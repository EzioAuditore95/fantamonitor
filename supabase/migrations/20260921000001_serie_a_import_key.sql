-- Second door on the Serie A import, for the caller that has no session.
--
-- The admin gate added with the tables works for the button and for nothing else: a scheduled
-- run is not a logged-in user. This is the same shape as fm_auto_sync_authorized — the migration
-- keeps only the digest, the plaintext lives in FM_SERIE_A_IMPORT_KEY on Vercel — and the two
-- keys are deliberately different: the auto-sync one opens the league's own data, this one opens
-- a public championship table, and they should never be able to stand in for each other.

create or replace function public.fm_serie_a_import_authorized(access_key text)
returns boolean language sql immutable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(coalesce(access_key,''),'UTF8'),'sha256'),'hex')='be86a8651be0f28e9d6b8815066e6565f3df8a4b6cdaae386a7fbc416bc0c987';
$$;
revoke all on function public.fm_serie_a_import_authorized(text) from public,authenticated;
grant execute on function public.fm_serie_a_import_authorized(text) to anon,service_role;

-- Dropped and recreated rather than overloaded: PostgREST resolves a function by the names of
-- the arguments it is given, and two candidates named alike would make the one-argument call
-- ambiguous at runtime, where neither the SQL tests nor the type checker would see it.
drop function if exists public.fm_import_serie_a_round(jsonb);
create function public.fm_import_serie_a_round(payload jsonb, access_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_season text; v_round integer; v_final boolean; item jsonb;
  v_state text; v_grade numeric; was_final boolean; n_grades integer:=0; n_matches integer:=0;
begin
  -- Both doors are coalesced: an authorizer that answers NULL instead of false would make this
  -- `if not (null or false)` fall through, and a gate that opens on unknown is not a gate.
  if not (coalesce(public.fm_serie_a_import_authorized(access_key),false)
    or coalesce(cardinality(public.fm_my_admin_league_ids()),0)>0) then raise exception 'unauthorized' using errcode='42501'; end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'invalid_payload'; end if;
  v_season:=payload->>'season'; v_round:=(payload->>'round')::integer;
  if v_season is null or v_season !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'invalid_season'; end if;
  if v_round is null or v_round not between 1 and 38 then raise exception 'invalid_round'; end if;
  if jsonb_typeof(payload->'final') is distinct from 'boolean' then raise exception 'invalid_payload'; end if;
  v_final:=(payload->>'final')::boolean;
  if jsonb_typeof(payload->'matches') is distinct from 'array' then raise exception 'invalid_matches'; end if;
  n_matches:=jsonb_array_length(payload->'matches');
  if n_matches not between 1 and 20 then raise exception 'invalid_matches'; end if;
  if jsonb_typeof(payload->'grades') is distinct from 'array' or jsonb_array_length(payload->'grades') not between 1 and 1000 then raise exception 'invalid_grades'; end if;
  if v_final <> (select bool_and((value->>'status')::integer=4) from jsonb_array_elements(payload->'matches')) then raise exception 'invalid_final'; end if;

  perform pg_advisory_xact_lock(hashtext('fm_serie_a'||v_season), v_round);
  select final into was_final from public.fm_serie_a_rounds where season=v_season and round=v_round;
  if was_final then raise exception 'round_already_final'; end if;

  insert into public.fm_serie_a_teams (id,name)
  select distinct on ((t.value->>'id')::integer) (t.value->>'id')::integer,t.value->>'name'
  from jsonb_array_elements(coalesce(payload->'teams','[]'::jsonb)) t
  on conflict (id) do update set name=excluded.name,updated_at=now();

  insert into public.fm_serie_a_rounds (season,round,final,imported_at) values (v_season,v_round,v_final,now())
  on conflict (season,round) do update set final=excluded.final,imported_at=now();

  delete from public.fm_serie_a_matches where season=v_season and round=v_round;
  insert into public.fm_serie_a_matches (season,round,match_id,home_team_id,away_team_id,home_goals,away_goals,kickoff,status)
  select v_season,v_round,(m.value->>'match_id')::integer,(m.value->>'home_team_id')::integer,(m.value->>'away_team_id')::integer,
    (m.value->>'home_goals')::integer,(m.value->>'away_goals')::integer,(m.value->>'kickoff')::timestamptz,(m.value->>'status')::integer
  from jsonb_array_elements(payload->'matches') m;

  insert into public.fm_serie_a_players (id,name,role,team_id)
  select distinct on ((p.value->>'id')::integer) (p.value->>'id')::integer,p.value->>'name',p.value->>'role',(p.value->>'team_id')::integer
  from jsonb_array_elements(coalesce(payload->'players','[]'::jsonb)) p
  on conflict (id) do update set name=excluded.name,role=excluded.role,team_id=excluded.team_id,updated_at=now();

  for item in select value from jsonb_array_elements(payload->'grades') loop
    v_state:=item->>'state'; v_grade:=(item->>'grade')::numeric;
    if v_state is null or v_state not in ('graded','no_vote','did_not_play') then raise exception 'invalid_state'; end if;
    if (v_state='graded')<>(v_grade is not null) then raise exception 'invalid_state'; end if;
    if (item->>'player_id') is null then raise exception 'invalid_player'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(item->'events','[]'::jsonb)) e
      where jsonb_typeof(e.value) is distinct from 'number' or (e.value)::text::integer not between 0 and 99) then raise exception 'invalid_events'; end if;
    n_grades:=n_grades+1;
  end loop;

  delete from public.fm_serie_a_grades where season=v_season and round=v_round;
  insert into public.fm_serie_a_grades (season,round,player_id,team_id,state,grade,events,minutes,status,presence_odds,raw)
  select v_season,v_round,(g.value->>'player_id')::integer,(g.value->>'team_id')::integer,g.value->>'state',(g.value->>'grade')::numeric,
    coalesce((select array_agg((e.value)::text::integer order by e.ordinality) from jsonb_array_elements(coalesce(g.value->'events','[]'::jsonb)) with ordinality e),'{}'::integer[]),
    coalesce((select array_agg((n.value)::text::integer order by n.ordinality) from jsonb_array_elements(coalesce(g.value->'minutes','[]'::jsonb)) with ordinality n),'{}'::integer[]),
    (g.value->>'status')::integer,(g.value->>'presence_odds')::integer,g.value->'raw'
  from jsonb_array_elements(payload->'grades') g;

  return jsonb_build_object('season',v_season,'round',v_round,'final',v_final,'grades',n_grades,'matches',n_matches);
end;
$$;
revoke all on function public.fm_import_serie_a_round(jsonb,text) from public;
grant execute on function public.fm_import_serie_a_round(jsonb,text) to anon,authenticated;

-- The unattended run needs to know what is already settled, or it would start at round 1 every
-- time and never reach the round being played. It cannot read the table — the policy is for
-- `authenticated` — so the same key that opens the write opens this one view of the state,
-- rather than widening the read policy to anon for everybody.
create function public.fm_serie_a_rounds_for_import(access_key text, season text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not coalesce(public.fm_serie_a_import_authorized(access_key),false) then raise exception 'unauthorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('round',r.round,'final',r.final) order by r.round),'[]'::jsonb)
   into result from public.fm_serie_a_rounds r where r.season=fm_serie_a_rounds_for_import.season;
  return result;
end;
$$;
revoke all on function public.fm_serie_a_rounds_for_import(text,text) from public,authenticated;
grant execute on function public.fm_serie_a_rounds_for_import(text,text) to anon,service_role;
