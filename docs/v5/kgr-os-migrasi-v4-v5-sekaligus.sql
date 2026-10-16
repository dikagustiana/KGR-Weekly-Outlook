-- KGR-OS: 10 migrasi v4 + v5 sekaligus, untuk SQL Editor Supabase (satu kali Run).
--
-- Isi: file supabase/migrations/20261017000100 s.d. 20261023000100, disambung urut nama, isi tiap file tidak diubah.
-- Tambahan di luar file migrasi hanya dua: cek prasyarat v3 di awal dan tabel cek di akhir.
-- SQL Editor menjalankan semuanya dalam satu transaksi: error di mana pun membatalkan semuanya (tidak ada yang
-- setengah terpasang). Semua file bisa dijalankan ulang. Hasil yang benar: tabel 11 baris, kolom ada semuanya true.
-- Flag v4_* dan v5_* tetap mati sampai Admin menyalakannya.
--
-- sha256 file sumber (cek: sha256sum supabase/migrations/<file>):
--   74217987d6a7bc6ce7f0c065c8d8c6dd55dcbb03081a10714860d113e9aeb8eb  20261017000100_v4_schema.sql
--   d8bbfac4032b10ecd443a1e089a4de00da3d644e30c2b3524e53fe0daf14cd3d  20261017000200_v4_security.sql
--   c8181edd0afda9bf0c9cf579f339fa0e4386f359f8e6632da00004cc3da5c6f2  20261017000300_v4_design_flag.sql
--   2593aca5dcec543c4a4570a06aaa59956722024753ec63de406892146e77ed75  20261017000400_v4_cash_split.sql
--   868b77a8be3eeeff6b4de321dfde97737b36dec5c5794899589f21810dfb3cb4  20261018000100_v4_ppic.sql
--   a368770a41834cb85f26408a224a35b5ce8b9a22bfa8413ce150363cbb17679f  20261019000100_v4_release.sql
--   a5667af8814c953230810a9f05410fc59510f32b3124e0dcdc23a59267867789  20261020000100_v4_commercial.sql
--   c05f4a883a7b3aa4d1fcdf3a0e531ac3a19f78030941c3e6bb4abac35fd7e010  20261021000100_v5_foundation.sql
--   be303bdcbd7ae26cf83dba04ded7f14ddec11d91a36560225d254e023a41ae6a  20261022000100_v5_costing.sql
--   b8b806a81b27eee46f9f31964a7fec5b811d82db75e0299b46985bd0fc4ca059  20261023000100_v5_input.sql

-------------------------------------------------------------------------------- prasyarat: v3 sudah terpasang
do $$
begin
  if to_regclass('public.mart_table') is null or to_regclass('public.commercial_daily') is null
     or to_regprocedure('public.tg_discount_guard()') is null then
    raise exception 'Migrasi v3 belum lengkap di database ini; v4 dan v5 tidak dijalankan';
  end if;
end $$;

-------------------------------------------------------------------------------- 1/10 20261017000100_v4_schema.sql
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

-------------------------------------------------------------------------------- 2/10 20261017000200_v4_security.sql
-- v4 irisan 0 — security findings S1, S2, S4, S5, S6 (docs/PRD-v4.md §8; S3 = K7 in 20261017000100).
-- Additive and re-runnable. Guards that depend on a module read the global flag in app_setting, so with every module
-- off (the production default) the only behaviour change is S1: a signed-in user can no longer call mart_replace.

-------------------------------------------------------------------------------- S1: data marts are written by the server job only
-- Same body as 20261016000400 except the caller check: the service role (the rebuild job on the server) instead of
-- any operational role, and the scope is recorded in data_status (§4.3).
create or replace function public.mart_replace(p_table text, p_scope text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.mart_table%rowtype;
  cols text; upd text; keys text; tcols text; ecols text; keep text := '';
  n_ins int := 0; n_del int := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'mart_replace: data mart hanya ditulis job rebuild di server' using errcode = '42501';
  end if;
  select * into m from public.mart_table where name = p_table;
  if not found then raise exception 'mart_replace: % bukan tabel data mart', p_table; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'mart_replace: rows harus array'; end if;
  select string_agg(format('%I', k), ',') into keys from unnest(m.key_cols) k;
  if m.keep_col is not null and m.keep_values is not null then
    keep := format(' and t.%I::text <> all (%L::text[])', m.keep_col, m.keep_values);
  end if;
  if jsonb_array_length(p_rows) > 0 then
    select string_agg(format('%I', k), ','), string_agg(format('t.%I', k), ','), string_agg(format('excluded.%I', k), ',')
      into cols, tcols, ecols
      from jsonb_object_keys(p_rows -> 0) k where not (k = any(m.key_cols));
    upd := (select string_agg(format('%I = excluded.%I', k, k), ',') from jsonb_object_keys(p_rows -> 0) k where not (k = any(m.key_cols)));
    cols := keys || coalesce(',' || cols, '');
    execute format(
      'insert into public.%I as t (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do %s',
      p_table, cols, cols, p_table, keys,
      case when upd is null then 'nothing' else format('update set %s where (%s) is distinct from (%s)', upd, tcols, ecols) end)
      using p_rows;
    get diagnostics n_ins = row_count;
  end if;
  execute format(
    'delete from public.%I t where t.%I::text = $2%s and (%s) not in (select %s from jsonb_populate_recordset(null::public.%I, $1))',
    p_table, m.scope_col, keep, (select string_agg(format('t.%I', k), ',') from unnest(m.key_cols) k), keys, p_table)
    using p_rows, p_scope;
  get diagnostics n_del = row_count;
  -- input_fingerprint = md5 of the rows the engine produced for the scope; the registry row only changes when the
  -- content does (an unchanged rebuild writes nothing, as for the mart rows themselves)
  insert into public.data_status as d (table_name, scope, status, built_at, input_fingerprint, stale_from)
  values (p_table, p_scope, 'draft', now(), md5(p_rows::text), null)
  on conflict (table_name, scope) do update set status = 'draft', built_at = excluded.built_at,
    input_fingerprint = excluded.input_fingerprint, stale_from = null
  where d.input_fingerprint is distinct from excluded.input_fingerprint or d.status <> 'draft' or d.stale_from is not null;
  return jsonb_build_object('written', n_ins, 'deleted', n_del);
end $$;
revoke all on function public.mart_replace(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mart_replace(text, text, jsonb) to service_role;

-- No direct client write either: the admin insert/update policies of the v3 marts are neutralised by a restrictive
-- policy (the service role bypasses RLS). lot_movement keeps its manual rows (inputs) through its own policies.
do $$
declare t text;
begin
  foreach t in array array['lot','lot_balance_daily','sku_balance_daily','demand_weekly','pl_daily','cash_position_daily',
                           'ccc_daily','solvency_monthly','commercial_daily','sales_scorecard_weekly'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_no_client_ins') then
      execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (false)', t || '_no_client_ins', t);
      execute format('create policy %I on public.%I as restrictive for update to authenticated using (false)', t || '_no_client_upd', t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------- S2: sales without an assignment see no SKU
-- The commercial view for sales lists only the keys assigned to the signed-in rep (a row with key null = every key of
-- that assignment). No assignment = no rows (default deny). Column list unchanged from 20261016001200.
create or replace view public.commercial_daily_sales with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff, c.cost_per_kg_ma,
         c.price_floor, c.price_list, c.margin_per_kg_list, c.realized_price_7d, c.margin_per_kg_realized, c.holding_loss_per_day,
         c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg
  from public.commercial_daily c
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = c.key)));
revoke all on public.commercial_daily_sales from public, anon;
grant select on public.commercial_daily_sales to authenticated;

-- Discount requests: sales read their own requests and those of their assigned keys
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'discount_approval' and policyname = 'discount_approval_sales_scope') then
    create policy discount_approval_sales_scope on public.discount_approval as restrictive for select to authenticated
      using (not (select public.has_role('sales'))
             or requested_by = public.current_email()
             or exists (select 1 from public.sales_assignment a
                        where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = discount_approval.key)));
  end if;
end $$;

-------------------------------------------------------------------------------- S4: the audit trail of cost detail is not for sales
-- Sales cannot read old/new payloads of tables carrying cost pools, batch costs, overhead, cost per lot (SI), cash and
-- fixed-cost detail. Other roles unchanged.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment']));
  end if;
end $$;

-------------------------------------------------------------------------------- S5: invariants in the database, not only in forms
-- C29: Σ allocation per order line ≤ kg − cancelled_kg. The line row is locked first (parallel requests queue).
create or replace function public.tg_allocation_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap numeric; tot numeric;
begin
  if new.deleted_at is not null then return new; end if;
  select s.kg - s.cancelled_kg into cap from public.sales_line s where s.id = new.sales_line_id for update;
  select coalesce(sum(a.kg), 0) into tot from public.allocation a
   where a.sales_line_id = new.sales_line_id and a.deleted_at is null and a.id is distinct from new.id;
  if tot + new.kg > cap then
    raise exception 'C29: alokasi % kg melebihi order (% kg sudah dialokasikan dari % kg)', new.kg, tot, cap using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_allocation_cap() from public, anon, authenticated;

-- C38: an Order priced under the floor needs an approved discount that covers it (same rule as @kgr/engine guardOrders:
-- same key and customer, requested price ≤ price, kg ≥ kg, not yet used by another line). Active only while the
-- m7_approval flag is on; the floor is the latest commercial row of the key within 14 days (lib/v3/discount.ts).
create or replace function public.tg_floor_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text; fl numeric; on_ boolean;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if public.app_role() is null then return new; end if;
  -- status null counts as an order, as in floorGuard (lib/v3/discount.ts)
  if coalesce(new.status, 'Order') <> 'Order' or new.deleted_at is not null or new.price is null or new.kg is null then return new; end if;
  select coalesce((s.value ->> 'enabled')::boolean, false) into on_ from public.app_setting s where s.key = 'm7_approval';
  if not coalesce(on_, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.status, 'Order') = 'Order' and new.price is not distinct from old.price and new.kg is not distinct from old.kg
     and new.item_code is not distinct from old.item_code and new.key_manual is not distinct from old.key_manual
     and new.customer is not distinct from old.customer then
    return new;
  end if;
  k := case when nullif(trim(coalesce(new.key_manual, '')), '') is not null then new.key_manual
            else (select m.key from public.item_map m where upper(trim(m.item_code)) = upper(trim(new.item_code)) and m.deleted_at is null limit 1) end;
  if k is null then return new; end if;
  select c.price_floor into fl from public.commercial_daily c
   where c.key = k and c.date <= today and c.date >= today - 14 and c.price_floor is not null order by c.date desc limit 1;
  if fl is null or new.price >= fl then return new; end if;
  if exists (select 1 from public.discount_approval a
             where a.status = 'approved' and a.key = k and coalesce(a.customer, '') = coalesce(new.customer, '')
               and a.requested_price <= new.price and a.kg >= new.kg and (a.sales_line_id is null or a.sales_line_id = new.id)) then
    return new;
  end if;
  raise exception 'C38: harga Rp % untuk % di bawah harga lantai Rp % tanpa approval diskon', round(new.price), k, round(fl) using errcode = '42501';
end $$;
revoke execute on function public.tg_floor_guard() from public, anon, authenticated;

-- No self-approval (G2): the decider of a discount request is not its requester. Same body as 20261016001300 plus that
-- check; admin keeps deciding everything.
create or replace function public.tg_discount_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null or r = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'Permintaan diskon dibuat dengan status pending' using errcode = '42501'; end if;
    new.requested_by := coalesce(new.requested_by, (select auth.jwt() ->> 'email'));
    return new;
  end if;
  if new.status is distinct from old.status or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    if old.status <> 'pending' then raise exception 'Keputusan diskon sudah final' using errcode = '42501'; end if;
    if old.requested_by is not null and lower(old.requested_by) = public.current_email() then
      raise exception 'Permintaan diskon tidak diputuskan oleh pengajunya sendiri' using errcode = '42501';
    end if;
    if r = 'finance' then return new; end if;
    if r = 'commercial_lead' then
      if new.rp_per_kg_below > public.discount_limit() then
        raise exception 'Diskon % Rp/kg di atas batas commercial lead (% Rp/kg): keputusan Finance', new.rp_per_kg_below, public.discount_limit() using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Peran % tidak memutuskan diskon', r using errcode = '42501';
  end if;
  -- the request itself (price, floor, kg) is fixed once made
  if (to_jsonb(new) - array['sales_line_id','reason','updated_at','updated_by']) is distinct from (to_jsonb(old) - array['sales_line_id','reason','updated_at','updated_by']) then
    raise exception 'Isi permintaan diskon tidak bisa diubah' using errcode = '42501';
  end if;
  return new;
end $$;

-- A locked monthly version is not deleted either (update is already refused by version_immutable, 20261016001000)
create or replace function public.tg_version_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Versi outlook yang sudah dikunci tidak bisa dihapus' using errcode = '42501';
end $$;

-- An approved weekly plan is a record: its numbers do not change (save a new version instead). Copying to batch,
-- the note and soft delete stay possible.
create or replace function public.tg_plan_week_approved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.app_role() is null then return new; end if;
  if old.approved_at is not null
     and (to_jsonb(new) - array['copied_to_batch_at','note','deleted_at','deleted_by','updated_at','updated_by'])
         is distinct from (to_jsonb(old) - array['copied_to_batch_at','note','deleted_at','deleted_by','updated_at','updated_by']) then
    raise exception 'Rencana versi % sudah disetujui; simpan sebagai versi baru', old.version using errcode = '42501';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'allocation_cap' and tgrelid = 'public.allocation'::regclass) then
    create trigger allocation_cap before insert or update of kg, sales_line_id, deleted_at on public.allocation
      for each row execute function public.tg_allocation_cap();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'floor_guard' and tgrelid = 'public.sales_line'::regclass) then
    create trigger floor_guard before insert or update on public.sales_line for each row execute function public.tg_floor_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'version_no_delete' and tgrelid = 'public.month_outlook_version'::regclass) then
    create trigger version_no_delete before delete on public.month_outlook_version for each row execute function public.tg_version_no_delete();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'plan_week_approved' and tgrelid = 'public.plan_week'::regclass) then
    create trigger plan_week_approved before update on public.plan_week for each row execute function public.tg_plan_week_approved();
  end if;
end $$;

-------------------------------------------------------------------------------- S6: SECURITY DEFINER hygiene
-- Every security-definer function in public must pin search_path; none is executable by anon; trigger functions are
-- not executable through the API at all (a trigger fires without EXECUTE). Fails the migration when a function breaks
-- the rule. A function that authenticated or service_role could execute before (RLS helpers such as app_role,
-- week_writable, and the RPCs module_enabled, discount_limit, admin_set_password) keeps an explicit grant, so removing
-- the PUBLIC grant never breaks a policy.
do $$
declare f record; a boolean; sr boolean;
begin
  for f in select p.oid, p.oid::regprocedure as sig, p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger, p.proconfig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef loop
    if f.proconfig is null or not exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%') then
      raise exception 'S6: % is SECURITY DEFINER without a fixed search_path', f.sig;
    end if;
    a := has_function_privilege('authenticated', f.oid, 'execute');
    sr := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      if a then execute format('grant execute on function %s to authenticated', f.sig); end if;
      if sr then execute format('grant execute on function %s to service_role', f.sig); end if;
    end if;
  end loop;
end $$;
grant execute on function public.mart_replace(text, text, jsonb) to service_role;

-------------------------------------------------------------------------------- 3/10 20261017000300_v4_design_flag.sql
-- v4 irisan 1 — feature flag of the new design and the management page "Minggu ini" (docs/PRD-v4.md §2 rule 7, §10).
-- Default off: with the flag off every page renders as before. With it on the rebuild job also writes the weekly rows
-- of pl_daily_v4 (§3.4). Additive and re-runnable.
insert into public.app_setting (key, value, note) values
  ('v4_design', '{"enabled": false}', 'PRD v4 irisan 1: bahasa visual baru, navigasi per peran, halaman Minggu ini')
on conflict (key) do nothing;

-- The weekly rows depend on week-level inputs without a date column (run-rate, parameter, sell prices, opening stock):
-- a change queues the Monday of its week, so the rebuild recomputes the week.
create or replace function public.tg_needs_rebuild_week() returns trigger
language plpgsql security definer set search_path = '' as $$
declare w uuid := coalesce((to_jsonb(coalesce(new, old)) ->> 'week_id')::uuid, null); d date;
begin
  select week_start into d from public.week where id = w;
  if d is not null and not exists (select 1 from public.rebuild_queue q where q.date = d and q.status = 'queued') then
    insert into public.rebuild_queue (date, reason) values (d, tg_table_name || ' ' || lower(tg_op));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.tg_needs_rebuild_week() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['runrate','parameter','sku_price','opening_stock'] loop
    if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild_week' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger needs_rebuild_week after insert or update or delete on public.%I for each row execute function public.tg_needs_rebuild_week()', t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------- 4/10 20261017000400_v4_cash_split.sql
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

-------------------------------------------------------------------------------- 5/10 20261018000100_v4_ppic.sql
-- v4 irisan 3 — M3 PPIC (docs/PRD-v4.md §3.1 P3.1–P3.9, K1, K2, K8, §6.4, §6.5). Additive and re-runnable.
-- demand_weekly carries the production unit, its class (K1) and where the forecast came from (K2); plan_week records
-- that it was saved on placeholder yields (C42); plan_check_reason keeps the written reason that lets a PERIKSA
-- control open the next step of the Rencana page; capacity gets empty rows for PPIC to fill (P3.6), no numbers.

alter table public.demand_weekly add column if not exists unit text;
alter table public.demand_weekly add column if not exists product_class text;
alter table public.demand_weekly add column if not exists source_forecast text;
alter table public.plan_week add column if not exists yield_provisional boolean not null default false;
alter table public.plan_week add column if not exists controls jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demand_weekly_product_class_check' and conrelid = 'public.demand_weekly'::regclass) then
    alter table public.demand_weekly add constraint demand_weekly_product_class_check check (product_class is null or product_class in ('main','by_product'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demand_weekly_source_forecast_check' and conrelid = 'public.demand_weekly'::regclass) then
    alter table public.demand_weekly add constraint demand_weekly_source_forecast_check check (source_forecast is null or source_forecast in ('sales','stat'));
  end if;
end $$;

-- §6.4: "langkah berikutnya terkunci sampai kontrol langkah sebelumnya LULUS atau PERIKSA dengan alasan"
create table if not exists public.plan_check_reason (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  code        text not null check (code ~ '^C[0-9]{2}$'),
  reason      text not null check (length(trim(reason)) >= 5),
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index if not exists plan_check_reason_week_code on public.plan_check_reason (week_start, code) where deleted_at is null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.plan_check_reason'::regclass) then
    create trigger stamp before insert or update on public.plan_check_reason for each row execute function public.tg_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.plan_check_reason'::regclass) then
    create trigger audit after insert or update or delete on public.plan_check_reason for each row execute function public.tg_audit();
  end if;
end $$;
alter table public.plan_check_reason enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'plan_check_reason' and policyname = 'plan_check_reason_read') then
    create policy plan_check_reason_read on public.plan_check_reason for select to authenticated using ((select public.is_app_user()));
    create policy plan_check_reason_ins on public.plan_check_reason for insert to authenticated with check ((select public.has_role('admin','ppic')));
    create policy plan_check_reason_upd on public.plan_check_reason for update to authenticated
      using ((select public.has_role('admin','ppic'))) with check ((select public.has_role('admin','ppic')));
  end if;
end $$;

-- P3.6: capacity rows for two periods with empty values and a description; PPIC fills the numbers (C47 stays
-- BELUM DIISI while cut_capacity_head is null). Maklon until 31 Oct, RPA Rawa Terate from 1 Nov.
insert into public.capacity (date, cut_capacity_head, chiller_kg, abf_kg, note)
select d::date, null, null, null,
       case when d < date '2026-11-01' then 'Maklon (s.d. 31 Okt 2026): kapasitas potong, chiller, ABF diisi PPIC'
            else 'RPA Rawa Terate (mulai 1 Nov 2026): kapasitas potong, chiller, ABF diisi PPIC' end
from generate_series(date '2026-10-19', date '2026-11-29', interval '1 day') d
on conflict (date) do nothing;

-- K7: one delivery document per PO line once (re-uploading the delivery CSV, or two people pressing Terkirim with the
-- same DO number, cannot record it twice)
create unique index if not exists delivery_line_document on public.delivery (sales_line_id, document_ref) where deleted_at is null and document_ref is not null;

-------------------------------------------------------------------------------- 6/10 20261019000100_v4_release.sql
-- v4 irisan 4 — finance close (docs/PRD-v4.md §3.5, §3.6, §3.9, §7.2, G3, G8). Additive and re-runnable.
--
-- §7.2: a weekly release and a monthly version are written only inside release_week / release_month (SECURITY
-- DEFINER, search_path fixed). The functions check, in the release transaction, what the database can see for itself:
-- the caller's role, the SHA-256 of the snapshot text, pending rebuilds of the period (STALE), the version order and the
-- V1 lock date (K9), the register of assumptions (P10), batches without output (C48), and the controls carried in the
-- snapshot. A mandatory control that is GAGAL / BELUM DIISI / STALE rejects the release, with the reason per control,
-- unless a release_override row exists for it — written only by a role that release_override_policy allows for that
-- control (no generic admin override). Direct inserts into release / month_outlook_version are no longer allowed.
-- Flag v4_release (default off): off = the weekly rule stays as in v1 (only GAGAL rejects, no override); on = the §7.2
-- rule. A v4 monthly snapshot (rule_version) always takes the §7.2 rule.
--
-- M1 (§3.5): batches from 1 Nov 2026 default to the own-RPA cost mode; overhead per head as well as per kg LB;
-- C48: an Aktual batch without SKU output cannot have its costing posted; DI-01: the ledger keeps the COGS of a DO at
-- MA on the revenue date next to the MA on the invoice date.

-------------------------------------------------------------------------------- flag
insert into public.app_setting (key, value, note)
values ('v4_release', '{"enabled": false}', 'PRD v4 §7.2: rilis menolak kontrol wajib GAGAL / BELUM DIISI / STALE kecuali ada override per kontrol')
on conflict (key) do nothing;

-------------------------------------------------------------------------------- overrides
create table if not exists public.release_override_policy (
  code          text primary key check (code ~ '^C[0-9]{1,2}$'),
  allowed_roles text[] not null default '{}',
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

insert into public.release_override_policy (code, allowed_roles, note)
select 'C' || n, array['finance'], 'kontrol v1: Finance dengan alasan dan bukti' from generate_series(1, 20) n
on conflict (code) do nothing;
insert into public.release_override_policy (code, allowed_roles, note) values
  ('C21', array['cost_accounting','finance'], 'costing M1'), ('C22', array['cost_accounting','finance'], 'costing M1'),
  ('C23', array['cost_accounting','finance'], 'costing M1'), ('C24', array['cost_accounting','finance'], 'costing M1'),
  ('C33', array['finance'], 'driver biaya'), ('C34', array['finance'], 'biaya tetap melebihi jadwal'), ('C43', array['finance'], 'biaya tetap belum diperbarui'),
  ('C35', array['finance'], 'kas'), ('C36', array['finance'], 'kas'), ('C37', array['finance'], 'kas'),
  ('C49', array['finance'], 'P&L harian vs jurnal'),
  ('C32', '{}', 'bridge V1 → V2 harus menutup; tidak ada override'),
  ('C45', '{}', 'STALE: bangun ulang mart; tidak ada override'),
  ('C48', '{}', 'batch tanpa output: lengkapi output; tidak ada override')
on conflict (code) do nothing;

create table if not exists public.release_override (
  id           uuid primary key default gen_random_uuid(),
  scope_kind   text not null check (scope_kind in ('week','month')),
  scope        text not null,                                   -- week_start, or month first day + ':' + version
  code         text not null references public.release_override_policy(code),
  reason       text not null check (length(trim(reason)) >= 10),
  evidence     text not null check (length(trim(evidence)) >= 3),  -- voucher, file, link
  created_role text,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create unique index if not exists release_override_scope_code on public.release_override (scope_kind, scope, code) where deleted_at is null;

create or replace function public.tg_release_override_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_role := public.app_role();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['release_override_policy','release_override'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'override_role' and tgrelid = 'public.release_override'::regclass) then
    create trigger override_role before insert on public.release_override for each row execute function public.tg_release_override_role();
  end if;
  if not exists (select 1 from pg_policies where tablename = 'release_override_policy' and policyname = 'release_override_policy_read') then
    create policy release_override_policy_read on public.release_override_policy for select to authenticated using ((select public.is_app_user()));
    -- the policy itself is Admin's to maintain (who may override what), not a way to override
    create policy release_override_policy_upd on public.release_override_policy for update to authenticated
      using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'release_override' and policyname = 'release_override_read') then
    create policy release_override_read on public.release_override for select to authenticated using ((select public.is_app_user()));
    create policy release_override_ins on public.release_override for insert to authenticated
      with check (exists (select 1 from public.release_override_policy p where p.code = release_override.code and public.app_role() = any (p.allowed_roles)));
    -- withdrawing an override (soft delete) is for the role that may give it
    create policy release_override_upd on public.release_override for update to authenticated
      using (exists (select 1 from public.release_override_policy p where p.code = release_override.code and public.app_role() = any (p.allowed_roles)))
      with check (exists (select 1 from public.release_override_policy p where p.code = release_override.code and public.app_role() = any (p.allowed_roles)));
  end if;
end $$;

-------------------------------------------------------------------------------- helpers
-- Pending rebuilds of a date range: the marts a release reads would be older than their inputs (STALE).
create or replace function public.release_stale_dates(p_from date, p_to date) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(distinct q.date::text, ', ' order by q.date::text) from public.rebuild_queue q
   where q.status in ('queued','running') and q.date between p_from and p_to;
$$;
revoke all on function public.release_stale_dates(date, date) from public, anon;

-- C48: Aktual batches in a date range without any SKU output row.
create or replace function public.c48_batches(p_from date, p_to date) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(coalesce(b.batch_ref, b.id::text), ', ' order by b.date, b.batch_ref) from public.batch b
   where b.status = 'Aktual' and b.deleted_at is null and b.date between p_from and p_to
     and not exists (select 1 from public.batch_output_sku o where o.batch_id = b.id and o.deleted_at is null and o.kg > 0);
$$;
revoke all on function public.c48_batches(date, date) from public, anon;

-- The n-th Thursday of a month (K9 v1_lock_week).
create or replace function public.nth_thursday(p_month date, p_n integer) returns date
language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_month)::date + ((4 - extract(isodow from date_trunc('month', p_month))::int + 7) % 7) + 7 * (greatest(p_n, 1) - 1))::date;
$$;

-- Controls of a snapshot that reject: mandatory codes whose status is GAGAL / BELUM DIISI / STALE and that have no
-- override for the scope; when p_strict is false the v1 rule: only GAGAL, and no overrides (as before v4).
-- Returns the reasons, one per control, or null.
create or replace function public.release_rejections(p_controls jsonb, p_mandatory text[], p_scope_kind text, p_scope text, p_strict boolean) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(c.code || ' ' || c.status, '; ' order by c.code)
    from (select coalesce(e ->> 'code', 'C' || (e ->> 'no')) as code, e ->> 'status' as status from jsonb_array_elements(coalesce(p_controls, '[]'::jsonb)) e) c
   where (p_mandatory is null or c.code = any (p_mandatory))
     and (c.status = 'GAGAL' or (p_strict and c.status in ('BELUM DIISI','STALE')))
     and not (p_strict and exists (select 1 from public.release_override o where o.scope_kind = p_scope_kind and o.scope = p_scope and o.code = c.code and o.deleted_at is null));
$$;
revoke all on function public.release_rejections(jsonb, text[], text, text, boolean) from public, anon;

-------------------------------------------------------------------------------- week guard
-- week_end is a generated column: in a BEFORE trigger NEW.week_end is still null, so the guard of 20261014000200 read it
-- as changed and refused every non-admin week update, including Finance setting status 'released' (the v1 release
-- ignored that error, so a week released by Finance stayed 'open'). Same rule, generated column skipped.
create or replace function public.tg_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
begin
  if r = 'admin' or r is null then return new; end if;
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at','updated_by','week_end') or (o -> k) is not distinct from (n -> k) then continue; end if;
    if k = 'update_date' then continue; end if;
    if k = 'status' and r = 'finance' and old.status in ('open','released') and new.status in ('open','released') then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-------------------------------------------------------------------------------- release_week
create or replace function public.release_week(p_week_id uuid, p_json text, p_sha text, p_pdf_path text, p_ops jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.week%rowtype; snap jsonb; is_strict boolean; bad text; stale text; rid uuid; email text := public.current_email();
begin
  if not (select public.has_role('admin','finance')) then
    raise exception 'Rilis mingguan hanya oleh Admin atau Finance' using errcode = '42501';
  end if;
  select * into w from public.week where id = p_week_id;
  if not found then raise exception 'Minggu tidak ada'; end if;
  if w.status = 'closed' then raise exception 'Minggu % sudah ditutup', w.week_start using errcode = '42501'; end if;
  if encode(sha256(convert_to(p_json, 'UTF8')), 'hex') <> p_sha then
    raise exception 'Snapshot berubah: SHA-256 tidak cocok' using errcode = '22000';
  end if;
  snap := p_json::jsonb;
  if snap -> 'controls' -> 'controls' is null then raise exception 'Snapshot tanpa kontrol' using errcode = '22000'; end if;
  is_strict := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v4_release'), false);
  bad := public.release_rejections(snap -> 'controls' -> 'controls', null, 'week', w.week_start::text, is_strict);
  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  end if;
  if bad is not null then
    raise exception 'Rilis ditolak: %', bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.release (week_id, update_date, engine_version, snapshot, snapshot_sha256, pdf_path, control_status, controls, ops_rows, released_by)
  values (w.id, w.update_date, coalesce(snap ->> 'engineVersion', ''), snap, p_sha, p_pdf_path, coalesce(snap -> 'controls' ->> 'overall', ''), snap -> 'controls', coalesce(p_ops, '[]'::jsonb), email)
  returning id into rid;
  update public.week set status = 'released' where id = w.id and status = 'open';
  return rid;
end $$;
revoke all on function public.release_week(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.release_week(uuid, text, text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- release_month
-- p_version V1 / V2 / FINAL. Totals and the snapshot come from the server's engine run; the function checks the order
-- of versions, the dates, the register, C48, STALE and the snapshot's controls before inserting.
create or replace function public.release_month(p_month date, p_version text, p_json text, p_sha text, p_cut_off date,
  p_totals jsonb, p_rule_version text, p_anomaly_days jsonb, p_po_share numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', p_month)::date; last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  today date := (now() at time zone 'Asia/Jakarta')::date;
  mo public.month_outlook%rowtype; snap jsonb; bad text; stale text; c48 text; open_reg text; lock_week int; vid uuid;
  is_strict boolean; v4 boolean; email text := public.current_email(); mand text[];
begin
  if not (select public.has_role('admin','finance')) then
    raise exception 'Versi bulanan dikunci oleh Admin atau Finance' using errcode = '42501';
  end if;
  if p_version not in ('V1','V2','FINAL') then raise exception 'Versi tidak dikenal: %', p_version; end if;
  if encode(sha256(convert_to(p_json, 'UTF8')), 'hex') <> p_sha then
    raise exception 'Snapshot berubah: SHA-256 tidak cocok' using errcode = '22000';
  end if;
  snap := p_json::jsonb;
  v4 := snap ? 'rule_version';
  is_strict := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v4_release'), false);
  select * into mo from public.month_outlook where month = m;
  if not found then
    insert into public.month_outlook (month, status) values (m, 'open') returning * into mo;
  end if;
  if exists (select 1 from public.month_outlook_version where month_outlook_id = mo.id and version = p_version) then
    raise exception '% sudah dikunci', p_version using errcode = '23505';
  end if;
  if p_version = 'V2' and not exists (select 1 from public.month_outlook_version where month_outlook_id = mo.id and version = 'V1') then
    raise exception 'Kunci V1 dulu' using errcode = 'P0001';
  end if;
  if p_version = 'FINAL' and today <= last then
    raise exception 'FINAL dikunci setelah akhir bulan (%)', last using errcode = 'P0001';
  end if;
  bad := null;
  if v4 and p_version = 'V1' then
    -- K9: V1 from the lock Thursday of the month (parameter v1_lock_week of the month's last week, default 3)
    select coalesce(p.v1_lock_week, 3) into lock_week from public.parameter p join public.week w on w.id = p.week_id
     where w.week_start <= last order by w.week_start desc limit 1;
    if today < public.nth_thursday(m, coalesce(lock_week, 3)) then
      bad := concat_ws('; ', bad, format('K9: V1 dikunci mulai %s', public.nth_thursday(m, coalesce(lock_week, 3))));
    end if;
    -- P10: every live engine assumption agreed, with owner and date
    select string_agg(r.code, ', ' order by r.code) into open_reg from public.assumption_register r
     where r.month_outlook_id = mo.id and r.deleted_at is null and r.status <> 'superseded' and r.version is null
       and (r.status <> 'agreed' or r.owner is null or r.agreed_at is null);
    if open_reg is not null then bad := concat_ws('; ', bad, 'P10 register belum disepakati: ' || open_reg); end if;
  end if;
  -- C48: an Aktual batch of the month without SKU output (no override)
  c48 := public.c48_batches(m, least(coalesce(p_cut_off, last), last));
  if c48 is not null and (v4 or p_version = 'FINAL') then bad := concat_ws('; ', bad, 'C48 GAGAL: batch tanpa output ' || c48); end if;
  -- STALE: the month's mart must be built after its last input
  stale := public.release_stale_dates(m, last);
  if stale is not null and (v4 or is_strict) then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  -- the snapshot's controls: mandatory per version (§7.1)
  mand := case p_version when 'V1' then array['C33','C34','C49'] when 'V2' then array['C32'] else array['C21','C22','C23','C24','C35','C36','C37','C48','C49'] end;
  bad := concat_ws('; ', bad, public.release_rejections(snap -> 'controls', mand, 'month', m::text || ':' || p_version, v4 or is_strict));
  if bad is not null and bad <> '' then
    raise exception 'Versi % ditolak: %', p_version, bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.month_outlook_version (month_outlook_id, version, cut_off_date, locked_by, snapshot, snapshot_sha256, revenue, cogs, gp, opex, nibt,
    rule_version, anomaly_days, po_share, approved_by)
  values (mo.id, p_version, p_cut_off, email, snap, p_sha, (p_totals ->> 'revenue')::numeric, (p_totals ->> 'cogs')::numeric, (p_totals ->> 'gp')::numeric,
    (p_totals ->> 'opex')::numeric, (p_totals ->> 'nibt')::numeric, p_rule_version, p_anomaly_days, p_po_share, email)
  returning id into vid;
  update public.month_outlook set status = case p_version when 'V1' then 'v1_locked' when 'V2' then 'v2' else 'final' end where id = mo.id;
  return vid;
end $$;
revoke all on function public.release_month(date, text, text, text, date, jsonb, text, jsonb, numeric) from public, anon;
grant execute on function public.release_month(date, text, text, text, date, jsonb, text, jsonb, numeric) to authenticated;

-- direct writes of a release or a version are gone: only the functions above insert them. The policies keep their
-- names with a check that never passes, so earlier migrations re-run without recreating the old ones.
drop policy if exists release_ins on public.release;
create policy release_ins on public.release for insert to authenticated with check (false);
drop policy if exists month_outlook_version_ins on public.month_outlook_version;
create policy month_outlook_version_ins on public.month_outlook_version for insert to authenticated with check (false);

-------------------------------------------------------------------------------- M1 own-RPA mode (§3.5) and C48 on posting
alter table public.overhead_rate add column if not exists rate_per_head numeric(18,4);

-- from 1 Nov 2026 the RPA is KGR's own: a new batch from that date takes the own cost mode unless set otherwise later
create or replace function public.tg_batch_cost_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.date >= date '2026-11-01' and new.cost_mode = 'maklon' then new.cost_mode := 'own'; end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'batch_cost_mode' and tgrelid = 'public.batch'::regclass) then
    create trigger batch_cost_mode before insert on public.batch for each row execute function public.tg_batch_cost_mode();
  end if;
end $$;

create or replace function public.tg_allocation_run_c48() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted')
     and not exists (select 1 from public.batch_output_sku o where o.batch_id = new.batch_id and o.deleted_at is null and o.kg > 0) then
    raise exception 'C48: batch tanpa output SKU tidak bisa diposting' using errcode = '23514';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'allocation_run_c48' and tgrelid = 'public.allocation_run'::regclass) then
    create trigger allocation_run_c48 before insert or update on public.allocation_run for each row execute function public.tg_allocation_run_c48();
  end if;
end $$;

-------------------------------------------------------------------------------- §3.5 DI-01 cost date vs invoice date
-- out_sale of an Accurate invoice line that replaced an Ops DO line: cost_ma = MA on the movement (invoice) date,
-- cost_ma_revenue = MA on the DO (revenue, K11) date. Both written by the ledger builder (mart, service role).
alter table public.lot_movement add column if not exists revenue_date date;
alter table public.lot_movement add column if not exists cost_ma_revenue numeric(18,2);
create index if not exists lot_movement_revenue_date on public.lot_movement (revenue_date) where revenue_date is not null;

-------------------------------------------------------------------------------- 7/10 20261020000100_v4_commercial.sql
-- v4 irisan 5 — M7 commercial (docs/PRD-v4.md §3.8, §6.7, K8, P3.9, §8 S5, journey B). Additive and re-runnable.
--
-- C38 in the database, not only in the form (S5). The guard of 20261017000200 checked an Order line before insert but
-- never used the approval up, so one approved discount could cover any number of lines sent straight to the API. From
-- here:
--   * the check runs after the row is written (floor_guard_v4) and links the covering approval to the line under a row
--     lock: one approval, one line, also for parallel requests;
--   * it covers every Order line, PO and spot alike (§7.1: C38 is for saving an order). Aktual lines (signed DOs from
--     Ops, invoices from Accurate) are delivery facts of an order that was checked when it was saved (Q74);
--   * an Order line under the floor without an approval cannot be allocated (journey B: "tidak bisa dialokasi sampai
--     approval sah"), e.g. a line entered while m7_approval was off;
--   * a spot sale (K8, P3.9): no PO number, today, before the cut-off time, parameter spot_enabled on, the key's
--     commercial status "jual hari ini" and at most its free fresh kg.
-- Everything stays inactive while the module flag m7_approval is off (C38) / spot_enabled is off (spot).

-------------------------------------------------------------------------------- helpers
-- Key of a sales line: key_manual, else the item map.
create or replace function public.sales_key(p_item_code text, p_key_manual text) returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(trim(coalesce(p_key_manual, '')), '') is not null then trim(p_key_manual)
              else (select m.key from public.item_map m where upper(trim(m.item_code)) = upper(trim(p_item_code)) and m.deleted_at is null limit 1) end;
$$;
revoke all on function public.sales_key(text, text) from public, anon;

-- Price floor of a key on a day: the latest commercial row within 14 days (lib/v3/discount.ts floors).
create or replace function public.floor_of(p_key text, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select c.price_floor from public.commercial_daily c
   where c.key = p_key and c.date <= p_date and c.date >= p_date - 14 and c.price_floor is not null
   order by c.date desc limit 1;
$$;
revoke all on function public.floor_of(text, date) from public, anon;

create or replace function public.m7_approval_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value ->> 'enabled')::boolean from public.app_setting s where s.key = 'm7_approval'), false);
$$;
revoke all on function public.m7_approval_on() from public, anon;

-- Take the approved discount that covers a line (already linked to it, else a free one), lock it, link it; null = none.
create or replace function public.take_approval(p_line uuid, p_key text, p_customer text, p_price numeric, p_kg numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid;
begin
  select a.id into aid from public.discount_approval a
   where a.status = 'approved' and a.key = p_key and coalesce(a.customer, '') = coalesce(p_customer, '')
     and a.requested_price <= p_price and a.kg >= p_kg and (a.sales_line_id = p_line or a.sales_line_id is null)
   order by (a.sales_line_id is not null) desc, a.decided_at, a.id
   limit 1 for update;
  if aid is not null then
    update public.discount_approval set sales_line_id = p_line where id = aid and sales_line_id is null;
  end if;
  return aid;
end $$;
revoke all on function public.take_approval(uuid, text, text, numeric, numeric) from public, anon, authenticated;

-------------------------------------------------------------------------------- C38 on sales lines
create or replace function public.tg_floor_guard_v4() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r text := public.app_role(); k text; fl numeric;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if r is null then return null; end if;                     -- server jobs and migrations
  if new.deleted_at is not null or new.price is null or new.kg is null then return null; end if;
  if coalesce(new.status, 'Order') <> 'Order' then return null; end if;
  if not public.m7_approval_on() then return null; end if;
  -- a change that does not touch the priced terms (fulfilled kg, demand status) is not checked again
  if tg_op = 'UPDATE' and old.deleted_at is null and new.price is not distinct from old.price and new.kg is not distinct from old.kg
     and new.item_code is not distinct from old.item_code and new.key_manual is not distinct from old.key_manual
     and new.customer is not distinct from old.customer and new.channel is not distinct from old.channel then
    return null;
  end if;
  k := public.sales_key(new.item_code, new.key_manual);
  if k is null then return null; end if;
  fl := public.floor_of(k, today);
  if fl is null or new.price >= fl then return null; end if;
  if public.take_approval(new.id, k, new.customer, new.price, new.kg) is null then
    raise exception 'C38: harga Rp % untuk % di bawah harga lantai Rp % tanpa approval diskon yang belum terpakai', round(new.price), k, round(fl)
      using errcode = '42501', hint = 'Ajukan approval diskon; satu approval untuk satu baris order.';
  end if;
  return null;
end $$;
revoke execute on function public.tg_floor_guard_v4() from public, anon, authenticated;

-------------------------------------------------------------------------------- C38 on allocation (journey B)
create or replace function public.tg_allocation_floor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.sales_line%rowtype; k text; fl numeric;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if public.app_role() is null or new.deleted_at is not null then return new; end if;
  if not public.m7_approval_on() then return new; end if;
  select * into l from public.sales_line where id = new.sales_line_id;
  if not found or coalesce(l.status, 'Order') <> 'Order' or l.price is null or l.kg is null then return new; end if;
  k := public.sales_key(l.item_code, l.key_manual);
  if k is null then return new; end if;
  fl := public.floor_of(k, today);
  if fl is null or l.price >= fl then return new; end if;
  if public.take_approval(l.id, k, l.customer, l.price, l.kg) is null then
    raise exception 'C38: order % di bawah harga lantai (Rp % < Rp %) belum disetujui; tidak bisa dialokasi', k, round(l.price), round(fl) using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_allocation_floor() from public, anon, authenticated;

-------------------------------------------------------------------------------- spot (K8, P3.9)
create or replace function public.tg_spot_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r text := public.app_role(); p public.parameter%rowtype; c public.commercial_daily%rowtype; k text;
  now_j timestamp := now() at time zone 'Asia/Jakarta';
begin
  -- a new spot sale is an Order line; its delivery (Aktual) and later changes were checked when the sale was made
  if r is null or new.channel is distinct from 'spot' or new.deleted_at is not null or coalesce(new.status, 'Order') <> 'Order' then return new; end if;
  if tg_op = 'UPDATE' and old.channel = 'spot' then return new; end if;
  if r not in ('admin','sales','commercial_lead') then
    raise exception 'Penjualan spot oleh Sales atau commercial lead' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(new.po_ref, '')), '') is not null then
    raise exception 'Penjualan spot tanpa nomor PO' using errcode = '23514';
  end if;
  select * into p from public.parameter where week_id = new.week_id;
  if not coalesce(p.spot_enabled, false) then
    raise exception 'Jalur spot belum diaktifkan untuk minggu ini (parameter spot_enabled)' using errcode = '42501';
  end if;
  if new.date is distinct from now_j::date then
    raise exception 'Penjualan spot hanya untuk hari ini (%)', now_j::date using errcode = '23514';
  end if;
  if now_j::time >= coalesce(p.cut_off_time, time '14:00') then
    raise exception 'Cut-off % sudah lewat: sisa fresh diblast, bukan dijual spot', coalesce(p.cut_off_time, time '14:00') using errcode = '23514';
  end if;
  k := public.sales_key(new.item_code, new.key_manual);
  select * into c from public.commercial_daily d where d.key = k and d.date between now_j::date - 1 and now_j::date order by d.date desc limit 1;
  if not found or c.urgency is distinct from 'jual_hari_ini' then
    raise exception 'SKU % tidak berstatus jual hari ini di Komersial', coalesce(k, new.item_code) using errcode = '23514';
  end if;
  if new.kg is null or new.kg <= 0 or new.kg > coalesce(c.free_fresh_kg, 0) then
    raise exception 'Spot % kg melebihi stok fresh bebas % kg', new.kg, coalesce(c.free_fresh_kg, 0) using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_spot_guard() from public, anon, authenticated;

-------------------------------------------------------------------------------- triggers
do $$
begin
  -- the before-insert guard of 20261017000200 is replaced by the after-row guard that also uses the approval up
  if exists (select 1 from pg_trigger where tgname = 'floor_guard' and tgrelid = 'public.sales_line'::regclass) then
    drop trigger floor_guard on public.sales_line;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'floor_guard_v4' and tgrelid = 'public.sales_line'::regclass) then
    create trigger floor_guard_v4 after insert or update on public.sales_line for each row execute function public.tg_floor_guard_v4();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'spot_guard' and tgrelid = 'public.sales_line'::regclass) then
    create trigger spot_guard before insert or update on public.sales_line for each row execute function public.tg_spot_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'allocation_floor' and tgrelid = 'public.allocation'::regclass) then
    create trigger allocation_floor before insert on public.allocation for each row execute function public.tg_allocation_floor();
  end if;
end $$;

-------------------------------------------------------------------------------- scorecard: kg spot (§3.8)
alter table public.sales_scorecard_weekly add column if not exists kg_spot numeric(12,2);


-------------------------------------------------------------------------------- 8/10 20261021000100_v5_foundation.sql
-- v5/0 — foundation (docs/PRD-v5.md §5, §5.3, Bab 8, §3.1). Additive and re-runnable.
--
-- Columns and tables of PRD v5 §5, empty; weight classes K, S, B seeded without numbers (PPIC fills them, O5); role
-- operations_director (§5.3); task registry seeded from the weekly calendar (§3.1); flags v5_* off. The only `drop`
-- statements are `drop constraint if exists` followed by the wider check (as v3/v4), the replacement of trigger
-- functions, and `drop not null` on weight_class.avg_kg so a class can exist before PPIC gives it an average.
-- Nothing here is read by the v1 engine.
--
-- Not added because the column already exists: lb_supply.price (lb_supply.price_per_kg, m3) and
-- parameter.shrink_target (parameter.target_shrink, v1). docs/v5/QUESTIONS.md Q-v5-1.

-------------------------------------------------------------------------------- role (§5.3)
do $$
begin
  alter table public.app_user drop constraint if exists app_user_role_check;
  alter table public.app_user add constraint app_user_role_check check (role in (
    'admin','inventory_accounting','sales','ppic','purchasing','finance','management','commercial_lead','cost_accounting','operations_director'));
end $$;

-------------------------------------------------------------------------------- flags (rule: default off)
insert into public.app_setting (key, value, note) values
  ('v5_costing',    '{"enabled": false}', 'PRD v5 irisan 1: costing rencana/estimasi/sementara/final, simulasi live bird'),
  ('v5_pl',         '{"enabled": false}', 'PRD v5 irisan 2: laba rugi dua tampilan, beban tetap, kumulatif lima ukuran'),
  ('v5_ppic_class', '{"enabled": false}', 'PRD v5 irisan 3: demand per ukuran → kelas → kg LB, layar PPIC v5'),
  ('v5_commercial', '{"enabled": false}', 'PRD v5 irisan 4: komitmen, price list mingguan, jawaban surplus, layar Commercial v5'),
  ('v5_input',      '{"enabled": false}', 'PRD v5 irisan 5: layar Input per role, upload tervalidasi, grid kelengkapan'),
  ('v5_management', '{"enabled": false}', 'PRD v5 irisan 6: layar Manajemen v5, Lihat sebagai')
on conflict (key) do nothing;

-------------------------------------------------------------------------------- columns (§5.1)
alter table public.item_map    add column if not exists size_kg numeric(4,2);
alter table public.sales_line  add column if not exists size_kg numeric(4,2);

alter table public.weight_class alter column avg_kg drop not null;
insert into public.weight_class (code, min_kg, max_kg, avg_kg, sort_order, note) values
  ('K', null, null, null, 2, 'Kelas kecil. Rentang dan rata-rata kg LB diisi PPIC (PRD v5 O5); angka di mockup hanya ilustrasi'),
  ('S', null, null, null, 3, 'Kelas sedang. Rentang dan rata-rata kg LB diisi PPIC (PRD v5 O5); angka di mockup hanya ilustrasi'),
  ('B', null, null, null, 4, 'Kelas besar. Rentang dan rata-rata kg LB diisi PPIC (PRD v5 O5); angka di mockup hanya ilustrasi')
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lot' and column_name = 'cost_status') then
    alter table public.lot add column cost_status text check (cost_status in ('rencana','estimasi','sementara','final'));
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sku_balance_daily' and column_name = 'cost_status') then
    alter table public.sku_balance_daily add column cost_status text check (cost_status in ('rencana','estimasi','sementara','final'));
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'batch' and column_name = 'invoice_status') then
    alter table public.batch add column invoice_status text not null default 'pending' check (invoice_status in ('pending','received','tied'));
  end if;
end $$;
alter table public.batch add column if not exists wp_due_at timestamptz;
alter table public.batch add column if not exists wp_received_at timestamptz;

do $$
begin
  alter table public.pl_daily_v4 drop constraint if exists pl_daily_v4_basis_check;
  alter table public.pl_daily_v4 add constraint pl_daily_v4_basis_check
    check (basis in ('journal','do_unbilled','po','runrate','fixed','variable','event','fixed_estimate'));
end $$;

alter table public.upload add column if not exists checks jsonb;
alter table public.upload add column if not exists ok_count integer;
alter table public.upload add column if not exists preview_fingerprint text;

alter table public.parameter add column if not exists commitment_lock_dow  integer not null default 5;
alter table public.parameter add column if not exists commitment_lock_time time    not null default '17:00';
alter table public.parameter add column if not exists wp_due_hours         integer not null default 24;
alter table public.parameter add column if not exists wp_due_time          time    not null default '12:00';
alter table public.parameter add column if not exists cost_anomaly_ratio   numeric(8,4) not null default 3;
alter table public.parameter add column if not exists yield_karkas_min     numeric(8,6) not null default 0.68;
alter table public.parameter add column if not exists yield_karkas_max     numeric(8,6) not null default 0.76;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'parameter' and column_name = 'revaluation_sold_mode') then
    -- O1: how the sold part of a final-vs-provisional cost difference is booked (usulan; default cogs_line)
    alter table public.parameter add column revaluation_sold_mode text not null default 'cogs_line'
      check (revaluation_sold_mode in ('cogs_line','restate_sale_date'));
  end if;
end $$;

-------------------------------------------------------------------------------- tables (§5.2)
-- K28: carcass size (kg per bird, "Uk 1.3" = 1,30) → LB weight class; filled by PPIC, empty here (O3, O5)
create table if not exists public.size_class_map (
  id             uuid primary key default gen_random_uuid(),
  size_kg        numeric(4,2) not null,
  weight_class   text not null references public.weight_class(code) on update cascade,
  effective_from date not null,
  effective_to   date,
  note           text,
  deleted_at     timestamptz,
  deleted_by     text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists size_class_map_active on public.size_class_map (size_kg, effective_from) where deleted_at is null;

-- K25: the LB price (and volume) the operations director decided for a cut date; history kept, latest decision wins
create table if not exists public.lb_price_decision (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  weight_class  text references public.weight_class(code) on update cascade,   -- null = every class (O2)
  price         numeric(18,4) not null check (price > 0),
  volume_kg_lb  numeric(12,2) check (volume_kg_lb is null or volume_kg_lb >= 0),
  decided_by    text,
  decided_at    timestamptz not null default now(),
  note          text,
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create index if not exists lb_price_decision_date on public.lb_price_decision (date, weight_class, decided_at desc);

-- K26: next week's commitment per SKU (and size); draft → locked (Friday 17.00, commercial lead) → superseded
create table if not exists public.sales_commitment (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null check (extract(isodow from week_start) = 1),
  version     integer not null default 1,
  key         text not null,
  size_kg     numeric(4,2),
  fresh_kg    numeric(12,2) not null default 0 check (fresh_kg >= 0),
  frozen_kg   numeric(12,2) not null default 0 check (frozen_kg >= 0),
  price       numeric(18,4) check (price is null or price > 0),
  status      text not null default 'draft' check (status in ('draft','locked','superseded')),
  sales_rep   text,
  locked_by   text,
  locked_at   timestamptz,
  reason      text,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index if not exists sales_commitment_locked on public.sales_commitment (week_start, key, coalesce(size_kg, 0)) where status = 'locked' and deleted_at is null;
create unique index if not exists sales_commitment_draft  on public.sales_commitment (week_start, key, coalesce(size_kg, 0)) where status = 'draft' and deleted_at is null;
alter table public.sales_line add column if not exists commitment_id uuid references public.sales_commitment(id) on delete restrict;

-- K24: the price list of a week, locked by the commercial lead; the next week's joint cost uses last week's locked list
create table if not exists public.price_list_week (
  week_start   date not null check (extract(isodow from week_start) = 1),
  key          text not null,
  price_fresh  numeric(18,4) check (price_fresh is null or price_fresh > 0),
  price_frozen numeric(18,4) check (price_frozen is null or price_frozen > 0),
  locked_by    text,
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (week_start, key)
);

-- K27: the saved weekly plan per weight class (pattern, kg LB, heads, fresh / frozen per SKU)
create table if not exists public.plan_week_class (
  id               uuid primary key default gen_random_uuid(),
  plan_week_id     uuid not null references public.plan_week(id) on delete restrict,
  weight_class     text not null references public.weight_class(code) on update cascade,
  cut_pattern      text,
  kg_lb            numeric(12,2),
  heads            integer,
  fresh_kg_by_key  jsonb not null default '{}'::jsonb,
  frozen_kg_by_key jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique (plan_week_id, weight_class)
);

-- §4.6: Commercial's answer to a surplus in PPIC's plan
create table if not exists public.surplus_response (
  id           uuid primary key default gen_random_uuid(),
  plan_week_id uuid not null references public.plan_week(id) on delete restrict,
  key          text not null,
  surplus_kg   numeric(12,2) not null,
  response     text not null check (response in ('absorb','reduce','partial')),
  absorb_kg    numeric(12,2) check (absorb_kg is null or absorb_kg >= 0),
  price        numeric(18,4) check (price is null or price > 0),
  responded_by text,
  responded_at timestamptz not null default now(),
  note         text,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create index if not exists surplus_response_plan on public.surplus_response (plan_week_id, key) where deleted_at is null;

-- K22 (mart): final vs provisional cost of a lot. lot_ref, not lot.id: the lot mart is rebuilt (Q-v5-2)
create table if not exists public.lot_revaluation (
  date         date not null,
  lot_ref      text not null,
  key          text,
  cost_from    numeric(18,4),
  cost_to      numeric(18,4),
  kg_remaining numeric(12,2),
  kg_sold      numeric(12,2),
  amount       numeric(18,2),
  amount_sold  numeric(18,2),
  status_from  text,
  status_to    text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (date, lot_ref)
);

-- §4.2 (mart): demand per ship date × carcass size → class → kg LB. size_code 'Uk 1.3' or 'tanpa' (no size)
create table if not exists public.demand_class_weekly (
  week_start   date not null,
  ship_date    date not null,
  size_code    text not null,
  size_kg      numeric(4,2),
  weight_class text not null,
  net_kg       numeric(12,2) not null default 0,
  kg_lb        numeric(12,2) not null default 0,
  heads        numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (week_start, ship_date, size_code)
);

-- §4.9: what has to be filled in, by whom, by when (seeded from §3.1)
create table if not exists public.input_task_rule (
  kind        text primary key,
  title       text not null,
  owner_role  text not null,
  due_rule    text not null,
  impact_text text not null,
  marts       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- §4.9 (mart): task instances made by the daily job; status computed from the data, never ticked by hand
create table if not exists public.input_task (
  due_date   date not null,
  rule_kind  text not null references public.input_task_rule(kind) on update cascade,
  ref        text not null,
  due_at     timestamptz,
  status     text not null check (status in ('open','waiting','received','passed','late')),
  done_at    timestamptz,
  upload_id  uuid,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (due_date, rule_kind, ref)
);

-- K35 (mart): input × date for the release
create table if not exists public.input_completeness_daily (
  date       date not null,
  kind       text not null,
  owner_role text not null,
  status     text not null check (status in ('passed','noted','late','not_due')),
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (date, kind)
);

insert into public.mart_table (name, scope_col, key_cols, note) values
  ('lot_revaluation',          'date',      '{date,lot_ref}',                  'v5 K22: revaluation when a lot cost becomes final'),
  ('demand_class_weekly',      'week_start','{week_start,ship_date,size_code}','v5 §4.2: demand per size → class → kg LB'),
  ('input_task',               'due_date',  '{due_date,rule_kind,ref}',        'v5 §4.9: task instances, status from the data'),
  ('input_completeness_daily', 'date',      '{date,kind}',                     'v5 K35: input × date for the release')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols, note = excluded.note;

-------------------------------------------------------------------------------- task registry seed (§3.1)
-- due_rule: <anchor> <+|-> <n> day(s) <HH:MM>, anchor ∈ week_start, cut_date, date, batch.date, month_start; 'event' = no
-- deadline (on receipt). Read by the engine (irisan 5). Release on Thursday (O10 default).
insert into public.input_task_rule (kind, title, owner_role, due_rule, impact_text, marts) values
  ('commitment_lock',   'Kunci komitmen minggu depan',            'commercial_lead',     'week_start - 3 days 17:00', 'Rencana Senin memakai PO saja; C52 merah', '["sales_commitment"]'),
  ('price_list_lock',   'Kunci price list minggu depan',          'commercial_lead',     'week_start - 3 days 17:00', 'Alokasi biaya bersama memakai price list terakhir yang terkunci', '["price_list_week"]'),
  ('plan_week',         'Rencana mingguan per kelas',             'ppic',                'week_start + 0 days 10:00', 'Batch harian tidak bisa disalin', '["plan_week","plan_week_class","demand_class_weekly"]'),
  ('lb_price_decision', 'Putuskan harga dan volume live bird',    'operations_director', 'cut_date - 1 day 12:00',    'Simulasi COGS memakai harga kemarin berlabel; C57', '["lb_price_decision"]'),
  ('lb_supply',         'Supply live bird per kelas',             'purchasing',          'cut_date - 1 day 12:00',    'Supply per kelas tidak diketahui; C58', '["lb_supply"]'),
  ('allocation',        'Alokasi FEFO, spot, cut-off',            'ppic',                'date + 0 days 14:00',       'Sisa fresh tidak ditawarkan spot sebelum blast', '["allocation","blast_event"]'),
  ('costing_wp',        'WP potong per batch',                    'cost_accounting',     'batch.date + 1 day 12:00',  'C53; biaya/kg di Commercial tetap estimasi', '["batch_output_sku","lot","sku_balance_daily"]'),
  ('supplier_invoice',  'Faktur pemasok, tie ke GL',              'cost_accounting',     'event',                     'Costing tetap sementara', '["cost_pool","lot_revaluation"]'),
  ('gl_daily',          'Jurnal Accurate harian',                 'inventory_accounting','date + 0 days 16:00',       'Actual P&L berhenti di hari terakhir lolos', '["gl_line","pl_daily_v4"]'),
  ('stock_daily',       'Stok dan kartu stok harian',             'inventory_accounting','date + 0 days 16:00',       'Rekon stok (C26) tertahan', '["stock_card_snapshot"]'),
  ('release_week',      'Rilis mingguan dengan grid kelengkapan', 'finance',             'week_start + 3 days 17:00', 'Rilis ditolak di server', '["release"]'),
  ('fixed_cost',        'Jadwal beban tetap bulan ini',           'finance',             'month_start + 0 days 17:00','P&L memakai estimasi bulan lalu; C55', '["fixed_cost_schedule","pl_daily_v4"]'),
  ('budget',            'Budget bulan ini',                       'finance',             'month_start + 0 days 17:00','Kartu "budget belum diisi"', '["budget"]')
on conflict (kind) do nothing;

-------------------------------------------------------------------------------- guards
-- K26: a commitment is drafted by Sales (assigned keys) or the commercial lead and locked by the commercial lead; a
-- locked row does not change; a new version after the lock needs a reason and supersedes the locked one when locked.
create or replace function public.tg_commitment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.app_role(); prev uuid;
begin
  if r is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Komitmen dibuat sebagai draft, lalu dikunci Kepala Sales' using errcode = '42501'; end if;
    if r = 'sales' and not exists (select 1 from public.sales_assignment a
        where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = new.key)) then
      raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
    end if;
    new.version := coalesce((select max(c.version) from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
                              and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0)), 0) + 1;
    if new.version > 1 and exists (select 1 from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
        and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0) and c.status = 'locked' and c.deleted_at is null)
       and length(trim(coalesce(new.reason, ''))) < 5 then
      raise exception 'Komitmen sudah dikunci: versi baru wajib alasan' using errcode = '23514';
    end if;
    new.locked_by := null; new.locked_at := null;
    return new;
  end if;
  -- UPDATE
  if pg_trigger_depth() > 1 and old.status = 'locked' and new.status = 'superseded' then return new; end if;   -- set by the lock below
  if old.status in ('locked','superseded') then
    raise exception 'Komitmen versi % sudah %; buat versi baru dengan alasan', old.version, old.status using errcode = '42501';
  end if;
  if new.status = 'locked' then
    if r not in ('commercial_lead','admin') then raise exception 'Komitmen dikunci oleh Kepala Sales' using errcode = '42501'; end if;
    new.locked_by := public.current_email(); new.locked_at := now();
    select c.id into prev from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
       and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0) and c.status = 'locked' and c.deleted_at is null and c.id <> new.id;
    if prev is not null then
      if length(trim(coalesce(new.reason, ''))) < 5 then raise exception 'Versi baru setelah kunci wajib alasan' using errcode = '23514'; end if;
      update public.sales_commitment set status = 'superseded' where id = prev;
    end if;
    return new;
  end if;
  if new.status = 'superseded' then raise exception 'Versi digeser hanya saat versi baru dikunci' using errcode = '42501'; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = new.key)) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  new.locked_by := null; new.locked_at := null;
  return new;
end $$;
revoke execute on function public.tg_commitment_guard() from public, anon, authenticated;

-- K24: a locked price list row does not change; only the commercial lead (or admin) locks
create or replace function public.tg_price_list_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if tg_op = 'UPDATE' and old.locked_at is not null then
    raise exception 'Price list minggu % untuk % sudah dikunci', old.week_start, old.key using errcode = '42501';
  end if;
  if new.locked_at is not null then
    if r not in ('commercial_lead','admin') then raise exception 'Price list dikunci oleh Kepala Sales' using errcode = '42501'; end if;
    new.locked_by := public.current_email();
  else
    new.locked_by := null;
  end if;
  return new;
end $$;

-- K25: the decider is the signed-in user; a decision is never edited (a new one is recorded instead)
create or replace function public.tg_lb_decision_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.app_role() is null then return new; end if;
  if tg_op = 'UPDATE' then raise exception 'Keputusan harga LB tidak diubah; catat keputusan baru' using errcode = '42501'; end if;
  new.decided_by := public.current_email(); new.decided_at := now();
  return new;
end $$;

-- §4.6: the responder is the signed-in user; Sales answer for their assigned keys only
create or replace function public.tg_surplus_response_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = new.key)) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.responded_by := public.current_email(); new.responded_at := now(); end if;
  return new;
end $$;

-------------------------------------------------------------------------------- triggers, RLS (Bab 8)
do $$
declare t text; marts text[] := array['lot_revaluation','demand_class_weekly','input_task','input_completeness_daily'];
begin
  foreach t in array array['size_class_map','lb_price_decision','sales_commitment','price_list_week','plan_week_class','surplus_response',
                           'lot_revaluation','demand_class_weekly','input_task_rule','input_task','input_completeness_daily'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_read', t,
        case t
          -- cost detail is not for sales (v4 M7, S4)
          when 'lot_revaluation' then '(select public.is_app_user()) and not (select public.has_role(''sales''))'
          when 'lb_price_decision' then '(select public.is_app_user()) and not (select public.has_role(''sales''))'
          -- K32: sales see the commitments of their assigned keys only
          when 'sales_commitment' then '(select public.is_app_user()) and (not (select public.has_role(''sales'')) or exists (select 1 from public.sales_assignment a where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = sales_commitment.key)))'
          else '(select public.is_app_user())' end);
    end if;
    if t = any (marts) then
      -- data marts: written by the server job through mart_replace only (S1)
      if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_no_client_ins') then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (false)', t || '_no_client_ins', t);
        execute format('create policy %I on public.%I as restrictive for update to authenticated using (false)', t || '_no_client_upd', t);
      end if;
      continue;
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(%s)))', t || '_ins', t,
        case t
          when 'size_class_map'    then '''admin'',''ppic'''
          when 'lb_price_decision' then '''admin'',''operations_director'''
          when 'sales_commitment'  then '''admin'',''sales'',''commercial_lead'''
          when 'price_list_week'   then '''admin'',''commercial_lead'''
          when 'plan_week_class'   then '''admin'',''ppic'''
          when 'surplus_response'  then '''admin'',''sales'',''commercial_lead'''
          when 'input_task_rule'   then '''admin'''
        end);
      if t <> 'lb_price_decision' then
        execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(%s))) with check ((select public.has_role(%s)))', t || '_upd', t,
          case t
            when 'size_class_map'    then '''admin'',''ppic'''
            when 'sales_commitment'  then '''admin'',''sales'',''commercial_lead'''
            when 'price_list_week'   then '''admin'',''commercial_lead'''
            when 'plan_week_class'   then '''admin'',''ppic'''
            when 'surplus_response'  then '''admin'',''sales'',''commercial_lead'''
            when 'input_task_rule'   then '''admin'''
          end,
          case t
            when 'size_class_map'    then '''admin'',''ppic'''
            when 'sales_commitment'  then '''admin'',''sales'',''commercial_lead'''
            when 'price_list_week'   then '''admin'',''commercial_lead'''
            when 'plan_week_class'   then '''admin'',''ppic'''
            when 'surplus_response'  then '''admin'',''sales'',''commercial_lead'''
            when 'input_task_rule'   then '''admin'''
          end);
      end if;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'commitment_guard' and tgrelid = 'public.sales_commitment'::regclass) then
    create trigger commitment_guard before insert or update on public.sales_commitment for each row execute function public.tg_commitment_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'price_list_guard' and tgrelid = 'public.price_list_week'::regclass) then
    create trigger price_list_guard before insert or update on public.price_list_week for each row execute function public.tg_price_list_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'lb_decision_stamp' and tgrelid = 'public.lb_price_decision'::regclass) then
    create trigger lb_decision_stamp before insert or update on public.lb_price_decision for each row execute function public.tg_lb_decision_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'surplus_response_guard' and tgrelid = 'public.surplus_response'::regclass) then
    create trigger surplus_response_guard before insert or update on public.surplus_response for each row execute function public.tg_surplus_response_guard();
  end if;

  -- a decision about the LB price changes the cost of the dates it covers: queue them (rebuild, S1)
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.lb_price_decision'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.lb_price_decision for each row execute function public.tg_needs_rebuild();
  end if;

  -- operations_director reads what management reads (§5.3): the cash tables of m6 name their readers
  foreach t in array array['bank_account','cash_daily','cash_daily_plan','cash_position_daily','ccc_daily','solvency_monthly'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read_opsdir') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.has_role(''operations_director'')))', t || '_read_opsdir', t);
    end if;
  end loop;
end $$;

create index if not exists sales_commitment_week on public.sales_commitment (week_start, key) where deleted_at is null;
create index if not exists plan_week_class_plan on public.plan_week_class (plan_week_id);
create index if not exists input_task_owner on public.input_task (rule_kind, status);

-------------------------------------------------------------------------------- 9/10 20261022000100_v5_costing.sql
-- v5/1 — costing (docs/PRD-v5.md §4.1, §4.6, K20–K25). Additive and re-runnable; read only while v5_costing is on.
--
-- The commercial mart carries the SKU's cost per kg from the costing engine, its status (rencana / estimasi /
-- sementara / final) and the C54 flag; the v5 sales view shows them (a cost per SKU, never per lot or batch, v4 M7).
-- lot_revaluation keeps the sold part per sale date for revaluation_sold_mode = restate_sale_date (O1).

alter table public.commercial_daily add column if not exists cost_per_kg numeric(18,4);
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily' and column_name = 'cost_status') then
    alter table public.commercial_daily add column cost_status text check (cost_status in ('rencana','estimasi','sementara','final'));
  end if;
end $$;
alter table public.commercial_daily add column if not exists cost_check boolean;

alter table public.lot_revaluation add column if not exists sold_by_date jsonb;

-- the sales view of v5: the columns of commercial_daily_sales (20261017000200, S2: no assignment, no rows) and the
-- three costing columns. A separate view, so the earlier migrations that replace commercial_daily_sales stay re-runnable.
create or replace view public.commercial_daily_sales_v5 with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff, c.cost_per_kg_ma,
         c.price_floor, c.price_list, c.margin_per_kg_list, c.realized_price_7d, c.margin_per_kg_realized, c.holding_loss_per_day,
         c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
         c.cost_per_kg, c.cost_status, c.cost_check
  from public.commercial_daily c
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and (a.key is null or a.key = c.key)));
revoke all on public.commercial_daily_sales_v5 from public, anon;
grant select on public.commercial_daily_sales_v5 to authenticated;

-- a WP upload stamps its batches (K21, C53): set when batch_output_sku rows arrive for a batch
create or replace function public.tg_wp_received() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null then
    update public.batch set wp_received_at = coalesce(wp_received_at, now()) where id = new.batch_id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_wp_received() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'wp_received' and tgrelid = 'public.batch_output_sku'::regclass) then
    create trigger wp_received after insert on public.batch_output_sku for each row execute function public.tg_wp_received();
  end if;
end $$;

-------------------------------------------------------------------------------- 10/10 20261023000100_v5_input.sql
-- v5/5 — Input, validated uploads, completeness grid (docs/PRD-v5.md §4.9, §6.4, K34, K35). Additive and re-runnable.
--
-- K35: a red cell of the completeness grid (input × date, mart input_completeness_daily) in the week being released
-- rejects release_week unless Finance recorded a K35 override for that week (reason and evidence, release_override).
-- The rule applies only while flag v5_input is on; off = release_week exactly as v4 (20261019000100).
-- The only `drop` is `drop constraint if exists` followed by the wider check of release_override_policy.code (the
-- v3/v4 pattern): K35 is not a control number. Nothing here is read by the v1 engine.

-------------------------------------------------------------------------------- completeness grid: due time of a cell
-- a cell built before its deadline says not_due; after the deadline it is red (read by the screen and release_week)
alter table public.input_completeness_daily add column if not exists due_at timestamptz;

-------------------------------------------------------------------------------- task registry: PO of Sales (mockup Input, Sales)
-- the PO lines of a ship date are due the day before the cut at 12.00, when PPIC buys LB per class (C50)
insert into public.input_task_rule (kind, title, owner_role, due_rule, impact_text, marts) values
  ('po_lines', 'PO kirim lusa dengan ukuran karkas', 'sales', 'cut_date - 1 day 12:00', 'Ukuran karkas menentukan kelas LB yang dibeli PPIC; tanpa ukuran dihitung STD (C50)', '["sales_line","demand_class_weekly"]')
on conflict (kind) do nothing;

-------------------------------------------------------------------------------- K35 override
do $$
begin
  alter table public.release_override_policy drop constraint if exists release_override_policy_code_check;
  alter table public.release_override_policy add constraint release_override_policy_code_check check (code ~ '^(C[0-9]{1,2}|K35)$');
end $$;
insert into public.release_override_policy (code, allowed_roles, note) values
  ('K35', array['finance'], 'PRD v5 K35: sel merah grid kelengkapan minggu itu; Finance dengan alasan dan bukti'),
  ('C53', array['finance'], 'PRD v5 C53: batch lewat tenggat WP tanpa WP; GP RPA dirilis dengan override Finance')
on conflict (code) do nothing;

-------------------------------------------------------------------------------- reminders (§6.4, journey P)
-- Finance reminds the owner of a red cell; the owner's Input screen shows it. Append-only: no update, no delete.
create table if not exists public.input_reminder (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  kind        text not null references public.input_task_rule(kind) on update cascade,
  owner_role  text not null,
  note        text,
  sent_by     text,
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists input_reminder_owner on public.input_reminder (owner_role, sent_at desc);
create index if not exists input_reminder_date on public.input_reminder (date, kind);

create or replace function public.tg_input_reminder_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.app_role() is null then return new; end if;
  new.sent_by := public.current_email(); new.sent_at := now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.input_reminder'::regclass) then
    create trigger stamp before insert or update on public.input_reminder for each row execute function public.tg_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.input_reminder'::regclass) then
    create trigger audit after insert or update or delete on public.input_reminder for each row execute function public.tg_audit();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'reminder_stamp' and tgrelid = 'public.input_reminder'::regclass) then
    create trigger reminder_stamp before insert on public.input_reminder for each row execute function public.tg_input_reminder_stamp();
  end if;
  alter table public.input_reminder enable row level security;
  if not exists (select 1 from pg_policies where tablename = 'input_reminder' and policyname = 'input_reminder_read') then
    create policy input_reminder_read on public.input_reminder for select to authenticated using ((select public.is_app_user()));
    create policy input_reminder_ins on public.input_reminder for insert to authenticated with check ((select public.has_role('admin','finance')));
  end if;
end $$;

-------------------------------------------------------------------------------- release_week (v4 §7.2 + K35)
create or replace function public.release_week(p_week_id uuid, p_json text, p_sha text, p_pdf_path text, p_ops jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.week%rowtype; snap jsonb; is_strict boolean; bad text; stale text; red text; rid uuid; email text := public.current_email();
begin
  if not (select public.has_role('admin','finance')) then
    raise exception 'Rilis mingguan hanya oleh Admin atau Finance' using errcode = '42501';
  end if;
  select * into w from public.week where id = p_week_id;
  if not found then raise exception 'Minggu tidak ada'; end if;
  if w.status = 'closed' then raise exception 'Minggu % sudah ditutup', w.week_start using errcode = '42501'; end if;
  if encode(sha256(convert_to(p_json, 'UTF8')), 'hex') <> p_sha then
    raise exception 'Snapshot berubah: SHA-256 tidak cocok' using errcode = '22000';
  end if;
  snap := p_json::jsonb;
  if snap -> 'controls' -> 'controls' is null then raise exception 'Snapshot tanpa kontrol' using errcode = '22000'; end if;
  is_strict := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v4_release'), false);
  bad := public.release_rejections(snap -> 'controls' -> 'controls', null, 'week', w.week_start::text, is_strict);
  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  end if;
  -- K35 (flag v5_input): red cells of the week (late, or not due when built and past the deadline now)
  if coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_input'), false) then
    select string_agg(c.kind || ' ' || to_char(c.date, 'DD/MM'), ', ' order by c.date, c.kind) into red
      from public.input_completeness_daily c
     where c.date between w.week_start and (w.week_start + 6)
       and (c.status = 'late' or (c.status = 'not_due' and c.due_at is not null and c.due_at <= now()));
    if red is not null and not exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                                          and o.code = 'K35' and o.deleted_at is null) then
      bad := concat_ws('; ', bad, 'K35 kelengkapan data merah: ' || red);
    end if;
  end if;
  if bad is not null then
    raise exception 'Rilis ditolak: %', bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.release (week_id, update_date, engine_version, snapshot, snapshot_sha256, pdf_path, control_status, controls, ops_rows, released_by)
  values (w.id, w.update_date, coalesce(snap ->> 'engineVersion', ''), snap, p_sha, p_pdf_path, coalesce(snap -> 'controls' ->> 'overall', ''), snap -> 'controls', coalesce(p_ops, '[]'::jsonb), email)
  returning id into rid;
  update public.week set status = 'released' where id = w.id and status = 'open';
  return rid;
end $$;
revoke all on function public.release_week(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.release_week(uuid, text, text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- cek: semua baris harus true
select m.no, m.cek, m.ada
from (values
  (1,  '20261017000100_v4_schema',      to_regclass('public.delivery') is not null),
  (2,  '20261017000200_v4_security',    to_regprocedure('public.tg_allocation_cap()') is not null),
  (3,  '20261017000300_v4_design_flag', to_regprocedure('public.tg_needs_rebuild_week()') is not null),
  (4,  '20261017000400_v4_cash_split',  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cash_position_daily' and column_name = 'closing_without_affiliate')),
  (5,  '20261018000100_v4_ppic',        to_regclass('public.plan_check_reason') is not null),
  (6,  '20261019000100_v4_release',     to_regclass('public.release_override_policy') is not null),
  (7,  '20261020000100_v4_commercial',  exists (select 1 from pg_proc where proname = 'floor_of' and pronamespace = 'public'::regnamespace)),
  (8,  '20261021000100_v5_foundation',  to_regclass('public.input_task_rule') is not null),
  (9,  '20261022000100_v5_costing',     to_regclass('public.commercial_daily_sales_v5') is not null),
  (10, '20261023000100_v5_input',       to_regclass('public.input_reminder') is not null),
  (11, 'input_task_rule berisi 14',     (select count(*) from public.input_task_rule) = 14)
) as m(no, cek, ada)
order by m.no;
