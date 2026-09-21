-- Serie A grades from the public Fantacalcio live feed.
--
-- These tables carry no league_id on purpose: a grade of Modric belongs to Serie A, not to a
-- league, and duplicating six hundred rows per league would be a copy to keep in sync forever.
-- The scope of a row is the season, and the season is stored in the form the source publishes
-- ('2026-27'), not the form fm_leagues uses ('2026-2027'): they are two different vocabularies
-- and translating at the border is cheaper than pretending they are one.

create table public.fm_serie_a_teams (
  id integer primary key check (id > 0),
  name text not null check (length(name) between 1 and 60),
  updated_at timestamptz not null default now()
);

-- The id is the one Fantacalcio uses everywhere: in this feed, in the player page URL, in the
-- campioncini asset path, and — verified against the archive — in the `pid` of the lineups the
-- connector captures. That is the whole reason this data can be joined to ours at all.
create table public.fm_serie_a_players (
  id integer primary key check (id > 0),
  name text not null check (length(name) between 1 and 80),
  role text check (role in ('P','D','C','A')),
  team_id integer references public.fm_serie_a_teams(id),
  updated_at timestamptz not null default now()
);

create table public.fm_serie_a_rounds (
  season text not null check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  round integer not null check (round between 1 and 38),
  -- True only when every match of the round is over. Until then the grades below are live
  -- readings that will still change, and nothing may treat them as settled.
  final boolean not null default false,
  imported_at timestamptz not null default now(),
  primary key (season, round)
);

create table public.fm_serie_a_matches (
  season text not null,
  round integer not null,
  match_id integer not null check (match_id > 0),
  home_team_id integer not null references public.fm_serie_a_teams(id),
  away_team_id integer not null references public.fm_serie_a_teams(id),
  home_goals integer check (home_goals between 0 and 30),
  away_goals integer check (away_goals between 0 and 30),
  kickoff timestamptz,
  status integer not null check (status in (0,3,4)),
  primary key (season, round, match_id),
  foreign key (season, round) references public.fm_serie_a_rounds(season, round) on delete cascade,
  check (home_team_id <> away_team_id)
);

create table public.fm_serie_a_grades (
  season text not null,
  round integer not null,
  player_id integer not null references public.fm_serie_a_players(id),
  team_id integer references public.fm_serie_a_teams(id),
  -- 'no_vote' is a player who came on too late to be rated and 'did_not_play' one who never
  -- came on: both have no grade, and only the first is an appearance. Storing them as states
  -- instead of as a null grade is what keeps that difference readable later.
  state text not null check (state in ('graded','no_vote','did_not_play')),
  grade numeric(3,1) check (grade between 0 and 10),
  events integer[] not null default '{}'::integer[],
  minutes integer[] not null default '{}'::integer[],
  status integer not null check (status in (0,3,4)),
  presence_odds integer check (presence_odds between 0 and 100),
  raw jsonb,
  primary key (season, round, player_id),
  foreign key (season, round) references public.fm_serie_a_rounds(season, round) on delete cascade,
  check ((state = 'graded') = (grade is not null))
);
create index fm_serie_a_grades_player on public.fm_serie_a_grades (player_id, season, round);

alter table public.fm_serie_a_teams enable row level security;
alter table public.fm_serie_a_players enable row level security;
alter table public.fm_serie_a_rounds enable row level security;
alter table public.fm_serie_a_matches enable row level security;
alter table public.fm_serie_a_grades enable row level security;

-- Readable by any signed-in user and scoped by nothing: this is public championship data, and a
-- policy on fm_my_league_ids() would only hide from a member of league B what league A can see
-- on the source site anyway. Writes stay closed: they go through the RPC below.
create policy serie_a_teams_read on public.fm_serie_a_teams for select to authenticated using (true);
create policy serie_a_players_read on public.fm_serie_a_players for select to authenticated using (true);
create policy serie_a_rounds_read on public.fm_serie_a_rounds for select to authenticated using (true);
create policy serie_a_matches_read on public.fm_serie_a_matches for select to authenticated using (true);
create policy serie_a_grades_read on public.fm_serie_a_grades for select to authenticated using (true);

revoke all on public.fm_serie_a_teams,public.fm_serie_a_players,public.fm_serie_a_rounds,
  public.fm_serie_a_matches,public.fm_serie_a_grades from anon,authenticated;
grant select on public.fm_serie_a_teams,public.fm_serie_a_players,public.fm_serie_a_rounds,
  public.fm_serie_a_matches,public.fm_serie_a_grades to authenticated;
grant all on public.fm_serie_a_teams,public.fm_serie_a_players,public.fm_serie_a_rounds,
  public.fm_serie_a_matches,public.fm_serie_a_grades to service_role;

-- One round, one transaction. The caller is an admin of some league: the data is not league
-- scoped, so there is no league to be admin *of*, and the gate only has to keep a viewer from
-- rewriting the championship. An unattended trigger will need its own key, like the auto-sync
-- one; it does not exist yet and a digest that matches nothing would be worse than its absence.
create function public.fm_import_serie_a_round(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_season text; v_round integer; v_final boolean; item jsonb;
  v_state text; v_grade numeric; was_final boolean; n_grades integer:=0; n_matches integer:=0;
begin
  if coalesce(cardinality(public.fm_my_admin_league_ids()),0)=0 then raise exception 'admin_required' using errcode='42501'; end if;
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
  -- A round declared final by the payload must actually be final in the matches it carries:
  -- the two arrive together and disagreeing about it is how live data gets frozen by mistake.
  if v_final <> (select bool_and((value->>'status')::integer=4) from jsonb_array_elements(payload->'matches')) then raise exception 'invalid_final'; end if;

  perform pg_advisory_xact_lock(hashtext('fm_serie_a'||v_season), v_round);
  select final into was_final from public.fm_serie_a_rounds where season=v_season and round=v_round;
  -- Settled is settled: the feed keeps serving a finished round, and re-importing it could only
  -- replace an editorial correction with the live reading it superseded.
  if was_final then raise exception 'round_already_final'; end if;

  -- distinct on: the teams are read off the matches, where every club appears twice, and a
  -- second hit on the same id in one statement is an error, not an overwrite.
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
    -- The event vocabulary lives in lib/serie-a-events.ts, not here: SQL only refuses values
    -- that cannot be an event at all, so a new code from the source is stored, not dropped.
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
revoke all on function public.fm_import_serie_a_round(jsonb) from public,anon;
grant execute on function public.fm_import_serie_a_round(jsonb) to authenticated;
