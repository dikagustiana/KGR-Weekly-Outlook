-- PRD v5.2-A R73 (B-UI-3, K42): 26 weeks of synthetic data, far above the 1.000 rows PostgREST returns per request (db-max-rows).
-- SETUP only (psql as postgres). Deterministic: no random(), the same rows on every run. All names carry "vol" / "VOL" so a failure can
-- be traced to this file. Synthetic weeks: the 26 Mondays 2026-02-23 … 2026-08-17 (status closed), before the fixture week 2026-08-24.
--   sales_line       26 × 60 = 1.560 delivered lines in the 26 weeks, plus 1.100 open PO lines in the fixture week (27-29 Aug)
--   gl_line          182 days × 4 balanced rows = 728, plus 1.201 rows in the fixture week (24-26 Aug): 600 balanced pairs and one line with +12,34
--   lot_balance_daily  182 days × 8 keys = 1.456, plus 1.200 lots of one SKU on 24 Aug
--   pl_daily_v4      Mar–Jul 2026, 36 journal rows per day (5.508; 1.116 in March alone)
-- journey `volume` compares what the app shows (totals computed from these rows through PostgREST pages of 1.000) with direct SQL aggregates.

-- weeks (+ the parameter row the loaders expect)
insert into public.week (week_start, update_date, tb_opening_date, status, note)
select d::date, (d + interval '6 days')::date, date '2026-01-31', 'closed', 'e2e volume: minggu sintetis'
from generate_series(date '2026-02-23', date '2026-08-17', interval '7 days') d
where not exists (select 1 from public.week w where w.week_start = d::date);
insert into public.parameter (week_id)
select w.id from public.week w where w.note = 'e2e volume: minggu sintetis' and not exists (select 1 from public.parameter p where p.week_id = w.id);

-- sales_line: delivered lines of the synthetic weeks
insert into public.sales_line (week_id, seq, date, status, document_ref, customer, item_code, kg, price, source, channel)
select w.id, n, w.week_start + (n % 7), 'Aktual', 'VOL-DO-' || to_char(w.week_start, 'YYMMDD') || '-' || lpad(n::text, 3, '0'), 'PT VOL',
       (array['JLB0690','JLB0756','JLB0829','JLB0922','JLB0763','JLB0856'])[1 + n % 6],
       round(100 + ((n * 37) % 9000) / 10.0, 2), 30000 + (n * 13) % 5000, 'Accurate', 'po'
from public.week w, generate_series(1, 60) n
where w.note = 'e2e volume: minggu sintetis'
  and not exists (select 1 from public.sales_line s where s.document_ref = 'VOL-DO-' || to_char(w.week_start, 'YYMMDD') || '-' || lpad(n::text, 3, '0'));
-- sales_line: open PO lines in the fixture week (the weekly stock export counts them)
insert into public.sales_line (week_id, seq, date, delivery_date, status, demand_status, document_ref, po_ref, customer, item_code, kg, price, source, channel)
select (select id from public.week where week_start = date '2026-08-24'), 20000 + n, date '2026-08-27' + (n % 3), date '2026-08-27' + (n % 3), 'Order', 'Confirmed',
       'VOL-PO-' || lpad(n::text, 4, '0'), 'VOL-PO-' || lpad(n::text, 4, '0'), 'PT VOL',
       (array['JLB0690','JLB0756','JLB0829','JLB0922','JLB0763','JLB0856'])[1 + n % 6], round(10 + ((n * 17) % 4000) / 10.0, 2), 50000 + n % 100, 'Ops', 'po'
from generate_series(1, 1100) n
where not exists (select 1 from public.sales_line s where s.document_ref = 'VOL-PO-' || lpad(n::text, 4, '0'));

-- gl_line: balanced vouchers per day of the 26 weeks (accounts of the chart of accounts: AR / revenue, cost / AP)
insert into public.gl_line (seq, date, voucher_no, voucher_type, account, account_name, description, debit, credit, source)
select 50000 + row_number() over (), d::date, 'VOL-' || to_char(d, 'YYMMDD') || '-' || v.k, v.t, v.acct, v.nm, 'e2e volume', v.dr * amt, v.cr * amt, 'Accurate'
from generate_series(date '2026-02-23', date '2026-08-23', interval '1 day') d
cross join lateral (select 1000000 + (extract(doy from d)::int * 7919) % 900000 as amt) a
cross join (values ('SI', 'Sales Invoice', '1103001', 'Piutang Usaha', 1, 0), ('SI', 'Sales Invoice', '4101006', 'Penjualan Karkas', 0, 1),
                   ('PI', 'Purchase Invoice', '5100007', 'Biaya Kirim Ayam', 1, 0), ('PI', 'Purchase Invoice', '2101003', 'Utang Usaha Lainnya', 0, 1)) as v(k, t, acct, nm, dr, cr)
where not exists (select 1 from public.gl_line g where g.voucher_no like 'VOL-' || to_char(d, 'YYMMDD') || '-%');
-- gl_line: 1.201 rows in the fixture week whose net (Σ debit − Σ credit) is exactly +12,34: 600 pairs of equal debit and credit lines
-- (voucher VOL-GL-n) plus one line with debit 12,34
insert into public.gl_line (seq, date, voucher_no, voucher_type, account, account_name, description, debit, credit, source)
select 90000 + n, date '2026-08-24' + (n % 3), 'VOL-GL-' || lpad(((n + 1) / 2)::text, 4, '0'), 'Journal Voucher',
       case when n % 2 = 1 then '5100007' else '2101003' end, case when n % 2 = 1 then 'Biaya Kirim Ayam' else 'Utang Usaha Lainnya' end, 'e2e volume',
       case when n % 2 = 1 then round(1 + (((n + 1) / 2) * 31) % 5000 / 10.0, 2) end, case when n % 2 = 0 then round(1 + (((n + 1) / 2) * 31) % 5000 / 10.0, 2) end, 'Accurate'
from generate_series(1, 1200) n
where not exists (select 1 from public.gl_line g where g.voucher_no like 'VOL-GL-%');
insert into public.gl_line (seq, date, voucher_no, voucher_type, account, account_name, description, debit, credit, source)
select 91999, date '2026-08-26', 'VOL-GL-NET', 'Journal Voucher', '5100007', 'Biaya Kirim Ayam', 'e2e volume: selisih sengaja +12,34', 12.34, null, 'Accurate'
where not exists (select 1 from public.gl_line g where g.voucher_no = 'VOL-GL-NET');

-- lot_balance_daily: 8 keys per day of the 26 weeks, and 1.200 lots of RPA|Kepala|Fresh on 24 Aug (the SKU page lists them)
insert into public.lot_balance_daily (date, lot_ref, key, form, kg, free_kg, age_days)
select d::date, 'vol:' || to_char(d, 'YYMMDD') || ':' || k, (array['RPA|Karkas|Fresh','RPA|Karkas|Frozen','RPA|Kepala|Fresh','RPA|Ceker|Fresh','RPA|Usus|Fresh','RPA|HJA (Hati/Jantung/Ampela)|Fresh','RPA|Lemak|Fresh','RPA|Sayap|Fresh'])[k],
       case when k in (2) then 'frozen' else 'fresh' end, round(50 + (extract(doy from d)::int * k * 13) % 4000 / 10.0, 2), round(25 + (extract(doy from d)::int * k * 7) % 2000 / 10.0, 2), (extract(doy from d)::int + k) % 5
from generate_series(date '2026-02-23', date '2026-08-23', interval '1 day') d, generate_series(1, 8) k
on conflict (date, lot_ref) do nothing;
insert into public.lot_balance_daily (date, lot_ref, key, form, kg, free_kg, age_days)
select date '2026-08-24', 'volk:' || lpad(n::text, 4, '0'), 'RPA|Kepala|Fresh', 'fresh', round(1 + (n % 7) * 0.25, 2), round(1 + (n % 7) * 0.25, 2), n % 4
from generate_series(1, 1200) n
on conflict (date, lot_ref) do nothing;

-- pl_daily_v4: journal rows Mar–Jul 2026, every one of the 4 segments × 9 P&L lines per day (36 rows a day, 1.116 in March alone)
insert into public.pl_daily_v4 (date, segment, pl_line, basis, actual, forecast, kg)
select d::date, sg.s, ln.l, 'journal', round(((extract(doy from d)::int * ln.m * sg.m) % 90000 + 1000) * ln.sign * 1000, 2), null, round(((extract(doy from d)::int * ln.m) % 5000) / 10.0, 2)
from generate_series(date '2026-03-01', date '2026-07-31', interval '1 day') d
cross join (values ('LB main', 1), ('LB by-product', 2), ('Trading', 3), ('Umum', 4)) as sg(s, m)
cross join (values ('Revenue - LB Main Product', 3, 1), ('Revenue - LB By Product', 5, 1), ('Revenue - Trading', 7, 1), ('COGS - Live Bird', 11, -1),
                   ('COGS - Trading', 13, -1), ('Expedition expense', 17, -1), ('Blasting', 19, -1), ('Operating expense - Others', 23, -1),
                   ('Depreciation & amortisation', 29, -1)) as ln(l, m, sign)
on conflict (date, segment, pl_line, basis) do nothing;
