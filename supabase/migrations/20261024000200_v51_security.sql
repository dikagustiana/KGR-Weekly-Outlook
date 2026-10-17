-- v5.1/1 — security (docs/PRD-v5.1.md K43, K49, K53; R5, R7, R8, R9, R40). Additive and re-runnable.
--
-- K43: an assignment key may be a full SKU key or a base key; guards and the sales view compare base_key() on both
-- sides. K49: Sales write PO lines only for their assigned customers and keys (K32 in the database, not only in the
-- app). K53: the v5 sales view hides the v5 cost columns when the week's parameter.sales_sees_cost is false. R40: the
-- admin may soft-delete a locked commitment or price-list row (not unlock it); a retired price-list row may be
-- replaced. The only replacements are create or replace of functions and of the view with the same column list, and
-- alter policy of the two Sales read scopes (K43); R9 normalises the assignment e-mail to lower case.

-------------------------------------------------------------------------------- price list: soft delete (R40)
alter table public.price_list_week add column if not exists deleted_at timestamptz;
alter table public.price_list_week add column if not exists deleted_by text;

-------------------------------------------------------------------------------- K26 / K43 commitment guard
create or replace function public.tg_commitment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.app_role(); prev uuid;
begin
  if r is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Komitmen dibuat sebagai draft, lalu dikunci Kepala Sales' using errcode = '42501'; end if;
    if r = 'sales' and not exists (select 1 from public.sales_assignment a
        where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(new.key))) then
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
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(new.key))) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  new.locked_by := null; new.locked_at := null;
  return new;
end $$;
revoke execute on function public.tg_commitment_guard() from public, anon, authenticated;

-------------------------------------------------------------------------------- K24 price list guard (R40)
create or replace function public.tg_price_list_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if tg_op = 'UPDATE' and old.locked_at is not null and old.deleted_at is null then
    -- R40: the admin retires a locked row; the price and the lock stay as they were
    if r = 'admin' and new.deleted_at is not null and new.price_fresh is not distinct from old.price_fresh
       and new.price_frozen is not distinct from old.price_frozen and new.locked_at is not distinct from old.locked_at then
      return new;
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

-------------------------------------------------------------------------------- §4.6 / K43 surplus answers
create or replace function public.tg_surplus_response_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(new.key))) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.responded_by := public.current_email(); new.responded_at := now(); end if;
  return new;
end $$;

-------------------------------------------------------------------------------- K49: K32 in the database
-- A Sales user writes a PO line only for a customer and a key of one of their active assignments (customer null in the
-- assignment = every customer, key null = every SKU). A line without a customer (spot sale) is checked on the key.
create or replace function public.tg_sales_line_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if public.app_role() is distinct from 'sales' then return new; end if;
  k := coalesce(nullif(new.key_manual, ''), (select m.key from public.item_map m where m.item_code = new.item_code and m.deleted_at is null));
  if not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email()
        and (a.customer is null or new.customer is null or lower(a.customer) = lower(new.customer))
        and (a.key is null or (k is not null and public.base_key(a.key) = public.base_key(k)))) then
    raise exception 'Baris % % tidak ditugaskan kepada Anda', coalesce(new.customer, '(spot)'), coalesce(k, new.item_code, '') using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_sales_line_scope() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sales_line_scope' and tgrelid = 'public.sales_line'::regclass) then
    create trigger sales_line_scope before insert or update on public.sales_line for each row execute function public.tg_sales_line_scope();
  end if;
end $$;

-------------------------------------------------------------------------------- K43 read scope of Sales
-- the commitments and discount requests a Sales user reads match the guards above (base key on both sides); without
-- this a commitment on "RPA|Karkas" by a Sales user assigned "RPA|Karkas|Fresh" is written but not read back
alter policy sales_commitment_read on public.sales_commitment
  using ((select public.is_app_user())
         and (not (select public.has_role('sales'))
              or exists (select 1 from public.sales_assignment a
                         where a.active and lower(a.email) = public.current_email()
                           and (a.key is null or public.base_key(a.key) = public.base_key(sales_commitment.key)))));
alter policy discount_approval_sales_scope on public.discount_approval
  using (not (select public.has_role('sales'))
         or requested_by = public.current_email()
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email()
                      and (a.key is null or public.base_key(a.key) = public.base_key(discount_approval.key))));

-------------------------------------------------------------------------------- K43 + K53 sales view (same columns)
-- the cost of v5 (cost_per_kg, cost_status, cost_check) is null for Sales when the week of the row has
-- sales_sees_cost = false; the assignment is matched on base_key
create or replace view public.commercial_daily_sales_v5 with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff, c.cost_per_kg_ma,
         c.price_floor, c.price_list, c.margin_per_kg_list, c.realized_price_7d, c.margin_per_kg_realized, c.holding_loss_per_day,
         c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
         (case when s.sees then c.cost_per_kg end)::numeric(18,4) as cost_per_kg,
         case when s.sees then c.cost_status end as cost_status,
         case when s.sees then c.cost_check end as cost_check
  from public.commercial_daily c
  cross join lateral (
    select not (select public.has_role('sales'))
        or coalesce((select p.sales_sees_cost from public.parameter p join public.week w on w.id = p.week_id
                      where c.date between w.week_start and w.week_start + 6 limit 1), true) as sees
  ) s
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(c.key))));
revoke all on public.commercial_daily_sales_v5 from public, anon;
grant select on public.commercial_daily_sales_v5 to authenticated;

-------------------------------------------------------------------------------- R9 assignment e-mail stored lower case
-- the app reads the assignments of a viewer with email = lower(viewer) (no ilike: "_" and "%" are wildcards there);
-- the guards above already compare lower(a.email). Rows written by the table editor are normalised on write.
create or replace function public.tg_sales_assignment_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := nullif(lower(trim(new.email)), '');
  return new;
end $$;
revoke execute on function public.tg_sales_assignment_email() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'email_lower' and tgrelid = 'public.sales_assignment'::regclass) then
    create trigger email_lower before insert or update of email on public.sales_assignment for each row execute function public.tg_sales_assignment_email();
  end if;
end $$;
update public.sales_assignment set email = lower(trim(email)) where email is distinct from lower(trim(email));
