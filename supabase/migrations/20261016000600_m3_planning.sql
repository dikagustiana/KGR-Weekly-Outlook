-- v3 F3a — M3 demand → rencana → alokasi (PRD v3 §4.1, §4.4, PLAN Fase 3). Additive and re-runnable.
-- The v1 engine keeps reading sales_line.date / status / kg; the new columns and tables are read by M3 only.

-------------------------------------------------------------------------------- existing tables: new columns only
alter table public.sales_line add column if not exists delivery_date date;
alter table public.sales_line add column if not exists demand_status text;
alter table public.sales_line add column if not exists sales_rep text;
alter table public.sales_line add column if not exists po_ref text;
alter table public.sales_line add column if not exists po_date date;
alter table public.sales_line add column if not exists fulfilled_kg numeric(12,2) not null default 0;
alter table public.sales_line add column if not exists price_floor_at_sale numeric(18,4);
alter table public.sales_line add column if not exists discount_approval_id uuid;
comment on column public.sales_line.delivery_date is 'M3: target delivery date of a PO line (status Order). v1 keeps reading date (for Order rows = planned delivery, V13)';
comment on column public.sales_line.po_date is 'M3: document date of the PO (tgl_po)';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_line_demand_status_check' and conrelid = 'public.sales_line'::regclass) then
    alter table public.sales_line add constraint sales_line_demand_status_check
      check (demand_status is null or demand_status in ('Confirmed','Tentative','Forecast'));
  end if;
end $$;

alter table public.parameter add column if not exists tentative_weight numeric(8,6) not null default 0.70;
alter table public.parameter add column if not exists forecast_weight numeric(8,6) not null default 0.50;
alter table public.parameter add column if not exists downgrade_approval_threshold numeric(18,2) not null default 25000000;
alter table public.parameter add column if not exists lead_time_days integer not null default 1;

-------------------------------------------------------------------------------- master data (PPIC)
create table if not exists public.weight_class (
  code        text primary key,
  min_kg      numeric(8,3),
  max_kg      numeric(8,3),
  avg_kg      numeric(8,3) not null,
  sort_order  integer not null default 0,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.yield_matrix (
  id             uuid primary key default gen_random_uuid(),
  weight_class   text not null references public.weight_class(code),
  cut_pattern    text not null,
  key            text not null,              -- SKU key, SKU name (sku_key.sku: fresh + frozen) or sku_key.cut_component
  yield_pct      numeric(8,6) not null check (yield_pct >= 0 and yield_pct <= 1),  -- kg per kg live bird
  effective_from date not null default '2026-01-01',
  effective_to   date,
  note           text,
  source         text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id      uuid references public.upload(id),
  deleted_at     timestamptz,
  deleted_by     text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (weight_class, cut_pattern, key, effective_from)
);

create table if not exists public.substitution (
  id             uuid primary key default gen_random_uuid(),
  key_demand     text not null,
  key_substitute text not null,
  priority       integer not null default 1,
  max_pct        numeric(8,6) not null default 1 check (max_pct >= 0 and max_pct <= 1),
  note           text,
  deleted_at     timestamptz,
  deleted_by     text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (key_demand, key_substitute)
);

-------------------------------------------------------------------------------- inputs
create table if not exists public.forecast_line (
  id             uuid primary key default gen_random_uuid(),
  week_start     date not null,
  key            text not null,
  item_code      text,
  sales_rep      text,
  customer       text,
  kg             numeric(12,2) not null,
  price_expected numeric(18,4),
  basis          text,
  line_key       text,                      -- minggu|kode_item|sales_rep|customer|n (idempotent re-upload)
  source         text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id      uuid references public.upload(id),
  deleted_at     timestamptz,
  deleted_by     text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

create table if not exists public.capacity (
  id                uuid primary key default gen_random_uuid(),
  date              date not null unique,
  cut_capacity_head integer,
  chiller_kg        numeric(12,2),
  abf_kg            numeric(12,2),
  note              text,
  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create table if not exists public.lb_supply (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  supplier     text not null,
  weight_class text,
  head_count   integer,
  kg           numeric(12,2),
  price_per_kg numeric(18,4),
  status       text not null default 'offer' check (status in ('offer','confirmed','received')),
  note         text,
  source       text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id    uuid references public.upload(id),
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  unique nulls not distinct (date, supplier, weight_class)
);

-------------------------------------------------------------------------------- plans (PPIC decisions; numbers computed by @kgr/engine weeklyPlan / dailyPlan when saved)
create table if not exists public.plan_week (
  id                          uuid primary key default gen_random_uuid(),
  week_start                  date not null,
  version                     integer not null default 1,
  weight_class                text references public.weight_class(code),
  head_count                  integer not null,
  heads_needed                integer,
  supply_committed_heads      integer,
  capacity_heads              integer,
  binding_key                 text,
  weight_class_mix            jsonb not null default '{}'::jsonb,
  cut_pattern_mix             jsonb not null default '{}'::jsonb,
  output_kg_by_key            jsonb not null default '{}'::jsonb,
  surplus_kg_by_key           jsonb not null default '{}'::jsonb,
  frozen_planned_kg           numeric(12,2) not null default 0,
  frozen_planned_rp_downgrade numeric(18,2) not null default 0,
  needs_approval              boolean not null default false,
  approved_by                 text,
  approved_at                 timestamptz,
  copied_to_batch_at          timestamptz,
  note                        text,
  deleted_at                  timestamptz,
  deleted_by                  text,
  created_at                  timestamptz not null default now(),
  created_by                  text,
  updated_at                  timestamptz not null default now(),
  updated_by                  text,
  unique (week_start, version)
);

create table if not exists public.plan_day (
  id               uuid primary key default gen_random_uuid(),
  plan_week_id     uuid not null references public.plan_week(id) on delete restrict,
  date             date not null,
  head_count       integer not null default 0,
  weight_class     text,
  cut_pattern      text,
  supplier         text,
  target_kg_by_key jsonb not null default '{}'::jsonb,
  limited_by       text check (limited_by is null or limited_by in ('capacity','supply')),
  moved_from_later integer not null default 0,
  status           text not null default 'plan' check (status in ('plan','cut','closed')),
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique (plan_week_id, date)
);

-- F3b writes allocations (FEFO / manual); created here with the rest of the M3 model
create table if not exists public.allocation (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  sales_line_id uuid not null references public.sales_line(id) on delete restrict,
  lot_ref       text not null,
  kg            numeric(12,2) not null check (kg > 0),
  method        text not null default 'FEFO' check (method in ('FEFO','manual')),
  note          text,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text,
  unique (sales_line_id, lot_ref)
);

-------------------------------------------------------------------------------- data mart (one scope = one week)
create table if not exists public.demand_weekly (
  week_start      date not null,
  key             text not null,
  confirmed_kg    numeric(12,2) not null default 0,
  tentative_kg    numeric(12,2) not null default 0,
  forecast_kg     numeric(12,2) not null default 0,
  weighted_kg     numeric(12,2) not null default 0,
  stock_free_kg   numeric(12,2) not null default 0,
  substituted_kg  numeric(12,2) not null default 0,
  net_kg          numeric(12,2) not null default 0,
  karkas_kg_equiv numeric(12,2),
  cut_pattern     text,
  kg_per_head     numeric(12,4),
  heads           numeric(14,4),
  binding         boolean not null default false,
  weight_class    text,
  stock_date      date,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  primary key (week_start, key)
);

create index if not exists sales_line_delivery on public.sales_line (delivery_date) where deleted_at is null and status = 'Order';
create index if not exists sales_line_po_ref on public.sales_line (po_ref) where deleted_at is null;
create index if not exists yield_matrix_class on public.yield_matrix (weight_class, cut_pattern) where deleted_at is null;
create index if not exists forecast_line_week on public.forecast_line (week_start, key) where deleted_at is null;
create index if not exists lb_supply_date on public.lb_supply (date) where deleted_at is null;
create index if not exists plan_week_week on public.plan_week (week_start) where deleted_at is null;
create index if not exists plan_day_date on public.plan_day (date);
create index if not exists allocation_date on public.allocation (date) where deleted_at is null;
create index if not exists allocation_lot on public.allocation (lot_ref) where deleted_at is null;
create index if not exists demand_weekly_key on public.demand_weekly (key, week_start);

insert into public.mart_table (name, scope_col, key_cols, keep_col, keep_values, note) values
  ('demand_weekly', 'week_start', '{week_start,key}', null, null, 'M3 weighted demand → net → heads per SKU key per week')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols;

-------------------------------------------------------------------------------- triggers + RLS
do $$
declare t text;
begin
  foreach t in array array['weight_class','yield_matrix','substitution','forecast_line','capacity','lb_supply','plan_week','plan_day','allocation','demand_weekly'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare t text; w text;
begin
  -- read: every app user; write per PRD v3 §2
  foreach t in array array['weight_class','yield_matrix','substitution','forecast_line','capacity','lb_supply','plan_week','plan_day','allocation','demand_weekly'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.is_app_user()))', t || '_read', t);
    end if;
    w := case t
      when 'forecast_line' then '''admin'',''sales'',''commercial_lead'''
      when 'lb_supply' then '''admin'',''ppic'',''purchasing'''
      when 'allocation' then '''admin'',''sales'',''inventory_accounting'''
      when 'demand_weekly' then '''admin'''
      else '''admin'',''ppic''' end;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(%s)))', t || '_ins', t, w);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(%s))) with check ((select public.has_role(%s)))', t || '_upd', t, w, w);
    end if;
  end loop;
end $$;

-- plan approval (downgrade above the threshold): admin or finance sign off a PPIC plan (PRD v3 §4.4 step 4)
create or replace function public.tg_plan_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null or r = 'admin' then return new; end if;
  if (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) and r <> 'finance' then
    raise exception 'Hanya admin/finance yang menyetujui rencana (downgrade di atas batas)' using errcode = '42501';
  end if;
  if r = 'finance' and (to_jsonb(new) - array['approved_by','approved_at','updated_at','updated_by']) is distinct from (to_jsonb(old) - array['approved_by','approved_at','updated_at','updated_by']) then
    raise exception 'Finance hanya menyetujui rencana, tidak mengubahnya' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'plan_week_guard' and tgrelid = 'public.plan_week'::regclass) then
    create trigger plan_week_guard before update on public.plan_week for each row execute function public.tg_plan_week_guard();
  end if;
  if not exists (select 1 from pg_policies where tablename = 'plan_week' and policyname = 'plan_week_approve') then
    create policy plan_week_approve on public.plan_week for update to authenticated
      using ((select public.has_role('finance'))) with check ((select public.has_role('finance')));
  end if;
end $$;

-------------------------------------------------------------------------------- needs_rebuild: week-scoped inputs queue their Monday
create or replace function public.tg_needs_rebuild() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); d date;
begin
  d := coalesce(nullif(r ->> 'date', '')::date, nullif(r ->> 'origin_date', '')::date, nullif(r ->> 'week_start', '')::date);
  if d is not null and not exists (select 1 from public.rebuild_queue q where q.date = d and q.status = 'queued') then
    insert into public.rebuild_queue (date, reason) values (d, tg_table_name || ' ' || lower(tg_op));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.tg_needs_rebuild() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['forecast_line','lb_supply','capacity'] loop
    if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger needs_rebuild after insert or update or delete on public.%I for each row execute function public.tg_needs_rebuild()', t);
    end if;
  end loop;
end $$;
