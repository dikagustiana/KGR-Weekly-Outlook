-- v3 F4b — M4 monthly outlook (PRD v3 §4.1 week / parameter, §4.5, PLAN Fase 4 PR 4b). Additive and re-runnable.

alter table public.parameter add column if not exists v1_lock_day integer not null default 20;
alter table public.parameter add column if not exists forecast_tolerance_pct numeric(8,6) not null default 0.10;

create table if not exists public.month_outlook (
  id             uuid primary key default gen_random_uuid(),
  month          date not null unique check (extract(day from month) = 1),
  cut_off_date   date,
  status         text not null default 'open' check (status in ('open','v1_locked','v2','final')),
  budget_revenue numeric(18,2),
  budget_gp      numeric(18,2),
  budget_nibt    numeric(18,2),
  note           text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

alter table public.week add column if not exists month_outlook_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'week_month_outlook_fk' and conrelid = 'public.week'::regclass) then
    alter table public.week add constraint week_month_outlook_fk foreign key (month_outlook_id) references public.month_outlook(id);
  end if;
end $$;

create table if not exists public.month_outlook_version (
  id               uuid primary key default gen_random_uuid(),
  month_outlook_id uuid not null references public.month_outlook(id) on delete restrict,
  version          text not null check (version in ('V1','V2','FINAL')),
  cut_off_date     date,
  locked_at        timestamptz not null default now(),
  locked_by        text,
  snapshot         jsonb not null,
  snapshot_sha256  text not null,
  revenue          numeric(18,2),
  cogs             numeric(18,2),
  gp               numeric(18,2),
  opex             numeric(18,2),
  nibt             numeric(18,2),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique (month_outlook_id, version)
);

create table if not exists public.outlook_assumption (
  id               uuid primary key default gen_random_uuid(),
  month_outlook_id uuid not null references public.month_outlook(id) on delete restrict,
  version          text,
  code             text not null,
  description      text,
  value_text       text,
  value_num        numeric(18,6),
  source           text not null default 'manual',     -- manual | engine | kalibrasi
  owner            text,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text
);

create table if not exists public.closing_adjustment (
  id               uuid primary key default gen_random_uuid(),
  month_outlook_id uuid not null references public.month_outlook(id) on delete restrict,
  code             text not null,                      -- DI-01 …
  description      text not null,
  pl_line          text not null,
  amount           numeric(18,2) not null,             -- P&L sign: + income / − cost
  kind             text not null default 'other' check (kind in ('unbilled_revaluation','parked_cost','inventory_adj','accrual','other')),
  gl_voucher       text,
  posted           boolean not null default false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text
);

-- data mart: one scope = one date (PRD v3 §3)
create table if not exists public.pl_daily (
  date       date not null,
  pl_line    text not null,
  basis      text not null check (basis in ('journal','do_unbilled','po','runrate','fixed','variable')),
  actual     numeric(18,2),
  forecast   numeric(18,2),
  anomaly    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (date, pl_line, basis)
);

create table if not exists public.outlook_accuracy (
  month_outlook_id uuid not null references public.month_outlook(id) on delete restrict,
  version          text not null,
  metric           text not null check (metric in ('MAPE','bias','abs_err','MAPE_pre','bias_pre')),
  scope            text not null check (scope in ('revenue','gp','nibt')),
  value            numeric(18,6),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  primary key (month_outlook_id, version, metric, scope)
);

create index if not exists month_outlook_version_month on public.month_outlook_version (month_outlook_id, version);
create index if not exists outlook_assumption_month on public.outlook_assumption (month_outlook_id, code) where deleted_at is null;
create index if not exists closing_adjustment_month on public.closing_adjustment (month_outlook_id) where deleted_at is null;
create index if not exists pl_daily_line on public.pl_daily (pl_line, date);
create index if not exists gl_line_date on public.gl_line (date) where deleted_at is null;

insert into public.mart_table (name, scope_col, key_cols, keep_col, keep_values, note) values
  ('pl_daily', 'date', '{date,pl_line,basis}', null, null, 'M4 P&L per day: actual (journal, unbilled DO) and forecast (PO, run-rate)')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols;

do $$
declare t text; w text;
begin
  foreach t in array array['month_outlook','month_outlook_version','outlook_assumption','closing_adjustment','pl_daily','outlook_accuracy'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    -- the monthly outlook is read by every role (PRD v3 §6 /m/[month] "semua"); written by admin / finance
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.is_app_user()))', t || '_read', t);
    end if;
    w := case when t = 'pl_daily' then '''admin''' else '''admin'',''finance''' end;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(%s)))', t || '_ins', t, w);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(%s))) with check ((select public.has_role(%s)))', t || '_upd', t, w, w);
    end if;
  end loop;
end $$;

-- a locked version is immutable (its snapshot and SHA are the record)
create or replace function public.tg_version_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['note','updated_at','updated_by']) is distinct from (to_jsonb(old) - array['note','updated_at','updated_by']) then
    raise exception 'Versi outlook yang sudah dikunci tidak bisa diubah' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'version_immutable' and tgrelid = 'public.month_outlook_version'::regclass) then
    create trigger version_immutable before update on public.month_outlook_version for each row execute function public.tg_version_immutable();
  end if;
end $$;

-- journal changes queue their date (gl_line had no needs_rebuild trigger before M4)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.gl_line'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.gl_line for each row execute function public.tg_needs_rebuild();
  end if;
end $$;

-- closing notes of September 2026 from the FS (DI-01 … DI-05, PRD v3 §1): recorded, not posted
insert into public.month_outlook (month, status, note) values ('2026-09-01', 'open', 'dibuat oleh migrasi M4 untuk penyesuaian tutup buku DI-01 … DI-05 (FS Sep 2026)')
on conflict (month) do nothing;
insert into public.closing_adjustment (month_outlook_id, code, description, pl_line, amount, kind, posted)
select m.id, v.code, v.description, v.pl_line, v.amount, v.kind, false
from public.month_outlook m,
     (values
       ('DI-01', 'Revaluasi COGS unbilled (MA inventory berubah, invoice Agu → Sep)', 'COGS - Live Bird', 48354462.00, 'unbilled_revaluation'),
       ('DI-02', 'Biaya RPA September terparkir (perbaikan mesin 38,8 jt, boots 9,28 jt)', 'COGS - Live Bird', -48084680.00, 'parked_cost'),
       ('DI-03', 'Jasa transport LB 3 batch potong AGRO masih di P&L', 'Other COGS - Expedition', -12000000.00, 'parked_cost'),
       ('DI-04', 'Sewa ABF NMG (cost baru September)', 'Storage Expenses', -62450000.00, 'accrual'),
       ('DI-04', 'Inventory adjustment September', 'COGS - Live Bird', -69661617.00, 'inventory_adj'),
       ('DI-05', 'Inv 311 seharusnya masuk Agustus (sales live bird 20.989.500, COGS 23.123.922)', 'Revenue - LB Main Product', 20989500.00, 'other')
     ) as v(code, description, pl_line, amount, kind)
where m.month = '2026-09-01'
  and not exists (select 1 from public.closing_adjustment c where c.month_outlook_id = m.id and c.code = v.code and c.description = v.description);
