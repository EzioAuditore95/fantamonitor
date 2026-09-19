-- The connector passes its league to these four; the deployed functions still resolved it
-- through fm_default_league(). PostgREST matches by argument name, so every Telegram
-- command failed with PGRST202 while the rest of the connector worked — the mismatch sat
-- exactly in the gap between the SQL tests and the connector tests.
create function public.fm_current_round_for_bot(access_key text,league uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare d integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if league is null then raise exception 'league_required'; end if;
 select round into d from public.fm_round_schedule
 where league_id=league and start_at >= now()-interval '6 hours' order by start_at asc limit 1;
 if d is null then
  select round into d from public.fm_round_schedule where league_id=league order by start_at desc limit 1;
 end if;
 return d;
end;
$$;

create function public.fm_next_round_for_bot(access_key text,league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r record;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if league is null then raise exception 'league_required'; end if;
 select round,serie_a_round,start_at into r from public.fm_round_schedule
 where league_id=league and start_at >= now()-interval '6 hours' order by start_at asc limit 1;
 if not found then return null; end if;
 return jsonb_build_object('round',r.round,'serie_a_round',r.serie_a_round,'start_at',r.start_at);
end;
$$;

create function public.fm_get_telegram_message(access_key text,league uuid,day integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r record;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if league is null then raise exception 'league_required'; end if;
 select round,chat_id,message_id,last_checkpoint,updated_at into r
 from public.fm_telegram_messages where league_id=league and round=day;
 if not found then return null; end if;
 return jsonb_build_object('round',r.round,'chat_id',r.chat_id,'message_id',r.message_id,'last_checkpoint',r.last_checkpoint,'updated_at',r.updated_at);
end;
$$;

create function public.fm_upsert_telegram_message(access_key text,league uuid,day integer,target_chat_id text,telegram_message_id bigint,checkpoint_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare limit_rounds integer;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if league is null then raise exception 'league_required'; end if;
 select round_count into limit_rounds from public.fm_leagues where id=league;
 if limit_rounds is null then raise exception 'league_required'; end if;
 if day not between 1 and limit_rounds or telegram_message_id <= 0 or length(target_chat_id)=0 then raise exception 'invalid_telegram_state'; end if;
 insert into public.fm_telegram_messages(league_id,round,chat_id,message_id,last_checkpoint,updated_at)
 values(league,day,target_chat_id,telegram_message_id,checkpoint_name,now())
 on conflict(league_id,round) do update set chat_id=excluded.chat_id,message_id=excluded.message_id,last_checkpoint=excluded.last_checkpoint,updated_at=now();
 return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.fm_current_round_for_bot(text,uuid),public.fm_next_round_for_bot(text,uuid),
 public.fm_get_telegram_message(text,uuid,integer),public.fm_upsert_telegram_message(text,uuid,integer,text,bigint,text)
 from public,authenticated;
grant execute on function public.fm_current_round_for_bot(text,uuid),public.fm_next_round_for_bot(text,uuid),
 public.fm_get_telegram_message(text,uuid,integer),public.fm_upsert_telegram_message(text,uuid,integer,text,bigint,text)
 to anon,service_role;

-- I ponti a lega implicita non hanno più chiamanti: lasciarli significherebbe tenere in
-- piedi fm_default_league() per niente, e offrire di nuovo la firma che ha causato il guasto.
drop function public.fm_current_round_for_bot(text);
drop function public.fm_next_round_for_bot(text);
drop function public.fm_get_telegram_message(text,integer);
drop function public.fm_upsert_telegram_message(text,integer,text,bigint,text);
