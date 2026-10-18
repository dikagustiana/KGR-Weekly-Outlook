-- PRD v5.2-A R48 (journey T7 step 11): takes the week row of Monday 31 Aug 2026 away again, with the PO line of that week and the queue rows the
-- triggers wrote since (SETUP, psql as postgres; psql variable :since = the database time at the start of the step). The journeys after T7 (A6, L, P, R69,
-- F19, volume) start from the week 24-30 Aug alone, as before step 11: the step compares the row counts of every table before and after.
-- next-week.sql made the week, its copies and the PO line; the triggers of the data marts queue a rebuild on every insert and delete ("parameter insert",
-- "sales_line insert", "runrate delete", ...): those queue rows go too.
delete from public.sales_line where week_id = (select id from public.week where week_start = date '2026-08-31');
delete from public.tb_opening where week_id = (select id from public.week where week_start = date '2026-08-31');
delete from public.runrate where week_id = (select id from public.week where week_start = date '2026-08-31');
delete from public.sku_price where week_id = (select id from public.week where week_start = date '2026-08-31');
delete from public.parameter where week_id = (select id from public.week where week_start = date '2026-08-31');
delete from public.week where week_start = date '2026-08-31';
delete from public.rebuild_queue where date >= date '2026-08-31' and created_at >= :'since'::timestamptz;
