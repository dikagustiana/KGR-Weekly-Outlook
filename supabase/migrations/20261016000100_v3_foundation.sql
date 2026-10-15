-- v3 F0 — foundation (docs/PLAN-v3.md Fase 0, docs/PRD-v3-kgr-platform.md §2, §4.9).
-- Additive and re-runnable: if not exists / on conflict do nothing / drop … if exists + add for constraints.
-- Nothing here is read by the v1 engine.

-------------------------------------------------------------------------------- roles (PRD §2): constraint only, no column change
do $$
begin
  alter table public.app_user drop constraint if exists app_user_role_check;
  alter table public.app_user add constraint app_user_role_check check (role in (
    'admin','inventory_accounting','sales','ppic','purchasing','finance','management','commercial_lead','cost_accounting'));
end $$;

-------------------------------------------------------------------------------- feature flags per module (PRD §4.9)
create table if not exists public.app_setting (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.app_setting is 'Feature flags and app-wide settings. Module flags: {"enabled": bool, "roles": [..] | absent = all roles}. Default off.';

insert into public.app_setting (key, value, note) values
  ('m1_costing',    '{"enabled": false}', 'M1 Costing per batch → SKU'),
  ('m2_ledger',     '{"enabled": false}', 'M2 Lot ledger + near-live SKU'),
  ('m3_planning',   '{"enabled": false}', 'M3 Demand → rencana → alokasi'),
  ('m4_monthly',    '{"enabled": false}', 'M4 Outlook bulanan'),
  ('m5_drivers',    '{"enabled": false}', 'M5 Biaya dengan driver'),
  ('m6_cash',       '{"enabled": false}', 'M6 Kas, CCC, solvabilitas'),
  ('m7_commercial', '{"enabled": false}', 'M7 Commercial view'),
  ('m7_approval',   '{"enabled": false}', 'M7 Approval diskon di bawah harga lantai + scorecard')
on conflict (key) do nothing;

-- true when the module flag is on and (no role list, or the caller's role is in it)
create or replace function public.module_enabled(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (s.value ->> 'enabled')::boolean
       and (not (s.value ? 'roles') or jsonb_typeof(s.value -> 'roles') <> 'array'
            or (s.value -> 'roles') ? coalesce(public.app_role(), ''))
    from public.app_setting s where s.key = p_key), false)
$$;
revoke all on function public.module_enabled(text) from public, anon;
grant execute on function public.module_enabled(text) to authenticated;

-------------------------------------------------------------------------------- rebuild queue (PRD §3: rebuildDay(date), no external cron)
create table if not exists public.rebuild_queue (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  reason       text,
  status       text not null default 'queued' check (status in ('queued','running','done','failed')),
  error        text,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create index if not exists rebuild_queue_status_date on public.rebuild_queue (status, date);

-- Attached to input tables by the module migrations: queue the row's date (once while queued).
create or replace function public.tg_needs_rebuild() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); d date;
begin
  d := coalesce(nullif(r ->> 'date', '')::date, nullif(r ->> 'origin_date', '')::date);
  if d is not null and not exists (select 1 from public.rebuild_queue q where q.date = d and q.status = 'queued') then
    insert into public.rebuild_queue (date, reason) values (d, tg_table_name || ' ' || lower(tg_op));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.tg_needs_rebuild() from public, anon, authenticated;

-------------------------------------------------------------------------------- data-fix log (F0 D1–D9)
create table if not exists public.data_fix (
  id          uuid primary key default gen_random_uuid(),
  fix_id      text not null check (fix_id ~ '^D[0-9]+$'),
  week_id     uuid references public.week(id) on delete restrict,
  scope       text not null default '',
  description text not null,
  amount      numeric(18,2),
  kg          numeric(12,2),
  account     text,
  status      text not null default 'open' check (status in ('open','applied','decided','info')),
  applied_by  text,
  applied_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique nulls not distinct (fix_id, week_id, scope)
);
create index if not exists data_fix_week on public.data_fix (week_id, fix_id);

-------------------------------------------------------------------------------- data mart registry + writer (PRD §3 "satu angka")
create table if not exists public.mart_table (
  name       text primary key,
  scope_col  text not null,
  key_cols   text[] not null,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.mart_table is 'Data mart tables written by rebuildDay through mart_replace (scope_col = the date / week the rebuild owns).';

-- Replace one scope (e.g. one date) of a registered mart table with the rows computed by the engine:
-- changed rows are updated, new rows inserted, rows of that scope that are no longer produced are deleted.
-- Unchanged rows are not touched (so the audit trigger only logs real changes).
create or replace function public.mart_replace(p_table text, p_scope text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.mart_table%rowtype;
  cols text; upd text; keys text; tcols text; ecols text;
  n_ins int := 0; n_del int := 0;
begin
  if not (select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance','commercial_lead','cost_accounting')) then
    raise exception 'mart_replace: peran % tidak membangun data mart', coalesce(public.app_role(), '-') using errcode = '42501';
  end if;
  select * into m from public.mart_table where name = p_table;
  if not found then raise exception 'mart_replace: % bukan tabel data mart', p_table; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'mart_replace: rows harus array'; end if;
  select string_agg(format('%I', k), ',') into keys from unnest(m.key_cols) k;
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
    'delete from public.%I t where t.%I::text = $2 and (%s) not in (select %s from jsonb_populate_recordset(null::public.%I, $1))',
    p_table, m.scope_col, (select string_agg(format('t.%I', k), ',') from unnest(m.key_cols) k), keys, p_table)
    using p_rows, p_scope;
  get diagnostics n_del = row_count;
  return jsonb_build_object('written', n_ins, 'deleted', n_del);
end $$;
revoke all on function public.mart_replace(text, text, jsonb) from public, anon;
grant execute on function public.mart_replace(text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- triggers + RLS on the new tables
do $$
declare t text;
begin
  foreach t in array array['app_setting','rebuild_queue','data_fix','mart_table'] loop
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
  -- read: every active app user
  if not exists (select 1 from pg_policies where tablename = 'app_setting' and policyname = 'app_setting_read') then
    create policy app_setting_read on public.app_setting for select to authenticated using ((select public.is_app_user()));
    create policy app_setting_ins on public.app_setting for insert to authenticated with check ((select public.has_role('admin')));
    create policy app_setting_upd on public.app_setting for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'rebuild_queue' and policyname = 'rebuild_queue_read') then
    create policy rebuild_queue_read on public.rebuild_queue for select to authenticated using ((select public.is_app_user()));
    create policy rebuild_queue_ins on public.rebuild_queue for insert to authenticated
      with check ((select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance','commercial_lead','cost_accounting')));
    create policy rebuild_queue_upd on public.rebuild_queue for update to authenticated
      using ((select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance','commercial_lead','cost_accounting')))
      with check ((select public.has_role('admin','inventory_accounting','sales','ppic','purchasing','finance','commercial_lead','cost_accounting')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'data_fix' and policyname = 'data_fix_read') then
    create policy data_fix_read on public.data_fix for select to authenticated using ((select public.is_app_user()));
    create policy data_fix_ins on public.data_fix for insert to authenticated with check ((select public.has_role('admin','finance','inventory_accounting')));
    create policy data_fix_upd on public.data_fix for update to authenticated
      using ((select public.has_role('admin','finance','inventory_accounting'))) with check ((select public.has_role('admin','finance','inventory_accounting')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mart_table' and policyname = 'mart_table_read') then
    create policy mart_table_read on public.mart_table for select to authenticated using ((select public.is_app_user()));
    create policy mart_table_ins on public.mart_table for insert to authenticated with check ((select public.has_role('admin')));
    create policy mart_table_upd on public.mart_table for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
end $$;

-------------------------------------------------------------------------------- new roles on existing tables (PRD §2)
-- commercial_lead may do everything sales may (orders, sell prices, uploads); cost_accounting uploads costing files.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'sales_line' and policyname = 'sales_line_ins_v3') then
    create policy sales_line_ins_v3 on public.sales_line for insert to authenticated
      with check ((select public.has_role('commercial_lead')) and public.week_writable(week_id));
    create policy sales_line_upd_v3 on public.sales_line for update to authenticated
      using ((select public.has_role('commercial_lead')) and public.week_writable(week_id))
      with check ((select public.has_role('commercial_lead')) and public.week_writable(week_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sku_price' and policyname = 'sku_price_ins_v3') then
    create policy sku_price_ins_v3 on public.sku_price for insert to authenticated
      with check ((select public.has_role('commercial_lead')) and public.week_writable(week_id));
    create policy sku_price_upd_v3 on public.sku_price for update to authenticated
      using ((select public.has_role('commercial_lead')) and public.week_writable(week_id))
      with check ((select public.has_role('commercial_lead')) and public.week_writable(week_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'upload' and policyname = 'upload_ins_v3') then
    create policy upload_ins_v3 on public.upload for insert to authenticated with check ((select public.has_role('commercial_lead','cost_accounting')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'week' and policyname = 'week_upd_v3') then
    -- tg_week_guard still limits non-admin roles to the update date
    create policy week_upd_v3 on public.week for update to authenticated
      using ((select public.has_role('commercial_lead','cost_accounting'))) with check ((select public.has_role('commercial_lead','cost_accounting')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'kgr_storage_upload_v3') then
    create policy kgr_storage_upload_v3 on storage.objects for insert to authenticated
      with check (bucket_id = 'uploads' and (select public.has_role('commercial_lead','cost_accounting')));
  end if;
end $$;

-- sku_price guard: commercial_lead is treated like sales (sell price only). Same body as 20261014000200 otherwise.
create or replace function public.tg_price_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r = 'admin' or r is null then return new; end if;
  if r in ('sales','commercial_lead') and tg_op = 'UPDATE' and new.replacement_buy_price is distinct from old.replacement_buy_price then
    raise exception 'Sales hanya boleh mengubah harga jual acuan' using errcode = '42501';
  end if;
  if r = 'purchasing' and tg_op = 'UPDATE' and new.ref_sell_price is distinct from old.ref_sell_price then
    raise exception 'Purchasing hanya boleh mengubah harga beli pengganti' using errcode = '42501';
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------- private backup bucket (written by .github/workflows/backup.yml with the service role)
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
