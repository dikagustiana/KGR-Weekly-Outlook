-- v5.2 B7 — Sales no longer read plan_day (docs/v5.2/b7.md; docs/v5/QUESTIONS.md Q-v5.2-72, Q-v5.2-74). Additive and re-runnable:
-- two policies altered, nothing dropped, renamed or replaced. Registers schema version 5.2.6.
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
-- Second change, the audit trail (Q-v5.2-74: "plan_day ikut saat Q-v5.2-72 dikerjakan"). tg_audit copies the old and new values of
-- every change of plan_day into audit_log (heads, supplier, target_kg_by_key per day), audit_log_read opens all of audit_log to every app
-- user and only the restrictive audit_log_sales_redact narrows it for Sales. plan_day joins its list, which keeps every table it names
-- since B5/B6 (the twenty-six of B6) and gains plan_day.
--
-- Nothing else reads plan_day as the invoker (checked in a migrated database, b7.md section 4): no function, view, materialized view,
-- policy of another table, trigger or constraint names it. Its own triggers do not read it as the invoker (tg_audit is SECURITY DEFINER,
-- tg_stamp reads no table), its foreign key to plan_week is checked as the table owner, and the rebuild reads it with the service client.

-------------------------------------------------------------------------------- plan_day: not read by Sales
alter policy plan_day_read on public.plan_day
  using ((select public.is_app_user()) and not (select public.has_role('sales')));

-------------------------------------------------------------------------------- the audit trail of plan_day is not for Sales either
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    alter policy audit_log_sales_redact on public.audit_log
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly','plan_day']));
  else
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly','plan_day']));
  end if;
end $$;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.6') on conflict (version) do nothing;
