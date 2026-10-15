-- F0-D8 — balance sheet control −0,32 (FS Sep, BS - Management Report L8): the opening TB of a week sums to a few cents
-- (Accurate rounding), so assets − (liabilities + equity) ≠ 0 by that amount in every column. Controls 12 and 15 pass
-- (≤ Rp 1) but the statement does not balance. Fix: one rounding row per week on 7100008 "Rounding - KGR" (Other Income),
-- balance = −Σ TB, only when 0 < |Σ| ≤ 1 and only for weeks starting 2026-09-01 or later (the example week keeps the
-- Excel's TB, which sums to 0,03). Idempotent: skipped when the week already has the rounding row.
begin;
select set_config('request.jwt.claims', '{"email":"f0-fix@kgr-weekly-outlook"}', true);

with s as (
  select t.week_id, sum(coalesce(t.balance, 0)) as total, max(t.seq) as seq
  from public.tb_opening t join public.week w on w.id = t.week_id
  where t.deleted_at is null and w.week_start >= date '2026-09-01'
  group by t.week_id
)
insert into public.tb_opening (week_id, seq, account, name, balance, source)
select s.week_id, s.seq + 1, '7100008', 'Rounding - KGR (F0-D8 pembulatan TB)', -s.total, 'Manual'
from s
where s.total <> 0 and abs(s.total) <= 1
  and not exists (select 1 from public.tb_opening x where x.week_id = s.week_id and x.deleted_at is null and x.name like '%F0-D8%');

insert into public.data_fix (fix_id, week_id, scope, description, amount, account, status)
select 'D8', t.week_id, 'tb_rounding', 'Baris pembulatan TB awal ke 7100008 Rounding - KGR', t.balance, '7100008', 'applied'
from public.tb_opening t where t.deleted_at is null and t.name like '%F0-D8%'
on conflict (fix_id, week_id, scope) do update set amount = excluded.amount;

select w.week_start, sum(t.balance) as tb_sum from public.tb_opening t join public.week w on w.id = t.week_id
 where t.deleted_at is null group by 1 order by 1;
commit;
