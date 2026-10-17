-- v5.2 B2/2 — security (docs/PRD-v5.2-B-db.md B-R83: A-REL-1, -2, -3, -4, -7, -8, -9, -10, B-REL-2, -4, -7; O21, O31,
-- O38; K69). Additive and re-runnable.
--
-- A-REL-1 / K69: week.update_date changes only while the week is open, by admin/finance (forward or back) or through
--   advance_update_date (forward, GUC kgr.advance set by that function). Policies week_upd / week_upd_v3 unchanged
--   (docs/v5.2/b2-week-writers.md: other week columns are written by non-admin roles).
-- A-REL-2 / B-REL-4: the two Sales views hide every cost-derived column (MA cost, floor, margins, v5 cost) when the
--   week's sales_sees_cost is false or the week has no parameter row; same column lists, names and types. rpc floor_of
--   (price_floor of any key) is no longer executable by clients.
-- A-REL-3: plan_week_class and demand_class_weekly are not read by Sales; surplus_response is read by Sales only for
--   assigned keys; view surplus_for_sales_v52 gives Sales the surplus of their keys (limited columns).
-- A-REL-4: tg_sales_line_scope checks the row before (OLD) and after (NEW) an update or soft delete; a line without
--   a customer passes the customer test only when it is a new spot sale.
-- A-REL-7: Sales update only their own surplus answers; responded_by / responded_at are stamped on every write.
-- A-REL-8 / O21(b): assignment_covers(a_key, k): exact, or a_key without a form suffix covers every form of it;
--   used by every guard, policy and view that matches an assignment (the v4 view included).
-- A-REL-9: a locked price-list row is never updated except once by the admin setting deleted_at (never cleared).
-- A-REL-10 / O31(a): lock_commitments refuses (23514) a key whose sizes carry different prices, takes one price per
--   key deterministically, refuses a week that has started (WIB) unless admin, and leaves locked price rows alone.
-- B-REL-7: item_map lookups in triggers normalise the item code as the engine (trim of JS whitespace, upper case,
--   first item_code in order).
-- B-REL-2 / O38: release_override_policy is changed by migrations only (no write privilege for authenticated).
-- Only create or replace (same signatures), alter policy, revoke, and new objects. Registers schema version 5.2.1.

-------------------------------------------------------------------------------- O21 assignment cover
-- a null assignment key = every key; "RPA|Karkas" covers "RPA|Karkas", "…|Fresh", "…|Frozen", "…|n/a";
-- "RPA|Karkas|Fresh" covers only itself
create or replace function public.assignment_covers(a_key text, k text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select a_key is null
      or coalesce(a_key = k, false)
      or coalesce(a_key = public.base_key(a_key) and public.base_key(k) = a_key, false)
$$;
revoke all on function public.assignment_covers(text, text) from public, anon;
grant execute on function public.assignment_covers(text, text) to authenticated;

-------------------------------------------------------------------------------- B-REL-7 item code as the engine
-- packages/engine/src/prepare.ts:228,281,286: norm = s.trim().toUpperCase(); the first item_map row (ordered by
-- item_code, lib/data.ts:96) of a normalised code wins. JS trim() removes these white-space characters.
create or replace function public.norm_code(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select upper(regexp_replace(p,
    '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g'))
$$;
revoke all on function public.norm_code(text) from public, anon;
grant execute on function public.norm_code(text) to authenticated;

-- Key of a sales line: key_manual, else the item map (v4 20261020000100; only the item lookup changes)
create or replace function public.sales_key(p_item_code text, p_key_manual text) returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(trim(coalesce(p_key_manual, '')), '') is not null then trim(p_key_manual)
              when coalesce(public.norm_code(p_item_code), '') = '' then null
              else (select m.key from public.item_map m
                     where public.norm_code(m.item_code) = public.norm_code(p_item_code) and m.deleted_at is null
                     order by m.item_code limit 1) end;
$$;
revoke all on function public.sales_key(text, text) from public, anon;

-------------------------------------------------------------------------------- A-REL-1 / K69 week guard
-- Same rule as 20261019000100 for every column but update_date. update_date: only while old.status = 'open'; admin
-- and finance forward or back (audit_log keeps old and new); inventory_accounting / cost_accounting only through
-- advance_update_date (GUC kgr.advance = 'on', forward, at most the Monday after the week). The service role (no app
-- role) is not checked, as before.
create or replace function public.tg_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
  via_advance boolean := coalesce(current_setting('kgr.advance', true), '') = 'on';
begin
  if r is null then return new; end if;
  if new.update_date is distinct from old.update_date then
    if old.status is distinct from 'open' then
      raise exception 'Tanggal update minggu % tidak bisa diubah: status %', old.week_start, old.status using errcode = '42501';
    end if;
    if r in ('admin','finance') then
      null;
    elsif via_advance and r in ('inventory_accounting','cost_accounting')
          and new.update_date > old.update_date and new.update_date <= old.week_start + 7 then
      null;
    else
      raise exception 'Peran % tidak boleh mengubah tanggal update minggu; tanggal maju lewat upload data', r using errcode = '42501';
    end if;
  end if;
  if r = 'admin' then return new; end if;
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at','updated_by','week_end','update_date') or (o -> k) is not distinct from (n -> k) then continue; end if;
    if k = 'status' and r = 'finance' and old.status in ('open','released') and new.status in ('open','released') then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-- K39 (20261024000300) with the GUC that tg_week_guard accepts; checks and signature unchanged
create or replace function public.advance_update_date(p_week_id uuid, p_date date) returns date
language plpgsql security definer set search_path = '' as $$
declare w public.week%rowtype; nd date;
begin
  if not (select public.has_role('admin','finance','inventory_accounting','cost_accounting')) then
    raise exception 'Tanggal update dimajukan oleh upload Inventory Accounting, Cost Accounting atau Finance' using errcode = '42501';
  end if;
  select * into w from public.week where id = p_week_id;
  if not found then raise exception 'Minggu tidak ada'; end if;
  if w.status <> 'open' or p_date is null or p_date < w.week_start or p_date > w.week_start + 6 then return w.update_date; end if;
  nd := greatest(w.update_date, least(p_date + 1, w.week_start + 7));
  if nd <> w.update_date then
    perform set_config('kgr.advance', 'on', true);
    update public.week set update_date = nd where id = w.id;
    perform set_config('kgr.advance', 'off', true);
  end if;
  return nd;
end $$;
revoke all on function public.advance_update_date(uuid, date) from public, anon;
grant execute on function public.advance_update_date(uuid, date) to authenticated;

-------------------------------------------------------------------------------- A-REL-2 / B-REL-4 / O21 Sales views (same columns)
-- sees: not Sales, or the week of the row has sales_sees_cost = true; no week / no parameter row = false for Sales
create or replace view public.commercial_daily_sales with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff,
         (case when s.sees then c.cost_per_kg_ma end)::numeric(18,4) as cost_per_kg_ma,
         (case when s.sees then c.price_floor end)::numeric(18,4) as price_floor,
         c.price_list,
         (case when s.sees then c.margin_per_kg_list end)::numeric(18,4) as margin_per_kg_list,
         c.realized_price_7d,
         (case when s.sees then c.margin_per_kg_realized end)::numeric(18,4) as margin_per_kg_realized,
         c.holding_loss_per_day, c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg
  from public.commercial_daily c
  cross join lateral (
    select not (select public.has_role('sales'))
        or coalesce((select p.sales_sees_cost from public.parameter p join public.week w on w.id = p.week_id
                      where c.date between w.week_start and w.week_start + 6 limit 1), false) as sees
  ) s
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, c.key)));
revoke all on public.commercial_daily_sales from public, anon;
grant select on public.commercial_daily_sales to authenticated;

create or replace view public.commercial_daily_sales_v5 with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff,
         (case when s.sees then c.cost_per_kg_ma end)::numeric(18,4) as cost_per_kg_ma,
         (case when s.sees then c.price_floor end)::numeric(18,4) as price_floor,
         c.price_list,
         (case when s.sees then c.margin_per_kg_list end)::numeric(18,4) as margin_per_kg_list,
         c.realized_price_7d,
         (case when s.sees then c.margin_per_kg_realized end)::numeric(18,4) as margin_per_kg_realized,
         c.holding_loss_per_day, c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
         (case when s.sees then c.cost_per_kg end)::numeric(18,4) as cost_per_kg,
         case when s.sees then c.cost_status end as cost_status,
         case when s.sees then c.cost_check end as cost_check
  from public.commercial_daily c
  cross join lateral (
    select not (select public.has_role('sales'))
        or coalesce((select p.sales_sees_cost from public.parameter p join public.week w on w.id = p.week_id
                      where c.date between w.week_start and w.week_start + 6 limit 1), false) as sees
  ) s
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, c.key)));
revoke all on public.commercial_daily_sales_v5 from public, anon;
grant select on public.commercial_daily_sales_v5 to authenticated;

-- Found while reviewing A-REL-2: floor_of(key, date) hands price_floor to any signed-in user through rpc, whatever the
-- week's sales_sees_cost and the viewer's assignment. Only the SECURITY DEFINER triggers of C38 call it (they run as the
-- owner), the app never does, so clients lose execute (the owner and the service role keep it).
revoke execute on function public.floor_of(text, date) from authenticated;

-------------------------------------------------------------------------------- A-REL-3 Sales read scope of planning
alter policy plan_week_class_read on public.plan_week_class
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy demand_class_weekly_read on public.demand_class_weekly
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy surplus_response_read on public.surplus_response
  using ((select public.is_app_user())
         and (not (select public.has_role('sales'))
              or exists (select 1 from public.sales_assignment a
                         where a.active and lower(a.email) = public.current_email()
                           and public.assignment_covers(a.key, surplus_response.key))));

-- What Sales need of a surplus: per plan week (every version not deleted) and key, the plan's surplus kg and the
-- latest answer. Only keys of the viewer's assignments for Sales; no plan detail (classes, heads, cost, downgrade).
create or replace view public.surplus_for_sales_v52 with (security_barrier = true) as
  with plan_surplus as (
    select p.id as plan_week_id, s.key,
           case when s.value #>> '{}' ~ '^-?[0-9]{1,10}(\.[0-9]+)?$' then round((s.value #>> '{}')::numeric, 2) end as plan_surplus_kg
      from public.plan_week p
     cross join lateral jsonb_each(case when jsonb_typeof(p.surplus_kg_by_key) = 'object' then p.surplus_kg_by_key else '{}'::jsonb end) s
     where p.deleted_at is null
  ), answer as (
    select distinct on (r.plan_week_id, r.key) r.plan_week_id, r.key, r.surplus_kg, r.response, r.absorb_kg, r.price, r.responded_by, r.responded_at
      from public.surplus_response r
     where r.deleted_at is null
     order by r.plan_week_id, r.key, r.responded_at desc, r.id desc
  ), k as (
    select plan_week_id, key from plan_surplus union select plan_week_id, key from answer
  )
  select p.week_start, p.version as plan_version, k.plan_week_id, k.key, ps.plan_surplus_kg,
         a.surplus_kg as answered_surplus_kg, a.response, a.absorb_kg, a.price, a.responded_by, a.responded_at
    from k
    join public.plan_week p on p.id = k.plan_week_id and p.deleted_at is null
    left join plan_surplus ps on ps.plan_week_id = k.plan_week_id and ps.key = k.key
    left join answer a on a.plan_week_id = k.plan_week_id and a.key = k.key
   where (select public.is_app_user())
     and (not (select public.has_role('sales'))
          or exists (select 1 from public.sales_assignment sa
                     where sa.active and lower(sa.email) = public.current_email() and public.assignment_covers(sa.key, k.key)));
revoke all on public.surplus_for_sales_v52 from public, anon;
grant select on public.surplus_for_sales_v52 to authenticated;

-------------------------------------------------------------------------------- A-REL-4 / O21 / B-REL-7 Sales PO lines
-- Scope of one line for the signed-in Sales user: an active assignment whose customer is null (every customer) or the
-- line's customer, and whose key covers the line's key. A line without a customer is in scope of a customer-bound
-- assignment only when it is a new spot sale (p_spot_insert).
create or replace function public.sales_line_in_scope(p_customer text, p_key text, p_spot_insert boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sales_assignment a
    where a.active and lower(a.email) = public.current_email()
      and (a.customer is null
           or (p_customer is not null and lower(a.customer) = lower(p_customer))
           or (p_customer is null and coalesce(p_spot_insert, false)))
      and public.assignment_covers(a.key, p_key))
$$;
revoke all on function public.sales_line_in_scope(text, text, boolean) from public, anon, authenticated;

create or replace function public.tg_sales_line_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if public.app_role() is distinct from 'sales' then return new; end if;
  -- UPDATE and soft delete: the line as it was must be the user's too (no taking over another rep's PO)
  if tg_op = 'UPDATE' then
    k := public.sales_key(old.item_code, old.key_manual);
    if not public.sales_line_in_scope(old.customer, k, false) then
      raise exception 'Baris % % bukan dalam assignment Anda; tidak bisa diubah atau dihapus', coalesce(old.customer, '(tanpa pelanggan)'), coalesce(k, old.item_code, '')
        using errcode = '42501';
    end if;
  end if;
  k := public.sales_key(new.item_code, new.key_manual);
  if not public.sales_line_in_scope(new.customer, k, tg_op = 'INSERT' and new.channel is not distinct from 'spot') then
    raise exception 'Baris % % tidak ditugaskan kepada Anda', coalesce(new.customer, '(tanpa pelanggan)'), coalesce(k, new.item_code, '') using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_sales_line_scope() from public, anon, authenticated;

-------------------------------------------------------------------------------- A-REL-7 / O21 surplus answers
alter policy surplus_response_upd on public.surplus_response
  using ((select public.has_role('admin','commercial_lead'))
         or ((select public.has_role('sales')) and responded_by = public.current_email()))
  with check ((select public.has_role('admin','commercial_lead'))
              or ((select public.has_role('sales')) and responded_by = public.current_email()));

create or replace function public.tg_surplus_response_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, new.key)) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  -- the responder is whoever wrote the answer last (insert or update)
  new.responded_by := public.current_email(); new.responded_at := now();
  return new;
end $$;

-------------------------------------------------------------------------------- O21 commitments (K26 guard of 20261024000200)
create or replace function public.tg_commitment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.app_role(); prev uuid;
begin
  if r is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Komitmen dibuat sebagai draft, lalu dikunci Kepala Sales' using errcode = '42501'; end if;
    if r = 'sales' and not exists (select 1 from public.sales_assignment a
        where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, new.key)) then
      raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
    end if;
    new.version := coalesce((select max(c.version) from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
                              and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0)), 0) + 1;
    if new.version > 1 and exists (select 1 from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
        and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0) and c.status = 'locked' and c.deleted_at is null)
       and length(trim(coalesce(new.reason, ''))) < 5 then
      raise exception 'Komitmen sudah dikunci: versi baru wajib alasan' using errcode = '23514';
    end if;
    new.locked_by := null; new.locked_at := null;
    return new;
  end if;
  -- UPDATE
  if pg_trigger_depth() > 1 and old.status = 'locked' and new.status = 'superseded' then return new; end if;   -- set by the lock below
  -- R40: the admin retires a row (soft delete); status, figures and the lock stay as they were
  if r = 'admin' and old.deleted_at is null and new.deleted_at is not null and new.status = old.status
     and new.fresh_kg is not distinct from old.fresh_kg and new.frozen_kg is not distinct from old.frozen_kg and new.price is not distinct from old.price then
    return new;
  end if;
  if old.status in ('locked','superseded') then
    raise exception 'Komitmen versi % sudah %; buat versi baru dengan alasan', old.version, old.status using errcode = '42501';
  end if;
  if new.status = 'locked' then
    if r not in ('commercial_lead','admin') then raise exception 'Komitmen dikunci oleh Kepala Sales' using errcode = '42501'; end if;
    new.locked_by := public.current_email(); new.locked_at := now();
    select c.id into prev from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
       and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0) and c.status = 'locked' and c.deleted_at is null and c.id <> new.id;
    if prev is not null then
      if length(trim(coalesce(new.reason, ''))) < 5 then raise exception 'Versi baru setelah kunci wajib alasan' using errcode = '23514'; end if;
      update public.sales_commitment set status = 'superseded' where id = prev;
    end if;
    return new;
  end if;
  if new.status = 'superseded' then raise exception 'Versi digeser hanya saat versi baru dikunci' using errcode = '42501'; end if;
  -- Sales change a draft only of a key they cover, before and after the change
  if r = 'sales' and (not exists (select 1 from public.sales_assignment a
                                   where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, new.key))
                      or not exists (select 1 from public.sales_assignment a
                                   where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, old.key))) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  new.locked_by := null; new.locked_at := null;
  return new;
end $$;
revoke execute on function public.tg_commitment_guard() from public, anon, authenticated;

alter policy sales_commitment_read on public.sales_commitment
  using ((select public.is_app_user())
         and (not (select public.has_role('sales'))
              or exists (select 1 from public.sales_assignment a
                         where a.active and lower(a.email) = public.current_email()
                           and public.assignment_covers(a.key, sales_commitment.key))));
alter policy discount_approval_sales_scope on public.discount_approval
  using (not (select public.has_role('sales'))
         or requested_by = public.current_email()
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email()
                      and public.assignment_covers(a.key, discount_approval.key)));

-------------------------------------------------------------------------------- A-REL-9 locked price list (K24, R40)
-- A locked row does not change. The admin may retire it once: deleted_at (and deleted_by) set, every other column as
-- it was. A retired row is never updated again (deleted_at is not cleared, the price is not changed).
create or replace function public.tg_price_list_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
  keep text[] := array['deleted_at','deleted_by','updated_at','updated_by'];
begin
  if r is null then return new; end if;
  if tg_op = 'UPDATE' and old.locked_at is not null then
    if r = 'admin' and old.deleted_at is null and new.deleted_at is not null and (to_jsonb(old) - keep) = (to_jsonb(new) - keep) then
      return new;
    end if;
    if old.deleted_at is not null then
      raise exception 'Price list minggu % untuk % sudah dikunci dan diarsip; tidak bisa diubah atau dihidupkan lagi', old.week_start, old.key using errcode = '42501';
    end if;
    raise exception 'Price list minggu % untuk % sudah dikunci', old.week_start, old.key using errcode = '42501';
  end if;
  if new.locked_at is not null then
    if r not in ('commercial_lead','admin') then raise exception 'Price list dikunci oleh Kepala Sales' using errcode = '42501'; end if;
    new.locked_by := public.current_email();
  else
    new.locked_by := null;
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------- A-REL-10 / O31(a) lock of next week's commitments
-- As 20261024000300, plus: a week that has started (Monday <= today WIB) is locked by the admin only; the locked
-- versions of one key must carry one price over all sizes (else 23514 with the keys, nothing changes); that price is
-- written to the price list; a locked price-list row (live or retired, A-REL-9) is left as it is.
create or replace function public.lock_commitments(p_week_start date, p_price_frozen jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0; missing text; prev_w uuid; pf numeric; src text;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if not (select public.has_role('admin','commercial_lead')) then
    raise exception 'Komitmen dikunci oleh Kepala Sales' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then raise exception 'Minggu harus hari Senin' using errcode = '22023'; end if;
  if p_week_start <= today and not (select public.has_role('admin')) then
    raise exception 'Minggu % sudah berjalan (hari ini %): komitmen dikunci sebelum minggunya; koreksi oleh Admin', p_week_start, today
      using errcode = '42501';
  end if;
  select string_agg(c.key, ', ' order by c.key) into missing
    from public.sales_commitment c
   where c.week_start = p_week_start and c.status = 'draft' and c.deleted_at is null
     and length(trim(coalesce(c.reason, ''))) < 5
     and exists (select 1 from public.sales_commitment l where l.week_start = c.week_start and l.key = c.key
                   and coalesce(l.size_kg, 0) = coalesce(c.size_kg, 0) and l.status = 'locked' and l.deleted_at is null);
  if missing is not null then
    raise exception 'Versi baru setelah kunci wajib alasan: %', missing using errcode = '23514';
  end if;
  for d in select c.id from public.sales_commitment c
            where c.week_start = p_week_start and c.status = 'draft' and c.deleted_at is null order by c.key, c.size_kg loop
    update public.sales_commitment set status = 'locked' where id = d.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Tidak ada draft komitmen untuk minggu %', p_week_start using errcode = '22023'; end if;
  -- O31(a): one price per key over its sizes (the whole call is undone when not)
  select string_agg(x.key, ', ' order by x.key) into missing
    from (select c.key from public.sales_commitment c
           where c.week_start = p_week_start and c.status = 'locked' and c.deleted_at is null and c.price is not null
           group by c.key having count(distinct c.price) > 1) x;
  if missing is not null then
    raise exception 'Harga komitmen berbeda antar ukuran untuk key yang sama: %; samakan harga per key lalu kunci lagi', missing using errcode = '23514';
  end if;
  select w.id into prev_w from public.week w where w.week_start = p_week_start - 7;
  for d in select c.key, min(c.price) as price from public.sales_commitment c
            where c.week_start = p_week_start and c.status = 'locked' and c.deleted_at is null and c.price is not null
            group by c.key order by c.key loop
    if exists (select 1 from public.price_list_week p where p.week_start = p_week_start and p.key = d.key and p.locked_at is not null) then continue; end if;
    pf := nullif(coalesce(p_price_frozen, '{}'::jsonb) ->> d.key, '')::numeric;
    src := case when pf is not null then 'form' end;
    if pf is null and prev_w is not null then
      select sp.ref_sell_price into pf from public.sku_price sp where sp.week_id = prev_w and sp.key = public.base_key(d.key) || '|Frozen';
      src := case when pf is not null then 'sku_price' end;
    end if;
    insert into public.price_list_week (week_start, key, price_fresh, price_frozen, price_frozen_source, locked_at, deleted_at, deleted_by)
    values (p_week_start, d.key, d.price, pf, src, now(), null, null)
    on conflict (week_start, key) do update
      set price_fresh = excluded.price_fresh, price_frozen = excluded.price_frozen, price_frozen_source = excluded.price_frozen_source,
          locked_at = excluded.locked_at, deleted_at = null, deleted_by = null;
  end loop;
  return n;
end $$;
revoke all on function public.lock_commitments(date, jsonb) from public, anon;
grant execute on function public.lock_commitments(date, jsonb) to authenticated;

-------------------------------------------------------------------------------- B-REL-2 / O38 override policy by migration only
-- Who may override which control is set here and in later migrations, never through the API (Admin included).
revoke insert, update, delete, truncate on public.release_override_policy from public, anon, authenticated;
alter policy release_override_policy_upd on public.release_override_policy using (false) with check (false);

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.1') on conflict (version) do nothing;
