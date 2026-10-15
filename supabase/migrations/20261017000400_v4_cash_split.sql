-- v4 irisan 2 — cash mart: operations and affiliate funding apart (docs/PRD-v4.md §3.7, §6.3, G6). Additive and re-runnable.
-- cash_position_daily keeps its v3 columns; the rebuild job also writes, per day, the planned operating flows, the
-- planned affiliate funding, and the closing balance of the scenario "tanpa fasilitas afiliasi" (a stated assumption).
alter table public.cash_position_daily add column if not exists closing_without_affiliate numeric(18,2);
alter table public.cash_position_daily add column if not exists operating_in numeric(18,2);
alter table public.cash_position_daily add column if not exists operating_out numeric(18,2);
alter table public.cash_position_daily add column if not exists affiliate_net numeric(18,2);
alter table public.cash_position_daily add column if not exists lowest_without_affiliate numeric(18,2);
alter table public.cash_position_daily add column if not exists lowest_without_date date;
alter table public.cash_position_daily add column if not exists affiliate_assumption text;
-- 13 weeks, 12 months, accounts and drivers of the day's projection, written by the same rebuild (the management page reads it, K17)
alter table public.cash_position_daily add column if not exists horizon jsonb;

-- budget upload and fixed-cost upload read the month through these indexes
create index if not exists cost_event_month on public.cost_event (date) where deleted_at is null;
