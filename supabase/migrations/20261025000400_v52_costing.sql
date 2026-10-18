-- v5.2 B5/1 — costing and the leftovers of B2 (docs/PRD-v5.2-B-db.md B-R85, only what PRD v5.2-A asked for through
-- Q-v5.2; Q-v5.2-13, Q-v5.2-18). Additive and re-runnable: new columns, new objects, create or replace with the same
-- signatures, alter policy. Registers schema version 5.2.3.
--
-- B-R85 / R51: batch.lb_price_source — where the LB price of a batch came from (the decision of its class, the decision
--   for all classes, or typed by hand); null = none yet (C57). Written by whoever writes batch (admin, ppic, cost_accounting
--   through the existing batch policies): no new privilege.
-- B-R85 / A2 (R51, R52 stage 1): plan_check_reason.plan_week_id binds a written reason (C58) to the plan version it was
--   written for; plan_week_class.detail keeps the split per cut date a saved plan produced (null = a row saved before
--   v5.2). Both tables keep the write rights they have (admin, ppic).
-- B-R85 / A3 (R61): Finance posts an allocation that has an SKU without a reference price. allocation_run is updated by
--   admin and cost_accounting only, and batch by admin, ppic and cost_accounting; the override touches both (the run
--   becomes posted with the reason in issues, the batch costing_status becomes posted). Narrowest way: one
--   SECURITY DEFINER function, post_allocation_override(run ids, reason), that does exactly that and nothing else; no
--   write right on either table is opened to Finance.
-- Q-v5.2-13: tg_week_guard lets inventory_accounting and finance change week.opening_stock_flag while the week is open
--   (the stock upload writes it as inventory_accounting); every other column and the update_date rule are unchanged.
-- Q-v5.2-18: the two Sales views also hide holding_loss_per_day and downgrade_risk_rp unless the viewer sees cost (same
--   column lists, names, order and types as B2); price_floor_rule (markup per key) is not read by Sales.
--
-- NOT created, on purpose: save_class_plan (O33(b) postpones K27 stage 2), cost_snapshot and sales_stock_age_v52 (PRD A
-- did not ask for them; B-R85 says "only what PRD A asks for"). Q-v5.2-15 (Sales no longer read plan_week and
-- demand_weekly) is not here either: it waits for the code of A2 that reads the surplus through surplus_for_sales_v52.

-------------------------------------------------------------------------------- batch.lb_price_source (R51)
alter table public.batch add column if not exists lb_price_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'batch_lb_price_source_check' and conrelid = 'public.batch'::regclass) then
    alter table public.batch add constraint batch_lb_price_source_check
      check (lb_price_source in ('keputusan_kelas', 'keputusan_semua_kelas', 'manual'));
  end if;
end $$;
comment on column public.batch.lb_price_source is
  'PRD v5.2 R51: where lb_price came from: keputusan_kelas (decision of the batch class) > keputusan_semua_kelas (decision for all classes) > manual; null = no price yet (C57)';

-------------------------------------------------------------------------------- plan_check_reason.plan_week_id (C58 per plan version)
alter table public.plan_check_reason add column if not exists plan_week_id uuid references public.plan_week(id) on delete restrict;
comment on column public.plan_check_reason.plan_week_id is
  'PRD v5.2 R51: the plan version (plan_week) this reason was written for; null = written before v5.2 (counted by time only)';
-- one live reason per plan version and control. The older index (week_start, code) where deleted_at is null is kept (no
-- drop): while it stands, the reason of an older version is retired (deleted_at) before the next version gets its own.
create unique index if not exists plan_check_reason_plan_code
  on public.plan_check_reason (plan_week_id, code) where deleted_at is null and plan_week_id is not null;

-- the version must be a version of the same week
create or replace function public.tg_plan_check_reason_scope() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.plan_week_id is not null
     and not exists (select 1 from public.plan_week p where p.id = new.plan_week_id and p.week_start = new.week_start) then
    raise exception 'Alasan % untuk minggu % bukan milik versi rencana yang disebut', new.code, new.week_start using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_plan_check_reason_scope() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'plan_check_reason_scope' and tgrelid = 'public.plan_check_reason'::regclass) then
    create trigger plan_check_reason_scope before insert or update on public.plan_check_reason
      for each row execute function public.tg_plan_check_reason_scope();
  end if;
end $$;

-------------------------------------------------------------------------------- plan_week_class.detail (R52 stage 1)
alter table public.plan_week_class add column if not exists detail jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_week_class_detail_check' and conrelid = 'public.plan_week_class'::regclass) then
    alter table public.plan_week_class add constraint plan_week_class_detail_check
      check (detail is null or jsonb_typeof(detail) in ('object', 'array'));
  end if;
end $$;
comment on column public.plan_week_class.detail is
  'PRD v5.2 R52 stage 1: split of the class over the cut dates, as the plan was saved; null = a row saved before v5.2 (the split is derived from the demand profile)';

-------------------------------------------------------------------------------- R61 Finance override of an allocation posting
-- Posts draft allocations that carry an SKU with kg and no reference price (null or 0), which the normal posting (admin,
-- cost_accounting) refuses in the app (R61, K50). Checks, in the database:
--   * the caller is Finance or Admin; the reason has at least 10 characters (as the app asks);
--   * every run exists, is a draft, is balanced (|diff| <= 1, C21), has at least one unpriced SKU line (a priced run is
--     posted the normal way, so the override is never a general right to post), and its batch's week is not closed
--     (admin excepted, as week_writable);
--   * per run: status posted, posted_at / posted_by, the override sentence appended to issues (same wording as the app),
--     and batch.costing_status = 'posted'. C48 (a run without output) is still refused by its own trigger.
-- All runs or none. Returns the number of runs posted.
create or replace function public.post_allocation_override(p_run_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  reason text := trim(coalesce(p_reason, ''));
  email text := public.current_email();
  today date := (now() at time zone 'Asia/Jakarta')::date;
  ids uuid[]; r record; keys text; n integer := 0;
begin
  if not (select public.has_role('admin', 'finance')) then
    raise exception 'Override posting alokasi hanya oleh Finance atau Admin' using errcode = '42501';
  end if;
  if char_length(reason) < 10 then
    raise exception 'Override posting: alasan minimal 10 karakter' using errcode = '23514';
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_run_ids) x where x is not null;
  if ids is null then
    raise exception 'Pilih alokasi yang diposting dengan override' using errcode = '22023';
  end if;
  if (select count(*) from public.allocation_run a where a.id = any (ids)) <> cardinality(ids) then
    raise exception 'Ada alokasi yang tidak ditemukan' using errcode = '22023';
  end if;
  for r in
    select a.id, a.status, a.diff, a.issues, a.batch_id, coalesce(b.batch_ref, b.id::text) as batch_ref, b.week_id
      from public.allocation_run a join public.batch b on b.id = a.batch_id
     where a.id = any (ids) order by a.id for update of a
  loop
    if r.status <> 'draft' then
      raise exception 'Alokasi batch % berstatus %: hanya draft yang bisa diposting', r.batch_ref, r.status using errcode = '22023';
    end if;
    if abs(r.diff) > 1 then
      raise exception 'Alokasi batch % belum seimbang (selisih %): override tidak berlaku untuk C21', r.batch_ref, r.diff using errcode = '23514';
    end if;
    if not public.week_writable(r.week_id) then
      raise exception 'Minggu batch % sudah ditutup', r.batch_ref using errcode = '42501';
    end if;
    select string_agg(k, ', ' order by k) into keys
      from (select distinct coalesce(l.key, l.item_code, '?') as k
              from public.allocation_line l
             where l.allocation_run_id = r.id and l.kg > 0 and coalesce(l.price_ref, 0) = 0) u;
    if keys is null then
      raise exception 'Alokasi batch % berharga acuan lengkap: diposting dengan posting biasa, bukan override', r.batch_ref using errcode = '22023';
    end if;
    update public.allocation_run
       set status = 'posted', posted_at = now(), posted_by = email,
           issues = (case when jsonb_typeof(r.issues) = 'array' then r.issues else '[]'::jsonb end)
                    || to_jsonb(format('override Finance: diposting tanpa harga acuan %s — %s (%s, %s)', keys, reason, email, to_char(today, 'YYYY-MM-DD')))
     where id = r.id;
    update public.batch set costing_status = 'posted' where id = r.batch_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.post_allocation_override(uuid[], text) from public, anon;
grant execute on function public.post_allocation_override(uuid[], text) to authenticated;

-------------------------------------------------------------------------------- Q-v5.2-13 week guard: opening_stock_flag
-- As 20261025000200 (A-REL-1, K69), one added line: inventory_accounting and finance may change opening_stock_flag while
-- the week is open (before: any role but admin was refused, after the upload had already written its other rows).
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
    if k = 'opening_stock_flag' and r in ('inventory_accounting','finance') and old.status = 'open' then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-------------------------------------------------------------------------------- Q-v5.2-18 Sales views: the last two cost-derived columns
-- Same as 20261025000200 (names, order, types), with holding_loss_per_day and downgrade_risk_rp inside case when sees.
-- sees: not Sales, or the week of the row has sales_sees_cost = true; no week / no parameter row = false for Sales.
create or replace view public.commercial_daily_sales with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff,
         (case when s.sees then c.cost_per_kg_ma end)::numeric(18,4) as cost_per_kg_ma,
         (case when s.sees then c.price_floor end)::numeric(18,4) as price_floor,
         c.price_list,
         (case when s.sees then c.margin_per_kg_list end)::numeric(18,4) as margin_per_kg_list,
         c.realized_price_7d,
         (case when s.sees then c.margin_per_kg_realized end)::numeric(18,4) as margin_per_kg_realized,
         (case when s.sees then c.holding_loss_per_day end)::numeric(18,2) as holding_loss_per_day,
         (case when s.sees then c.downgrade_risk_rp end)::numeric(18,2) as downgrade_risk_rp,
         c.urgency, c.priority_score, c.rank, c.ordered_today_kg
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
         (case when s.sees then c.holding_loss_per_day end)::numeric(18,2) as holding_loss_per_day,
         (case when s.sees then c.downgrade_risk_rp end)::numeric(18,2) as downgrade_risk_rp,
         c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
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

-- the markup per key is the floor's recipe: Sales do not read it (every other role reads it as before)
alter policy price_floor_rule_read on public.price_floor_rule
  using ((select public.is_app_user()) and not (select public.has_role('sales')));

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.3') on conflict (version) do nothing;
