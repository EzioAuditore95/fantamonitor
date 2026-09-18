-- Aggiunge una lega. Lo schema è multi-tenant, la UI no: le leghe si creano da qui.
-- Modificare SOLO il blocco "parametri" in cima, poi eseguire:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/new-league.sql
--
-- Tutto avviene in una transazione: se un controllo fallisce non resta nulla a metà.

do $$
declare
  -- ------------------------------------------------------------- parametri --
  p_slug            text    := 'nome-lega';        -- minuscole, cifre e trattini
  p_name            text    := 'Nome Lega';
  p_season          text    := '2026-2027';
  p_competition_id  text    := '000000';           -- id competizione su Fantacalcio
  p_round_count     integer := 38;                 -- giornate di lega
  p_serie_a_offset  integer := 0;                  -- giornata Serie A = round + offset
  p_period_mode     text    := 'half';             -- 'half' (andata/ritorno) oppure 'season'
  p_first_half_end  integer := 19;                 -- ignorato se p_period_mode = 'season'
  p_free_tokens     integer := 1;                  -- gettoni gratuiti per periodo
  p_penalty_amount  integer := 5;                  -- euro per omissione oltre i gettoni
  p_telegram_chat   text    := null;               -- canale della lega
  p_telegram_thread text    := null;
  p_telegram_admin  text    := null;
  p_rules           jsonb   := jsonb_build_object(
                                 'season_label','Stagione 2026 / 27 · Serie A',
                                 'mode_label','CLASSIC');
  -- Squadre nell'ordine in cui devono comparire. Il colore è facoltativo: senza,
  -- il crest usa un fallback deterministico sul nome.
  p_teams           jsonb   := '[
                                 {"name":"Prima squadra","color":"#b6a1f7"},
                                 {"name":"Seconda squadra"}
                               ]'::jsonb;
  -- Email già registrate su Supabase Auth. La prima diventa amministratore.
  p_members         text[]  := array['admin@example.com','membro@example.com'];
  -- --------------------------------------------------------- fine parametri --
  new_league uuid;
  team_count integer;
  member_count integer;
  missing text[];
begin
  if exists(select 1 from public.fm_leagues
            where slug=p_slug and season=p_season and competition_id=p_competition_id) then
    raise exception 'La lega % (% / %) esiste già.',p_slug,p_season,p_competition_id;
  end if;
  team_count := jsonb_array_length(p_teams);
  if team_count < 2 then raise exception 'Servono almeno due squadre.'; end if;
  if team_count % 2 <> 0 then raise exception 'Il numero di squadre deve essere pari: il calendario accoppia le squadre.'; end if;

  select array_agg(e) into missing
  from unnest(p_members) e
  where not exists(select 1 from auth.users u where lower(u.email)=lower(e));
  if missing is not null then
    raise exception 'Questi account non sono registrati su Supabase Auth: %. Invitali prima.',array_to_string(missing,', ');
  end if;

  insert into public.fm_leagues (slug,name,season,competition_id,round_count,serie_a_offset,
    period_mode,first_half_end,free_tokens,penalty_amount,
    telegram_chat_id,telegram_thread_id,telegram_admin_chat_id,rules)
  values (p_slug,p_name,p_season,p_competition_id,p_round_count,p_serie_a_offset,
    p_period_mode,case when p_period_mode='season' then null else p_first_half_end end,
    p_free_tokens,p_penalty_amount,
    p_telegram_chat,p_telegram_thread,p_telegram_admin,p_rules)
  returning id into new_league;

  insert into public.fm_league_teams (league_id,name,position,color)
  select new_league,t.value->>'name',t.ordinality,nullif(t.value->>'color','')
  from jsonb_array_elements(p_teams) with ordinality as t(value,ordinality);

  -- Una riga per giornata. start_at resta null finché gli orari non sono noti, e un
  -- checkpoint senza orario non viene mai pianificato.
  insert into public.fm_round_schedule (league_id,round,serie_a_round,source,source_url)
  select new_league,r,r+p_serie_a_offset,'manual_seed',
    'https://apileague.fantacalcio.it/onboarding/v1/league/competition/calendar/'||p_competition_id
  from generate_series(1,p_round_count) r;

  insert into public.fm_memberships (league_id,user_id,role)
  select new_league,u.id,case when m.ordinality=1 then 'admin' else 'viewer' end
  from unnest(p_members) with ordinality as m(email,ordinality)
  join auth.users u on lower(u.email)=lower(m.email);
  get diagnostics member_count = row_count;

  -- auto_sync_enabled resta false: si accende dopo la prima cattura manuale riuscita.
  raise notice 'Lega % creata: % squadre, % giornate, % membri. Slug: /l/%',
    new_league,team_count,p_round_count,member_count,p_slug;
end $$;
