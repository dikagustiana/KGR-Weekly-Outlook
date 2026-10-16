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
