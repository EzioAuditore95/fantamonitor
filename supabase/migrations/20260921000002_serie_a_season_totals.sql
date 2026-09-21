-- Past seasons, as the statistics page of www.fantacalcio.it publishes them.
--
-- Its own table and not fm_serie_a_grades: a grade there is one round plus the events behind it,
-- while this is a season already added up. Squeezing an aggregate into that shape would mean
-- inventing the parts it was made of. No foreign key to fm_serie_a_players either — a past
-- season is full of players who have since left Serie A and will never appear in the live feed —
-- so the name travels with the row and the player id is simply the same id space.

create table public.fm_serie_a_season_totals (
  season text not null check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  player_id integer not null check (player_id > 0),
  name text not null check (length(name) between 1 and 80),
  team text check (length(team) between 1 and 10),
  role text check (role in ('P','D','C','A')),
  played integer check (played between 0 and 38),
  grade numeric(4,2) check (grade between 0 and 10),
  fantasy_grade numeric(4,2) check (fantasy_grade between -10 and 30),
  goals integer check (goals >= 0),
  conceded integer check (conceded >= 0),
  penalties_saved integer check (penalties_saved >= 0),
  assists integer check (assists >= 0),
  yellow integer check (yellow >= 0),
  red integer check (red >= 0),
  own_goals integer check (own_goals >= 0),
  imported_at timestamptz not null default now(),
  primary key (season, player_id)
);
create index fm_serie_a_season_totals_player on public.fm_serie_a_season_totals (player_id, season desc);

alter table public.fm_serie_a_season_totals enable row level security;
create policy serie_a_season_totals_read on public.fm_serie_a_season_totals for select to authenticated using (true);
revoke all on public.fm_serie_a_season_totals from anon,authenticated;
grant select on public.fm_serie_a_season_totals to authenticated;
grant all on public.fm_serie_a_season_totals to service_role;

-- Admin only, and no key door: importing a finished season is something a person does once, by
-- hand, not something a schedule needs. A season that is already stored is replaced whole, which
-- is what re-running it after the source corrects a figure should do.
create function public.fm_import_serie_a_season(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_season text; n_players integer;
begin
  if coalesce(cardinality(public.fm_my_admin_league_ids()),0)=0 then raise exception 'unauthorized' using errcode='42501'; end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'invalid_payload'; end if;
  v_season:=payload->>'season';
  if v_season is null or v_season !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'invalid_season'; end if;
  if jsonb_typeof(payload->'players') is distinct from 'array' then raise exception 'invalid_players'; end if;
  n_players:=jsonb_array_length(payload->'players');
  if n_players not between 1 and 1200 then raise exception 'invalid_players'; end if;
  -- A season the live feed is still filling must not be overwritten by an aggregate: the two
  -- describe the same months and only one of them can be recomputed from its parts.
  if exists(select 1 from public.fm_serie_a_rounds r where r.season=v_season) then raise exception 'season_is_live'; end if;

  delete from public.fm_serie_a_season_totals where season=v_season;
  insert into public.fm_serie_a_season_totals
    (season,player_id,name,team,role,played,grade,fantasy_grade,goals,conceded,penalties_saved,assists,yellow,red,own_goals)
  select distinct on ((p.value->>'player_id')::integer) v_season,(p.value->>'player_id')::integer,p.value->>'name',
    p.value->>'team',p.value->>'role',(p.value->>'played')::integer,(p.value->>'grade')::numeric,
    (p.value->>'fantasyGrade')::numeric,(p.value->>'goals')::integer,(p.value->>'conceded')::integer,
    (p.value->>'penaltiesSaved')::integer,(p.value->>'assists')::integer,(p.value->>'yellow')::integer,
    (p.value->>'red')::integer,(p.value->>'ownGoals')::integer
  from jsonb_array_elements(payload->'players') p;

  return jsonb_build_object('season',v_season,'players',(select count(*)::integer from public.fm_serie_a_season_totals where season=v_season));
end;
$$;
revoke all on function public.fm_import_serie_a_season(jsonb) from public,anon;
grant execute on function public.fm_import_serie_a_season(jsonb) to authenticated;
