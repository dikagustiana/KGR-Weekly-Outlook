-- F0-D4 — trade payables with a debit balance (PRD v3 §1: "+143,5 debit" in the projection; CF and CCC run the wrong way).
-- Records, per week, every payables line whose balance at the end of last week / yesterday is a debit (negative liability),
-- with the vouchers that drive it. No input row is changed: the cause is booking (payments before the purchase invoice, or a
-- cash-plan counter line on the wrong payable). Control C37 (Fase 5) flags it in the projection; Finance reclassifies in
-- Accurate (advance to supplier) or fixes the cash-plan counter line.
begin;
select set_config('request.jwt.claims', '{"email":"f0-fix@kgr-weekly-outlook"}', true);

with ap as (
  select account, bs_line from public.coa_map where deleted_at is null and bs_line in ('Trade Payables - Third Parties', 'Trade Payables - Affiliates')
), pts as (
  select w.id as week_id, w.week_start, w.tb_opening_date, d.label, d.at
  from public.week w cross join lateral (values ('akhir minggu lalu', w.week_start - 1), ('kemarin', w.update_date - 1)) d(label, at)
), bal as (
  select p.week_id, p.week_start, p.label, p.at, ap.bs_line,
    coalesce((select sum(coalesce(t.balance, 0)) from public.tb_opening t where t.week_id = p.week_id and t.deleted_at is null
              and t.account in (select account from ap a2 where a2.bs_line = ap.bs_line)), 0)
    + coalesce((select sum(coalesce(g.debit, 0) - coalesce(g.credit, 0)) from public.gl_line g where g.deleted_at is null
              and g.account in (select account from ap a2 where a2.bs_line = ap.bs_line) and g.date > p.tb_opening_date and g.date <= p.at), 0) as debit_balance
  from pts p cross join (select distinct bs_line from ap) ap
), plan as (
  select c.week_id, c.bs_counter_line as bs_line, sum(c.amount) as planned
  from public.cash_plan c where c.deleted_at is null and c.bs_counter_line in (select bs_line from ap) group by 1, 2
)
insert into public.data_fix (fix_id, week_id, scope, description, amount, status)
select 'D4', b.week_id, b.bs_line || ' @ ' || b.label,
  format('%s bersaldo debit Rp %s per %s (utang negatif). Rencana kas dengan pos lawan ini: Rp %s. Periksa pembayaran sebelum PI '
         '(uang muka pemasok) dan pos lawan rencana kas; kontrol C37 menandai proyeksi.', b.bs_line,
         to_char(b.debit_balance, 'FM999G999G999G990'), b.at, to_char(coalesce(pl.planned, 0), 'FM999G999G999G990')),
  round(b.debit_balance, 2), 'open'
from bal b left join plan pl on pl.week_id = b.week_id and pl.bs_line = b.bs_line
where b.debit_balance > 1
on conflict (fix_id, week_id, scope) do update set amount = excluded.amount, description = excluded.description;

select w.week_start, f.scope, f.amount from public.data_fix f join public.week w on w.id = f.week_id where f.fix_id = 'D4' order by 1, 2;
commit;
