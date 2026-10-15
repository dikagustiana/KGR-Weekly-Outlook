-- v4 irisan 0 — security findings S1, S2, S4, S5, S6 (docs/PRD-v4.md §8; S3 = K7 in 20261017000100).
-- Additive and re-runnable. Guards that depend on a module read the global flag in app_setting, so with every module
-- off (the production default) the only behaviour change is S1: a signed-in user can no longer call mart_replace.

-------------------------------------------------------------------------------- S1: data marts are written by the server job only
-- Same body as 20261016000400 except the caller check: the service role (the rebuild job on the server) instead of
-- any operational role, and the scope is recorded in data_status (§4.3).
create or replace function public.mart_replace(p_table text, p_scope text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.mart_table%rowtype;
  cols text; upd text; keys text; tcols text; ecols text; keep text := '';
  n_ins int := 0; n_del int := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'mart_replace: data mart hanya ditulis job rebuild di server' using errcode = '42501';
  end if;
  select * into m from public.mart_table where name = p_table;
  if not found then raise exception 'mart_replace: % bukan tabel data mart', p_table; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'mart_replace: rows harus array'; end if;
  select string_agg(format('%I', k), ',') into keys from unnest(m.key_cols) k;
  if m.keep_col is not null and m.keep_values is not null then
    keep := format(' and t.%I::text <> all (%L::text[])', m.keep_col, m.keep_values);
  end if;
  if jsonb_array_length(p_rows) > 0 then
    select string_agg(format('%I', k), ','), string_agg(format('t.%I', k), ','), string_agg(format('excluded.%I', k), ',')
      into cols, tcols, ecols
      from jsonb_object_keys(p_rows -> 0) k where not (k = any(m.key_cols));
    upd := (select string_agg(format('%I = excluded.%I', k, k), ',') from jsonb_object_keys(p_rows -> 0) k where not (k = any(m.key_cols)));
    cols := keys || coalesce(',' || cols, '');
    execute format(
      'insert into public.%I as t (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do %s',
      p_table, cols, cols, p_table, keys,
      case when upd is null then 'nothing' else format('update set %s where (%s) is distinct from (%s)', upd, tcols, ecols) end)
      using p_rows;
    get diagnostics n_ins = row_count;
  end if;
  execute format(
    'delete from public.%I t where t.%I::text = $2%s and (%s) not in (select %s from jsonb_populate_recordset(null::public.%I, $1))',
    p_table, m.scope_col, keep, (select string_agg(format('t.%I', k), ',') from unnest(m.key_cols) k), keys, p_table)
    using p_rows, p_scope;
  get diagnostics n_del = row_count;
  -- input_fingerprint = md5 of the rows the engine produced for the scope; the registry row only changes when the
  -- content does (an unchanged rebuild writes nothing, as for the mart rows themselves)
  insert into public.data_status as d (table_name, scope, status, built_at, input_fingerprint, stale_from)
  values (p_table, p_scope, 'draft', now(), md5(p_rows::text), null)
  on conflict (table_name, scope) do update set status = 'draft', built_at = excluded.built_at,
    input_fingerprint = excluded.input_fingerprint, stale_from = null
  where d.input_fingerprint is distinct from excluded.input_fingerprint or d.status <> 'draft' or d.stale_from is not null;
  return jsonb_build_object('written', n_ins, 'deleted', n_del);
end $$;
revoke all on function public.mart_replace(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mart_replace(text, text, jsonb) to service_role;

-- No direct client write either: the admin insert/update policies of the v3 marts are neutralised by a restrictive
-- policy (the service role bypasses RLS). lot_movement keeps its manual rows (inputs) through its own policies.
do $$
declare t text;
begin
  foreach t in array array['lot','lot_balance_daily','sku_balance_daily','demand_weekly','pl_daily','cash_position_daily',
                           'ccc_daily','solvency_monthly','commercial_daily','sales_scorecard_weekly'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_no_client_ins') then
      execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (false)', t || '_no_client_ins', t);
      execute format('create policy %I on public.%I as restrictive for update to authenticated using (false)', t || '_no_client_upd', t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------- S2: sales without an assignment see no SKU
-- The commercial view for sales lists only the keys assigned to the signed-in rep (a row with key null = every key of
-- that assignment). No assignment = no rows (default deny). Column list unchanged from 20261016001200.
create or replace view public.commercial_daily_sales with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff, c.cost_per_kg_ma,
         c.price_floor, c.price_list, c.margin_per_kg_list, c.realized_price_7d, c.margin_per_kg_realized, c.holding_loss_per_day,
         c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg
  from public.commercial_daily c
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = c.key)));
revoke all on public.commercial_daily_sales from public, anon;
grant select on public.commercial_daily_sales to authenticated;

-- Discount requests: sales read their own requests and those of their assigned keys
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'discount_approval' and policyname = 'discount_approval_sales_scope') then
    create policy discount_approval_sales_scope on public.discount_approval as restrictive for select to authenticated
      using (not (select public.has_role('sales'))
             or requested_by = public.current_email()
             or exists (select 1 from public.sales_assignment a
                        where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = discount_approval.key)));
  end if;
end $$;

-------------------------------------------------------------------------------- S4: the audit trail of cost detail is not for sales
-- Sales cannot read old/new payloads of tables carrying cost pools, batch costs, overhead, cost per lot (SI), cash and
-- fixed-cost detail. Other roles unchanged.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment']));
  end if;
end $$;

-------------------------------------------------------------------------------- S5: invariants in the database, not only in forms
-- C29: Σ allocation per order line ≤ kg − cancelled_kg. The line row is locked first (parallel requests queue).
create or replace function public.tg_allocation_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap numeric; tot numeric;
begin
  if new.deleted_at is not null then return new; end if;
  select s.kg - s.cancelled_kg into cap from public.sales_line s where s.id = new.sales_line_id for update;
  select coalesce(sum(a.kg), 0) into tot from public.allocation a
   where a.sales_line_id = new.sales_line_id and a.deleted_at is null and a.id is distinct from new.id;
  if tot + new.kg > cap then
    raise exception 'C29: alokasi % kg melebihi order (% kg sudah dialokasikan dari % kg)', new.kg, tot, cap using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_allocation_cap() from public, anon, authenticated;

-- C38: an Order priced under the floor needs an approved discount that covers it (same rule as @kgr/engine guardOrders:
-- same key and customer, requested price ≤ price, kg ≥ kg, not yet used by another line). Active only while the
-- m7_approval flag is on; the floor is the latest commercial row of the key within 14 days (lib/v3/discount.ts).
create or replace function public.tg_floor_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text; fl numeric; on_ boolean;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if public.app_role() is null then return new; end if;
  -- status null counts as an order, as in floorGuard (lib/v3/discount.ts)
  if coalesce(new.status, 'Order') <> 'Order' or new.deleted_at is not null or new.price is null or new.kg is null then return new; end if;
  select coalesce((s.value ->> 'enabled')::boolean, false) into on_ from public.app_setting s where s.key = 'm7_approval';
  if not coalesce(on_, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.status, 'Order') = 'Order' and new.price is not distinct from old.price and new.kg is not distinct from old.kg
     and new.item_code is not distinct from old.item_code and new.key_manual is not distinct from old.key_manual
     and new.customer is not distinct from old.customer then
    return new;
  end if;
  k := case when nullif(trim(coalesce(new.key_manual, '')), '') is not null then new.key_manual
            else (select m.key from public.item_map m where upper(trim(m.item_code)) = upper(trim(new.item_code)) and m.deleted_at is null limit 1) end;
  if k is null then return new; end if;
  select c.price_floor into fl from public.commercial_daily c
   where c.key = k and c.date <= today and c.date >= today - 14 and c.price_floor is not null order by c.date desc limit 1;
  if fl is null or new.price >= fl then return new; end if;
  if exists (select 1 from public.discount_approval a
             where a.status = 'approved' and a.key = k and coalesce(a.customer, '') = coalesce(new.customer, '')
               and a.requested_price <= new.price and a.kg >= new.kg and (a.sales_line_id is null or a.sales_line_id = new.id)) then
    return new;
  end if;
  raise exception 'C38: harga Rp % untuk % di bawah harga lantai Rp % tanpa approval diskon', round(new.price), k, round(fl) using errcode = '42501';
end $$;
revoke execute on function public.tg_floor_guard() from public, anon, authenticated;

-- No self-approval (G2): the decider of a discount request is not its requester. Same body as 20261016001300 plus that
-- check; admin keeps deciding everything.
create or replace function public.tg_discount_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null or r = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'Permintaan diskon dibuat dengan status pending' using errcode = '42501'; end if;
    new.requested_by := coalesce(new.requested_by, (select auth.jwt() ->> 'email'));
    return new;
  end if;
  if new.status is distinct from old.status or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    if old.status <> 'pending' then raise exception 'Keputusan diskon sudah final' using errcode = '42501'; end if;
    if old.requested_by is not null and lower(old.requested_by) = public.current_email() then
      raise exception 'Permintaan diskon tidak diputuskan oleh pengajunya sendiri' using errcode = '42501';
    end if;
    if r = 'finance' then return new; end if;
    if r = 'commercial_lead' then
      if new.rp_per_kg_below > public.discount_limit() then
        raise exception 'Diskon % Rp/kg di atas batas commercial lead (% Rp/kg): keputusan Finance', new.rp_per_kg_below, public.discount_limit() using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Peran % tidak memutuskan diskon', r using errcode = '42501';
  end if;
  -- the request itself (price, floor, kg) is fixed once made
  if (to_jsonb(new) - array['sales_line_id','reason','updated_at','updated_by']) is distinct from (to_jsonb(old) - array['sales_line_id','reason','updated_at','updated_by']) then
    raise exception 'Isi permintaan diskon tidak bisa diubah' using errcode = '42501';
  end if;
  return new;
end $$;

-- A locked monthly version is not deleted either (update is already refused by version_immutable, 20261016001000)
create or replace function public.tg_version_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Versi outlook yang sudah dikunci tidak bisa dihapus' using errcode = '42501';
end $$;

-- An approved weekly plan is a record: its numbers do not change (save a new version instead). Copying to batch,
-- the note and soft delete stay possible.
create or replace function public.tg_plan_week_approved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.app_role() is null then return new; end if;
  if old.approved_at is not null
     and (to_jsonb(new) - array['copied_to_batch_at','note','deleted_at','deleted_by','updated_at','updated_by'])
         is distinct from (to_jsonb(old) - array['copied_to_batch_at','note','deleted_at','deleted_by','updated_at','updated_by']) then
    raise exception 'Rencana versi % sudah disetujui; simpan sebagai versi baru', old.version using errcode = '42501';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'allocation_cap' and tgrelid = 'public.allocation'::regclass) then
    create trigger allocation_cap before insert or update of kg, sales_line_id, deleted_at on public.allocation
      for each row execute function public.tg_allocation_cap();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'floor_guard' and tgrelid = 'public.sales_line'::regclass) then
    create trigger floor_guard before insert or update on public.sales_line for each row execute function public.tg_floor_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'version_no_delete' and tgrelid = 'public.month_outlook_version'::regclass) then
    create trigger version_no_delete before delete on public.month_outlook_version for each row execute function public.tg_version_no_delete();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'plan_week_approved' and tgrelid = 'public.plan_week'::regclass) then
    create trigger plan_week_approved before update on public.plan_week for each row execute function public.tg_plan_week_approved();
  end if;
end $$;

-------------------------------------------------------------------------------- S6: SECURITY DEFINER hygiene
-- Every security-definer function in public must pin search_path; none is executable by anon; trigger functions are
-- not executable through the API at all (a trigger fires without EXECUTE). Fails the migration when a function breaks
-- the rule. A function that authenticated or service_role could execute before (RLS helpers such as app_role,
-- week_writable, and the RPCs module_enabled, discount_limit, admin_set_password) keeps an explicit grant, so removing
-- the PUBLIC grant never breaks a policy.
do $$
declare f record; a boolean; sr boolean;
begin
  for f in select p.oid, p.oid::regprocedure as sig, p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger, p.proconfig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef loop
    if f.proconfig is null or not exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%') then
      raise exception 'S6: % is SECURITY DEFINER without a fixed search_path', f.sig;
    end if;
    a := has_function_privilege('authenticated', f.oid, 'execute');
    sr := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      if a then execute format('grant execute on function %s to authenticated', f.sig); end if;
      if sr then execute format('grant execute on function %s to service_role', f.sig); end if;
    end if;
  end loop;
end $$;
grant execute on function public.mart_replace(text, text, jsonb) to service_role;
