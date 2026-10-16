-- v5/1 — costing (docs/PRD-v5.md §4.1, §4.6, K20–K25). Additive and re-runnable; read only while v5_costing is on.
--
-- The commercial mart carries the SKU's cost per kg from the costing engine, its status (rencana / estimasi /
-- sementara / final) and the C54 flag; the v5 sales view shows them (a cost per SKU, never per lot or batch, v4 M7).
-- lot_revaluation keeps the sold part per sale date for revaluation_sold_mode = restate_sale_date (O1).

alter table public.commercial_daily add column if not exists cost_per_kg numeric(18,4);
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily' and column_name = 'cost_status') then
    alter table public.commercial_daily add column cost_status text check (cost_status in ('rencana','estimasi','sementara','final'));
  end if;
end $$;
alter table public.commercial_daily add column if not exists cost_check boolean;

alter table public.lot_revaluation add column if not exists sold_by_date jsonb;

-- the sales view of v5: the columns of commercial_daily_sales (20261017000200, S2: no assignment, no rows) and the
-- three costing columns. A separate view, so the earlier migrations that replace commercial_daily_sales stay re-runnable.
create or replace view public.commercial_daily_sales_v5 with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff, c.cost_per_kg_ma,
         c.price_floor, c.price_list, c.margin_per_kg_list, c.realized_price_7d, c.margin_per_kg_realized, c.holding_loss_per_day,
         c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
         c.cost_per_kg, c.cost_status, c.cost_check
  from public.commercial_daily c
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = c.key)));
revoke all on public.commercial_daily_sales_v5 from public, anon;
grant select on public.commercial_daily_sales_v5 to authenticated;

-- a WP upload stamps its batches (K21, C53): set when batch_output_sku rows arrive for a batch
create or replace function public.tg_wp_received() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null then
    update public.batch set wp_received_at = coalesce(wp_received_at, now()) where id = new.batch_id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_wp_received() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'wp_received' and tgrelid = 'public.batch_output_sku'::regclass) then
    create trigger wp_received after insert on public.batch_output_sku for each row execute function public.tg_wp_received();
  end if;
end $$;
