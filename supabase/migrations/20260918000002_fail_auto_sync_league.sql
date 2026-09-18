-- fm_fail_auto_sync resolved its league through fm_default_league(), which returns null as
-- soon as a second league is active. The failure would then raise, the connector would
-- swallow it, and the run would stay 'running' forever — and fm_claim_due_auto_sync only
-- ever reclaims runs marked 'failed', so that round and checkpoint would be stuck for good.
-- The claim already knows its league: it has to be passed back in.
create or replace function public.fm_fail_auto_sync(access_key text,league uuid,day integer,checkpoint_name text,error_text text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 update public.fm_auto_sync_runs set status='failed',executed_at=now(),error=left(coalesce(error_text,'unknown'),500)
 where league_id=league and round=day and checkpoint=checkpoint_name and status='running';
end;
$$;
revoke all on function public.fm_fail_auto_sync(text,uuid,integer,text,text) from public,authenticated;
grant execute on function public.fm_fail_auto_sync(text,uuid,integer,text,text) to anon,service_role;

-- The four-argument bridge stays while the old connector is still in production.
create or replace function public.fm_fail_auto_sync(access_key text,day integer,checkpoint_name text,error_text text) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 target:=public.fm_default_league();
 if target is null then
  -- With no certain league the run is still marked failed: leaving it 'running' would make
  -- it unrecoverable, while 'failed' is retried up to three times.
  update public.fm_auto_sync_runs set status='failed',executed_at=now(),error=left(coalesce(error_text,'unknown'),500)
  where round=day and checkpoint=checkpoint_name and status='running';
  return;
 end if;
 perform public.fm_fail_auto_sync(access_key,target,day,checkpoint_name,error_text);
end;
$$;
