-- Reconcile bot RPCs and Telegram message state created manually in production.
-- Keep these definitions aligned with production: later migrations may evolve them.
create table if not exists public.fm_telegram_messages (
  round integer primary key check (round >= 1 and round <= 35),
  chat_id text not null,
  message_id bigint not null,
  last_checkpoint text,
  updated_at timestamptz not null default now()
);

alter table public.fm_telegram_messages enable row level security;
grant all on table public.fm_telegram_messages to anon, authenticated, service_role;

create or replace function public.fm_bot_import_snapshot(access_key text, sample jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare t jsonb; stamp timestamptz; identifier text; inserted_count integer:=0; day integer;
begin
  if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
  if jsonb_typeof(sample) is distinct from 'object' or sample->>'league' is distinct from 'chefantavitae10' or sample->>'season' is distinct from '2026-2027' or sample->>'competition_id' is distinct from '337500'
    or sample->'schema_version' is distinct from '1'::jsonb or sample->'expected_total' is distinct from '10'::jsonb or sample->>'source' is distinct from 'authenticated_ui' then raise exception 'invalid_snapshot'; end if;
  day=(sample->>'round')::integer;
  stamp=(sample->>'observed_at')::timestamptz;
  if day not between 1 and 35 or stamp is null or stamp>now()+interval '1 minute' or stamp<now()-interval '5 minutes' then raise exception 'invalid_snapshot_time'; end if;
  if coalesce(sample->>'source_url','') !~ ('^https://leghe[.]fantacalcio[.]it/chefantavitae10/view/competition/337500/manage-lineups/'||day::text||'([?].*)?$') then raise exception 'invalid_source'; end if;
  if jsonb_typeof(sample->'teams') is distinct from 'array' or jsonb_array_length(sample->'teams')<>10 or (select count(distinct value->>'name') from jsonb_array_elements(sample->'teams'))<>10 then raise exception 'invalid_teams'; end if;
  for t in select value from jsonb_array_elements(sample->'teams') loop
    if not coalesce(public.fm_valid_team(t->>'name'),false) or t->>'team_key' is distinct from t->>'name' or jsonb_typeof(t->'present') is distinct from 'boolean'
      or t->>'source_status' is distinct from (case when (t->>'present')::boolean then 'check-circle' else 'Non inserita' end) then raise exception 'invalid_team'; end if;
  end loop;
  if (sample->>'inserted')::integer is distinct from (select count(*)::integer from jsonb_array_elements(sample->'teams') where (value->>'present')::boolean) then raise exception 'invalid_count'; end if;
  identifier=encode(extensions.digest(convert_to(sample::text,'UTF8'),'sha256'),'hex');
  insert into public.fm_observations(id,round,observed_at,imported_by,body) values(identifier,day,stamp,null,sample)
  on conflict(round,observed_at) do nothing;
  get diagnostics inserted_count = row_count;
  return jsonb_build_object('ok',true,'inserted',inserted_count,'id',identifier);
end;
$function$;

create or replace function public.fm_current_round_for_bot(access_key text)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare d integer;
begin
  if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
  select round into d
  from public.fm_round_schedule
  where start_at >= now()-interval '6 hours'
  order by start_at asc
  limit 1;
  if d is null then
    select round into d from public.fm_round_schedule order by start_at desc limit 1;
  end if;
  return d;
end;
$function$;

create or replace function public.fm_get_telegram_message(access_key text, day integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
  if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
  select round,chat_id,message_id,last_checkpoint,updated_at into r from public.fm_telegram_messages where round=day;
  if not found then return null; end if;
  return jsonb_build_object('round',r.round,'chat_id',r.chat_id,'message_id',r.message_id,'last_checkpoint',r.last_checkpoint,'updated_at',r.updated_at);
end;
$function$;

create or replace function public.fm_next_round_for_bot(access_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
  if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
  select round,serie_a_round,start_at into r
  from public.fm_round_schedule
  where start_at >= now()-interval '6 hours'
  order by start_at asc
  limit 1;
  if not found then return null; end if;
  return jsonb_build_object('round',r.round,'serie_a_round',r.serie_a_round,'start_at',r.start_at);
end;
$function$;

create or replace function public.fm_upsert_telegram_message(access_key text, day integer, target_chat_id text, telegram_message_id bigint, checkpoint_name text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
  if day not between 1 and 35 or telegram_message_id <= 0 or length(target_chat_id)=0 then raise exception 'invalid_telegram_state'; end if;
  insert into public.fm_telegram_messages(round,chat_id,message_id,last_checkpoint,updated_at)
  values(day,target_chat_id,telegram_message_id,checkpoint_name,now())
  on conflict(round) do update set chat_id=excluded.chat_id,message_id=excluded.message_id,last_checkpoint=excluded.last_checkpoint,updated_at=now();
  return jsonb_build_object('ok',true);
end;
$function$;

grant execute on function public.fm_bot_import_snapshot(text,jsonb) to anon, authenticated, service_role;
grant execute on function public.fm_get_telegram_message(text,integer) to anon, authenticated, service_role;
grant execute on function public.fm_upsert_telegram_message(text,integer,text,bigint,text) to anon, authenticated, service_role;
grant execute on function public.fm_current_round_for_bot(text) to anon, authenticated, service_role;
grant execute on function public.fm_next_round_for_bot(text) to anon, authenticated, service_role;
