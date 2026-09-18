-- Per-league Fantacalcio credentials, write-only from the application's point of view.
-- The web app holds the public key and can only seal; the connector holds the private key
-- and is the only thing that can open what is stored here.

create table public.fm_league_credentials (
  league_id uuid primary key references public.fm_leagues(id) on delete cascade,
  payload text check (payload is null or length(payload) between 32 and 8192),
  key_version integer not null default 1 check (key_version > 0),
  session_state text check (session_state is null or length(session_state) between 32 and 262144),
  session_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  last_verified_at timestamptz,
  last_verified_status text check (last_verified_status is null or last_verified_status in ('ok','auth_failed','error'))
);

alter table public.fm_league_credentials enable row level security;
-- Deliberately no policy and no grant for authenticated: the ban on reading the ciphertext
-- back is enforced by the database, not by the routes. Even a badly written route finds
-- nothing to read.
revoke all on public.fm_league_credentials from anon,authenticated;
grant all on public.fm_league_credentials to service_role;

-- Metadata only. This is how the admin UI shows state without a grant on the table.
create function public.fm_league_credential_status(league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r record;
begin
 if not public.fm_is_member(league) then raise exception 'forbidden' using errcode='42501'; end if;
 select payload,session_state,session_expires_at,key_version,updated_at,last_verified_at,last_verified_status
   into r from public.fm_league_credentials where league_id=league;
 if not found then return jsonb_build_object('configured',false,'hasSession',false); end if;
 return jsonb_build_object('configured',r.payload is not null,'hasSession',r.session_state is not null,
   'sessionExpiresAt',r.session_expires_at,'keyVersion',r.key_version,'updatedAt',r.updated_at,
   'lastVerifiedAt',r.last_verified_at,'lastVerifiedStatus',r.last_verified_status);
end;
$$;
revoke all on function public.fm_league_credential_status(uuid) from public,anon;
grant execute on function public.fm_league_credential_status(uuid) to authenticated;

-- mode 'password' stores the sealed username/password; 'session' stores a sealed Playwright
-- storageState. Passing null for a mode clears that half.
create function public.fm_set_league_credentials(league uuid,mode text,sealed text,version integer,expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.fm_is_admin(league) then raise exception 'admin_required' using errcode='42501'; end if;
 if mode not in ('password','session') then raise exception 'invalid_credential_mode'; end if;
 if sealed is not null and sealed !~ '^v1[.]' then raise exception 'invalid_credential_payload'; end if;
 insert into public.fm_league_credentials(league_id,payload,session_state,session_expires_at,key_version,updated_at,updated_by)
 values(league,
   case when mode='password' then sealed end,
   case when mode='session' then sealed end,
   case when mode='session' then expires_at end,
   coalesce(version,1),now(),(select auth.uid()))
 on conflict(league_id) do update set
   payload=case when mode='password' then sealed else public.fm_league_credentials.payload end,
   session_state=case when mode='session' then sealed else public.fm_league_credentials.session_state end,
   session_expires_at=case when mode='session' then expires_at else public.fm_league_credentials.session_expires_at end,
   key_version=coalesce(version,public.fm_league_credentials.key_version),
   updated_at=now(),updated_by=(select auth.uid()),
   -- A new secret invalidates whatever the previous one was verified as.
   last_verified_at=null,last_verified_status=null;
 return jsonb_build_object('saved',true);
end;
$$;
revoke all on function public.fm_set_league_credentials(uuid,text,text,integer,timestamptz) from public,anon;
grant execute on function public.fm_set_league_credentials(uuid,text,text,integer,timestamptz) to authenticated;

-- ------------------------------------------------------------- connector side
create function public.fm_league_credentials_for_bot(access_key text,league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r record;
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 select payload,session_state,session_expires_at,key_version into r from public.fm_league_credentials where league_id=league;
 if not found then return null; end if;
 return jsonb_build_object('payload',r.payload,'sessionState',r.session_state,'sessionExpiresAt',r.session_expires_at,'keyVersion',r.key_version);
end;
$$;
revoke all on function public.fm_league_credentials_for_bot(text,uuid) from public,authenticated;
grant execute on function public.fm_league_credentials_for_bot(text,uuid) to anon,service_role;

-- The connector reseals and stores the refreshed storageState itself.
create function public.fm_store_league_session(access_key text,league uuid,sealed text,expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if sealed is not null and sealed !~ '^v1[.]' then raise exception 'invalid_credential_payload'; end if;
 insert into public.fm_league_credentials(league_id,session_state,session_expires_at,updated_at)
 values(league,sealed,expires_at,now())
 on conflict(league_id) do update set session_state=sealed,session_expires_at=expires_at,updated_at=now();
 return jsonb_build_object('saved',true);
end;
$$;
revoke all on function public.fm_store_league_session(text,uuid,text,timestamptz) from public,authenticated;
grant execute on function public.fm_store_league_session(text,uuid,text,timestamptz) to anon,service_role;

create function public.fm_record_credential_check(access_key text,league uuid,outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.fm_auto_sync_authorized(access_key) then raise exception 'unauthorized' using errcode='42501'; end if;
 if outcome not in ('ok','auth_failed','error') then raise exception 'invalid_credential_outcome'; end if;
 update public.fm_league_credentials set last_verified_at=now(),last_verified_status=outcome where league_id=league;
 return jsonb_build_object('recorded',true);
end;
$$;
revoke all on function public.fm_record_credential_check(text,uuid,text) from public,authenticated;
grant execute on function public.fm_record_credential_check(text,uuid,text) to anon,service_role;
