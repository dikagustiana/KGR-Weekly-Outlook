-- v5.2 B7 — Sales no longer read plan_day, nor what is derived from or attached to it (docs/v5.2/b7.md; docs/v5/QUESTIONS.md Q-v5.2-72,
-- Q-v5.2-74, Q-v5.2-84). Additive and re-runnable: four read policies and one audit policy altered, nothing dropped, renamed or replaced.
-- Registers schema version 5.2.6.
--
-- B6 (20261025000600) closed plan_week and demand_weekly to Sales and left plan_day open on purpose: Q-v5.2-15 names the first two,
-- and the code of v5.2 A1c still had to stop reading plan_day as Sales first. It has (apps/web: the readers of plan_day are
-- loadPlanning, the copy to batch and the plan writes; none runs as Sales, proved by the register test planning-readers.test.ts and by
-- sales-plan-reads.test.tsx, where a Sales session never asks for plan_day). plan_day is the plan's days: heads per cut date, weight class,
-- cut pattern, supplier and target_kg_by_key (the plan's kg per SKU per day), so a Sales reader of it saw what plan_week now hides.
-- Q-v5.2-72 closes it the way B6 closed its two tables:
--   plan_day_read: every app user, except Sales (the same shape as plan_week_read, demand_weekly_read, plan_week_class_read).
-- The write policies (plan_day_ins, plan_day_upd: Admin and PPIC) are not touched.
--
-- Q-v5.2-84 closes the same door for the three tables that carry the content of the plan or of the demand in another form (found by a
-- scan of every table of public that Sales can still select, b7.md section 5; no code of apps/web reads any of the three as Sales):
--   plan_variance_daily  mart built from plan_day: planned kg per production unit per day (the sum of target_kg_by_key) and planned heads,
--                        beside the actual ones (varianceRows). Read by the PPIC page and by Minggu ini (not Sales).
--   demand_shortfall     mart built from demand_weekly and the plan's heads: demand (net_kg) per SKU key, output at the plan, shortfall and
--                        the suggested action (shortfallRows). Written by the rebuild with the service client; nothing in apps/web reads it.
--   plan_check_reason    the written reason that PPIC records against a plan version (plan_week_id references plan_week; B5, A2): free text
--                        about the plan, read by the PPIC actions and by loadPlanning (neither runs as Sales).
-- Their read policies take the same shape: plan_variance_daily_read, demand_shortfall_read, plan_check_reason_read = every app user, except
-- Sales. Write policies (plan_check_reason_ins and _upd: Admin and PPIC) are not touched, and the two marts have no client write policy at
-- all, as before. Left open on purpose, and why: release and batch (Sales code reads both; b7.md section 5), the other tables of the scan.
--
-- Second change, the audit trail (Q-v5.2-74: "plan_day ikut saat Q-v5.2-72 dikerjakan"). tg_audit copies the old and new values of
-- every change of these tables into audit_log (plan_day: heads, supplier, target_kg_by_key per day; plan_variance_daily and demand_shortfall:
-- the kg of the mart rows; plan_check_reason: the text of the reason), audit_log_read opens all of audit_log to every app user and only the
-- restrictive audit_log_sales_redact narrows it for Sales. The four tables join its list, which keeps every table it names since B5/B6
-- (the twenty-six of B6).
--
-- Nothing else reads these tables as the invoker (checked in a migrated database, b7.md section 4): no function, view, materialized view,
-- policy of another table or constraint names them (tg_plan_check_reason_scope reads plan_week, not plan_check_reason). Their own triggers
-- do not read them as the invoker (tg_audit is SECURITY DEFINER, tg_stamp reads no table), the foreign keys are checked as the table owner,
-- and the rebuild reads and writes with the service client.

-------------------------------------------------------------------------------- plan_day, and what is derived from it: not read by Sales
alter policy plan_day_read on public.plan_day
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy plan_variance_daily_read on public.plan_variance_daily
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy demand_shortfall_read on public.demand_shortfall
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy plan_check_reason_read on public.plan_check_reason
  using ((select public.is_app_user()) and not (select public.has_role('sales')));

-------------------------------------------------------------------------------- the audit trail of these tables is not for Sales either
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    alter policy audit_log_sales_redact on public.audit_log
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly',
        'plan_day','plan_variance_daily','demand_shortfall','plan_check_reason']));
  else
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly',
        'plan_day','plan_variance_daily','demand_shortfall','plan_check_reason']));
  end if;
end $$;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.6') on conflict (version) do nothing;
