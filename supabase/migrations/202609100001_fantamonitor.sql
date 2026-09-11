-- Dedicated FANTAMONITOR schema. Auth membership is provisioned by the project owner.
create table public.fm_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','viewer'))
);
create table public.fm_observations (
  id text primary key,
  observed_at timestamptz not null,
  round integer not null check (round between 1 and 35),
  imported_at timestamptz not null default now(),
  imported_by uuid,
  body jsonb not null,
  unique(round,observed_at)
);
create table public.fm_lineup_reviews (
  id uuid primary key default gen_random_uuid(),
  team text not null, round integer not null check(round between 1 and 35),
  revision integer not null check(revision>0),
  recorded_at timestamptz not null default now(), recorded_by uuid,
  body jsonb not null, unique(team,round,revision)
);
create table public.fm_source_events (id text primary key, body jsonb not null);
alter table public.fm_members enable row level security;
alter table public.fm_observations enable row level security;
alter table public.fm_lineup_reviews enable row level security;
alter table public.fm_source_events enable row level security;

create function public.fm_is_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fm_members where user_id=(select auth.uid()));
$$;
create function public.fm_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fm_members where user_id=(select auth.uid()) and role='admin');
$$;
revoke all on function public.fm_is_member(), public.fm_is_admin() from public,anon;
grant execute on function public.fm_is_member(),public.fm_is_admin() to authenticated;
create policy membership_self on public.fm_members for select to authenticated using(user_id=(select auth.uid()));
create policy observations_members on public.fm_observations for select to authenticated using((select public.fm_is_member()));
create policy reviews_members on public.fm_lineup_reviews for select to authenticated using((select public.fm_is_member()));
create policy events_members on public.fm_source_events for select to authenticated using((select public.fm_is_member()));
revoke all on public.fm_members,public.fm_observations,public.fm_lineup_reviews,public.fm_source_events from anon,authenticated;
grant select on public.fm_members,public.fm_observations,public.fm_lineup_reviews,public.fm_source_events to authenticated;
grant all on public.fm_members,public.fm_observations,public.fm_lineup_reviews,public.fm_source_events to service_role;

create function public.fm_valid_team(value text) returns boolean language sql immutable set search_path='' as $$
 select value=any(array['AC Idovalproico','Atletico Fontanelle','FC LBVLA','FC SEMINI','FC Villaggio Mau Mau','FDS Sballo','I PIPPISTRELLI','Pro Spritz','Real Hasbulla','Salamandre']);
$$;
revoke all on function public.fm_valid_team(text) from public,anon,authenticated;

-- One RPC = one transaction: any conflict rolls back the complete batch.
create function public.fm_import_observations(records jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; sample jsonb; old jsonb; t jsonb; day integer; stamp timestamptz; inserted_count integer:=0; duplicates integer:=0;
begin
 if not public.fm_is_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 if jsonb_typeof(records) is distinct from 'array' then raise exception 'invalid_records';end if;
 if jsonb_array_length(records) not between 1 and 100 then raise exception 'invalid_records';end if;
 perform pg_advisory_xact_lock(337500,1);
 for item in select value from jsonb_array_elements(records) loop
  sample:=item->'body';
  if jsonb_typeof(sample) is distinct from 'object' or length(item->>'id') is distinct from 64 then raise exception 'invalid_snapshot';end if;
  if sample->>'league' is distinct from 'chefantavitae10' or sample->>'season' is distinct from '2026-2027' or sample->>'competition_id' is distinct from '337500'
   or sample->'schema_version' is distinct from '1'::jsonb or sample->'expected_total' is distinct from '10'::jsonb or sample->>'source' is distinct from 'authenticated_ui' then raise exception 'invalid_scope';end if;
  day:=(sample->>'round')::integer;stamp:=(sample->>'observed_at')::timestamptz;
  if day is null or day not between 1 and 35 or stamp is null or stamp>now()+interval '1 minute' then raise exception 'invalid_round_time';end if;
  if coalesce(sample->>'source_url','') !~ ('^https://leghe[.]fantacalcio[.]it/chefantavitae10/view/competition/337500/manage-lineups/'||day::text||'([?].*)?$') then raise exception 'invalid_source';end if;
  if jsonb_typeof(sample->'teams') is distinct from 'array' then raise exception 'invalid_teams';end if;
  if jsonb_array_length(sample->'teams')<>10 or (select count(distinct value->>'name') from jsonb_array_elements(sample->'teams'))<>10 then raise exception 'invalid_teams';end if;
  for t in select value from jsonb_array_elements(sample->'teams') loop
   if not coalesce(public.fm_valid_team(t->>'name'),false) or t->>'team_key' is distinct from t->>'name' or jsonb_typeof(t->'present') is distinct from 'boolean'
     or t->>'source_status' is distinct from (case when (t->>'present')::boolean then 'check-circle' else 'Non inserita' end) then raise exception 'invalid_team';end if;
  end loop;
  if (sample->>'inserted')::integer is distinct from (select count(*)::integer from jsonb_array_elements(sample->'teams') where (value->>'present')::boolean) then raise exception 'invalid_count';end if;
  select body into old from public.fm_observations where round=day and observed_at=stamp;
  if found then
    if old<>sample then raise exception 'observation_conflict';end if;duplicates:=duplicates+1;
  else
    insert into public.fm_observations(id,round,observed_at,imported_by,body) values(item->>'id',day,stamp,auth.uid(),sample);inserted_count:=inserted_count+1;
  end if;
 end loop;
 return jsonb_build_object('imported',inserted_count,'duplicates',duplicates);
end;
$$;
revoke all on function public.fm_import_observations(jsonb) from public,anon;
grant execute on function public.fm_import_observations(jsonb) to authenticated;

create function public.fm_save_review(record jsonb,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare day integer; team_name text; outcome text; old public.fm_lineup_reviews; stamp timestamptz;
begin
 if not public.fm_is_admin() then raise exception 'admin_required' using errcode='42501';end if;
 if jsonb_typeof(record) is distinct from 'object' then raise exception 'invalid_review';end if;
 day:=(record->>'round')::integer;team_name:=record->>'team';outcome:=record->>'status';stamp:=(record->>'deadline')::timestamptz;
 if day is null or day not between 1 and 35 or not coalesce(public.fm_valid_team(team_name),false) or expected_revision is null or expected_revision<0 then raise exception 'invalid_review_scope';end if;
 if outcome is null or outcome not in ('delivered','missed','unverified') or length(trim(coalesce(record->>'note',''))) not between 10 and 2000 then raise exception 'invalid_review';end if;
 if outcome<>'unverified' and (stamp is null or stamp>now()) then raise exception 'past_deadline_required';end if;
 if coalesce(record->>'source_url','') !~ ('^https://leghe[.]fantacalcio[.]it/chefantavitae10/view/competition/337500/(round|manage-lineups)/'||day::text||'([?].*)?$') then raise exception 'invalid_source';end if;
 perform pg_advisory_xact_lock(337500,2);
 select * into old from public.fm_lineup_reviews where team=team_name and round=day order by revision desc limit 1;
 if old.revision=expected_revision+1 and old.body=record then return jsonb_build_object('saved',true,'duplicate',true);end if;
 if coalesce(old.revision,0)<>expected_revision then raise exception 'review_conflict';end if;
 insert into public.fm_lineup_reviews(team,round,revision,recorded_by,body) values(team_name,day,expected_revision+1,auth.uid(),record);
 return jsonb_build_object('saved',true,'duplicate',false);
end;
$$;
revoke all on function public.fm_save_review(jsonb,integer) from public,anon;
grant execute on function public.fm_save_review(jsonb,integer) to authenticated;
