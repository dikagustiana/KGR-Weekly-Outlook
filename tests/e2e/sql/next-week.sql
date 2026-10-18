-- PRD v5.2-A R48 (journey T7 step 11): the week row of Monday 31 Aug 2026, as the Monday rollover would create it. SETUP only (psql as
-- postgres, never a user flow): the rollover is Admin -> Minggu -> "Lanjutkan minggu" (apps/web/lib/rollover.ts), an Admin step, and the R70
-- rule is "no Admin step except the initial rebuild". Without a week row /w/2026-08-31/rencana is a 404 (weekContext), so the Rencana of the
-- week a locked commitment belongs to cannot be opened.
-- What rolloverWeek copies from the week before and this file copies too: the week row (data date = Monday: week_check update_date >= week_start),
-- parameter (Accurate totals emptied), sku_price, runrate (week adjustment reset), tb_opening. What it does not copy here: opening_stock (the
-- Rencana reads the stock mart, not this table) and the order/plan rows (the planning loaders read sales_line by date, not by week).
-- Also here: the PO of that week (Tue 1 Sep, karkas fresh 4.000 kg, a copy of the PO line KGR26.E2E01 that Sales uploaded in step 1c): the upload of Sales holds
-- it with "minggu 2026-09-01 belum ada" until the week exists (step 1c), and an upload after SETUP would rebuild the marts (commercial_daily, pl_daily_v4, ...), which
-- the cleanup could not take back; so the line is part of this SETUP.
-- The journey removes the week and the line again afterwards (next-week-undo.sql), so the journeys after T7 start from the week 24-30 Aug alone.
do $$
declare prev public.week%rowtype; nid uuid; t text; cols text;
begin
  select * into prev from public.week where week_start = date '2026-08-24';
  if not found then raise exception 'minggu 2026-08-24 tidak ada'; end if;
  if exists (select 1 from public.week where week_start = date '2026-08-31') then return; end if;
  insert into public.week (week_start, update_date, tb_opening_date, status, lw_source, opening_stock_flag)
  values (date '2026-08-31', date '2026-08-31', prev.tb_opening_date, 'open', 'e2e: rollover Senin 31/08 (SETUP, bukan langkah Admin)', 'e2e: tanpa stok awal bawaan; Rencana membaca mart stok')
  returning id into nid;
  foreach t in array array['parameter', 'sku_price', 'runrate', 'tb_opening'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name not in ('id', 'week_id', 'created_at', 'created_by', 'updated_at', 'updated_by');
    execute format('insert into public.%I (week_id, %s) select %L, %s from public.%I where week_id = %L', t, cols, nid, cols, t, prev.id);
  end loop;
  update public.parameter set accurate_sales_kg = null, accurate_opening_stock_value = null where week_id = nid;
  update public.runrate set week_adjustment = 0 where week_id = nid;
end $$;

insert into public.sales_line (week_id, seq, date, delivery_date, status, demand_status, document_ref, po_ref, customer, item_code, kg, fulfilled_kg, cancelled_kg, price, size_kg, source, channel, created_by, updated_by)
select (select id from public.week where week_start = date '2026-08-31'), 0, date '2026-09-01', date '2026-09-01', 'Order', 'Confirmed', 'KGR26.E2E06', 'KGR26.E2E06', e.customer, e.item_code, 4000, 0, 0, e.price, e.size_kg, e.source, e.channel, e.created_by, e.updated_by
  from public.sales_line e
 where e.document_ref = 'KGR26.E2E01' and e.deleted_at is null
   and not exists (select 1 from public.sales_line x where x.document_ref = 'KGR26.E2E06');
