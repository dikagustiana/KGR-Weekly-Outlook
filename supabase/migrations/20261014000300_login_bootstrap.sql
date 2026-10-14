-- Login bootstrap: the first Admin sets their own password from the Supabase SQL editor (runs as postgres):
--   select public.set_login_password('admin@example.com', '<a strong password>');
-- Not callable through the API (no grant to anon/authenticated). Later logins are created by the Admin in the app.
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
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', '');
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

-- The in-app Admin path reuses it after checking the caller's role.
create or replace function public.admin_set_password(p_email text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.has_role('admin')) then raise exception 'Hanya Admin' using errcode = '42501'; end if;
  return public.set_login_password(p_email, p_password);
end $$;
revoke all on function public.admin_set_password(text, text) from public, anon;
grant execute on function public.admin_set_password(text, text) to authenticated;
