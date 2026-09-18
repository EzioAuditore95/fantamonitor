-- Reconcile the scheduler that lives inside the database.
--
-- Production drives the automatic synchronization from Postgres itself, not from GitHub
-- Actions: pg_cron fires fm_fire_scheduler_event, which reads a URL and a bearer token from
-- Vault and calls the scheduler service over pg_net; fm_schedule_next_event then books the
-- next checkpoint. None of this was in the repo, so CI could not see it and the deployment
-- notes contradicted it. Transcribed here verbatim from production on 2026-09-19.
--
-- pg_cron, pg_net and Vault are managed extensions of the Supabase project; this migration
-- assumes they are installed and does not create them. The function bodies resolve those
-- schemas only when called, so the file still runs in the PGlite test database.

-- Production also allows a fourth run status the repo never had: a checkpoint can be
-- skipped, and fm_schedule_next_event treats 'skipped' like 'success' when looking for the
-- next thing to book.
alter table public.fm_auto_sync_runs drop constraint if exists fm_auto_sync_runs_status_check;
alter table public.fm_auto_sync_runs add constraint fm_auto_sync_runs_status_check
  check (status in ('running','success','failed','skipped'));

CREATE OR REPLACE FUNCTION "public"."fm_schedule_next_event"("p_after" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_round integer;
  v_checkpoint text;
  v_target timestamptz;
  v_retry timestamptz;
  v_slug text;
  v_main_name text;
  v_retry_name text;
  v_main_cron text;
  v_retry_cron text;
begin
  select q.round, q.checkpoint, q.scheduled_at
  into v_round, v_checkpoint, v_target
  from (
    select s.round, x.checkpoint, s.start_at + x.delta as scheduled_at
    from public.fm_round_schedule s
    cross join (values
      ('T-24h'::text, interval '-24 hours'),
      ('T-12h'::text, interval '-12 hours'),
      ('T-1h'::text, interval '-1 hour'),
      ('T-15m'::text, interval '-15 minutes'),
      ('T+5m'::text, interval '5 minutes')
    ) as x(checkpoint, delta)
    left join public.fm_auto_sync_runs r
      on r.round=s.round and r.checkpoint=x.checkpoint
    where s.start_at + x.delta > p_after
      and coalesce(r.status,'') not in ('success','skipped')
    order by scheduled_at asc
    limit 1
  ) q;

  if v_target is null then
    return jsonb_build_object('status','no_future_checkpoint');
  end if;

  v_retry := v_target + interval '5 minutes';
  v_slug := regexp_replace(lower(v_checkpoint),'[^a-z0-9]+','_','g');
  v_main_name := format('fm_evt_r%s_%s_main',v_round,v_slug);
  v_retry_name := format('fm_evt_r%s_%s_retry',v_round,v_slug);
  v_main_cron := to_char(v_target at time zone 'UTC','MI HH24 DD MM') || ' *';
  v_retry_cron := to_char(v_retry at time zone 'UTC','MI HH24 DD MM') || ' *';

  perform cron.schedule(
    v_main_name,
    v_main_cron,
    format('select public.fm_fire_scheduler_event(%L,%L::timestamptz,false);',v_main_name,v_target::text)
  );
  perform cron.schedule(
    v_retry_name,
    v_retry_cron,
    format('select public.fm_fire_scheduler_event(%L,%L::timestamptz,true);',v_retry_name,v_retry::text)
  );

  return jsonb_build_object(
    'status','scheduled',
    'round',v_round,
    'checkpoint',v_checkpoint,
    'scheduled_at',v_target,
    'retry_at',v_retry,
    'main_job',v_main_name,
    'retry_job',v_retry_name
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fm_fire_scheduler_event"("p_job_name" "text", "p_fire_at" timestamp with time zone, "p_is_retry" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  -- Prevent an old yearly cron expression from firing outside its intended window.
  if abs(extract(epoch from (now() - p_fire_at))) > 900 then
    perform cron.unschedule(p_job_name);
    perform public.fm_schedule_next_event(now());
    return null;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name='fm_event_scheduler_url'
  limit 1;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='fm_event_scheduler_secret'
  limit 1;

  if coalesce(v_url,'')='' or coalesce(v_secret,'')='' then
    raise exception 'event_scheduler_vault_not_configured';
  end if;

  select net.http_post(
    url := rtrim(v_url,'/') || '/run',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || v_secret
    ),
    body := jsonb_build_object('source','supabase-cron','retry',p_is_retry,'scheduled_at',p_fire_at),
    timeout_milliseconds := 120000
  ) into v_request_id;

  perform cron.unschedule(p_job_name);
  perform public.fm_schedule_next_event(p_fire_at + interval '1 second');
  return v_request_id;
end;
$$;