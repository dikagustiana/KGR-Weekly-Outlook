-- v3 F2 — M2 lot ledger + near-live SKU (PRD v3 §4.3, PLAN Fase 2). Additive and re-runnable.
-- The v1 engine keeps reading opening_stock / receipt_line / sales_line; the ledger runs in parallel (PRD §10 risk 1).

-------------------------------------------------------------------------------- existing tables: new columns only
alter table public.sku_key add column if not exists storage_cost_per_kg_day numeric(18,4);
alter table public.sku_key add column if not exists fresh_window_hours integer;
alter table public.sku_key add column if not exists frozen_age_limit_days integer;
alter table public.parameter add column if not exists blast_cost_per_kg numeric(18,4) not null default 0;
alter table public.parameter add column if not exists cut_off_time time not null default '14:00';
alter table public.parameter add column if not exists fresh_window_hours_default integer not null default 48;
alter table public.parameter add column if not exists frozen_age_limit_days_default integer not null default 30;

-------------------------------------------------------------------------------- data mart writer: never delete input rows kept in a mart table
alter table public.mart_table add column if not exists keep_col text;
alter table public.mart_table add column if not exists keep_values text[];
comment on column public.mart_table.keep_col is 'Rows whose keep_col is in keep_values are inputs (e.g. manual lot adjustments) and are never deleted by mart_replace';

create or replace function public.mart_replace(p_table text, p_scope text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.mart_table%rowtype;
  cols text; upd text; keys text; tcols text; ecols text; keep text := '';
  n_ins int := 0; n_del int := 0;
begin
  if not (select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance','commercial_lead','cost_accounting')) then
    raise exception 'mart_replace: peran % tidak membangun data mart', coalesce(public.app_role(), '-') using errcode = '42501';
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
  return jsonb_build_object('written', n_ins, 'deleted', n_del);
end $$;
revoke all on function public.mart_replace(text, text, jsonb) from public, anon;
grant execute on function public.mart_replace(text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- lots and movements (built by rebuildDay from the source rows)
create table if not exists public.lot (
  id             uuid primary key default gen_random_uuid(),
  lot_ref        text not null unique,             -- engine reference: opening:<row>, receipt:<row>, blast:<event>, deficit:<item>
  batch_id       uuid references public.batch(id),
  batch_ref      text,
  key            text not null,
  item_code      text,
  form           text not null check (form in ('fresh','frozen')),
  origin         text not null check (origin in ('batch','trading','opening','conversion')),
  origin_date    date not null,
  ledger_date    date not null,                    -- day the lot enters the ledger (opening lots: the opening date)
  parent_lot_ref text,
  kg_in          numeric(12,2) not null,
  cost_in        numeric(18,2) not null,
  cost_per_kg_si numeric(18,4) not null,
  cost_per_kg_book numeric(18,4),
  assumed        boolean not null default false,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

create table if not exists public.lot_movement (
  id            uuid primary key default gen_random_uuid(),
  movement_ref  text not null unique,              -- engine reference (stable): type:ref_table:ref_id:lot_ref
  lot_ref       text not null,
  date          date not null,
  time          time,
  type          text not null check (type in ('in','out_sale','out_blast','in_blast','adjust','transfer','writedown')),
  kg            numeric(12,2) not null,
  cost          numeric(18,2) not null default 0,  -- specific identification (signed)
  cost_ma       numeric(18,2),                     -- moving average (signed)
  ref_table     text not null,                     -- 'manual' = opname / correction entered by inventory accounting (input)
  ref_id        text,
  document_ref  text,
  sales_line_id uuid,
  key           text,
  item_code     text,
  assumed       boolean not null default false,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

-------------------------------------------------------------------------------- data mart (one scope = one date)
create table if not exists public.lot_balance_daily (
  date             date not null,
  lot_ref          text not null,
  key              text not null,
  form             text not null,
  kg               numeric(12,2) not null,
  cost_ma          numeric(18,2),
  cost_per_kg_ma   numeric(18,4),
  cost_si          numeric(18,2),
  cost_per_kg_si   numeric(18,4),
  age_days         integer,
  hours_to_cutoff  integer,
  reserved_kg      numeric(12,2) not null default 0,
  free_kg          numeric(12,2) not null default 0,
  over_age         boolean not null default false,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  primary key (date, lot_ref)
);

create table if not exists public.sku_balance_daily (
  date            date not null,
  key             text not null,
  group_code      text,
  form            text,
  kg              numeric(12,2) not null,
  free_kg         numeric(12,2) not null default 0,
  reserved_kg     numeric(12,2) not null default 0,
  cost_ma         numeric(18,2),
  cost_per_kg_ma  numeric(18,4),
  cost_si         numeric(18,2),
  cost_per_kg_si  numeric(18,4),
  oldest_age_days integer,
  over_age_kg     numeric(12,2) not null default 0,
  lots            integer not null default 0,
  projected       boolean not null default false,  -- date ≥ the outlook's update date: plans and orders included
  updated_at      timestamptz not null default now(),
  updated_by      text,
  primary key (date, key)
);

-------------------------------------------------------------------------------- inputs
create table if not exists public.stock_card_snapshot (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  item_code   text not null,
  item_name   text,
  kg          numeric(12,2) not null,
  value       numeric(18,2),
  source      text not null default 'Accurate' check (source in ('Accurate','Ops','Manual')),
  upload_id   uuid references public.upload(id),
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (date, item_code)
);

create table if not exists public.blast_event (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  time         time,
  lot_ref_from text not null,
  lot_ref_to   text,                               -- filled by the rebuild (blast:<id>)
  key_from     text,
  key_to       text,
  kg           numeric(12,2) not null check (kg > 0),
  reason       text not null default 'planned' check (reason in ('cutoff','planned','quality')),
  rp_downgrade numeric(18,2),
  approved_by  text,
  note         text,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create index if not exists lot_key on public.lot (key, origin_date);
create index if not exists lot_ledger_date on public.lot (ledger_date);
create index if not exists lot_movement_lot on public.lot_movement (lot_ref, date);
create index if not exists lot_movement_date on public.lot_movement (date);
create index if not exists lot_movement_key on public.lot_movement (key, date);
create index if not exists lot_balance_daily_key on public.lot_balance_daily (date, key);
create index if not exists sku_balance_daily_key on public.sku_balance_daily (key, date);
create index if not exists stock_card_snapshot_date on public.stock_card_snapshot (date) where deleted_at is null;
create index if not exists blast_event_date on public.blast_event (date) where deleted_at is null;

insert into public.mart_table (name, scope_col, key_cols, keep_col, keep_values, note) values
  ('lot', 'ledger_date', '{lot_ref}', null, null, 'M2 lots (derived)'),
  ('lot_movement', 'date', '{movement_ref}', 'ref_table', '{manual}', 'M2 movements; ref_table=manual rows are inputs'),
  ('lot_balance_daily', 'date', '{date,lot_ref}', null, null, 'M2 balance per lot per day'),
  ('sku_balance_daily', 'date', '{date,key}', null, null, 'M2 balance per SKU key per day')
on conflict (name) do update set scope_col = excluded.scope_col, key_cols = excluded.key_cols, keep_col = excluded.keep_col, keep_values = excluded.keep_values;

-------------------------------------------------------------------------------- triggers + RLS
do $$
declare t text;
begin
  foreach t in array array['lot','lot_movement','lot_balance_daily','sku_balance_daily','stock_card_snapshot','blast_event'] loop
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
begin
  -- lots carry the specific cost per lot (finance detail): not for sales (PRD v3 §4.8, Q17); sales reads SKU balances through M7
  if not exists (select 1 from pg_policies where tablename = 'lot' and policyname = 'lot_read') then
    create policy lot_read on public.lot for select to authenticated using ((select public.is_app_user()) and not (select public.has_role('sales')));
    create policy lot_ins on public.lot for insert to authenticated with check ((select public.has_role('admin')));
    create policy lot_upd on public.lot for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lot_movement' and policyname = 'lot_movement_read') then
    create policy lot_movement_read on public.lot_movement for select to authenticated using ((select public.is_app_user()) and not (select public.has_role('sales')));
    -- manual opname / corrections: admin + inventory_accounting (PRD v3 §2 lot_adjust)
    create policy lot_movement_ins on public.lot_movement for insert to authenticated
      with check ((select public.has_role('admin','inventory_accounting')) and ref_table = 'manual' and type in ('adjust','writedown','transfer'));
    create policy lot_movement_upd on public.lot_movement for update to authenticated
      using ((select public.has_role('admin','inventory_accounting')) and ref_table = 'manual')
      with check ((select public.has_role('admin','inventory_accounting')) and ref_table = 'manual');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lot_balance_daily' and policyname = 'lot_balance_daily_read') then
    create policy lot_balance_daily_read on public.lot_balance_daily for select to authenticated using ((select public.is_app_user()) and not (select public.has_role('sales')));
    create policy lot_balance_daily_ins on public.lot_balance_daily for insert to authenticated with check ((select public.has_role('admin')));
    create policy lot_balance_daily_upd on public.lot_balance_daily for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sku_balance_daily' and policyname = 'sku_balance_daily_read') then
    create policy sku_balance_daily_read on public.sku_balance_daily for select to authenticated using ((select public.is_app_user()));
    create policy sku_balance_daily_ins on public.sku_balance_daily for insert to authenticated with check ((select public.has_role('admin')));
    create policy sku_balance_daily_upd on public.sku_balance_daily for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'stock_card_snapshot' and policyname = 'stock_card_snapshot_read') then
    create policy stock_card_snapshot_read on public.stock_card_snapshot for select to authenticated using ((select public.is_app_user()));
    create policy stock_card_snapshot_ins on public.stock_card_snapshot for insert to authenticated with check ((select public.has_role('admin','inventory_accounting')));
    create policy stock_card_snapshot_upd on public.stock_card_snapshot for update to authenticated
      using ((select public.has_role('admin','inventory_accounting'))) with check ((select public.has_role('admin','inventory_accounting')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'blast_event' and policyname = 'blast_event_read') then
    create policy blast_event_read on public.blast_event for select to authenticated using ((select public.is_app_user()));
    create policy blast_event_ins on public.blast_event for insert to authenticated with check ((select public.has_role('admin','ppic')));
    create policy blast_event_upd on public.blast_event for update to authenticated using ((select public.has_role('admin','ppic'))) with check ((select public.has_role('admin','ppic')));
  end if;
end $$;

-------------------------------------------------------------------------------- needs_rebuild: queue the date of every changed source row
-- lot_movement: only manual (input) rows queue a rebuild; rows written by the rebuild itself do not.
create or replace function public.tg_needs_rebuild_manual() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); d date := nullif(r ->> 'date', '')::date;
begin
  if coalesce(r ->> 'ref_table', '') = 'manual' and d is not null
     and not exists (select 1 from public.rebuild_queue q where q.date = d and q.status = 'queued') then
    insert into public.rebuild_queue (date, reason) values (d, 'lot_movement manual ' || lower(tg_op));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.tg_needs_rebuild_manual() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['sales_line','receipt_line','batch','blast_event','stock_card_snapshot'] loop
    if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger needs_rebuild after insert or update or delete on public.%I for each row execute function public.tg_needs_rebuild()', t);
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.lot_movement'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.lot_movement
      for each row execute function public.tg_needs_rebuild_manual();
  end if;
end $$;
