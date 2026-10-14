-- KGR Weekly Outlook — schema (PRD §4). Every table mirrors a sheet of reference/KGR_Weekly_Outlook.xlsx.
-- Money numeric(18,2); rates (Rp/kg) numeric(18,4); kg numeric(12,2); dates are Asia/Jakarta calendar dates.
-- Nothing is hard-deleted: input rows carry deleted_at / deleted_by (soft delete); Admin can restore.

create extension if not exists pgcrypto with schema extensions;

-------------------------------------------------------------------------------- users and roles (PRD §2)
create table public.app_user (
  email       text primary key check (email = lower(email) and position('@' in email) > 1),
  full_name   text,
  role        text not null check (role in ('admin','inventory_accounting','sales','ppic','purchasing','finance','management')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
comment on table public.app_user is 'Allow-list of users and their role. Login is only possible for active e-mails listed here.';

create or replace function public.current_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select u.role from public.app_user u where u.email = public.current_email() and u.active
$$;

create or replace function public.is_app_user() returns boolean
language sql stable set search_path = '' as $$
  select public.app_role() is not null
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(public.app_role() = any(roles), false)
$$;

-------------------------------------------------------------------------------- weeks (Monday–Sunday)
create table public.week (
  id               uuid primary key default gen_random_uuid(),
  week_start       date not null unique check (extract(isodow from week_start) = 1),
  week_end         date generated always as (week_start + 6) stored,
  update_date      date not null,
  tb_opening_date  date not null,
  status           text not null default 'open' check (status in ('open','released','closed')),
  -- last week's summary for block 1 (I_Parameter C38:E39)
  lw_rpa_kg        numeric(12,2) not null default 0,
  lw_rpa_revenue   numeric(18,2) not null default 0,
  lw_rpa_gp        numeric(18,2) not null default 0,
  lw_trading_kg    numeric(12,2) not null default 0,
  lw_trading_revenue numeric(18,2) not null default 0,
  lw_trading_gp    numeric(18,2) not null default 0,
  lw_source        text,
  opening_stock_flag text,           -- 'carried' while the opening stock is carried from last week's projection
  note             text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  check (update_date between week_start and week_start + 7)
);

-------------------------------------------------------------------------------- parameters (I_Parameter), one row per week
create table public.parameter (
  week_id                   uuid primary key references public.week(id) on delete restrict,
  horizon_fresh_days        integer not null default 3 check (horizon_fresh_days between 1 and 7),
  target_shrink             numeric(8,6) not null default 0.03,
  freight_plan_per_kg_lb    numeric(18,4) not null default 1000,
  maklon_per_kg_processed   numeric(18,4) not null default 1600,
  lb_price_today            numeric(18,4) not null default 0,
  min_trading_spread        numeric(18,4) not null default 2000,
  stock_age_limit_days      integer not null default 30,
  terms_lb_days             integer not null default 7,
  terms_trading_days        integer not null default 14,
  terms_freight_maklon_days integer not null default 30,
  yield_karkas              numeric(8,6) not null default 0.7367,
  yield_kepala              numeric(8,6) not null default 0.0467,
  yield_ceker               numeric(8,6) not null default 0.0294,
  yield_usus                numeric(8,6) not null default 0.0436,
  yield_hja                 numeric(8,6) not null default 0.0560,
  yield_lemak               numeric(8,6) not null default 0.0034,
  accurate_sales_kg         numeric(12,2),
  accurate_opening_stock_value numeric(18,2),
  placeholder_note          text,
  updated_at                timestamptz not null default now(),
  updated_by                text
);

-------------------------------------------------------------------------------- master data
create table public.sku_key (               -- I_Master (key and decision group)
  key            text primary key,
  segment        text not null check (segment in ('RPA','Trading')),
  sku            text not null,
  form           text not null,
  decision_group text not null,
  sort_order     integer not null default 0,
  note           text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  check (key = segment || '|' || sku || '|' || form)
);

create table public.sku_price (             -- I_Master F:G per week (reference sell price, replacement buy price)
  week_id               uuid not null references public.week(id) on delete restrict,
  key                   text not null references public.sku_key(key) on update cascade,
  ref_sell_price        numeric(18,4),
  replacement_buy_price numeric(18,4),
  note                  text,
  updated_at            timestamptz not null default now(),
  updated_by            text,
  primary key (week_id, key)
);

create table public.item_map (              -- I_Item
  item_code   text primary key,
  item_name   text,
  key         text not null references public.sku_key(key) on update cascade,
  suggested   boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table public.coa_map (               -- I_COA
  account                text primary key,
  name                   text not null,
  type                   text not null check (type in ('LabaRugi','Neraca','Header')),
  pl_line                text,
  bs_line                text,
  cf_category_as_counter text,
  is_cash                boolean not null default false,
  fs_mapping_reference   text,
  deleted_at             timestamptz,
  deleted_by             text,
  created_at             timestamptz not null default now(),
  created_by             text,
  updated_at             timestamptz not null default now(),
  updated_by             text
);

-------------------------------------------------------------------------------- uploads (staging + log)
create table public.upload (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid references public.week(id) on delete restrict,
  kind         text not null,
  file_name    text not null,
  file_sha256  text not null,
  file_path    text,
  status       text not null default 'staged' check (status in ('staged','committed','discarded','failed')),
  date_from    date,
  date_to      date,
  row_count    integer not null default 0,
  inserted     integer not null default 0,
  updated      integer not null default 0,
  deleted      integer not null default 0,
  unchanged    integer not null default 0,
  issues       jsonb not null default '[]'::jsonb,
  message      text,
  uploaded_by  text,
  uploaded_at  timestamptz not null default now(),
  committed_at timestamptz
);

create table public.upload_row (
  upload_id uuid not null references public.upload(id) on delete cascade,
  row_no    integer not null,
  target    text not null,
  data      jsonb not null,
  issues    jsonb not null default '[]'::jsonb,
  primary key (upload_id, row_no)
);

-------------------------------------------------------------------------------- input rows (common provenance columns)
-- source: Accurate / Ops / Manual; document_ref: invoice, SJ, PO, GRN or voucher; confirmed_by: who signed off an Ops row.
-- superseded_at/by: an Ops row replaced by the Accurate posting of the same document (kept for control 20).

create table public.opening_stock (         -- I_Stok_Awal
  id                uuid primary key default gen_random_uuid(),
  week_id           uuid not null references public.week(id) on delete restrict,
  seq               integer not null default 0,
  item_code         text,
  item_name         text,
  key_manual        text,                    -- only for rows carried from last week's projection (per key)
  kg                numeric(12,2),
  value             numeric(18,2),
  avg_age_days      numeric(10,2),
  kg_over_age_limit numeric(12,2),
  note              text,
  source            text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  document_ref      text,
  confirmed_by      text,
  upload_id         uuid references public.upload(id),
  superseded_at     timestamptz,
  superseded_by     uuid,
  deleted_at        timestamptz,
  deleted_by        text,
  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create table public.sales_line (            -- T_Penjualan
  id            uuid primary key default gen_random_uuid(),
  week_id       uuid not null references public.week(id) on delete restrict,
  seq           integer not null default 0,
  date          date,
  status        text check (status in ('Aktual','Order')),
  document_ref  text,
  customer      text,
  item_code     text,
  key_manual    text,
  kg            numeric(12,2),
  price         numeric(18,4),
  hpp_actual    numeric(18,2),
  source        text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  confirmed_by  text,
  line_key      text,                         -- natural key within an upload (document|item|n) for idempotent re-uploads
  upload_id     uuid references public.upload(id),
  superseded_at timestamptz,
  superseded_by uuid,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create table public.receipt_line (          -- T_Penerimaan
  id             uuid primary key default gen_random_uuid(),
  week_id        uuid not null references public.week(id) on delete restrict,
  seq            integer not null default 0,
  date           date,
  status         text check (status in ('Aktual','Rencana')),
  receipt_source text check (receipt_source in ('Produksi RPA','Beli Trading')),
  document_ref   text,
  supplier       text,
  item_code      text,
  key_manual     text,
  kg             numeric(12,2),
  unit_cost      numeric(18,4),
  source         text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  confirmed_by   text,
  line_key       text,
  upload_id      uuid references public.upload(id),
  superseded_at  timestamptz,
  superseded_by  uuid,
  deleted_at     timestamptz,
  deleted_by     text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

create table public.batch (                 -- T_Batch
  id                uuid primary key default gen_random_uuid(),
  week_id           uuid not null references public.week(id) on delete restrict,
  seq               integer not null default 0,
  date              date,
  status            text check (status in ('Aktual','Rencana')),
  batch_ref         text,
  supplier          text,
  lb_kg             numeric(12,2),
  lb_price          numeric(18,4),
  freight           numeric(18,2),
  maklon            numeric(18,2),
  processed_kg      numeric(12,2),
  out_karkas_fresh  numeric(12,2),
  out_karkas_frozen numeric(12,2),
  out_kepala        numeric(12,2),
  out_ceker         numeric(12,2),
  out_usus          numeric(12,2),
  out_hja           numeric(12,2),
  out_lemak         numeric(12,2),
  out_other         numeric(12,2),
  source            text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  document_ref      text,
  confirmed_by      text,
  upload_id         uuid references public.upload(id),
  superseded_at     timestamptz,
  superseded_by     uuid,
  deleted_at        timestamptz,
  deleted_by        text,
  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create table public.gl_line (               -- T_GL (journal lines after the TB date; selected by date, not by week)
  id            uuid primary key default gen_random_uuid(),
  seq           integer not null default 0,
  date          date,
  voucher_no    text,
  voucher_type  text,
  account       text,
  account_name  text,
  description   text,
  debit         numeric(18,2),
  credit        numeric(18,2),
  party         text,
  cf_override   text,
  line_key      text,
  source        text not null default 'Accurate' check (source in ('Accurate','Ops','Manual')),
  upload_id     uuid references public.upload(id),
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create table public.tb_opening (            -- I_TB
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references public.week(id) on delete restrict,
  seq         integer not null default 0,
  account     text not null,
  name        text,
  balance     numeric(18,2),
  source      text not null default 'Accurate' check (source in ('Accurate','Ops','Manual')),
  upload_id   uuid references public.upload(id),
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table public.runrate (               -- I_RunRate
  id              uuid primary key default gen_random_uuid(),
  week_id         uuid not null references public.week(id) on delete restrict,
  pl_line         text not null,
  monthly_amount  numeric(18,2) not null default 0,
  week_adjustment numeric(18,2) not null default 0,
  basis           text,
  seq             integer not null default 0,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  unique (week_id, pl_line)
);

create table public.cash_plan (             -- T_Kas_Rencana
  id              uuid primary key default gen_random_uuid(),
  week_id         uuid not null references public.week(id) on delete restrict,
  seq             integer not null default 0,
  date            date,
  cf_category     text,
  bs_counter_line text,
  description     text,
  amount          numeric(18,2),
  source          text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  document_ref    text,
  confirmed_by    text,
  upload_id       uuid references public.upload(id),
  deleted_at      timestamptz,
  deleted_by      text,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-------------------------------------------------------------------------------- releases and audit
create table public.release (
  id              uuid primary key default gen_random_uuid(),
  week_id         uuid not null references public.week(id) on delete restrict,
  update_date     date not null,
  engine_version  text not null,
  snapshot        jsonb not null,
  snapshot_sha256 text not null,
  pdf_path        text,
  control_status  text not null,
  controls        jsonb not null,
  ops_rows        jsonb not null default '[]'::jsonb,
  released_by     text not null,
  released_at     timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text,
  week_id    uuid,
  op         text not null,
  changes    jsonb,
  actor      text,
  at         timestamptz not null default now()
);

-------------------------------------------------------------------------------- indexes
create index on public.sales_line (week_id) where deleted_at is null;
create index on public.sales_line (week_id, document_ref);
create index on public.receipt_line (week_id) where deleted_at is null;
create index on public.receipt_line (week_id, document_ref);
create index on public.batch (week_id) where deleted_at is null;
create index on public.opening_stock (week_id) where deleted_at is null;
create index on public.gl_line (date) where deleted_at is null;
create index on public.gl_line (voucher_no);
create index on public.tb_opening (week_id) where deleted_at is null;
create index on public.cash_plan (week_id) where deleted_at is null;
create index on public.release (week_id, released_at desc);
create index on public.audit_log (table_name, row_id);
create index on public.audit_log (at desc);
create index on public.upload (week_id, uploaded_at desc);
create index on public.item_map (key);
