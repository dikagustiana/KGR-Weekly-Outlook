-- PRD v5.2-A R69 (journey R69): the app's numbers of a month for the 15 lines of the minimum FS mapping, derived straight from the tables the app
-- reads, with plain SQL and without any app or engine code. READ ONLY (psql variable :month = first day of the month, e.g. 2026-08-01); the journey
-- builds the FS fixture from these amounts and compares them with what the page "Rekonsiliasi" shows. Same definitions as the engine
-- (packages/engine/src/fs-app.ts, actualRowsV4): amounts in Rupiah, P&L sign (revenue and other income +, costs -), liabilities and equity
-- positive on the balance sheet.
--   PL  = the journal of the month by coa_map.pl_line (credit - debit): revenue = "Revenue*", cogs = "COGS*" and "Other COGS*", other = Interest
--         Expense, Other Income, Other Expense, opex = every other line; gp = revenue + cogs; nibt = gp + opex + other. What this does not count and the
--         app does: the unbilled DO rows (K11) and the v5 costing rows (Selisih costing, Biaya kapasitas idle) of the month: the journey states that
--         both are absent (the page says so) before it compares.
--   BS  = the trial balance of the latest week that starts by the month end (tb_opening) + the journal after the trial balance date up to the
--         month end, per coa_map.bs_line of the Neraca accounts; equity = Shareholder Equity + Retained earnings (credit side) + the profit of
--         the year (all LabaRugi accounts: trial balance and journal).
with p as (select :'month'::date as m, (date_trunc('month', :'month'::date) + interval '1 month - 1 day')::date as last),
w as (select id, tb_opening_date from public.week, p where week_start <= p.last order by week_start desc limit 1),
pl as (
  select case when c.pl_line like 'Revenue%' then 'revenue'
              when c.pl_line like 'COGS%' or c.pl_line like 'Other COGS%' then 'cogs'
              when c.pl_line in ('Interest Expense', 'Other Income', 'Other Expense') then 'other'
              else 'opex' end as grp,
         sum(coalesce(g.credit, 0) - coalesce(g.debit, 0)) as amt
    from public.gl_line g
    join public.coa_map c on trim(c.account) = trim(g.account) and c.deleted_at is null and c.pl_line is not null, p
   where g.deleted_at is null and g.date between p.m and p.last
   group by 1
),
plx as (
  select (select coalesce(amt, 0) from pl where grp = 'revenue') as revenue,
         (select coalesce(amt, 0) from pl where grp = 'cogs') as cogs,
         (select coalesce(amt, 0) from pl where grp = 'opex') as opex,
         (select coalesce(amt, 0) from pl where grp = 'other') as other
),
mv as (
  select trim(t.account) as account, t.balance as amt from public.tb_opening t, w where t.week_id = w.id and t.deleted_at is null
  union all
  select trim(g.account), coalesce(g.debit, 0) - coalesce(g.credit, 0)
    from public.gl_line g, w, p where g.deleted_at is null and g.date > w.tb_opening_date and g.date <= p.last
),
bs as (
  select c.bs_line, c.type, sum(mv.amt) as amt
    from mv join public.coa_map c on trim(c.account) = mv.account and c.deleted_at is null
   group by c.bs_line, c.type
),
b as (select bs_line as line, amt from bs where type = 'Neraca')
select app_line, round(amount, 2)::text as amount from (
  select 1 as o, 'revenue' as app_line, revenue as amount from plx
  union all select 2, 'cogs', cogs from plx
  union all select 3, 'gp', revenue + cogs from plx
  union all select 4, 'opex', opex from plx
  union all select 5, 'other', other from plx
  union all select 6, 'nibt', revenue + cogs + opex + other from plx
  union all select 7, 'kas', coalesce((select amt from b where line = 'Cash and cash equivalents'), 0)
  union all select 8, 'piutang_pihak_ketiga', coalesce((select amt from b where line = 'Trade Receivables - Third Parties'), 0)
  union all select 9, 'piutang_pihak_berelasi', coalesce((select amt from b where line = 'Trade Receivables - Related Parties'), 0)
  union all select 10, 'persediaan_produk', coalesce((select amt from b where line = 'Inventory - Product'), 0)
  union all select 11, 'persediaan_trading', coalesce((select amt from b where line = 'Inventory - Trading'), 0)
  union all select 12, 'utang_dagang_pihak_ketiga', -coalesce((select amt from b where line = 'Trade Payables - Third Parties'), 0)
  union all select 13, 'utang_dagang_afiliasi', -coalesce((select amt from b where line = 'Trade Payables - Affiliates'), 0)
  union all select 14, 'utang_lain_afiliasi', -coalesce((select amt from b where line = 'Other Payable - Related Parties'), 0)
  union all select 15, 'ekuitas', -coalesce((select sum(amt) from b where line in ('Shareholder Equity', 'Retained earnings')), 0)
                                  - coalesce((select sum(amt) from bs where type = 'LabaRugi'), 0)
) x order by o;
