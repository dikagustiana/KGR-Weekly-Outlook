-- v3 F1 — M1 costing per batch → SKU (PRD v3 §4.1, §4.2). Additive and re-runnable.
-- The v1 engine keeps reading batch.out_*; the SKU detail lives in batch_output_sku.

-------------------------------------------------------------------------------- existing tables: new columns only
alter table public.batch add column if not exists cost_mode text not null default 'maklon';
alter table public.batch add column if not exists head_count integer;
alter table public.batch add column if not exists avg_lb_kg numeric(8,3);
alter table public.batch add column if not exists weight_class text;
alter table public.batch add column if not exists cut_pattern text;
alter table public.batch add column if not exists costing_status text not null default 'none';
alter table public.batch add column if not exists cost_pool_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'batch_cost_mode_check') then
    alter table public.batch add constraint batch_cost_mode_check check (cost_mode in ('maklon','own'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'batch_costing_status_check') then
    alter table public.batch add constraint batch_costing_status_check check (costing_status in ('none','uploaded','allocated','posted'));
  end if;
end $$;

alter table public.sku_key add column if not exists group_code text;
alter table public.sku_key add column if not exists cut_component text;
comment on column public.sku_key.group_code is 'Reporting group (Karkas 0,9 + 1,0 → KARKAS), PRD v3 §4.1';
comment on column public.sku_key.cut_component is 'Cut component in the yield matrix (karkas, dada, paha, …), PRD v3 §4.4';

alter table public.parameter add column if not exists by_product_method text not null default 'joint';
alter table public.parameter add column if not exists yield_gap_tolerance numeric(8,6) not null default 0.02;
alter table public.parameter add column if not exists avg_lb_kg_default numeric(8,3) not null default 2.0;
alter table public.parameter add column if not exists selling_cost_per_kg numeric(18,4) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parameter_by_product_method_check') then
    alter table public.parameter add constraint parameter_by_product_method_check check (by_product_method in ('joint','nrv'));
  end if;
end $$;

-------------------------------------------------------------------------------- new tables
create table if not exists public.cost_pool (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  mode         text not null default 'maklon' check (mode in ('maklon','own')),
  description  text,
  total_pi     numeric(18,2) not null default 0,
  total_gl     numeric(18,2),
  tie_out_diff numeric(18,2) generated always as (total_pi - total_gl) stored,
  status       text not null default 'open' check (status in ('open','tied','posted')),
  posted_at    timestamptz,
  posted_by    text,
  source       text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  document_ref text,
  upload_id    uuid references public.upload(id),
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  check (period_end >= period_start)
);

create table if not exists public.cost_pool_line (
  id           uuid primary key default gen_random_uuid(),
  cost_pool_id uuid not null references public.cost_pool(id) on delete restrict,
  component    text not null check (component in ('LB','freight','maklon','labour','overhead','blast','other')),
  date         date,
  supplier     text,
  account      text,
  document_ref text,
  amount       numeric(18,2) not null,
  batch_id     uuid references public.batch(id) on delete restrict,
  note         text,
  line_key     text,
  source       text not null default 'Accurate' check (source in ('Accurate','Ops','Manual')),
  upload_id    uuid references public.upload(id),
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- One row per batch × item (the WP prices Premium and Grade A of one key differently); key-level views are sums.
create table if not exists public.batch_output_sku (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.batch(id) on delete restrict,
  key              text references public.sku_key(key) on update cascade,
  item_code        text,
  item_name        text,
  kg               numeric(12,2) not null,
  pct_of_processed numeric(8,6),
  price_ref        numeric(18,4),
  source           text not null default 'WP' check (source in ('WP','manual')),
  note             text,
  upload_id        uuid references public.upload(id),
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique nulls not distinct (batch_id, key, item_code)
);

create table if not exists public.overhead_rate (
  id              uuid primary key default gen_random_uuid(),
  period_start    date not null,
  period_end      date not null,
  rate_per_kg_lb  numeric(18,4) not null,
  basis_kg        numeric(12,2),
  budget_overhead numeric(18,2),
  note            text,
  deleted_at      timestamptz,
  deleted_by      text,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  check (period_end >= period_start)
);

create table if not exists public.allocation_run (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid not null references public.batch(id) on delete restrict,
  method             text not null default 'relative_sales_value' check (method in ('relative_sales_value')),
  by_product_method  text not null default 'joint' check (by_product_method in ('joint','nrv')),
  mode               text not null default 'maklon' check (mode in ('maklon','own')),
  price_list_week_id uuid references public.week(id),
  overhead_rate_id   uuid references public.overhead_rate(id),
  run_at             timestamptz not null default now(),
  run_by             text,
  total_cost         numeric(18,2) not null,
  overhead_cost      numeric(18,2) not null default 0,
  total_allocated    numeric(18,2) not null,
  diff               numeric(18,2) generated always as (total_cost - total_allocated) stored,
  status             text not null default 'draft' check (status in ('draft','posted','superseded')),
  posted_at          timestamptz,
  posted_by          text,
  issues             jsonb not null default '[]'::jsonb,
  engine_version     text,
  created_at         timestamptz not null default now(),
  created_by         text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);

create table if not exists public.allocation_line (
  id                  uuid primary key default gen_random_uuid(),
  allocation_run_id   uuid not null references public.allocation_run(id) on delete restrict,
  batch_output_sku_id uuid references public.batch_output_sku(id),
  key                 text,
  item_code           text,
  kg                  numeric(12,2) not null,
  price_ref           numeric(18,4),
  sales_value         numeric(18,2) not null,
  share               numeric(12,8) not null,
  allocated_cost      numeric(18,2) not null,
  cost_per_kg         numeric(18,4) not null,
  by_product_method   text not null default 'joint' check (by_product_method in ('joint','nrv')),
  nrv_floor           numeric(18,4),
  nrv_writedown       numeric(18,2) not null default 0,
  created_at          timestamptz not null default now(),
  created_by          text,
  updated_at          timestamptz not null default now(),
  updated_by          text
);

create index if not exists cost_pool_period on public.cost_pool (period_start, period_end) where deleted_at is null;
create index if not exists cost_pool_line_pool on public.cost_pool_line (cost_pool_id) where deleted_at is null;
create index if not exists cost_pool_line_batch on public.cost_pool_line (batch_id) where deleted_at is null;
create index if not exists batch_output_sku_batch on public.batch_output_sku (batch_id) where deleted_at is null;
create index if not exists batch_output_sku_key on public.batch_output_sku (key);
create index if not exists allocation_run_batch on public.allocation_run (batch_id, run_at desc);
create index if not exists allocation_line_run_key on public.allocation_line (allocation_run_id, key);
create index if not exists batch_date_status on public.batch (date, status) where deleted_at is null;

-------------------------------------------------------------------------------- triggers + RLS
do $$
declare t text;
begin
  foreach t in array array['cost_pool','cost_pool_line','batch_output_sku','overhead_rate','allocation_run','allocation_line'] loop
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
declare t text;
begin
  -- Cost detail is finance detail: sales does not read cost pools, batch costs, overhead rates or allocations (PRD v3 §4.8, Q17).
  foreach t in array array['cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.is_app_user()) and not (select public.has_role(''sales'')))', t || '_read', t);
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(''admin'',''cost_accounting'')))', t || '_ins', t);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(''admin'',''cost_accounting''))) with check ((select public.has_role(''admin'',''cost_accounting'')))', t || '_upd', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'batch_output_sku' and policyname = 'batch_output_sku_read') then
    create policy batch_output_sku_read on public.batch_output_sku for select to authenticated using ((select public.is_app_user()));
    create policy batch_output_sku_ins on public.batch_output_sku for insert to authenticated with check ((select public.has_role('admin','cost_accounting','ppic')));
    create policy batch_output_sku_upd on public.batch_output_sku for update to authenticated
      using ((select public.has_role('admin','cost_accounting','ppic'))) with check ((select public.has_role('admin','cost_accounting','ppic')));
  end if;
  -- cost_accounting writes batches from the WP (PRD v3 §5 costing_wp → batch update)
  if not exists (select 1 from pg_policies where tablename = 'batch' and policyname = 'batch_ins_v3') then
    create policy batch_ins_v3 on public.batch for insert to authenticated
      with check ((select public.has_role('cost_accounting')) and public.week_writable(week_id));
    create policy batch_upd_v3 on public.batch for update to authenticated
      using ((select public.has_role('cost_accounting')) and public.week_writable(week_id))
      with check ((select public.has_role('cost_accounting')) and public.week_writable(week_id));
  end if;
end $$;
