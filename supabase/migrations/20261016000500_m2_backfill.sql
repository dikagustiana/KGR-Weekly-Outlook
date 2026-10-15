-- v3 F2 backfill (PLAN-v3 Fase 2). The lots and movements are built by the engine (rebuildDay), not in SQL:
-- this migration queues every date from the first week with opening stock up to the latest update date, so the first
-- "Proses antrian" / "Bangun ulang" on /admin/modul (with m2_ledger on) builds the whole ledger:
--   lots origin 'opening' from opening_stock of the earliest week (assumed), lots from production / trading receipts,
--   out_sale FIFO (assumed) from actual sales, balances per lot and per key for every day.
-- Idempotent: a date that is already queued is not queued twice.
insert into public.rebuild_queue (date, reason)
select d::date, 'backfill M2'
from (select min(w.week_start) as s, max(w.week_start + 6) as e
        from public.week w where exists (select 1 from public.opening_stock o where o.week_id = w.id and o.deleted_at is null)) b,
     generate_series(b.s, b.e, interval '1 day') d
where b.s is not null
  and not exists (select 1 from public.rebuild_queue q where q.date = d::date and q.status = 'queued');
