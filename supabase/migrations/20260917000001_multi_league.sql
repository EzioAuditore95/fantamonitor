-- Multi-tenant schema: the league becomes a row, not a literal.
-- Every scope check that used to compare against 'chefantavitae10' / '2026-2027' / '337500'
-- now resolves a row in fm_leagues and reads the limits from it.

-- ---------------------------------------------------------------- new tables
create table public.fm_leagues (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  season text not null check (length(season) between 1 and 32),
  competition_id text not null check (competition_id ~ '^[0-9]{1,16}$'),
  name text not null check (length(name) between 1 and 80),
  round_count integer not null check (round_count between 1 and 60),
  serie_a_offset integer not null default 0 check (serie_a_offset between 0 and 20),
  period_mode text not null check (period_mode in ('half','season')),
  first_half_end integer,
  free_tokens integer not null default 1 check (free_tokens between 0 and 10),
  penalty_amount integer not null default 5 check (penalty_amount >= 0),
  telegram_chat_id text,
  telegram_thread_id text,
  telegram_admin_chat_id text,
  auto_sync_enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, season, competition_id),
  check (period_mode = 'season' or (first_half_end between 1 and round_count - 1))
);
-- The slug is interpolated into the source_url regexes below: the character class above
-- is what makes that interpolation safe, cheaper than escaping at every call site.

-- A table and not a jsonb column: fantacalcio_team_id is rediscovered on every capture by
-- intercepting an XHR, and persisting it removes a failure mode from the connector.
create table public.fm_league_teams (
  league_id uuid not null references public.fm_leagues(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  position integer not null check (position > 0),
  color text,
  fantacalcio_team_id integer,
  primary key (league_id, name),
  unique (league_id, position)
);

create table public.fm_memberships (
  league_id uuid not null references public.fm_leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.fm_leagues enable row level security;
alter table public.fm_league_teams enable row level security;
alter table public.fm_memberships enable row level security;

-- ------------------------------------------------------- seed the live league
-- The uuid is fixed so the seed is idempotent and lib/league.ts can name the same row.
insert into public.fm_leagues (id,slug,season,competition_id,name,round_count,serie_a_offset,
  period_mode,first_half_end,free_tokens,penalty_amount,auto_sync_enabled,rules)
values ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','chefantavitae10','2026-2027','337500','CheFantaVitaE10',
  35,3,'half',16,1,5,true,
  jsonb_build_object('season_label','Stagione 2026 / 27 · Serie A','mode_label','CLASSIC',
    'formula_one_base_eur',70,'europe_top',5));

insert into public.fm_league_teams (league_id,name,position,color) values
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','AC Idovalproico',1,'#b6a1f7'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','Atletico Fontanelle',2,'#efa88d'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','FC LBVLA',3,'#8bb8f6'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','FC SEMINI',4,'#e4bc6e'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','FC Villaggio Mau Mau',5,'#91cdd0'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','FDS Sballo',6,'#afbcf3'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','I PIPPISTRELLI',7,'#d4ee8a'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','Pro Spritz',8,'#f0a0b8'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','Real Hasbulla',9,'#c3e878'),
 ('9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13','Salamandre',10,'#b9a6ec');

insert into public.fm_memberships (league_id,user_id,role)
select '9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13',user_id,role from public.fm_members;

-- Refuse to backfill anything that is not this league: the body carries league/season/
-- competition_id, so the derivation is used here as a check, never as the mechanism.
do $$
begin
  if exists (select 1 from public.fm_observations
             where body->>'league' is distinct from 'chefantavitae10'
                or body->>'season' is distinct from '2026-2027'
                or body->>'competition_id' is distinct from '337500')
  then raise exception 'backfill_precondition_failed: fm_observations'; end if;
  if exists (select 1 from public.fm_lineup_reviews
             where body->>'source_url' not like 'https://leghe.fantacalcio.it/chefantavitae10/%')
  then raise exception 'backfill_precondition_failed: fm_lineup_reviews'; end if;
  if exists (select 1 from public.fm_source_events
             where coalesce(body->>'source_url','https://leghe.fantacalcio.it/chefantavitae10/') not like 'https://leghe.fantacalcio.it/chefantavitae10/%')
  then raise exception 'backfill_precondition_failed: fm_source_events'; end if;
end $$;

-- ------------------------------------------- league_id on the existing tables
-- The round CHECKs degrade to a structural bound: a CHECK cannot read fm_leagues,
-- so the exact limit moves into the RPCs, which do read round_count.
alter table public.fm_observations add column league_id uuid references public.fm_leagues(id) on delete cascade;
update public.fm_observations set league_id='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
alter table public.fm_observations alter column league_id set not null;
alter table public.fm_observations drop constraint fm_observations_round_observed_at_key;
alter table public.fm_observations add constraint fm_observations_league_round_observed_at_key unique (league_id,round,observed_at);
alter table public.fm_observations drop constraint fm_observations_round_check;
alter table public.fm_observations add constraint fm_observations_round_check check (round between 1 and 60);
create index fm_observations_league_idx on public.fm_observations(league_id,round);

alter table public.fm_lineup_reviews add column league_id uuid references public.fm_leagues(id) on delete cascade;
update public.fm_lineup_reviews set league_id='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
alter table public.fm_lineup_reviews alter column league_id set not null;
alter table public.fm_lineup_reviews drop constraint fm_lineup_reviews_team_round_revision_key;
alter table public.fm_lineup_reviews add constraint fm_lineup_reviews_league_team_round_revision_key unique (league_id,team,round,revision);
alter table public.fm_lineup_reviews drop constraint fm_lineup_reviews_round_check;
alter table public.fm_lineup_reviews add constraint fm_lineup_reviews_round_check check (round between 1 and 60);
create index fm_lineup_reviews_league_idx on public.fm_lineup_reviews(league_id,team,round);

alter table public.fm_source_events add column league_id uuid references public.fm_leagues(id) on delete cascade;
update public.fm_source_events set league_id='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
alter table public.fm_source_events alter column league_id set not null;
create index fm_source_events_league_idx on public.fm_source_events(league_id);

-- The auto-sync FK must become composite in the same transaction, otherwise a run of one
-- league can attach itself to the schedule of another.
alter table public.fm_auto_sync_runs drop constraint fm_auto_sync_runs_round_fkey;

alter table public.fm_round_schedule add column league_id uuid references public.fm_leagues(id) on delete cascade;
update public.fm_round_schedule set league_id='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
alter table public.fm_round_schedule alter column league_id set not null;
alter table public.fm_round_schedule drop constraint fm_round_schedule_pkey;
alter table public.fm_round_schedule add constraint fm_round_schedule_pkey primary key (league_id,round);
alter table public.fm_round_schedule drop constraint fm_round_schedule_round_check;
alter table public.fm_round_schedule add constraint fm_round_schedule_round_check check (round between 1 and 60);
alter table public.fm_round_schedule drop constraint fm_round_schedule_serie_a_round_check;
alter table public.fm_round_schedule add constraint fm_round_schedule_serie_a_round_check check (serie_a_round between 1 and 80);

alter table public.fm_auto_sync_runs add column league_id uuid references public.fm_leagues(id) on delete cascade;
update public.fm_auto_sync_runs set league_id='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
alter table public.fm_auto_sync_runs alter column league_id set not null;
alter table public.fm_auto_sync_runs drop constraint fm_auto_sync_runs_round_checkpoint_key;
alter table public.fm_auto_sync_runs add constraint fm_auto_sync_runs_league_round_checkpoint_key unique (league_id,round,checkpoint);
alter table public.fm_auto_sync_runs add constraint fm_auto_sync_runs_schedule_fkey
  foreign key (league_id,round) references public.fm_round_schedule(league_id,round) on delete cascade;
drop index public.fm_auto_sync_runs_round_idx;
create index fm_auto_sync_runs_league_idx on public.fm_auto_sync_runs(league_id,round,scheduled_at);

alter table public.fm_telegram_messages add column league_id uuid references public.fm_leagues(id) on delete cascade;
update public.fm_telegram_messages set league_id='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
alter table public.fm_telegram_messages alter column league_id set not null;
alter table public.fm_telegram_messages drop constraint fm_telegram_messages_pkey;
alter table public.fm_telegram_messages add constraint fm_telegram_messages_pkey primary key (league_id,round);
alter table public.fm_telegram_messages drop constraint fm_telegram_messages_round_check;
alter table public.fm_telegram_messages add constraint fm_telegram_messages_round_check check (round between 1 and 60);

-- ---------------------------------------------------- membership and policies
drop policy observations_members on public.fm_observations;
drop policy reviews_members on public.fm_lineup_reviews;
drop policy events_members on public.fm_source_events;
drop policy round_schedule_members on public.fm_round_schedule;
drop policy auto_sync_runs_members on public.fm_auto_sync_runs;
drop policy membership_self on public.fm_members;
-- Dropped, not kept as an overload: a policy written as fm_is_member() would still compile
-- and would open every league to every member.
drop function public.fm_is_member();
drop function public.fm_is_admin();

-- Returning the array keeps the policy an InitPlan evaluated once per query.
-- fm_is_member(league_id) inside a policy would be a correlated subquery, run per row.
-- The ::uuid[] cast in the policies is required: without it the parser reads
-- any((select f())) as the sub-SELECT form and compares uuid against uuid[].
create function public.fm_my_league_ids() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(league_id),'{}'::uuid[]) from public.fm_memberships where user_id=(select auth.uid());
$$;
create function public.fm_my_admin_league_ids() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(league_id),'{}'::uuid[]) from public.fm_memberships where user_id=(select auth.uid()) and role='admin';
$$;
create function public.fm_is_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select target is not null and target=any(public.fm_my_league_ids());
$$;
create function public.fm_is_admin(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select target is not null and target=any(public.fm_my_admin_league_ids());
$$;
revoke all on function public.fm_my_league_ids(),public.fm_my_admin_league_ids(),public.fm_is_member(uuid),public.fm_is_admin(uuid) from public,anon;
grant execute on function public.fm_my_league_ids(),public.fm_my_admin_league_ids(),public.fm_is_member(uuid),public.fm_is_admin(uuid) to authenticated;

-- Bridge used by the entry points that cannot yet name a league: the connector still calls
-- them with their original signature. Null when zero or several leagues are active, so the
-- ambiguity fails loudly instead of writing into the wrong league. Removed in the connector phase.
create function public.fm_default_league() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.fm_leagues where active and (select count(*) from public.fm_leagues where active)=1;
$$;
revoke all on function public.fm_default_league() from public,authenticated;
grant execute on function public.fm_default_league() to anon,service_role;

create policy leagues_members on public.fm_leagues for select to authenticated using (id=any((select public.fm_my_league_ids())::uuid[]));
create policy league_teams_members on public.fm_league_teams for select to authenticated using (league_id=any((select public.fm_my_league_ids())::uuid[]));
-- Reading fm_memberships from inside its own policy would recurse; fm_my_admin_league_ids
-- is security definer and therefore skips RLS.
create policy memberships_self on public.fm_memberships for select to authenticated using (user_id=(select auth.uid()) or league_id=any((select public.fm_my_admin_league_ids())::uuid[]));
create policy observations_members on public.fm_observations for select to authenticated using (league_id=any((select public.fm_my_league_ids())::uuid[]));
create policy reviews_members on public.fm_lineup_reviews for select to authenticated using (league_id=any((select public.fm_my_league_ids())::uuid[]));
create policy events_members on public.fm_source_events for select to authenticated using (league_id=any((select public.fm_my_league_ids())::uuid[]));
create policy round_schedule_members on public.fm_round_schedule for select to authenticated using (league_id=any((select public.fm_my_league_ids())::uuid[]));
create policy auto_sync_runs_members on public.fm_auto_sync_runs for select to authenticated using (league_id=any((select public.fm_my_league_ids())::uuid[]));

revoke all on public.fm_leagues,public.fm_league_teams,public.fm_memberships from anon,authenticated;
grant select on public.fm_leagues,public.fm_league_teams,public.fm_memberships to authenticated;
grant all on public.fm_leagues,public.fm_league_teams,public.fm_memberships to service_role;
-- fm_telegram_messages keeps RLS with no policy (deny by default) and loses the blanket
-- grant it was created with: only the security definer bot RPCs touch it.
revoke all on public.fm_telegram_messages from anon,authenticated;
grant all on public.fm_telegram_messages to service_role;

drop table public.fm_members;

-- -------------------------------------------------------- scope helpers (RPC)
create function public.fm_valid_team(league uuid,value text) returns boolean
-- stable, not immutable: it reads a table now, and an immutable declaration would let the
-- planner inline and cache a stale answer.
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fm_league_teams where league_id=league and name=value);
$$;
revoke all on function public.fm_valid_team(uuid,text) from public,anon,authenticated;

create function public.fm_league_team_count(target uuid) returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.fm_league_teams where league_id=target;
$$;
revoke all on function public.fm_league_team_count(uuid) from public,anon,authenticated;

-- The snapshot body carries league/season/competition_id, so the scope of an import is the
-- body itself: it is impossible to land a snapshot of league A inside league B.
create function public.fm_league_for_sample(sample jsonb) returns uuid language sql stable security definer set search_path='' as $$
 select l.id from public.fm_leagues l
 where l.active and l.slug=sample->>'league' and l.season=sample->>'season' and l.competition_id=sample->>'competition_id';
$$;
revoke all on function public.fm_league_for_sample(jsonb) from public,anon,authenticated;

-- Shared by the three importers, which used to carry three near-identical copies of this.
create function public.fm_assert_teams(target uuid,sample jsonb,day integer) returns void
language plpgsql stable security definer set search_path='' as $$
declare l record; t jsonb; team_total integer;
begin
 select slug,competition_id into l from public.fm_leagues where id=target;
 if not found then raise exception 'invalid_scope'; end if;
 team_total:=public.fm_league_team_count(target);
 if coalesce(sample->>'source_url','') !~ ('^https://leghe[.]fantacalcio[.]it/'||l.slug||'/view/competition/'||l.competition_id||'/manage-lineups/'||day::text||'([?].*)?$') then raise exception 'invalid_source'; end if;
 if jsonb_typeof(sample->'teams') is distinct from 'array' then raise exception 'invalid_teams'; end if;
 if jsonb_array_length(sample->'teams')<>team_total or (select count(distinct value->>'name') from jsonb_array_elements(sample->'teams'))<>team_total then raise exception 'invalid_teams'; end if;
 for t in select value from jsonb_array_elements(sample->'teams') loop
  if not coalesce(public.fm_valid_team(target,t->>'name'),false) or t->>'team_key' is distinct from t->>'name' or jsonb_typeof(t->'present') is distinct from 'boolean'
    or t->>'source_status' is distinct from (case when (t->>'present')::boolean then 'check-circle' else 'Non inserita' end) then raise exception 'invalid_team'; end if;
 end loop;
 if (sample->>'inserted')::integer is distinct from (select count(*)::integer from jsonb_array_elements(sample->'teams') where (value->>'present')::boolean) then raise exception 'invalid_count'; end if;
end;
$$;
revoke all on function public.fm_assert_teams(uuid,jsonb,integer) from public,anon,authenticated;

-- ------------------------------------------------------------- import and review
create or replace function public.fm_import_observations(records jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; sample jsonb; old jsonb; day integer; stamp timestamptz; inserted_count integer:=0; duplicates integer:=0; target uuid; batch_league uuid; limit_rounds integer;
begin
 -- Kept first so a non-admin never learns anything about the body it sent.
 if public.fm_my_admin_league_ids()='{}'::uuid[] then raise exception 'admin_required' using errcode='42501'; end if;
 if jsonb_typeof(records) is distinct from 'array' then raise exception 'invalid_records';end if;
 if jsonb_array_length(records) not between 1 and 100 then raise exception 'invalid_records';end if;
 for item in select value from jsonb_array_elements(records) loop
  sample:=item->'body';
  if jsonb_typeof(sample) is distinct from 'object' or length(item->>'id') is distinct from 64 then raise exception 'invalid_snapshot';end if;
  target:=public.fm_league_for_sample(sample);
  if target is null or sample->'schema_version' is distinct from '1'::jsonb
   or sample->'expected_total' is distinct from to_jsonb(public.fm_league_team_count(target))
   or sample->>'source' is distinct from 'authenticated_ui' then raise exception 'invalid_scope';end if;
  -- A batch spanning two leagues would be protected by the first league's lock only.
  if batch_league is null then
   batch_league:=target;
   if not public.fm_is_admin(batch_league) then raise exception 'admin_required' using errcode='42501';end if;
   perform pg_advisory_xact_lock(pg_catalog.hashtext(batch_league::text),1);
  elsif batch_league<>target then raise exception 'invalid_scope';
  end if;
  select round_count into limit_rounds from public.fm_leagues where id=target;
  day:=(sample->>'round')::integer;stamp:=(sample->>'observed_at')::timestamptz;
  if day is null or day not between 1 and limit_rounds or stamp is null or stamp>now()+interval '1 minute' then raise exception 'invalid_round_time';end if;
  perform public.fm_assert_teams(target,sample,day);
  select body into old from public.fm_observations where league_id=target and round=day and observed_at=stamp;
  if found then
    if old<>sample then raise exception 'observation_conflict';end if;duplicates:=duplicates+1;
  else
    insert into public.fm_observations(id,league_id,round,observed_at,imported_by,body) values(item->>'id',target,day,stamp,auth.uid(),sample);inserted_count:=inserted_count+1;
  end if;
 end loop;
 return jsonb_build_object('imported',inserted_count,'duplicates',duplicates);
end;
$$;

create function public.fm_save_review(record jsonb,expected_revision integer,league uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare day integer; team_name text; outcome text; old public.fm_lineup_reviews; stamp timestamptz; l record;
begin
 if not public.fm_is_admin(league) then raise exception 'admin_required' using errcode='42501';end if;
 select slug,competition_id,round_count into l from public.fm_leagues where id=league and active;
 if not found then raise exception 'invalid_review_scope';end if;
 if jsonb_typeof(record) is distinct from 'object' then raise exception 'invalid_review';end if;
 day:=(record->>'round')::integer;team_name:=record->>'team';outcome:=record->>'status';stamp:=(record->>'deadline')::timestamptz;
 if day is null or day not between 1 and l.round_count or not coalesce(public.fm_valid_team(league,team_name),false) or expected_revision is null or expected_revision<0 then raise exception 'invalid_review_scope';end if;
 if outcome is null or outcome not in ('delivered','missed','unverified') or length(trim(coalesce(record->>'note',''))) not between 10 and 2000 then raise exception 'invalid_review';end if;
 if outcome<>'unverified' and (stamp is null or stamp>now()) then raise exception 'past_deadline_required';end if;
 if coalesce(record->>'source_url','') !~ ('^https://leghe[.]fantacalcio[.]it/'||l.slug||'/view/competition/'||l.competition_id||'/(round|manage-lineups)/'||day::text||'([?].*)?$') then raise exception 'invalid_source';end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtext(league::text),2);
 select * into old from public.fm_lineup_reviews where league_id=league and team=team_name and round=day order by revision desc limit 1;
 if old.revision=expected_revision+1 and old.body=record then return jsonb_build_object('saved',true,'duplicate',true);end if;
 if coalesce(old.revision,0)<>expected_revision then raise exception 'review_conflict';end if;
 insert into public.fm_lineup_reviews(league_id,team,round,revision,recorded_by,body) values(league,team_name,day,expected_revision+1,auth.uid(),record);
 return jsonb_build_object('saved',true,'duplicate',false);
end;
$$;
revoke all on function public.fm_save_review(jsonb,integer,uuid) from public,anon;
grant execute on function public.fm_save_review(jsonb,integer,uuid) to authenticated;

-- Expand/contract shim: the app moves to the three-argument form in the routing phase.
create or replace function public.fm_save_review(record jsonb,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target:=public.fm_default_league();
 if target is null then raise exception 'league_required';end if;
 return public.fm_save_review(record,expected_revision,target);
end;
$$;

-- ------------------------------------------------------------------ auto-sync
create or replace function public.fm_claim_due_auto_sync(access_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record; reclaimed integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 for c in
  with candidates as (
   select s.league_id,s.round,v.checkpoint,
    case v.checkpoint when 'T-24h' then s.start_at-interval '24 hours' when 'T-12h' then s.start_at-interval '12 hours'
     when 'T-1h' then s.start_at-interval '1 hour' when 'T-15m' then s.start_at-interval '15 minutes' when 'T+5m' then s.start_at+interval '5 minutes' end scheduled_at
   from public.fm_round_schedule s
   join public.fm_leagues g on g.id=s.league_id and g.active and g.auto_sync_enabled
   cross join (values('T-24h'),('T-12h'),('T-1h'),('T-15m'),('T+5m')) v(checkpoint) where s.start_at is not null
  ) select * from candidates x where now()>=x.scheduled_at and now()<x.scheduled_at+interval '10 minutes' order by x.scheduled_at
 loop
  insert into public.fm_auto_sync_runs(league_id,round,checkpoint,scheduled_at,status) values(c.league_id,c.round,c.checkpoint,c.scheduled_at,'running') on conflict(league_id,round,checkpoint) do nothing;
  if found then return jsonb_build_object('league_id',c.league_id,'round',c.round,'checkpoint',c.checkpoint,'scheduled_at',c.scheduled_at); end if;
  update public.fm_auto_sync_runs set status='running',claimed_at=now(),executed_at=null,error=null,attempt_count=attempt_count+1
   where league_id=c.league_id and round=c.round and checkpoint=c.checkpoint and status='failed' and attempt_count<3 and now()>=c.scheduled_at and now()<c.scheduled_at+interval '10 minutes';
  get diagnostics reclaimed=row_count;
  if reclaimed=1 then return jsonb_build_object('league_id',c.league_id,'round',c.round,'checkpoint',c.checkpoint,'scheduled_at',c.scheduled_at); end if;
 end loop;
 return null;
end;
$$;

create or replace function public.fm_complete_auto_sync(access_key text,day integer,checkpoint_name text,sample jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz;identifier text;inserted_count integer:=0;target uuid;limit_rounds integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if jsonb_typeof(sample) is distinct from 'object' then raise exception 'invalid_snapshot'; end if;
 target:=public.fm_league_for_sample(sample);
 if target is null then raise exception 'invalid_snapshot'; end if;
 select round_count into limit_rounds from public.fm_leagues where id=target;
 if day not between 1 and limit_rounds or checkpoint_name not in ('T-24h','T-12h','T-1h','T-15m','T+5m') then raise exception 'invalid_scope'; end if;
 if not exists(select 1 from public.fm_auto_sync_runs where league_id=target and round=day and checkpoint=checkpoint_name and status='running') then raise exception 'claim_required'; end if;
 if sample->'schema_version' is distinct from '1'::jsonb or sample->'expected_total' is distinct from to_jsonb(public.fm_league_team_count(target))
  or sample->>'source' is distinct from 'authenticated_ui' or (sample->>'round')::integer is distinct from day then raise exception 'invalid_snapshot'; end if;
 stamp=(sample->>'observed_at')::timestamptz;
 if stamp is null or stamp>now()+interval '1 minute' or stamp<now()-interval '5 minutes' then raise exception 'invalid_snapshot_time'; end if;
 perform public.fm_assert_teams(target,sample,day);
 identifier=encode(extensions.digest(convert_to(sample::text,'UTF8'),'sha256'),'hex');
 insert into public.fm_observations(id,league_id,round,observed_at,imported_by,body) values(identifier,target,day,stamp,null,sample) on conflict(league_id,round,observed_at) do nothing;
 get diagnostics inserted_count=row_count;
 update public.fm_auto_sync_runs set status='success',executed_at=now(),observation_id=case when inserted_count=1 then identifier else observation_id end,error=null where league_id=target and round=day and checkpoint=checkpoint_name;
 return jsonb_build_object('ok',true,'inserted',inserted_count);
end;
$$;

create or replace function public.fm_fail_auto_sync(access_key text,day integer,checkpoint_name text,error_text text) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 target:=public.fm_default_league();
 if target is null then raise exception 'league_required'; end if;
 update public.fm_auto_sync_runs set status='failed',executed_at=now(),error=left(coalesce(error_text,'unknown'),500)
 where league_id=target and round=day and checkpoint=checkpoint_name and status='running';
end;
$$;

-- ----------------------------------------------------------------- bot RPCs
create or replace function public.fm_bot_import_snapshot(access_key text,sample jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; identifier text; inserted_count integer:=0; day integer; target uuid; limit_rounds integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if jsonb_typeof(sample) is distinct from 'object' then raise exception 'invalid_snapshot'; end if;
 target:=public.fm_league_for_sample(sample);
 if target is null or sample->'schema_version' is distinct from '1'::jsonb
  or sample->'expected_total' is distinct from to_jsonb(public.fm_league_team_count(target))
  or sample->>'source' is distinct from 'authenticated_ui' then raise exception 'invalid_snapshot'; end if;
 select round_count into limit_rounds from public.fm_leagues where id=target;
 day=(sample->>'round')::integer;
 stamp=(sample->>'observed_at')::timestamptz;
 if day not between 1 and limit_rounds or stamp is null or stamp>now()+interval '1 minute' or stamp<now()-interval '5 minutes' then raise exception 'invalid_snapshot_time'; end if;
 perform public.fm_assert_teams(target,sample,day);
 identifier=encode(extensions.digest(convert_to(sample::text,'UTF8'),'sha256'),'hex');
 insert into public.fm_observations(id,league_id,round,observed_at,imported_by,body) values(identifier,target,day,stamp,null,sample)
 on conflict(league_id,round,observed_at) do nothing;
 get diagnostics inserted_count = row_count;
 return jsonb_build_object('ok',true,'inserted',inserted_count,'id',identifier);
end;
$$;

create or replace function public.fm_current_round_for_bot(access_key text) returns integer
language plpgsql security definer set search_path='' as $$
declare d integer; target uuid;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 target:=public.fm_default_league();
 if target is null then raise exception 'league_required'; end if;
 select round into d from public.fm_round_schedule where league_id=target and start_at >= now()-interval '6 hours' order by start_at asc limit 1;
 if d is null then
  select round into d from public.fm_round_schedule where league_id=target order by start_at desc limit 1;
 end if;
 return d;
end;
$$;

create or replace function public.fm_next_round_for_bot(access_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; target uuid;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 target:=public.fm_default_league();
 if target is null then raise exception 'league_required'; end if;
 select round,serie_a_round,start_at into r from public.fm_round_schedule
 where league_id=target and start_at >= now()-interval '6 hours' order by start_at asc limit 1;
 if not found then return null; end if;
 return jsonb_build_object('round',r.round,'serie_a_round',r.serie_a_round,'start_at',r.start_at);
end;
$$;

create or replace function public.fm_get_telegram_message(access_key text,day integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; target uuid;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 target:=public.fm_default_league();
 if target is null then raise exception 'league_required'; end if;
 select round,chat_id,message_id,last_checkpoint,updated_at into r from public.fm_telegram_messages where league_id=target and round=day;
 if not found then return null; end if;
 return jsonb_build_object('round',r.round,'chat_id',r.chat_id,'message_id',r.message_id,'last_checkpoint',r.last_checkpoint,'updated_at',r.updated_at);
end;
$$;

create or replace function public.fm_upsert_telegram_message(access_key text,day integer,target_chat_id text,telegram_message_id bigint,checkpoint_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; limit_rounds integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 target:=public.fm_default_league();
 if target is null then raise exception 'league_required'; end if;
 select round_count into limit_rounds from public.fm_leagues where id=target;
 if day not between 1 and limit_rounds or telegram_message_id <= 0 or length(target_chat_id)=0 then raise exception 'invalid_telegram_state'; end if;
 insert into public.fm_telegram_messages(league_id,round,chat_id,message_id,last_checkpoint,updated_at)
 values(target,day,target_chat_id,telegram_message_id,checkpoint_name,now())
 on conflict(league_id,round) do update set chat_id=excluded.chat_id,message_id=excluded.message_id,last_checkpoint=excluded.last_checkpoint,updated_at=now();
 return jsonb_build_object('ok',true);
end;
$$;

-- Every caller now names its league; the single-argument form would silently accept a team
-- belonging to a different one.
drop function public.fm_valid_team(text);
