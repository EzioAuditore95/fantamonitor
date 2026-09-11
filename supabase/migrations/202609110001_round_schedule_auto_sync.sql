-- Round schedule + audited automatic lineup synchronization.
-- Production was migrated on 2026-09-11; this file is the source of truth for new environments.
create extension if not exists pgcrypto;

create table public.fm_round_schedule (
  round integer primary key check (round between 1 and 35),
  serie_a_round integer not null check (serie_a_round between 1 and 38),
  start_at timestamptz,
  source text not null default 'fantacalcio_api',
  source_url text,
  updated_at timestamptz not null default now()
);

create table public.fm_auto_sync_runs (
  id uuid primary key default gen_random_uuid(),
  round integer not null references public.fm_round_schedule(round) on delete cascade,
  checkpoint text not null check (checkpoint in ('T-24h','T-12h','T-1h','T-15m','T+5m')),
  scheduled_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  executed_at timestamptz,
  status text not null check (status in ('running','success','failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  observation_id text references public.fm_observations(id) on delete set null,
  error text,
  unique(round,checkpoint)
);

alter table public.fm_round_schedule enable row level security;
alter table public.fm_auto_sync_runs enable row level security;
create policy round_schedule_members on public.fm_round_schedule for select to authenticated using ((select public.fm_is_member()));
create policy auto_sync_runs_members on public.fm_auto_sync_runs for select to authenticated using ((select public.fm_is_member()));
revoke all on public.fm_round_schedule,public.fm_auto_sync_runs from anon,authenticated;
grant select on public.fm_round_schedule,public.fm_auto_sync_runs to authenticated;
grant all on public.fm_round_schedule,public.fm_auto_sync_runs to service_role;
create index fm_round_schedule_start_idx on public.fm_round_schedule(start_at);
create index fm_auto_sync_runs_round_idx on public.fm_auto_sync_runs(round,scheduled_at);

-- Fantacalcio's competition calendar maps league round r to Serie A round r+3.
insert into public.fm_round_schedule(round,serie_a_round,start_at,source,source_url)
select r,r+3,null,'fantacalcio_api','https://apileague.fantacalcio.it/onboarding/v1/league/competition/calendar/337500'
from generate_series(1,35) r;

-- Kickoffs currently published by Lega Serie A. Future rows remain NULL until official times are known.
update public.fm_round_schedule set start_at='2026-09-11 20:45:00+02',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://images.legaseriea.it/image/private/fl_attachment/prd/czailts3apyt3kuxjran.pdf' where round=1;
update public.fm_round_schedule set start_at='2026-09-18 20:45:00+02',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://images.legaseriea.it/image/private/fl_attachment/prd/czailts3apyt3kuxjran.pdf' where round=2;
update public.fm_round_schedule set start_at='2026-10-10 15:00:00+02',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=3;
update public.fm_round_schedule set start_at='2026-10-16 20:45:00+02',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=4;
update public.fm_round_schedule set start_at='2026-10-23 20:45:00+02',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=5;
update public.fm_round_schedule set start_at='2026-10-27 18:30:00+01',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=6;
update public.fm_round_schedule set start_at='2026-10-31 15:00:00+01',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=7;
update public.fm_round_schedule set start_at='2026-11-06 20:45:00+01',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=8;
update public.fm_round_schedule set start_at='2026-11-21 15:00:00+01',source='fantacalcio_mapping+lega_serie_a_official',source_url='https://www.legaseriea.it/serie-a/news/quando-si-gioca-anticipi-e-posticipi-fino-alla-12a-giornata' where round=9;

-- Only the Railway connector knows the plaintext key; the database keeps its SHA-256 digest.
create or replace function public.fm_auto_sync_authorized(access_key text) returns boolean
language sql immutable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(coalesce(access_key,''),'UTF8'),'sha256'),'hex')='4aea953195f6925d6de5c82424dfdc5633e07e832cbea1b428a19799bc9a5212';
$$;
revoke all on function public.fm_auto_sync_authorized(text) from public,authenticated;
grant execute on function public.fm_auto_sync_authorized(text) to anon,service_role;

create or replace function public.fm_claim_due_auto_sync(access_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record; reclaimed integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 for c in
  with candidates as (
   select s.round,v.checkpoint,
    case v.checkpoint when 'T-24h' then s.start_at-interval '24 hours' when 'T-12h' then s.start_at-interval '12 hours'
     when 'T-1h' then s.start_at-interval '1 hour' when 'T-15m' then s.start_at-interval '15 minutes' when 'T+5m' then s.start_at+interval '5 minutes' end scheduled_at
   from public.fm_round_schedule s cross join (values('T-24h'),('T-12h'),('T-1h'),('T-15m'),('T+5m')) v(checkpoint) where s.start_at is not null
  ) select * from candidates x where now()>=x.scheduled_at and now()<x.scheduled_at+interval '10 minutes' order by x.scheduled_at
 loop
  insert into public.fm_auto_sync_runs(round,checkpoint,scheduled_at,status) values(c.round,c.checkpoint,c.scheduled_at,'running') on conflict(round,checkpoint) do nothing;
  if found then return jsonb_build_object('round',c.round,'checkpoint',c.checkpoint,'scheduled_at',c.scheduled_at); end if;
  update public.fm_auto_sync_runs set status='running',claimed_at=now(),executed_at=null,error=null,attempt_count=attempt_count+1
   where round=c.round and checkpoint=c.checkpoint and status='failed' and attempt_count<3 and now()>=c.scheduled_at and now()<c.scheduled_at+interval '10 minutes';
  get diagnostics reclaimed=row_count;
  if reclaimed=1 then return jsonb_build_object('round',c.round,'checkpoint',c.checkpoint,'scheduled_at',c.scheduled_at); end if;
 end loop;
 return null;
end;
$$;
revoke all on function public.fm_claim_due_auto_sync(text) from public,authenticated;
grant execute on function public.fm_claim_due_auto_sync(text) to anon,service_role;

create or replace function public.fm_complete_auto_sync(access_key text,day integer,checkpoint_name text,sample jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb;stamp timestamptz;identifier text;inserted_count integer:=0;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if day not between 1 and 35 or checkpoint_name not in ('T-24h','T-12h','T-1h','T-15m','T+5m') then raise exception 'invalid_scope'; end if;
 if not exists(select 1 from public.fm_auto_sync_runs where round=day and checkpoint=checkpoint_name and status='running') then raise exception 'claim_required'; end if;
 if jsonb_typeof(sample) is distinct from 'object' or sample->>'league' is distinct from 'chefantavitae10' or sample->>'season' is distinct from '2026-2027' or sample->>'competition_id' is distinct from '337500'
  or sample->'schema_version' is distinct from '1'::jsonb or sample->'expected_total' is distinct from '10'::jsonb or sample->>'source' is distinct from 'authenticated_ui' or (sample->>'round')::integer is distinct from day then raise exception 'invalid_snapshot'; end if;
 stamp=(sample->>'observed_at')::timestamptz;
 if stamp is null or stamp>now()+interval '1 minute' or stamp<now()-interval '5 minutes' then raise exception 'invalid_snapshot_time'; end if;
 if coalesce(sample->>'source_url','') !~ ('^https://leghe[.]fantacalcio[.]it/chefantavitae10/view/competition/337500/manage-lineups/'||day::text||'([?].*)?$') then raise exception 'invalid_source'; end if;
 if jsonb_typeof(sample->'teams') is distinct from 'array' or jsonb_array_length(sample->'teams')<>10 or (select count(distinct value->>'name') from jsonb_array_elements(sample->'teams'))<>10 then raise exception 'invalid_teams'; end if;
 for t in select value from jsonb_array_elements(sample->'teams') loop
  if not coalesce(public.fm_valid_team(t->>'name'),false) or t->>'team_key' is distinct from t->>'name' or jsonb_typeof(t->'present') is distinct from 'boolean'
   or t->>'source_status' is distinct from (case when (t->>'present')::boolean then 'check-circle' else 'Non inserita' end) then raise exception 'invalid_team'; end if;
 end loop;
 if (sample->>'inserted')::integer is distinct from (select count(*)::integer from jsonb_array_elements(sample->'teams') where (value->>'present')::boolean) then raise exception 'invalid_count'; end if;
 identifier=encode(extensions.digest(convert_to(sample::text,'UTF8'),'sha256'),'hex');
 insert into public.fm_observations(id,round,observed_at,imported_by,body) values(identifier,day,stamp,null,sample) on conflict(round,observed_at) do nothing;
 get diagnostics inserted_count=row_count;
 update public.fm_auto_sync_runs set status='success',executed_at=now(),observation_id=case when inserted_count=1 then identifier else observation_id end,error=null where round=day and checkpoint=checkpoint_name;
 return jsonb_build_object('ok',true,'inserted',inserted_count);
end;
$$;
revoke all on function public.fm_complete_auto_sync(text,integer,text,jsonb) from public,authenticated;
grant execute on function public.fm_complete_auto_sync(text,integer,text,jsonb) to anon,service_role;

create or replace function public.fm_fail_auto_sync(access_key text,day integer,checkpoint_name text,error_text text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 update public.fm_auto_sync_runs set status='failed',executed_at=now(),error=left(coalesce(error_text,'unknown'),500)
 where round=day and checkpoint=checkpoint_name and status='running';
end;
$$;
revoke all on function public.fm_fail_auto_sync(text,integer,text,text) from public,authenticated;
grant execute on function public.fm_fail_auto_sync(text,integer,text,text) to anon,service_role;
