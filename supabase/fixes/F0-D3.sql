-- F0-D3 — opening stock (Accurate stock card, opening_stock) vs inventory on the balance sheet (TB + journal up to the day
-- before the week starts). PRD v3 §1: 3.955,0 jt vs 3.780,6 jt in the example week, gap 174,4 jt.
-- The stock card is the physical truth the v1 engine uses, so opening_stock is NOT changed. The gap is written per week as
-- a reasoned adjustment row (data_fix D3, scope 'opening_vs_bs'); the lot ledger (M2, control C27) reads it as a
-- reconciling item until accounting books the correction. Re-running updates the amount (idempotent).
begin;
select set_config('request.jwt.claims', '{"email":"f0-fix@kgr-weekly-outlook"}', true);

with inv_accounts as (
  select account from public.coa_map where deleted_at is null and bs_line in ('Inventory - Product', 'Inventory - Trading')
), wk as (
  select w.id, w.week_start, w.tb_opening_date from public.week w
), stock as (
  select o.week_id, sum(coalesce(o.value, 0)) as value, sum(coalesce(o.kg, 0)) as kg
  from public.opening_stock o where o.deleted_at is null and o.superseded_at is null group by o.week_id
), tb as (
  select t.week_id, sum(coalesce(t.balance, 0)) as bal
  from public.tb_opening t where t.deleted_at is null and t.account in (select account from inv_accounts) group by t.week_id
), gl as (
  select wk.id as week_id, sum(coalesce(g.debit, 0) - coalesce(g.credit, 0)) as mov
  from wk join public.gl_line g on g.deleted_at is null and g.account in (select account from inv_accounts)
   and g.date > wk.tb_opening_date and g.date <= wk.week_start - 1
  group by wk.id
), gap as (
  select wk.id as week_id, wk.week_start, s.value as stock_value, s.kg as stock_kg,
         coalesce(tb.bal, 0) + coalesce(gl.mov, 0) as bs_value
  from wk join stock s on s.week_id = wk.id left join tb on tb.week_id = wk.id left join gl on gl.week_id = wk.id
)
insert into public.data_fix (fix_id, week_id, scope, description, amount, kg, account, status)
select 'D3', week_id, 'opening_vs_bs',
  format('Stok awal %s: kartu stok Accurate Rp %s vs persediaan neraca (TB + jurnal s.d. %s) Rp %s. Selisih Rp %s dicatat sebagai '
         'penyesuaian rekonsiliasi (bukan mengubah stok awal). Dugaan penyebab: HPP faktur unbilled (akrual MJ / baris tanpa tanggal) '
         'sudah mengkredit persediaan sementara DO belum keluar dari kartu stok, dan DO in-transit. Tindakan: Inventory Accounting '
         'mencocokkan per item ke Inventory Valuation; selisih yang tersisa dibukukan sebagai penyesuaian persediaan.',
         week_start, to_char(stock_value, 'FM999G999G999G990'), week_start - 1, to_char(bs_value, 'FM999G999G999G990'),
         to_char(stock_value - bs_value, 'FM999G999G999G990')),
  round(stock_value - bs_value, 2), stock_kg, '1104003',
  case when abs(stock_value - bs_value) <= 1 then 'info' else 'open' end
from gap
on conflict (fix_id, week_id, scope) do update
  set amount = excluded.amount, kg = excluded.kg, description = excluded.description,
      status = case when public.data_fix.status = 'applied' then 'applied' else excluded.status end;

select w.week_start, f.amount, f.status from public.data_fix f join public.week w on w.id = f.week_id where f.fix_id = 'D3' order by w.week_start;
commit;
