-- v3 F5 — M6 cash, CCC, solvency (PRD v3 §4.7, PLAN Fase 5). Additive and re-runnable.

create table if not exists public.bank_account (
  account_no  text primary key,
  bank        text,
  name        text,
  currency    text not null default 'IDR',
  coa_account text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.cash_daily (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  account_no  text not null,
  opening     numeric(18,2),
  closing     numeric(18,2) not null,
  note        text,
  source      text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id   uuid references public.upload(id),
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (date, account_no)
);

create table if not exists public.cash_daily_plan (
  id                     uuid primary key default gen_random_uuid(),
  date                   date not null,
  account_no             text,
  cf_category            text,
  description            text,
  amount                 numeric(18,2) not null,          -- + in / − out
  fixed_cost_schedule_id uuid references public.fixed_cost_schedule(id),
  status                 text not null default 'plan' check (status in ('plan','done','cancelled')),
  done_date              date,
  line_key               text unique,                     -- tanggal|rekening|kategori|n (idempotent re-upload)
  source                 text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id              uuid references public.upload(id),
  deleted_at             timestamptz,
  deleted_by             text,
  created_at             timestamptz not null default now(),
  created_by             text,
  updated_at             timestamptz not null default now(),
  updated_by             text
);

-- data marts (one scope = one date / one month)
create table if not exists public.cash_position_daily (
  date              date primary key,
  total_closing     numeric(18,2),
  total_plan_in     numeric(18,2) not null default 0,
  total_plan_out    numeric(18,2) not null default 0,
  projected_closing numeric(18,2),
  lowest_next_13w   numeric(18,2),
  lowest_date       date,
  accounts          integer not null default 0,
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create table if not exists public.ccc_daily (
  date              date primary key,
  dio_days          numeric(10,2),
  dso_days          numeric(10,2),
  dpo_days          numeric(10,2),
  ccc_days          numeric(10,2),
  inventory_value   numeric(18,2),
  ar_value          numeric(18,2),
  ap_value          numeric(18,2),
  cogs_ttm_daily    numeric(18,2),
  revenue_ttm_daily numeric(18,2),
  window_days       integer,
  working_capital   numeric(18,2),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create table if not exists public.solvency_monthly (
  month                     date primary key,
  equity                    numeric(18,2),
  paid_in_capital           numeric(18,2),
  affiliate_payable         numeric(18,2),
  affiliate_receivable      numeric(18,2),
  months_to_negative_equity numeric(10,2),
  basis_nibt                numeric(18,2),
  basis_date                date,
  updated_at                timestamptz not null default now(),
  updated_by                text
);

create index if not exists cash_daily_date on public.cash_daily (date) where deleted_at is null;
create index if not exists cash_daily_plan_date on public.cash_daily_plan (date) where deleted_at is null;

insert into public.mart_table (name, scope_col, key_cols, keep_col, keep_values, note) values
  ('cash_position_daily', 'date', '{date}', null, null, 'M6 cash position per day + lowest of the next 13 weeks'),
  ('ccc_daily', 'date', '{date}', null, null, 'M6 DIO / DSO / DPO / CCC per day'),
  ('solvency_monthly', 'month', '{month}', null, null, 'M6 equity, affiliates, months to negative equity per month')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols;

do $$
declare t text; w text;
begin
  foreach t in array array['bank_account','cash_daily','cash_daily_plan','cash_position_daily','ccc_daily','solvency_monthly'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    -- cash and solvency: finance, management, admin (PRD v3 §6 /kas, /kas/ccc)
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.has_role(''admin'',''finance'',''management'')))', t || '_read', t);
    end if;
    w := case when t in ('cash_position_daily','ccc_daily','solvency_monthly') then '''admin''' else '''admin'',''finance''' end;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(%s)))', t || '_ins', t, w);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(%s))) with check ((select public.has_role(%s)))', t || '_upd', t, w, w);
    end if;
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cash_daily','cash_daily_plan'] loop
    if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger needs_rebuild after insert or update or delete on public.%I for each row execute function public.tg_needs_rebuild()', t);
    end if;
  end loop;
end $$;
