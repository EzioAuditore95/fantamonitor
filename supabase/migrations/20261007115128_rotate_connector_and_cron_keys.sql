-- Rotate independent bot and Serie A keys; only SHA-256 digests belong in migrations.
create or replace function public.fm_auto_sync_authorized(access_key text) returns boolean
language sql immutable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(coalesce(access_key,''),'UTF8'),'sha256'),'hex')='c7e3c23e2a5530bc85725e9d04d77ad2c49b02be23bd0583fa6f7a2ba860d91e';
$$;
revoke all on function public.fm_auto_sync_authorized(text) from public,authenticated;
grant execute on function public.fm_auto_sync_authorized(text) to anon,service_role;
create or replace function public.fm_serie_a_import_authorized(access_key text) returns boolean
language sql immutable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(coalesce(access_key,''),'UTF8'),'sha256'),'hex')='865aa9cb7209ca58d28ab21f64cc0d9b10b4d6aff7dfd24096ded41f6e4047af';
$$;
revoke all on function public.fm_serie_a_import_authorized(text) from public,authenticated;
grant execute on function public.fm_serie_a_import_authorized(text) to anon,service_role;
