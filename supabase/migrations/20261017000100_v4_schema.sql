-- v4 irisan 0 — data model delta (docs/PRD-v4.md §4.1, §4.2, §4.3) and K7 partial deliveries.
-- Additive and re-runnable: add column if not exists, create table if not exists, constraints and policies only when
-- missing. The only `drop` statements below are `drop constraint if exists` immediately followed by the wider check
-- (same pattern as 20261016000100 for app_user.role). The v1 engine reads none of the new columns or tables, and every
-- new table starts empty except the status mapping (§4.3) and the by-product seed of sku_key.product_class (K1).

-------------------------------------------------------------------------------- §4.1 new columns on existing tables
-- K1: only main products decide the head count; by-products give a buy signal instead
alter table public.sku_key add column if not exists product_class text not null default 'main';

-- K7 / K8: partial deliveries and spot sales. fulfilled_kg (20261016000600) becomes Σ delivery.kg, written by trigger.
alter table public.sales_line add column if not exists channel text not null default 'po';
alter table public.sales_line add column if not exists cancelled_kg numeric(12,2) not null default 0;

-- K2: statistical vs sales forecast. PRD §4.1 names this column `source`, but forecast_line.source already exists as
-- the provenance column ('Accurate','Ops','Manual'; PRD §4 conventions) and columns are not renamed (§2 rule 3), so
-- the new column is forecast_source. docs/v4/QUESTIONS.md Q5.
alter table public.forecast_line add column if not exists forecast_source text not null default 'sales';
alter table public.forecast_line add column if not exists scenario text;

-- K6: template 8.3
alter table public.fixed_cost_schedule add column if not exists day_basis text not null default 'calendar';
alter table public.fixed_cost_schedule add column if not exists posting_day integer;
alter table public.fixed_cost_schedule add column if not exists basis_doc text;
alter table public.fixed_cost_schedule add column if not exists owner text;
alter table public.fixed_cost_schedule add column if not exists version integer not null default 1;

-- §3.3 driver 'event'; P1 segment of the account
alter table public.coa_map add column if not exists segment text;

-- K3, K9, K8. v1_lock_day (20261016001000) stays; readers move to v1_lock_week in irisan 2.
alter table public.parameter add column if not exists runrate_window_days integer not null default 7;
alter table public.parameter add column if not exists v1_lock_week integer not null default 3;
alter table public.parameter add column if not exists spot_enabled boolean not null default false;

-- §3.9 provenance of a locked monthly version
alter table public.month_outlook_version add column if not exists rule_version text;
alter table public.month_outlook_version add column if not exists anomaly_days jsonb;
alter table public.month_outlook_version add column if not exists po_share numeric(8,6);
alter table public.month_outlook_version add column if not exists approved_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sku_key_product_class_check' and conrelid = 'public.sku_key'::regclass) then
    alter table public.sku_key add constraint sku_key_product_class_check check (product_class in ('main','by_product'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_line_channel_check' and conrelid = 'public.sales_line'::regclass) then
    alter table public.sales_line add constraint sales_line_channel_check check (channel in ('po','spot'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_line_cancelled_kg_check' and conrelid = 'public.sales_line'::regclass) then
    alter table public.sales_line add constraint sales_line_cancelled_kg_check check (cancelled_kg >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forecast_line_forecast_source_check' and conrelid = 'public.forecast_line'::regclass) then
    alter table public.forecast_line add constraint forecast_line_forecast_source_check check (forecast_source in ('stat','sales'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forecast_line_scenario_check' and conrelid = 'public.forecast_line'::regclass) then
    alter table public.forecast_line add constraint forecast_line_scenario_check check (scenario is null or scenario in ('Bear','Base','Bull'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fixed_cost_schedule_day_basis_check' and conrelid = 'public.fixed_cost_schedule'::regclass) then
    alter table public.fixed_cost_schedule add constraint fixed_cost_schedule_day_basis_check check (day_basis in ('calendar','working'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fixed_cost_schedule_posting_day_check' and conrelid = 'public.fixed_cost_schedule'::regclass) then
    alter table public.fixed_cost_schedule add constraint fixed_cost_schedule_posting_day_check check (posting_day is null or posting_day between 1 and 31);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coa_map_segment_check' and conrelid = 'public.coa_map'::regclass) then
    alter table public.coa_map add constraint coa_map_segment_check check (segment is null or segment in ('LB main','LB by-product','Trading'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parameter_v1_lock_week_check' and conrelid = 'public.parameter'::regclass) then
    alter table public.parameter add constraint parameter_v1_lock_week_check check (v1_lock_week between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parameter_runrate_window_days_check' and conrelid = 'public.parameter'::regclass) then
    alter table public.parameter add constraint parameter_runrate_window_days_check check (runrate_window_days between 1 and 62);
  end if;
  -- widen the driver check with 'event' (§3.3); the four existing values keep their meaning
  if not exists (select 1 from pg_constraint where conname = 'coa_map_driver_type_check' and conrelid = 'public.coa_map'::regclass
                 and pg_get_constraintdef(oid) like '%event%') then
    alter table public.coa_map drop constraint if exists coa_map_driver_type_check;
    alter table public.coa_map add constraint coa_map_driver_type_check check (driver_type in ('fixed','variable','runrate','event','none'));
  end if;
end $$;

-- K1 seed: Kepala, Ceker, Usus, HJA, Lemak are by-products. Once only: after that PPIC owns the column.
do $$
begin
  if not exists (select 1 from public.sku_key where product_class = 'by_product') then
    update public.sku_key set product_class = 'by_product' where sku in ('Kepala','Ceker','Usus','HJA (Hati/Jantung/Ampela)','Lemak');
  end if;
end $$;

-------------------------------------------------------------------------------- §4.2 new tables
-- K7: one row per delivery (DO / surat jalan). Outstanding = kg − Σ delivery.kg − cancelled_kg.
create table if not exists public.delivery (
  id            uuid primary key default gen_random_uuid(),
  sales_line_id uuid not null references public.sales_line(id) on delete restrict,
  date          date not null,
  kg            numeric(12,2) not null check (kg > 0),
  document_ref  text,                               -- nomor DO / surat jalan
  received_by   text,
  note          text,
  source        text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id     uuid references public.upload(id),
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

-- §3.3: one-off costs, never averaged into a run-rate
create table if not exists public.cost_event (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  account      text,
  pl_line      text not null,
  amount       numeric(18,2) not null,
  reason       text not null,
  owner        text,
  document_ref text,
  source       text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id    uuid references public.upload(id),
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- P4: approved budget per month × segment × metric; a revision is a new version
create table if not exists public.budget (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null default 1,
  month       date not null check (extract(day from month) = 1),
  segment     text not null,
  metric      text not null check (metric in ('kg','revenue','gp','opex','nibt')),
  value       numeric(18,2) not null,
  approved_by text,
  approved_at timestamptz,
  locked      boolean not null default false,
  source      text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  upload_id   uuid references public.upload(id),
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (version, month, segment, metric)
);

-- P10: assumption register (replaces outlook_assumption for new versions; outlook_assumption stays)
create table if not exists public.assumption_register (
  id               uuid primary key default gen_random_uuid(),
  month_outlook_id uuid not null references public.month_outlook(id) on delete restrict,
  version          text,
  code             text not null,
  name             text not null,
  value_num        numeric(18,6),
  value_text       text,
  basis            text,
  owner            text,
  agreed_at        timestamptz,
  deviation_note   text,
  status           text not null default 'proposed' check (status in ('proposed','agreed','superseded')),
  source           text not null default 'manual' check (source in ('manual','engine','kalibrasi')),
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text
);

-- data marts (written only by the server rebuild job through mart_replace, see 20261017000200)
-- P1/P6: P&L per day per segment and basis. pl_daily (20261016001000) stays for v3 readers; v4 readers use this one.
-- segment 'Umum' = lines without a segment (opex, interest), since a primary key column cannot be null.
create table if not exists public.pl_daily_v4 (
  date       date not null,
  segment    text not null check (segment in ('LB main','LB by-product','Trading','Umum')),
  pl_line    text not null,
  basis      text not null check (basis in ('journal','do_unbilled','po','runrate','fixed','variable','event')),
  actual     numeric(18,2),
  forecast   numeric(18,2),
  kg         numeric(12,2),
  anomaly    boolean not null default false,
  upload_id  uuid,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (date, segment, pl_line, basis)
);

-- P3.4 / C41: by-product shortfall at the planned head count
create table if not exists public.demand_shortfall (
  week_start        date not null,
  key               text not null,
  net_kg            numeric(12,2) not null default 0,
  output_kg_at_plan numeric(12,2) not null default 0,
  shortfall_kg      numeric(12,2) not null default 0,
  suggested_action  text check (suggested_action is null or suggested_action in ('buy_trading','reduce_order')),
  updated_at        timestamptz not null default now(),
  updated_by        text,
  primary key (week_start, key)
);

-- P3.7: actual vs plan per SKU key per day
create table if not exists public.plan_variance_daily (
  date          date not null,
  key           text not null,
  planned_kg    numeric(12,2),
  actual_kg     numeric(12,2),
  variance_kg   numeric(12,2),
  planned_heads integer,
  actual_heads  integer,
  updated_at    timestamptz not null default now(),
  updated_by    text,
  primary key (date, key)
);

-- P13: accuracy per day of a version against FINAL
create table if not exists public.forecast_accuracy_daily (
  month_outlook_id uuid not null references public.month_outlook(id) on delete restrict,
  version          text not null,
  date             date not null,
  segment          text not null,
  forecast         numeric(18,2),
  actual           numeric(18,2),
  diff             numeric(18,2),
  day_kind         text check (day_kind is null or day_kind in ('po','runrate')),
  diff_kg          numeric(18,2),
  diff_price       numeric(18,2),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  primary key (version, date, segment)
);

create index if not exists delivery_line on public.delivery (sales_line_id) where deleted_at is null;
create index if not exists delivery_date on public.delivery (date) where deleted_at is null;
create index if not exists cost_event_date on public.cost_event (date, pl_line) where deleted_at is null;
create index if not exists budget_month on public.budget (month, segment) where deleted_at is null;
create index if not exists assumption_register_month on public.assumption_register (month_outlook_id, code) where deleted_at is null;
create index if not exists pl_daily_v4_line on public.pl_daily_v4 (pl_line, date);
create index if not exists demand_shortfall_key on public.demand_shortfall (key, week_start);
create index if not exists plan_variance_daily_key on public.plan_variance_daily (key, date);
create index if not exists forecast_accuracy_daily_month on public.forecast_accuracy_daily (month_outlook_id, version);
create index if not exists sales_line_channel on public.sales_line (channel, date) where deleted_at is null and channel = 'spot';

insert into public.mart_table (name, scope_col, key_cols, keep_col, keep_values, note) values
  ('pl_daily_v4', 'date', '{date,segment,pl_line,basis}', null, null, 'v4 P&L per day per segment and basis (P1, P6)'),
  ('demand_shortfall', 'week_start', '{week_start,key}', null, null, 'v4 by-product shortfall at the planned heads (P3.4, C41)'),
  ('plan_variance_daily', 'date', '{date,key}', null, null, 'v4 actual vs plan per SKU key per day (P3.7)'),
  ('forecast_accuracy_daily', 'date', '{version,date,segment}', null, null, 'v4 accuracy of a version per day (P13)')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols;

-------------------------------------------------------------------------------- §4.3 data status
-- One row per data mart table × scope (date or week), written by mart_replace; status of source tables is read from
-- their own columns through status_map. C45 (STALE) compares the mart with the rebuild queue (apps/web/lib/v3/stale.ts).
create table if not exists public.data_status (
  table_name        text not null,
  scope             text not null,
  status            text not null default 'draft' check (status in ('missing','draft','validated','reconciliation_pending',
                      'reconciliation_failed','reviewed','released','superseded','final')),
  built_at          timestamptz,
  input_fingerprint text,
  stale_from        date,
  note              text,
  updated_at        timestamptz not null default now(),
  updated_by        text,
  primary key (table_name, scope)
);

-- Explicit mapping of the status columns that already exist (meaning of the old values unchanged, §4.3)
create table if not exists public.status_map (
  table_name  text not null,
  column_name text not null,
  old_value   text not null,
  status      text not null check (status in ('missing','draft','validated','reconciliation_pending',
                'reconciliation_failed','reviewed','released','superseded','final')),
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (table_name, column_name, old_value)
);
insert into public.status_map (table_name, column_name, old_value, status, note) values
  ('week', 'status', 'open', 'draft', 'minggu berjalan, input masih bisa berubah'),
  ('week', 'status', 'released', 'released', 'sudah dirilis (snapshot di release)'),
  ('week', 'status', 'closed', 'final', 'minggu ditutup, hanya Admin yang menulis'),
  ('batch', 'costing_status', 'none', 'missing', 'belum ada WP costing'),
  ('batch', 'costing_status', 'uploaded', 'draft', 'WP diunggah, belum dialokasikan'),
  ('batch', 'costing_status', 'allocated', 'validated', 'alokasi dihitung, belum diposting'),
  ('batch', 'costing_status', 'posted', 'released', 'diposting ke HPP'),
  ('month_outlook', 'status', 'open', 'draft', 'bulan berjalan tanpa versi terkunci'),
  ('month_outlook', 'status', 'v1_locked', 'released', 'V1 dikunci'),
  ('month_outlook', 'status', 'v2', 'released', 'V2 dikunci'),
  ('month_outlook', 'status', 'final', 'final', 'FINAL setelah tutup buku'),
  ('upload', 'status', 'staged', 'draft', 'di stage, belum commit'),
  ('upload', 'status', 'committed', 'validated', 'lolos validasi dan di-commit'),
  ('upload', 'status', 'discarded', 'superseded', 'dibuang sebelum commit'),
  ('upload', 'status', 'failed', 'reconciliation_failed', 'gagal validasi')
on conflict (table_name, column_name, old_value) do nothing;

-------------------------------------------------------------------------------- K7 triggers
-- Σ delivery.kg per line ≤ kg − cancelled_kg; sales_line.fulfilled_kg = Σ delivery.kg. The line row is locked first, so
-- two deliveries of one line in parallel are checked one after the other.
create or replace function public.tg_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[] := array_remove(array[case when tg_op <> 'INSERT' then old.sales_line_id end, case when tg_op <> 'DELETE' then new.sales_line_id end], null);
  lid uuid; cap numeric; tot numeric;
begin
  foreach lid in array (select array_agg(distinct x) from unnest(ids) x) loop
    select s.kg - s.cancelled_kg into cap from public.sales_line s where s.id = lid for update;
    select coalesce(sum(d.kg), 0) into tot from public.delivery d where d.sales_line_id = lid and d.deleted_at is null;
    if tot > cap then
      raise exception 'Pengiriman % kg melebihi sisa order (% kg setelah batal)', tot, cap using errcode = '23514';
    end if;
    perform set_config('kgr.delivery_sync', 'on', true);
    update public.sales_line set fulfilled_kg = tot where id = lid and fulfilled_kg is distinct from tot;
    perform set_config('kgr.delivery_sync', '', true);
  end loop;
  return null;
end $$;
revoke execute on function public.tg_delivery_sync() from public, anon, authenticated;

-- fulfilled_kg is derived: a signed-in user cannot set it directly; kg / cancelled_kg cannot drop below what was delivered
create or replace function public.tg_sales_line_fulfilled_guard() returns trigger
language plpgsql set search_path = '' as $$
declare tot numeric;
begin
  if public.app_role() is null or coalesce(current_setting('kgr.delivery_sync', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.fulfilled_kg := 0;
    return new;
  end if;
  if new.fulfilled_kg is distinct from old.fulfilled_kg then
    raise exception 'fulfilled_kg dihitung dari tabel pengiriman (delivery); catat pengiriman, bukan mengubah kolom ini' using errcode = '42501';
  end if;
  if new.kg is distinct from old.kg or new.cancelled_kg is distinct from old.cancelled_kg then
    select coalesce(sum(d.kg), 0) into tot from public.delivery d where d.sales_line_id = new.id and d.deleted_at is null;
    if tot > new.kg - new.cancelled_kg then
      raise exception 'Sudah terkirim % kg; kg dikurangi batal tidak boleh lebih kecil', tot using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'delivery_sync' and tgrelid = 'public.delivery'::regclass) then
    create trigger delivery_sync after insert or update or delete on public.delivery for each row execute function public.tg_delivery_sync();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'fulfilled_guard' and tgrelid = 'public.sales_line'::regclass) then
    create trigger fulfilled_guard before insert or update on public.sales_line for each row execute function public.tg_sales_line_fulfilled_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.delivery'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.delivery for each row execute function public.tg_needs_rebuild();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.cost_event'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.cost_event for each row execute function public.tg_needs_rebuild();
  end if;
end $$;

-- P4: a locked budget row is not edited (a revision is a new version); Admin may unlock
create or replace function public.tg_budget_locked() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null or r = 'admin' then return new; end if;
  if old.locked then raise exception 'Budget yang sudah dikunci tidak diubah; unggah versi baru' using errcode = '42501'; end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'budget_locked' and tgrelid = 'public.budget'::regclass) then
    create trigger budget_locked before update on public.budget for each row execute function public.tg_budget_locked();
  end if;
end $$;

-------------------------------------------------------------------------------- stamps, audit, RLS on the new tables
do $$
declare t text;
begin
  foreach t in array array['delivery','cost_event','budget','assumption_register','pl_daily_v4','demand_shortfall',
                           'plan_variance_daily','forecast_accuracy_daily','data_status','status_map'] loop
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
declare t text; r text; w text;
begin
  foreach t in array array['delivery','cost_event','budget','assumption_register','pl_daily_v4','demand_shortfall',
                           'plan_variance_daily','forecast_accuracy_daily','data_status','status_map'] loop
    -- finance detail (one-off costs, budget) is not for sales (PRD v3 Q17)
    r := case when t in ('cost_event','budget') then '(select public.is_app_user()) and not (select public.has_role(''sales''))'
              else '(select public.is_app_user())' end;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_read', t, r);
    end if;
    -- data marts and the status registry: no write policy (server job only, 20261017000200)
    w := case t
      when 'delivery' then '''admin'',''inventory_accounting'',''sales'',''commercial_lead'''
      when 'cost_event' then '''admin'',''finance'''
      when 'budget' then '''admin'',''finance'''
      when 'assumption_register' then '''admin'',''finance'''
      when 'status_map' then '''admin'''
      else null end;
    if t = 'delivery' and not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      -- same week rule as the order line itself (closed week: Admin only)
      create policy delivery_ins on public.delivery for insert to authenticated
        with check ((select public.has_role('admin','inventory_accounting','sales','commercial_lead'))
                    and exists (select 1 from public.sales_line s where s.id = sales_line_id and public.week_writable(s.week_id)));
      create policy delivery_upd on public.delivery for update to authenticated
        using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
    elsif w is not null and not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(%s)))', t || '_ins', t, w);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(%s))) with check ((select public.has_role(%s)))', t || '_upd', t, w, w);
    end if;
  end loop;
end $$;
