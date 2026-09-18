-- The connector stops carrying league constants in code and reads them from here.
create or replace function public.fm_leagues_for_bot(access_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
    'id',l.id,'slug',l.slug,'season',l.season,'competitionId',l.competition_id,'name',l.name,
    'roundCount',l.round_count,'serieAOffset',l.serie_a_offset,'autoSyncEnabled',l.auto_sync_enabled,
    'telegramChatId',l.telegram_chat_id,'telegramThreadId',l.telegram_thread_id,'telegramAdminChatId',l.telegram_admin_chat_id,
    'teams',coalesce((select jsonb_agg(t.name order by t.position) from public.fm_league_teams t where t.league_id=l.id),'[]'::jsonb)
  ) order by l.slug)
  from public.fm_leagues l where l.active),'[]'::jsonb);
end;
$$;
revoke all on function public.fm_leagues_for_bot(text) from public,authenticated;
grant execute on function public.fm_leagues_for_bot(text) to anon,service_role;

-- Persisting the Fantacalcio team id removes a failure mode: today it is rediscovered on
-- every capture by intercepting an XHR, and a missed interception fails the whole capture.
create or replace function public.fm_store_league_team_ids(access_key text,league uuid,mapping jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; updated integer:=0;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if jsonb_typeof(mapping) is distinct from 'object' then raise exception 'invalid_team_mapping'; end if;
 for item in select key as name,value::text::integer as team_id from jsonb_each_text(mapping) loop
  update public.fm_league_teams set fantacalcio_team_id=item.team_id where league_id=league and name=item.name;
  updated:=updated+1;
 end loop;
 return jsonb_build_object('updated',updated);
end;
$$;
revoke all on function public.fm_store_league_team_ids(text,uuid,jsonb) from public,authenticated;
grant execute on function public.fm_store_league_team_ids(text,uuid,jsonb) to anon,service_role;
