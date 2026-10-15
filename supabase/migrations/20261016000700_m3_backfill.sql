-- v3 F3a backfill (PRD v3 §4.1, PLAN Fase 3). Idempotent: only empty columns are filled, seeds use on conflict do nothing.

-- Existing Order rows are PO lines: Confirmed, delivery date = the v1 date of the order (planned delivery, V13).
-- The column defaults of the base table are left alone; only rows whose demand_status is still empty are touched.
update public.sales_line
   set demand_status = 'Confirmed', delivery_date = coalesce(delivery_date, date)
 where status = 'Order' and demand_status is null;

-- Weight class: one standard class until PPIC fills its own (Q5: KGR_Demand_Forecast.xlsx I_Live_Bird B3 = 2,0 kg).
insert into public.weight_class (code, min_kg, max_kg, avg_kg, sort_order, note) values
  ('STD', 1.800, 2.200, 2.000, 1, 'Placeholder v3 F3a: rata-rata LB 2,0 kg (I_Live_Bird B3); PPIC mengisi kelas sebenarnya')
on conflict (code) do nothing;

-- Yield matrix placeholders (kg per kg LB), keyed by SKU name so the fresh and frozen keys share a yield:
--   pattern 'karkas'   = v1 parameter yields (I_Parameter: karkas 73,67%, kepala 4,67%, ceker 2,94%, usus 4,36%,
--                        HJA 5,60%, lemak 0,34%) × (1 − target susut 3%), the same output the v1 engine plans per kg LB;
--   pattern 'boneless' = KGR_Demand_Forecast.xlsx I_Yield (BLD 18%, BLP 13%, sayap 9%, ceker 4%, kepala 3%, kulit 6%,
--                        jeroan 5%, tulang/kerangka 28%).
insert into public.yield_matrix (weight_class, cut_pattern, key, yield_pct, effective_from, note) values
  ('STD', 'karkas',   'Karkas',                    0.714599, '2026-01-01', 'Placeholder: yield v1 × (1 − 0,03)'),
  ('STD', 'karkas',   'Kepala',                    0.045299, '2026-01-01', 'Placeholder: yield v1 × (1 − 0,03)'),
  ('STD', 'karkas',   'Ceker',                     0.028518, '2026-01-01', 'Placeholder: yield v1 × (1 − 0,03)'),
  ('STD', 'karkas',   'Usus',                      0.042292, '2026-01-01', 'Placeholder: yield v1 × (1 − 0,03)'),
  ('STD', 'karkas',   'HJA (Hati/Jantung/Ampela)', 0.054320, '2026-01-01', 'Placeholder: yield v1 × (1 − 0,03)'),
  ('STD', 'karkas',   'Lemak',                     0.003298, '2026-01-01', 'Placeholder: yield v1 × (1 − 0,03)'),
  ('STD', 'boneless', 'BLD',                       0.180000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'BLP',                       0.130000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'Sayap',                     0.090000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'Ceker',                     0.040000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'Kepala',                    0.030000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'Kulit',                     0.060000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'HJA (Hati/Jantung/Ampela)', 0.050000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx'),
  ('STD', 'boneless', 'KRK (Kerangka)',            0.280000, '2026-01-01', 'Placeholder: I_Yield KGR_Demand_Forecast.xlsx')
on conflict (weight_class, cut_pattern, key, effective_from) do nothing;

-- Weekly demand is rebuilt per week (scope = Monday): queue the Monday of every week that has PO lines.
insert into public.rebuild_queue (date, reason)
select distinct w.week_start, 'backfill M3'
from public.week w
where exists (select 1 from public.sales_line s where s.week_id = w.id and s.status = 'Order' and s.deleted_at is null)
  and not exists (select 1 from public.rebuild_queue q where q.date = w.week_start and q.status = 'queued');
