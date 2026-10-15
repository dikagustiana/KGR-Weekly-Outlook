-- v3 F6a — M7 commercial view (PRD v3 §4.8, PLAN Fase 6). Additive and re-runnable. The approval / scorecard
-- tables are created here too (PLAN: one M7 migration); their pages and guards come with F6b (flag m7_approval).

alter table public.parameter add column if not exists sales_sees_cost boolean not null default true;
alter table public.parameter add column if not exists discount_limit_rp_per_kg numeric(18,4) not null default 500;

create table if not exists public.sales_assignment (
  id          uuid primary key default gen_random_uuid(),
  sales_rep   text not null,
  email       text,                                -- login of the rep (app_user.email), for "my SKUs"
  customer    text,
  key         text,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique nulls not distinct (sales_rep, customer, key)
);

create table if not exists public.sales_target (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  sales_rep   text not null,
  key         text,
  target_kg   numeric(12,2),
  target_rp   numeric(18,2),
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique nulls not distinct (week_start, sales_rep, key)
);

create table if not exists public.urgency_rule (
  id          uuid primary key default gen_random_uuid(),
  form        text not null check (form in ('fresh','frozen')),
  age_from    integer not null,
  age_to      integer,
  status      text not null check (status in ('aman','jual_minggu_ini','jual_hari_ini','di_atas_umur')),
  sort        integer not null default 0,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (form, age_from)
);

create table if not exists public.price_floor_rule (
  id               uuid primary key default gen_random_uuid(),
  key              text,
  group_code       text,
  markup_rp_per_kg numeric(18,4) not null default 0,
  markup_pct       numeric(8,6) not null default 0,
  effective_from   date not null default '2026-01-01',
  note             text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique nulls not distinct (key, group_code, effective_from)
);

create table if not exists public.discount_approval (
  id              uuid primary key default gen_random_uuid(),
  sales_line_id   uuid references public.sales_line(id) on delete restrict,
  key             text,
  customer        text,
  requested_price numeric(18,4) not null,
  floor_price     numeric(18,4) not null,
  rp_per_kg_below numeric(18,4) not null,
  kg              numeric(12,2) not null,
  total_below     numeric(18,2) not null,
  requested_by    text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by      text,
  decided_at      timestamptz,
  reason          text,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- data marts
create table if not exists public.commercial_daily (
  date                   date not null,
  key                    text not null,
  group_code             text,
  form                   text,
  free_fresh_kg          numeric(12,2) not null default 0,
  free_frozen_kg         numeric(12,2) not null default 0,
  oldest_age_days        integer,
  hours_to_cutoff        integer,
  cost_per_kg_ma         numeric(18,4),
  cost_per_kg_si         numeric(18,4),
  price_floor            numeric(18,4),
  price_list             numeric(18,4),
  margin_per_kg_list     numeric(18,4),
  realized_price_7d      numeric(18,4),
  margin_per_kg_realized numeric(18,4),
  holding_loss_per_day   numeric(18,2),
  downgrade_risk_rp      numeric(18,2),
  urgency                text check (urgency is null or urgency in ('aman','jual_minggu_ini','jual_hari_ini','di_atas_umur')),
  priority_score         numeric(18,2),
  rank                   integer,
  ordered_today_kg       numeric(12,2) not null default 0,
  updated_at             timestamptz not null default now(),
  updated_by             text,
  primary key (date, key)
);

create table if not exists public.sales_scorecard_weekly (
  week_start          date not null,
  sales_rep           text not null,
  target_kg           numeric(12,2),
  actual_kg           numeric(12,2),
  pct                 numeric(10,6),
  target_rp           numeric(18,2),
  actual_rp           numeric(18,2),
  kg_to_frozen_unsold numeric(12,2),
  rp_downgrade        numeric(18,2),
  forecast_mape       numeric(10,6),
  discount_count      integer not null default 0,
  discount_rp         numeric(18,2) not null default 0,
  updated_at          timestamptz not null default now(),
  updated_by          text,
  primary key (week_start, sales_rep)
);

create index if not exists sales_assignment_email on public.sales_assignment (email) where active;
create index if not exists sales_target_week on public.sales_target (week_start);
create index if not exists discount_approval_status on public.discount_approval (status, created_at);
create index if not exists discount_approval_line on public.discount_approval (sales_line_id);
create index if not exists commercial_daily_rank on public.commercial_daily (date, rank);

insert into public.mart_table (name, scope_col, key_cols, keep_col, keep_values, note) values
  ('commercial_daily', 'date', '{date,key}', null, null, 'M7 commercial view per SKU key per day'),
  ('sales_scorecard_weekly', 'week_start', '{week_start,sales_rep}', null, null, 'M7 scorecard per sales rep per week')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols;

do $$
declare t text; w text; r text;
begin
  foreach t in array array['sales_assignment','sales_target','urgency_rule','price_floor_rule','discount_approval','commercial_daily','sales_scorecard_weekly'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    -- commercial_daily carries the specific cost per lot (SI): not for sales, who read the view below (Q17)
    r := case when t = 'commercial_daily' then '(select public.is_app_user()) and not (select public.has_role(''sales''))' else '(select public.is_app_user())' end;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_read', t, r);
    end if;
    w := case t
      when 'sales_assignment' then '''admin'',''commercial_lead'''
      when 'sales_target' then '''admin'',''commercial_lead'''
      when 'urgency_rule' then '''admin'',''finance'',''commercial_lead'''
      when 'price_floor_rule' then '''admin'',''finance'',''commercial_lead'''
      when 'discount_approval' then '''admin'',''commercial_lead'',''finance'',''sales'''
      else '''admin''' end;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(%s)))', t || '_ins', t, w);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(%s))) with check ((select public.has_role(%s)))', t || '_upd', t, w, w);
    end if;
  end loop;
end $$;

-- sales read the commercial view without the specific cost per lot (column list only, no computation)
create or replace view public.commercial_daily_sales as
  select date, key, group_code, form, free_fresh_kg, free_frozen_kg, oldest_age_days, hours_to_cutoff, cost_per_kg_ma, price_floor, price_list,
         margin_per_kg_list, realized_price_7d, margin_per_kg_realized, holding_loss_per_day, downgrade_risk_rp, urgency, priority_score, rank, ordered_today_kg
  from public.commercial_daily
  where (select public.is_app_user());
revoke all on public.commercial_daily_sales from public, anon;
grant select on public.commercial_daily_sales to authenticated;

-- urgency defaults (PRD v3 Q18): fresh > 24 h = jual hari ini; frozen > 21 days = jual minggu ini; > 30 = di atas batas umur
insert into public.urgency_rule (form, age_from, age_to, status, sort, note) values
  ('fresh', 0, 0, 'aman', 1, 'Q18: fresh ≤ 24 jam'),
  ('fresh', 1, null, 'jual_hari_ini', 2, 'Q18: fresh > 24 jam = jual hari ini'),
  ('frozen', 0, 21, 'aman', 1, 'Q18'),
  ('frozen', 22, 30, 'jual_minggu_ini', 2, 'Q18: frozen > 21 hari = jual minggu ini'),
  ('frozen', 31, null, 'di_atas_umur', 3, 'Q18: > frozen_age_limit_days (30) = di atas batas umur')
on conflict (form, age_from) do nothing;

