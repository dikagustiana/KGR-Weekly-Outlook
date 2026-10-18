-- PRD v5.2-A R71: "all inputs filled" for the fixture week 24-30 Aug 2026. SETUP only (psql as postgres, never a user
-- flow); every block says why the app has no path for it. What the app can take through its own screens is NOT here:
-- journey-T7 does it with the role that owns the input (supply LB, yield per class, capacity, the class plan, the LB
-- price of the cut dates still ahead, WP, invoices, posting, allocation of Thu/Fri, commitments, the Accurate totals
-- of C8/C9, the refresh of the grid and the release).
-- The fixture is "as of Thursday 27 Aug": Mon-Wed have no sales, allocation, stock card or LB decisions in it. This file
-- is that history (small, balanced, clearly synthetic); the loop runs from Thursday 27 Aug to the release on Friday.
-- Safe to re-run.

------------------------------------------------------------------------------------------------------------------
-- 1. Master data without an editor (PRD v5.2-A §3.7: "Editor size_class_map" is not built; the class ranges are "diisi
--    PPIC" in PRD v5 O5 but have no screen). Ranges and the size → class map are illustrative.
update public.weight_class set min_kg = 1.400, max_kg = 1.700, avg_kg = 1.600 where code = 'K' and avg_kg is null;
update public.weight_class set min_kg = 1.700, max_kg = 2.100, avg_kg = 1.900 where code = 'S' and avg_kg is null;
update public.weight_class set min_kg = 2.100, max_kg = 2.600, avg_kg = 2.300 where code = 'B' and avg_kg is null;
insert into public.size_class_map (size_kg, weight_class, effective_from, note)
select s.size_kg, s.cls, date '2026-01-01', 'e2e: peta ukuran → kelas (ilustrasi)'
from (values (0.6, 'K'), (0.7, 'K'), (0.8, 'K'), (0.9, 'K'), (1.0, 'S'), (1.1, 'S'), (1.2, 'S'), (1.3, 'B'), (1.4, 'B'), (1.5, 'B')) as s(size_kg, cls)
where not exists (select 1 from public.size_class_map m where m.size_kg = s.size_kg and m.effective_from = date '2026-01-01' and m.deleted_at is null);

------------------------------------------------------------------------------------------------------------------
-- 2. C45: the stock mart of the Sunday before the plan week (23 Aug) must exist. The fixture is the first week in the
--    database, so there is no week before it; the opening position of 24 Aug stands in for the Sunday before.
insert into public.sku_balance_daily (date, key, group_code, form, kg, free_kg, reserved_kg, cost_ma, cost_per_kg_ma, cost_si, cost_per_kg_si, oldest_age_days, over_age_kg, lots, projected, cost_status)
select date '2026-08-23', key, group_code, form, kg, free_kg, reserved_kg, cost_ma, cost_per_kg_ma, cost_si, cost_per_kg_si, oldest_age_days, over_age_kg, lots, false, cost_status
from public.sku_balance_daily where date = date '2026-08-24'
on conflict (date, key) do nothing;

------------------------------------------------------------------------------------------------------------------
-- 3. Monday-Wednesday history of the owners (K35 cells of 24-26 Aug). Direktur Operasional's LB price decisions of the
--    cut dates 25, 26 and 27 Aug (the screen only decides tomorrow; Thursday's decision for Fri 28 is made in the journey).
insert into public.lb_price_decision (date, weight_class, price, volume_kg_lb, decided_by, decided_at, note)
select d.cut, null, d.price, d.vol, 'opsdir@e2e.test', (d.cut - 1)::timestamptz + interval '4 hours', 'e2e: riwayat keputusan harga LB (setup)'
from (values (date '2026-08-25', 23659.9100, 12211.60), (date '2026-08-26', 24148.1400, 12089.60), (date '2026-08-27', 24600.0000, 11681.40)) as d(cut, price, vol)
where not exists (select 1 from public.lb_price_decision x where x.date = d.cut);

-- Stock card of Inventory Accounting for 24-28 Aug (the v4 wizard takes an Accurate .xlsx; here: the opening list)
insert into public.stock_card_snapshot (date, item_code, item_name, kg, value, source)
select d::date, o.item_code, o.item_name, o.kg, o.value, 'Accurate'
from generate_series(date '2026-08-24', date '2026-08-28', interval '1 day') d
cross join lateral (select item_code, item_name, kg, value from public.opening_stock where item_code is not null order by item_code limit 6) o
on conflict (date, item_code) do nothing;

-- Journal of Inventory Accounting for 27 and 28 Aug (the fixture ends on 26 Aug): one small balanced voucher per day on
-- accounts of the chart of accounts (no new account, so C14 stays 0)
insert into public.gl_line (seq, date, voucher_no, voucher_type, account, account_name, description, debit, credit, source)
select 9000 + row_number() over (), v.d, 'E2E-JV-' || to_char(v.d, 'YYMMDD'), 'Journal Voucher', l.account, l.name, 'e2e: jurnal harian (setup)', l.debit, l.credit, 'Accurate'
from (values (date '2026-08-27'), (date '2026-08-28')) as v(d)
cross join (values ('5100007', 'Biaya Kirim Ayam', 1000000.00, null::numeric), ('2101003', 'Utang Usaha Lainnya', null::numeric, 1000000.00)) as l(account, name, debit, credit)
where not exists (select 1 from public.gl_line g where g.voucher_no = 'E2E-JV-' || to_char(v.d, 'YYMMDD'));

-- Sales delivered on 24 and 25 Aug (status Aktual) and the PO line of 26 Aug (fully delivered), each with its FEFO allocation: the
-- fixture holds POs from 27 Aug only; K35 asks for an allocation per day and for the PO of the day after a cut date, and the
-- screens cannot create a line for a past date. 24/25 are Aktual so they stay out of the plan's demand.
with w as (select id from public.week where week_start = date '2026-08-24'),
  ins as (
    insert into public.sales_line (week_id, seq, date, delivery_date, status, demand_status, document_ref, po_ref, customer, item_code, kg, fulfilled_kg, price, source, channel, sales_rep)
    select w.id, 9000 + x.n, x.d, x.d, x.st, case when x.st = 'Order' then 'Confirmed' end, 'E2E-PO-' || to_char(x.d, 'YYMMDD'), 'E2E-PO-' || to_char(x.d, 'YYMMDD'), 'PT A', 'JLB0922', 150.00, 150.00, 45000, 'Accurate', 'po', 'SALES-E2E'
    from w, (values (1, date '2026-08-24', 'Aktual'), (2, date '2026-08-25', 'Aktual'), (3, date '2026-08-26', 'Order')) as x(n, d, st)
    where not exists (select 1 from public.sales_line s where s.document_ref = 'E2E-PO-' || to_char(x.d, 'YYMMDD'))
    returning id, delivery_date)
insert into public.allocation (date, sales_line_id, lot_ref, kg, method, note)
select i.delivery_date, i.id, (select lot_ref from public.lot_balance_daily where key = 'RPA|Karkas|Fresh' and date = i.delivery_date order by kg desc limit 1), 150.00, 'FEFO', 'e2e: riwayat alokasi (setup)'
from ins i
where (select lot_ref from public.lot_balance_daily where key = 'RPA|Karkas|Fresh' and date = i.delivery_date order by kg desc limit 1) is not null
on conflict (sales_line_id, lot_ref) do nothing;


------------------------------------------------------------------------------------------------------------------
-- 4. PO prices of the fixture are below the cost floor of the v5 costing (commercial_daily.price_floor = cost per kg), so C38
--    (the database guard, "di bawah harga lantai") rightly holds the allocation of those lines. C38 is not bypassed: the test POs are
--    priced 25% above the floor of their delivery date, which is the state of a week whose orders cover their cost.
update public.sales_line s set price = ceil(f.price_floor * 1.25)
from public.item_map m, public.commercial_daily f
where m.item_code = s.item_code and f.key = m.key and f.date = s.delivery_date
  and s.status = 'Order' and s.deleted_at is null and s.superseded_at is null
  and s.delivery_date between date '2026-08-27' and date '2026-08-29'
  and s.price < f.price_floor * 1.25;
