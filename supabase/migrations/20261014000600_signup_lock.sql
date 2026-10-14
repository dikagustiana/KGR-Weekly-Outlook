-- Close self sign-up. Before this, anyone could call the Auth sign-up endpoint with an e-mail that is
-- on the allow-list but has no login yet and get a confirmed account (the trigger auto-confirms).
-- Now auth.users accepts only:
--   * logins provisioned by set_login_password / admin_set_password (Admin or SQL editor), and
--   * OAuth providers that prove ownership of the e-mail (Google), still limited to the allow-list.
create or replace function public.tg_auth_allowlist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_user u where u.email = lower(new.email) and u.active) then
    raise exception 'E-mail % belum terdaftar di KGR Weekly Outlook. Minta Admin menambahkan Anda.', new.email
      using errcode = '42501';
  end if;
  if coalesce(current_setting('kgr.provisioning', true), '') <> 'on'
     and coalesce(new.raw_app_meta_data ->> 'provider', '') not in ('google') then
    raise exception 'Pendaftaran mandiri tidak tersedia. Login dibuat oleh Admin (Admin → Pengguna).'
      using errcode = '42501';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;

create or replace function public.set_login_password(p_email text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; e text := lower(trim(p_email));
begin
  if length(p_password) < 8 then raise exception 'Kata sandi minimal 8 karakter'; end if;
  if not exists (select 1 from public.app_user where email = e and active) then
    raise exception 'Tambahkan % ke public.app_user dulu', e;
  end if;
  select id into uid from auth.users where lower(email) = e;
  if uid is null then
    perform set_config('kgr.provisioning', 'on', true);
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', '');
    perform set_config('kgr.provisioning', 'off', true);
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid::text, uid, jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true),
      'email', now(), now(), now());
    return 'created';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
  return 'updated';
end $$;
revoke all on function public.set_login_password(text, text) from public, anon, authenticated;

-- Trigger functions are not API endpoints (triggers fire without EXECUTE; this only hides them from /rpc).
revoke execute on function public.tg_audit() from public, anon, authenticated;
revoke execute on function public.tg_auth_allowlist() from public, anon, authenticated;
