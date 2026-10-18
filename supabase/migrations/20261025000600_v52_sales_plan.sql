-- v5.2 B6 — Sales no longer read PPIC's plan and demand (docs/v5.2/b6.md; docs/v5/QUESTIONS.md Q-v5.2-15). Additive and
-- re-runnable: policies altered, one trigger function and one view replaced (same signature, same columns). Registers schema version 5.2.5.
--
-- Q-v5.2-15 closes in steps. B2 (20261025000200, A-REL-3) took plan_week_class and demand_class_weekly away from Sales and
-- gave them the view surplus_for_sales_v52 (the surplus of their assigned keys, nothing of the plan). Left open there, on
-- purpose, until the code stopped reading them as Sales: plan_week (heads, output and surplus per key, frozen kg, the Rp
-- downgrade, approval) and demand_weekly (the demand per SKU and week: PO kg, weighted kg, net kg, heads). The code of v5.2
-- A1c no longer reads either as Sales (the answer to the surplus goes through the view; the Demand page, the control list and
-- the snapshot, the management preview and the Input card say "tidak ditampilkan untuk Sales"), so the read policies lose Sales:
--   plan_week_read, demand_weekly_read: every app user, except Sales (the same shape as B2's plan_week_class_read).
-- Write policies, the restrictive "no client write" policies of the demand mart and the approval policy of Finance are not touched.
-- The view surplus_for_sales_v52 keeps giving Sales their rows: it is not security_invoker, so it reads plan_week as its owner
-- (as B2 relies on), and the foreign key of surplus_response.plan_week_id is checked as the owner of plan_week as well, so a
-- Sales answer to the surplus still goes in (both proved in supabase/tests/rls_roles.sql, block "v5.2 B6").
--
-- Three more changes in this file, all found while checking what else depends on, or bypasses, a Sales read of plan_week (b6.md):
--   * (Q-v5.2-74) the audit trail. audit_log is read by every app user and the audit trigger of these tables copies the old and new
--     values of every change (plan_week: heads, output and surplus per key, downgrade; demand_weekly and demand_class_weekly: kg per
--     SKU and size; plan_week_class: kg LB and heads per class), so a table closed to Sales stayed readable to them through its
--     trail. The Sales redaction of audit_log (the restrictive policy of 20261017000200, extended by B5) now lists the four tables
--     Sales no longer read: plan_week, plan_week_class, demand_weekly, demand_class_weekly. plan_day follows its own table
--     (Q-v5.2-72): still readable, so its trail is too.
--   * (Q-v5.2-73) the BEFORE trigger of plan_check_reason (B5, A2: the plan version of a reason must belong to the reason's week)
--     read plan_week as the user who writes. Nobody but Admin and PPIC may write a reason, but the trigger fires before the
--     row-level security check, so a Sales user who tried to would be told "bukan milik versi rencana" (the trigger saw no plan)
--     instead of being refused by the policy. It is now SECURITY DEFINER (search_path fixed, no execute for clients, same body and
--     signature): an integrity check does not depend on who may read the table.
--   * (Q-v5.2-71) the view. The plan lists its surplus per production unit ("Karkas"); the answers and the assignments name the SKU
--     key ("RPA|Karkas"). B2's view joined the two on the raw key, so for a unit-keyed plan it showed Sales nothing (an assignment
--     RPA|Karkas does not cover the key "Karkas") and showed the lead two rows for one surplus (the plan row without its answer, the
--     answer without its plan kg). The view now names a unit by the base key of its RPA SKU, the way the app stores an answer
--     (apps/web/lib/v5/surplus.ts surplusKeys). Same columns, names, order and types as B2; a key that already has a "|" is unchanged.

-------------------------------------------------------------------------------- plan_week and demand_weekly: not read by Sales
alter policy plan_week_read on public.plan_week
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy demand_weekly_read on public.demand_weekly
  using ((select public.is_app_user()) and not (select public.has_role('sales')));

-------------------------------------------------------------------------------- the audit trail of the closed tables is not for Sales either
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    alter policy audit_log_sales_redact on public.audit_log
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly']));
  else
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly']));
  end if;
end $$;

-------------------------------------------------------------------------------- the version check of plan_check_reason runs as its owner
create or replace function public.tg_plan_check_reason_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.plan_week_id is not null
     and not exists (select 1 from public.plan_week p where p.id = new.plan_week_id and p.week_start = new.week_start) then
    raise exception 'Alasan % untuk minggu % bukan milik versi rencana yang disebut', new.code, new.week_start using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_plan_check_reason_scope() from public, anon, authenticated;

-------------------------------------------------------------------------------- surplus_for_sales_v52: a unit is the base key of its RPA SKU
create or replace view public.surplus_for_sales_v52 with (security_barrier = true) as
  with plan_surplus as (
    select p.id as plan_week_id,
           case when s.key like '%|%' then s.key else 'RPA|' || s.key end as key,
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

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.5') on conflict (version) do nothing;
