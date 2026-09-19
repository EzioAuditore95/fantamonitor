-- Between matchdays the bot pointed at the next round, whose lineup page Fantacalcio has
-- not opened yet: /status failed with connector_round_unavailable for weeks at a time and
-- only worked on match weekends. A round is "current" while the system actually watches it,
-- which starts at the first checkpoint, 24 hours before kickoff. Outside that window the
-- last played round is the honest answer, and it is always readable.
create or replace function public.fm_current_round_for_bot(access_key text,league uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare d integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if league is null then raise exception 'league_required'; end if;
 -- In finestra: dal primo checkpoint fino a 6 ore dopo il calcio d'inizio.
 select round into d from public.fm_round_schedule
 where league_id=league and start_at is not null
   and now() between start_at - interval '24 hours' and start_at + interval '6 hours'
 order by start_at asc limit 1;
 if d is not null then return d; end if;
 -- Fuori finestra: l'ultima giocata, che su Fantacalcio resta leggibile.
 select round into d from public.fm_round_schedule
 where league_id=league and start_at is not null and start_at < now()
 order by start_at desc limit 1;
 if d is not null then return d; end if;
 -- Stagione non ancora cominciata: la prima in calendario.
 select round into d from public.fm_round_schedule
 where league_id=league and start_at is not null order by start_at asc limit 1;
 return d;
end;
$$;
