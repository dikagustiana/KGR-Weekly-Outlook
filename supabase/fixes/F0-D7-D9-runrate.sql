-- F0-D7 / D9 — run-rate of the fixed costs that the September FS shows understated (PRD v3 §1):
--   D7 depreciation: FS Sep 0 (not booked) vs 10.393.461,35 every month Jan–Aug → run-rate D&A = 10.393.461 when 0 / empty.
--   D9 salaries: app run-rate 29,8 jt vs FS 85,6 jt (Aug 85.565.549, Sep 82.677.332) → run-rate = salaries of the last
--      closed month in the FS when the week's run-rate is lower: weeks of September → Aug 85.565.549; from October → Sep 82.677.332.
-- Only weeks starting 2026-09-01 or later; the example week 24–30 Aug 2026 keeps its Excel values. Idempotent.
-- From M5 (Fase 4) these lines move to fixed_cost_schedule; this script only fixes the v1 run-rate in the meantime.
begin;
select set_config('request.jwt.claims', '{"email":"f0-fix@kgr-weekly-outlook"}', true);

update public.runrate r
   set monthly_amount = 10393461, basis = coalesce(r.basis || ' · ', '') || 'F0-D7: D&A FS Jan–Agu 10.393.461/bulan (Sep belum dibukukan)'
  from public.week w
 where w.id = r.week_id and w.week_start >= date '2026-09-01'
   and r.pl_line = 'Depreciation & amortisation' and coalesce(r.monthly_amount, 0) = 0;

update public.runrate r
   set monthly_amount = s.amount, basis = coalesce(r.basis || ' · ', '') || s.note
  from public.week w,
       lateral (select case when w.week_start < date '2026-10-01' then 85565549 else 82677332 end as amount,
                       case when w.week_start < date '2026-10-01' then 'F0-D9: gaji FS Agu 2026 85.565.549' else 'F0-D9: gaji FS Sep 2026 82.677.332' end as note) s
 where w.id = r.week_id and w.week_start >= date '2026-09-01'
   and r.pl_line = 'Salaries and allowance' and coalesce(r.monthly_amount, 0) < s.amount;

insert into public.data_fix (fix_id, week_id, scope, description, status)
select f.fix_id, w.id, 'runrate', f.descr, 'applied'
  from public.week w cross join (values
    ('D7', 'Run-rate D&A = 10.393.461 (FS Jan–Agu); Sep 2026 belum dibukukan di FS'),
    ('D9', 'Run-rate gaji = gaji FS bulan tutup terakhir (Agu 85.565.549 / Sep 82.677.332)')) f(fix_id, descr)
 where w.week_start >= date '2026-09-01'
on conflict (fix_id, week_id, scope) do nothing;

select w.week_start, r.pl_line, r.monthly_amount from public.runrate r join public.week w on w.id = r.week_id
 where r.pl_line in ('Depreciation & amortisation', 'Salaries and allowance') order by 1, 2;
commit;
