-- Triggers (stamps, audit trail, closed-week guard, column-level guards), RLS per role (PRD §2, §8, §9),
-- the generic apply_changes RPC used by the upload wizard, and the login allow-list.

-------------------------------------------------------------------------------- stamps
create or replace function public.tg_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  who text := nullif(public.current_email(), '');
  j jsonb := to_jsonb(new);
  patch jsonb := '{}'::jsonb;
begin
  if j ? 'updated_at' then patch := patch || jsonb_build_object('updated_at', now()); end if;
  if who is not null and j ? 'updated_by' then patch := patch || jsonb_build_object('updated_by', who); end if;
  if tg_op = 'INSERT' and who is not null and j ? 'created_by' and (j ->> 'created_by') is null then
    patch := patch || jsonb_build_object('created_by', who);
  end if;
  if patch <> '{}'::jsonb then new := jsonb_populate_record(new, patch); end if;
  return new;
end $$;

-------------------------------------------------------------------------------- audit trail
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  r_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(r_new, r_old);
  diff jsonb := '{}'::jsonb;
  k text;
  op text := tg_op;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if k not in ('updated_at','updated_by') and (r_old -> k) is distinct from (r_new -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(r_old -> k, r_new -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
    if (r_old ->> 'deleted_at') is null and (r_new ->> 'deleted_at') is not null then op := 'SOFT_DELETE';
    elsif (r_old ->> 'deleted_at') is not null and (r_new ->> 'deleted_at') is null then op := 'RESTORE';
    end if;
  elsif tg_op = 'DELETE' then
    diff := r_old;
  else
    diff := null; -- the inserted row itself is the record
  end if;
  insert into public.audit_log (table_name, row_id, week_id, op, changes, actor)
  values (
    tg_table_name,
    coalesce(r ->> 'id', r ->> 'key', r ->> 'item_code', r ->> 'account', r ->> 'email', r ->> 'week_id'),
    case when r ? 'week_id' then (r ->> 'week_id')::uuid when tg_table_name = 'week' then (r ->> 'id')::uuid end,
    op, diff, coalesce(nullif(public.current_email(), ''), 'system')
  );
  return coalesce(new, old);
end $$;

-------------------------------------------------------------------------------- closed weeks are read-only (except Admin)
create or replace function public.week_writable(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.week where id = w and (status <> 'closed' or (select public.has_role('admin'))))
$$;

-------------------------------------------------------------------------------- column-level guards
-- parameter: Purchasing may change the live-bird price, terms and spread; Inventory Accounting the Accurate totals.
create or replace function public.tg_parameter_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
  allowed text[];
begin
  if r = 'admin' or r is null then return new; end if;  -- r is null only for service/system updates
  allowed := case r
    when 'purchasing' then array['lb_price_today','min_trading_spread','terms_lb_days','terms_trading_days','terms_freight_maklon_days']
    when 'inventory_accounting' then array['accurate_sales_kg','accurate_opening_stock_value']
    when 'finance' then array['terms_lb_days','terms_trading_days','terms_freight_maklon_days']
    else array[]::text[] end;
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at','updated_by') and (o -> k) is distinct from (n -> k) and not (k = any(allowed)) then
      raise exception 'Peran % tidak boleh mengubah parameter %', r, k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- week: only Admin manages weeks; the daily roles may move the update date; Finance/Admin release.
create or replace function public.tg_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
begin
  if r = 'admin' or r is null then return new; end if;
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at','updated_by') or (o -> k) is not distinct from (n -> k) then continue; end if;
    if k = 'update_date' then continue; end if;
    if k = 'status' and r = 'finance' and old.status in ('open','released') and new.status in ('open','released') then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-- sku_price: Sales sets sell prices, Purchasing sets replacement buy prices.
create or replace function public.tg_price_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r = 'admin' or r is null then return new; end if;
  if r = 'sales' and tg_op = 'UPDATE' and new.replacement_buy_price is distinct from old.replacement_buy_price then
    raise exception 'Sales hanya boleh mengubah harga jual acuan' using errcode = '42501';
  end if;
  if r = 'purchasing' and tg_op = 'UPDATE' and new.ref_sell_price is distinct from old.ref_sell_price then
    raise exception 'Purchasing hanya boleh mengubah harga beli pengganti' using errcode = '42501';
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------- attach triggers
do $$
declare t text;
begin
  foreach t in array array['app_user','week','parameter','sku_key','sku_price','item_map','coa_map','opening_stock',
    'sales_line','receipt_line','batch','gl_line','tb_opening','runrate','cash_plan'] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;
create trigger guard before update on public.parameter for each row execute function public.tg_parameter_guard();
create trigger guard before update on public.week for each row execute function public.tg_week_guard();
create trigger guard before insert or update on public.sku_price for each row execute function public.tg_price_guard();

-------------------------------------------------------------------------------- RLS
alter table public.app_user enable row level security;
alter table public.week enable row level security;
alter table public.parameter enable row level security;
alter table public.sku_key enable row level security;
alter table public.sku_price enable row level security;
alter table public.item_map enable row level security;
alter table public.coa_map enable row level security;
alter table public.upload enable row level security;
alter table public.upload_row enable row level security;
alter table public.opening_stock enable row level security;
alter table public.sales_line enable row level security;
alter table public.receipt_line enable row level security;
alter table public.batch enable row level security;
alter table public.gl_line enable row level security;
alter table public.tb_opening enable row level security;
alter table public.runrate enable row level security;
alter table public.cash_plan enable row level security;
alter table public.release enable row level security;
alter table public.audit_log enable row level security;

-- app_user: everyone sees their own row; Admin sees and manages all.
create policy app_user_select on public.app_user for select to authenticated
  using (email = public.current_email() or (select public.has_role('admin')));
create policy app_user_admin_ins on public.app_user for insert to authenticated with check ((select public.has_role('admin')));
create policy app_user_admin_upd on public.app_user for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy app_user_admin_del on public.app_user for delete to authenticated using ((select public.has_role('admin')));

-- Read: every active app user reads everything except the user list (PRD §2: everyone can read the outlook).
do $$
declare t text;
begin
  foreach t in array array['week','parameter','sku_key','sku_price','item_map','coa_map','upload','upload_row','opening_stock',
    'sales_line','receipt_line','batch','gl_line','tb_opening','runrate','cash_plan','release','audit_log'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_app_user()))', t || '_read', t);
  end loop;
end $$;

-- Write policies per role (no DELETE policy on input tables: soft delete only).
create policy week_ins on public.week for insert to authenticated with check ((select public.has_role('admin')));
create policy week_upd on public.week for update to authenticated
  using ((select public.has_role('admin','inventory_accounting','finance','ppic','sales','purchasing')))
  with check ((select public.has_role('admin','inventory_accounting','finance','ppic','sales','purchasing')));

create policy parameter_ins on public.parameter for insert to authenticated with check ((select public.has_role('admin')));
create policy parameter_upd on public.parameter for update to authenticated
  using ((select public.has_role('admin','purchasing','inventory_accounting','finance')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','purchasing','inventory_accounting','finance')) and public.week_writable(week_id));

create policy sku_key_write on public.sku_key for insert to authenticated with check ((select public.has_role('admin')));
create policy sku_key_upd on public.sku_key for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy item_map_ins on public.item_map for insert to authenticated with check ((select public.has_role('admin')));
create policy item_map_upd on public.item_map for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy coa_map_ins on public.coa_map for insert to authenticated with check ((select public.has_role('admin')));
create policy coa_map_upd on public.coa_map for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy sku_price_ins on public.sku_price for insert to authenticated
  with check ((select public.has_role('admin','sales','purchasing')) and public.week_writable(week_id));
create policy sku_price_upd on public.sku_price for update to authenticated
  using ((select public.has_role('admin','sales','purchasing')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','sales','purchasing')) and public.week_writable(week_id));

-- Uploads: the roles that own the uploaded data.
create policy upload_ins on public.upload for insert to authenticated
  with check ((select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance')));
create policy upload_upd on public.upload for update to authenticated
  using (uploaded_by = public.current_email() or (select public.has_role('admin')))
  with check (uploaded_by = public.current_email() or (select public.has_role('admin')));
create policy upload_row_ins on public.upload_row for insert to authenticated
  with check (exists (select 1 from public.upload u where u.id = upload_id and (u.uploaded_by = public.current_email() or (select public.has_role('admin')))));
create policy upload_row_del on public.upload_row for delete to authenticated
  using (exists (select 1 from public.upload u where u.id = upload_id and (u.uploaded_by = public.current_email() or (select public.has_role('admin')))));

-- Input tables
create policy opening_stock_ins on public.opening_stock for insert to authenticated
  with check ((select public.has_role('admin','inventory_accounting')) and public.week_writable(week_id));
create policy opening_stock_upd on public.opening_stock for update to authenticated
  using ((select public.has_role('admin','inventory_accounting')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','inventory_accounting')) and public.week_writable(week_id));

create policy sales_line_ins on public.sales_line for insert to authenticated
  with check ((select public.has_role('admin','inventory_accounting','sales')) and public.week_writable(week_id));
create policy sales_line_upd on public.sales_line for update to authenticated
  using ((select public.has_role('admin','inventory_accounting','sales')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','inventory_accounting','sales')) and public.week_writable(week_id));

create policy receipt_line_ins on public.receipt_line for insert to authenticated
  with check (public.week_writable(week_id) and (
    (select public.has_role('admin','inventory_accounting'))
    or ((select public.has_role('ppic')) and receipt_source = 'Produksi RPA')
    or ((select public.has_role('purchasing')) and receipt_source = 'Beli Trading')));
create policy receipt_line_upd on public.receipt_line for update to authenticated
  using (public.week_writable(week_id) and (
    (select public.has_role('admin','inventory_accounting'))
    or ((select public.has_role('ppic')) and receipt_source = 'Produksi RPA')
    or ((select public.has_role('purchasing')) and receipt_source = 'Beli Trading')))
  with check (public.week_writable(week_id) and (
    (select public.has_role('admin','inventory_accounting'))
    or ((select public.has_role('ppic')) and receipt_source = 'Produksi RPA')
    or ((select public.has_role('purchasing')) and receipt_source = 'Beli Trading')));

create policy batch_ins on public.batch for insert to authenticated
  with check ((select public.has_role('admin','ppic')) and public.week_writable(week_id));
create policy batch_upd on public.batch for update to authenticated
  using ((select public.has_role('admin','ppic')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','ppic')) and public.week_writable(week_id));

create policy gl_line_ins on public.gl_line for insert to authenticated with check ((select public.has_role('admin','inventory_accounting')));
create policy gl_line_upd on public.gl_line for update to authenticated
  using ((select public.has_role('admin','inventory_accounting','finance'))) with check ((select public.has_role('admin','inventory_accounting','finance')));

create policy tb_opening_ins on public.tb_opening for insert to authenticated
  with check ((select public.has_role('admin','inventory_accounting')) and public.week_writable(week_id));
create policy tb_opening_upd on public.tb_opening for update to authenticated
  using ((select public.has_role('admin','inventory_accounting')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','inventory_accounting')) and public.week_writable(week_id));

create policy runrate_ins on public.runrate for insert to authenticated
  with check ((select public.has_role('admin','finance')) and public.week_writable(week_id));
create policy runrate_upd on public.runrate for update to authenticated
  using ((select public.has_role('admin','finance')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','finance')) and public.week_writable(week_id));

create policy cash_plan_ins on public.cash_plan for insert to authenticated
  with check ((select public.has_role('admin','finance','purchasing')) and public.week_writable(week_id));
create policy cash_plan_upd on public.cash_plan for update to authenticated
  using ((select public.has_role('admin','finance','purchasing')) and public.week_writable(week_id))
  with check ((select public.has_role('admin','finance','purchasing')) and public.week_writable(week_id));

create policy release_ins on public.release for insert to authenticated with check ((select public.has_role('admin','finance')));
-- audit_log: written only by the security-definer trigger; no write policy.

-------------------------------------------------------------------------------- apply_changes: one transaction per upload commit
-- Runs as the caller (security invoker) so RLS and the guards above apply to every row.
create or replace function public.apply_changes(
  p_table text, p_inserts jsonb, p_updates jsonb, p_soft_deletes uuid[], p_supersede uuid[] default '{}'
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  allowed text[] := array['sales_line','receipt_line','batch','gl_line','tb_opening','opening_stock','cash_plan','runrate','item_map','coa_map','sku_key'];
  cols text;
  u jsonb;
  n_ins int := 0; n_upd int := 0; n_del int := 0; n_sup int := 0;
  pk text := case p_table when 'item_map' then 'item_code' when 'coa_map' then 'account' when 'sku_key' then 'key' else 'id' end;
begin
  if not (p_table = any(allowed)) then
    raise exception 'apply_changes: tabel % tidak diizinkan', p_table;
  end if;
  if p_inserts is not null and jsonb_typeof(p_inserts) = 'array' and jsonb_array_length(p_inserts) > 0 then
    select string_agg(format('%I', k), ',') into cols from jsonb_object_keys(p_inserts -> 0) k;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)', p_table, cols, cols, p_table)
      using p_inserts;
    get diagnostics n_ins = row_count;
  end if;
  if p_updates is not null and jsonb_typeof(p_updates) = 'array' then
    for u in select * from jsonb_array_elements(p_updates) loop
      select string_agg(format('%I', k), ',') into cols from jsonb_object_keys(u) k where k <> pk;
      if cols is null then continue; end if;
      execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.%I::text = $1 ->> %L',
        p_table, cols, cols, p_table, pk, pk) using u;
      n_upd := n_upd + 1;
    end loop;
  end if;
  if p_soft_deletes is not null and array_length(p_soft_deletes, 1) > 0 then
    execute format('update public.%I set deleted_at = now(), deleted_by = public.current_email() where id = any($1) and deleted_at is null', p_table)
      using p_soft_deletes;
    get diagnostics n_del = row_count;
  end if;
  if p_supersede is not null and array_length(p_supersede, 1) > 0 then
    execute format('update public.%I set superseded_at = now() where id = any($1) and superseded_at is null', p_table) using p_supersede;
    get diagnostics n_sup = row_count;
  end if;
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'deleted', n_del, 'superseded', n_sup);
end $$;
grant execute on function public.apply_changes(text, jsonb, jsonb, uuid[], uuid[]) to authenticated;

-------------------------------------------------------------------------------- login allow-list (auth.users)
-- Only active e-mails in app_user can register; they are confirmed immediately (no e-mail round trip needed).
create or replace function public.tg_auth_allowlist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_user u where u.email = lower(new.email) and u.active) then
    raise exception 'E-mail % belum terdaftar di KGR Weekly Outlook. Minta Admin menambahkan Anda.', new.email
      using errcode = '42501';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;
create trigger kgr_allowlist before insert on auth.users for each row execute function public.tg_auth_allowlist();

-- Admin: create a login with a temporary password, or reset one (no e-mail needed).
create or replace function public.admin_set_password(p_email text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; e text := lower(trim(p_email));
begin
  if not (select public.has_role('admin')) then raise exception 'Hanya Admin' using errcode = '42501'; end if;
  if length(p_password) < 8 then raise exception 'Kata sandi minimal 8 karakter'; end if;
  if not exists (select 1 from public.app_user where email = e and active) then
    raise exception 'Tambahkan % ke daftar pengguna dulu', e;
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
  else
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
    return 'updated';
  end if;
end $$;
revoke all on function public.admin_set_password(text, text) from public, anon;
grant execute on function public.admin_set_password(text, text) to authenticated;

-------------------------------------------------------------------------------- storage buckets (private)
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('releases', 'releases', false) on conflict (id) do nothing;

create policy kgr_storage_read on storage.objects for select to authenticated
  using (bucket_id in ('uploads','releases') and (select public.is_app_user()));
create policy kgr_storage_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance')));
create policy kgr_storage_release on storage.objects for insert to authenticated
  with check (bucket_id = 'releases' and (select public.has_role('admin','finance')));
