-- The in-database scheduler was written when one league was the only possibility: it joined
-- fm_auto_sync_runs to fm_round_schedule on `round` alone, so with two leagues it would read
-- another league's run to decide whether a checkpoint still needs booking, and the cron job
-- names would collide. It now books the next pending checkpoint of every active league.
create or replace function public.fm_schedule_next_event(p_after timestamp with time zone default now())
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  r record;
  v_retry timestamptz;
  v_tag text;
  v_main_name text;
  v_retry_name text;
  booked jsonb := '[]'::jsonb;
begin
  for r in
    select distinct on (q.league_id) q.league_id, q.slug, q.round, q.checkpoint, q.scheduled_at
    from (
      select s.league_id, g.slug, s.round, x.checkpoint, s.start_at + x.delta as scheduled_at
      from public.fm_round_schedule s
      join public.fm_leagues g on g.id = s.league_id and g.active and g.auto_sync_enabled
      cross join (values
        ('T-24h'::text, interval '-24 hours'),
        ('T-12h'::text, interval '-12 hours'),
        ('T-1h'::text, interval '-1 hour'),
        ('T-15m'::text, interval '-15 minutes'),
        ('T+5m'::text, interval '5 minutes')
      ) as x(checkpoint, delta)
      -- Joining on the league as well is the whole point of this migration.
      left join public.fm_auto_sync_runs a
        on a.league_id = s.league_id and a.round = s.round and a.checkpoint = x.checkpoint
      where s.start_at is not null
        and s.start_at + x.delta > p_after
        and coalesce(a.status,'') not in ('success','skipped')
    ) q
    order by q.league_id, q.scheduled_at asc
  loop
    v_retry := r.scheduled_at + interval '5 minutes';
    -- The league goes into the job name: without it two leagues sharing a kickoff would
    -- overwrite each other's cron entry.
    v_tag := left(replace(r.league_id::text,'-',''),8)||'_r'||r.round||'_'||regexp_replace(lower(r.checkpoint),'[^a-z0-9]+','_','g');
    v_main_name := 'fm_evt_'||v_tag||'_main';
    v_retry_name := 'fm_evt_'||v_tag||'_retry';
    perform cron.schedule(v_main_name, to_char(r.scheduled_at at time zone 'UTC','MI HH24 DD MM')||' *',
      format('select public.fm_fire_scheduler_event(%L,%L::timestamptz,false);',v_main_name,r.scheduled_at::text));
    perform cron.schedule(v_retry_name, to_char(v_retry at time zone 'UTC','MI HH24 DD MM')||' *',
      format('select public.fm_fire_scheduler_event(%L,%L::timestamptz,true);',v_retry_name,v_retry::text));
    booked := booked || jsonb_build_object('league',r.slug,'round',r.round,'checkpoint',r.checkpoint,
      'scheduled_at',r.scheduled_at,'main_job',v_main_name,'retry_job',v_retry_name);
  end loop;
  if jsonb_array_length(booked)=0 then return jsonb_build_object('status','no_future_checkpoint'); end if;
  return jsonb_build_object('status','scheduled','booked',booked);
end;
$function$;
