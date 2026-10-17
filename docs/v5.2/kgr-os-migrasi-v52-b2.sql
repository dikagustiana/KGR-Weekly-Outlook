-- KGR-OS: 3 migrasi v5.2 B2 sekaligus (meta, security, release), untuk SQL Editor Supabase (satu kali Run).
-- Dijalankan MANUSIA setelah sign-off dan setelah lulus di staging (PRD v5.2-B K66, K67; Q-v5.2-4). BELUM dijalankan di KGR-OS.
--
-- Urutan wajib: backup (B0-1) -> bundel v5.1 (docs/v5.1/kgr-os-migrasi-v51.sql, tabel cek 12 baris true) -> bundel ini.
-- Bundel ini menolak jalan bila v5.1 belum terpasang (cek prasyarat di bawah).
--
-- Isi: file supabase/migrations/20261025000100 s.d. 20261025000300, disambung urut nama, isi tiap file tidak diubah.
-- Tambahan di luar file migrasi hanya empat: cek prasyarat di awal, pengisian bundle_sha256 di registry, notify pgrst,
-- dan tabel cek di akhir. SQL Editor menjalankan semuanya dalam satu transaksi: error di mana pun membatalkan semuanya.
-- Semua file bisa dijalankan ulang (bukti: docs/v5.2/bukti/b2-bundel.txt, docs/v5.2/bukti/b2-migrasi-rerun.txt).
-- Hasil yang benar: tabel cek 24 baris, kolom ada semuanya true; select public.schema_version() = 5.2.2.
-- Tidak ada flag yang dinyalakan, tidak ada data aplikasi yang diubah. Satu-satunya data: baris schema_registry
-- (5.1.0 bila lock_commitments ada, 5.2.0, 5.2.1, 5.2.2) dan baris kebijakan override C55 (Finance).
--
-- Yang berubah bagi pengguna (ringkas; rinci di docs/v5.2/b2.md):
--   * week.update_date hanya berubah di minggu open, oleh Admin/Finance atau lewat advance_update_date (K69).
--   * Sales tidak membaca plan_week_class, demand_class_weekly, jawaban surplus key lain; kolom biaya view Sales
--     kosong bila sales_sees_cost=false atau parameter minggu tidak ada (A-REL-2/3, B-REL-4).
--   * assignment Sales "RPA|Karkas|Fresh" hanya mencakup SKU itu; "RPA|Karkas" mencakup semua bentuknya (O21b).
--   * release_week menghitung C53 dan grid K35 per hari di DB; release_month V1 ditahan C55 (K68, O22b, O28b, O32b).
--   * lock_commitments menolak minggu yang sudah berjalan (kecuali Admin) dan harga berbeda antar ukuran (O31a).
--   * release_override_policy hanya berubah lewat migrasi (O38b).
--
-- sha256 file sumber (cek: sha256sum supabase/migrations/<file>):
--   14161e7ad0065b78760143fcbff57b3858578e674d60ee1d6d6d9439efb3b6a2  20261025000100_v52_meta.sql
--   08d19a9a8b2368480d67b5023436b627cad390dc17b463256823fc265b022c06  20261025000200_v52_security.sql
--   c247bcf5e1be3d5b1cc45ea992e6c3ebbe3e00b3178ce2c715e6206ad18bbc0e  20261025000300_v52_release.sql
-- sha256 ketiganya disambung urut nama (cek: cat <tiga file urut> | sha256sum), disimpan di schema_registry.bundle_sha256:
--   e33e57167d24b64ddcc38fd95f60ded2cd8defc1bc6639a5a1c64302a5d68c7b

-------------------------------------------------------------------------------- prasyarat: v5.1 sudah terpasang
do $$
begin
  if to_regprocedure('public.base_key(text)') is null
     or to_regprocedure('public.lock_commitments(date,jsonb)') is null
     or to_regprocedure('public.advance_update_date(uuid,date)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'price_list_week' and column_name = 'deleted_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'parameter' and column_name = 'po_unsized_mode')
     or not exists (select 1 from pg_trigger where tgname = 'sales_line_scope' and tgrelid = to_regclass('public.sales_line'))
     or to_regclass('public.commercial_daily_sales_v5') is null or to_regclass('public.input_completeness_daily') is null
     or not exists (select 1 from public.release_override_policy where code = 'C53') then
    raise exception 'Migrasi v5.1 belum lengkap di database ini (docs/v5.1/kgr-os-migrasi-v51.sql dulu, lalu notify pgrst); v5.2 B2 tidak dijalankan';
  end if;
end $$;

-------------------------------------------------------------------------------- 1/3 20261025000100_v52_meta.sql
-- v5.2 B2/1 — schema version in the database (docs/PRD-v5.2-B-db.md B-R82, K65). Additive and re-runnable.
--
-- public.schema_registry keeps one row per applied schema version (the bundle that brought it, who applied it, the
-- sha256 of the bundle); public.schema_version() returns the highest version. Read by every app user (PRD A R44
-- tahap 2 compares it with EXPECTED_SCHEMA); written only by the database owner / service role, i.e. by a migration or
-- a bundle (no write policy and no write privilege for authenticated, Admin included).
-- The v5.1 bundle is recorded as 5.1.0 only when its last object (lock_commitments) exists. Every later file of
-- v5.2 B2 registers its own version at its end (v52_security 5.2.1, v52_release 5.2.2).

-------------------------------------------------------------------------------- registry
create table if not exists public.schema_registry (
  version       text primary key,
  applied_at    timestamptz not null default now(),
  applied_by    text default current_user,
  bundle_sha256 text
);
comment on table public.schema_registry is 'PRD v5.2 K65: applied schema versions; written only by migrations / bundles (service role), read by app users.';

alter table public.schema_registry enable row level security;
revoke all on public.schema_registry from public, anon;
revoke insert, update, delete, truncate on public.schema_registry from authenticated;
grant select on public.schema_registry to authenticated;
grant select, insert, update, delete on public.schema_registry to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'schema_registry' and policyname = 'schema_registry_read') then
    create policy schema_registry_read on public.schema_registry for select to authenticated using ((select public.is_app_user()));
  end if;
end $$;

-------------------------------------------------------------------------------- schema_version()
-- Highest version by the dotted number before any "-" suffix (5.10.0 > 5.9.3); a row whose version is not dotted
-- numbers sorts last; ties (e.g. 5.2.0 and 5.2.0-x) → the latest applied_at.
create or replace function public.schema_version() returns text
language sql stable security definer set search_path = '' as $$
  select r.version
    from public.schema_registry r
   order by case when split_part(r.version, '-', 1) ~ '^[0-9]{1,9}(\.[0-9]{1,9})*$'
                 then string_to_array(split_part(r.version, '-', 1), '.')::int[] end desc nulls last,
            r.applied_at desc, r.version desc
   limit 1
$$;
revoke all on function public.schema_version() from public, anon;
grant execute on function public.schema_version() to authenticated;

-------------------------------------------------------------------------------- versions
insert into public.schema_registry (version)
select '5.1.0' where to_regprocedure('public.lock_commitments(date,jsonb)') is not null
on conflict (version) do nothing;
insert into public.schema_registry (version) values ('5.2.0') on conflict (version) do nothing;

-------------------------------------------------------------------------------- 2/3 20261025000200_v52_security.sql
-- v5.2 B2/2 — security (docs/PRD-v5.2-B-db.md B-R83: A-REL-1, -2, -3, -4, -7, -8, -9, -10, B-REL-2, -4, -7; O21, O31,
-- O38; K69). Additive and re-runnable.
--
-- A-REL-1 / K69: week.update_date changes only while the week is open, by admin/finance (forward or back) or through
--   advance_update_date (forward, GUC kgr.advance set by that function). Policies week_upd / week_upd_v3 unchanged
--   (docs/v5.2/b2-week-writers.md: other week columns are written by non-admin roles).
-- A-REL-2 / B-REL-4: the two Sales views hide every cost-derived column (MA cost, floor, margins, v5 cost) when the
--   week's sales_sees_cost is false or the week has no parameter row; same column lists, names and types. rpc floor_of
--   (price_floor of any key) is no longer executable by clients.
-- A-REL-3: plan_week_class and demand_class_weekly are not read by Sales; surplus_response is read by Sales only for
--   assigned keys; view surplus_for_sales_v52 gives Sales the surplus of their keys (limited columns).
-- A-REL-4: tg_sales_line_scope checks the row before (OLD) and after (NEW) an update or soft delete; a line without
--   a customer passes the customer test only when it is a new spot sale.
-- A-REL-7: Sales update only their own surplus answers; responded_by / responded_at are stamped on every write.
-- A-REL-8 / O21(b): assignment_covers(a_key, k): exact, or a_key without a form suffix covers every form of it;
--   used by every guard, policy and view that matches an assignment (the v4 view included).
-- A-REL-9: a locked price-list row is never updated except once by the admin setting deleted_at (never cleared).
-- A-REL-10 / O31(a): lock_commitments refuses (23514) a key whose sizes carry different prices, takes one price per
--   key deterministically, refuses a week that has started (WIB) unless admin, and leaves locked price rows alone.
-- B-REL-7: item_map lookups in triggers normalise the item code as the engine (trim of JS whitespace, upper case,
--   first item_code in order).
-- B-REL-2 / O38: release_override_policy is changed by migrations only (no write privilege for authenticated).
-- Only create or replace (same signatures), alter policy, revoke, and new objects. Registers schema version 5.2.1.

-------------------------------------------------------------------------------- O21 assignment cover
-- a null assignment key = every key; "RPA|Karkas" covers "RPA|Karkas", "…|Fresh", "…|Frozen", "…|n/a";
-- "RPA|Karkas|Fresh" covers only itself
create or replace function public.assignment_covers(a_key text, k text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select a_key is null
      or coalesce(a_key = k, false)
      or coalesce(a_key = public.base_key(a_key) and public.base_key(k) = a_key, false)
$$;
revoke all on function public.assignment_covers(text, text) from public, anon;
grant execute on function public.assignment_covers(text, text) to authenticated;

-------------------------------------------------------------------------------- B-REL-7 item code as the engine
-- packages/engine/src/prepare.ts:228,281,286: norm = s.trim().toUpperCase(); the first item_map row (ordered by
-- item_code, lib/data.ts:96) of a normalised code wins. JS trim() removes these white-space characters.
create or replace function public.norm_code(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select upper(regexp_replace(p,
    '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g'))
$$;
revoke all on function public.norm_code(text) from public, anon;
grant execute on function public.norm_code(text) to authenticated;

-- Key of a sales line: key_manual, else the item map (v4 20261020000100; only the item lookup changes)
create or replace function public.sales_key(p_item_code text, p_key_manual text) returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(trim(coalesce(p_key_manual, '')), '') is not null then trim(p_key_manual)
              when coalesce(public.norm_code(p_item_code), '') = '' then null
              else (select m.key from public.item_map m
                     where public.norm_code(m.item_code) = public.norm_code(p_item_code) and m.deleted_at is null
                     order by m.item_code limit 1) end;
$$;
revoke all on function public.sales_key(text, text) from public, anon;

-------------------------------------------------------------------------------- A-REL-1 / K69 week guard
-- Same rule as 20261019000100 for every column but update_date. update_date: only while old.status = 'open'; admin
-- and finance forward or back (audit_log keeps old and new); inventory_accounting / cost_accounting only through
-- advance_update_date (GUC kgr.advance = 'on', forward, at most the Monday after the week). The service role (no app
-- role) is not checked, as before.
create or replace function public.tg_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
  via_advance boolean := coalesce(current_setting('kgr.advance', true), '') = 'on';
begin
  if r is null then return new; end if;
  if new.update_date is distinct from old.update_date then
    if old.status is distinct from 'open' then
      raise exception 'Tanggal update minggu % tidak bisa diubah: status %', old.week_start, old.status using errcode = '42501';
    end if;
    if r in ('admin','finance') then
      null;
    elsif via_advance and r in ('inventory_accounting','cost_accounting')
          and new.update_date > old.update_date and new.update_date <= old.week_start + 7 then
      null;
    else
      raise exception 'Peran % tidak boleh mengubah tanggal update minggu; tanggal maju lewat upload data', r using errcode = '42501';
    end if;
  end if;
  if r = 'admin' then return new; end if;
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at','updated_by','week_end','update_date') or (o -> k) is not distinct from (n -> k) then continue; end if;
    if k = 'status' and r = 'finance' and old.status in ('open','released') and new.status in ('open','released') then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-- K39 (20261024000300) with the GUC that tg_week_guard accepts; checks and signature unchanged
create or replace function public.advance_update_date(p_week_id uuid, p_date date) returns date
language plpgsql security definer set search_path = '' as $$
declare w public.week%rowtype; nd date;
begin
  if not (select public.has_role('admin','finance','inventory_accounting','cost_accounting')) then
    raise exception 'Tanggal update dimajukan oleh upload Inventory Accounting, Cost Accounting atau Finance' using errcode = '42501';
  end if;
  select * into w from public.week where id = p_week_id;
  if not found then raise exception 'Minggu tidak ada'; end if;
  if w.status <> 'open' or p_date is null or p_date < w.week_start or p_date > w.week_start + 6 then return w.update_date; end if;
  nd := greatest(w.update_date, least(p_date + 1, w.week_start + 7));
  if nd <> w.update_date then
    perform set_config('kgr.advance', 'on', true);
    update public.week set update_date = nd where id = w.id;
    perform set_config('kgr.advance', 'off', true);
  end if;
  return nd;
end $$;
revoke all on function public.advance_update_date(uuid, date) from public, anon;
grant execute on function public.advance_update_date(uuid, date) to authenticated;

-------------------------------------------------------------------------------- A-REL-2 / B-REL-4 / O21 Sales views (same columns)
-- sees: not Sales, or the week of the row has sales_sees_cost = true; no week / no parameter row = false for Sales
create or replace view public.commercial_daily_sales with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff,
         (case when s.sees then c.cost_per_kg_ma end)::numeric(18,4) as cost_per_kg_ma,
         (case when s.sees then c.price_floor end)::numeric(18,4) as price_floor,
         c.price_list,
         (case when s.sees then c.margin_per_kg_list end)::numeric(18,4) as margin_per_kg_list,
         c.realized_price_7d,
         (case when s.sees then c.margin_per_kg_realized end)::numeric(18,4) as margin_per_kg_realized,
         c.holding_loss_per_day, c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg
  from public.commercial_daily c
  cross join lateral (
    select not (select public.has_role('sales'))
        or coalesce((select p.sales_sees_cost from public.parameter p join public.week w on w.id = p.week_id
                      where c.date between w.week_start and w.week_start + 6 limit 1), false) as sees
  ) s
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, c.key)));
revoke all on public.commercial_daily_sales from public, anon;
grant select on public.commercial_daily_sales to authenticated;

create or replace view public.commercial_daily_sales_v5 with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff,
         (case when s.sees then c.cost_per_kg_ma end)::numeric(18,4) as cost_per_kg_ma,
         (case when s.sees then c.price_floor end)::numeric(18,4) as price_floor,
         c.price_list,
         (case when s.sees then c.margin_per_kg_list end)::numeric(18,4) as margin_per_kg_list,
         c.realized_price_7d,
         (case when s.sees then c.margin_per_kg_realized end)::numeric(18,4) as margin_per_kg_realized,
         c.holding_loss_per_day, c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
         (case when s.sees then c.cost_per_kg end)::numeric(18,4) as cost_per_kg,
         case when s.sees then c.cost_status end as cost_status,
         case when s.sees then c.cost_check end as cost_check
  from public.commercial_daily c
  cross join lateral (
    select not (select public.has_role('sales'))
        or coalesce((select p.sales_sees_cost from public.parameter p join public.week w on w.id = p.week_id
                      where c.date between w.week_start and w.week_start + 6 limit 1), false) as sees
  ) s
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, c.key)));
revoke all on public.commercial_daily_sales_v5 from public, anon;
grant select on public.commercial_daily_sales_v5 to authenticated;

-- Found while reviewing A-REL-2: floor_of(key, date) hands price_floor to any signed-in user through rpc, whatever the
-- week's sales_sees_cost and the viewer's assignment. Only the SECURITY DEFINER triggers of C38 call it (they run as the
-- owner), the app never does, so clients lose execute (the owner and the service role keep it).
revoke execute on function public.floor_of(text, date) from authenticated;

-------------------------------------------------------------------------------- A-REL-3 Sales read scope of planning
alter policy plan_week_class_read on public.plan_week_class
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy demand_class_weekly_read on public.demand_class_weekly
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy surplus_response_read on public.surplus_response
  using ((select public.is_app_user())
         and (not (select public.has_role('sales'))
              or exists (select 1 from public.sales_assignment a
                         where a.active and lower(a.email) = public.current_email()
                           and public.assignment_covers(a.key, surplus_response.key))));

-- What Sales need of a surplus: per plan week (every version not deleted) and key, the plan's surplus kg and the
-- latest answer. Only keys of the viewer's assignments for Sales; no plan detail (classes, heads, cost, downgrade).
create or replace view public.surplus_for_sales_v52 with (security_barrier = true) as
  with plan_surplus as (
    select p.id as plan_week_id, s.key,
           case when s.value #>> '{}' ~ '^-?[0-9]{1,10}(\.[0-9]+)?$' then round((s.value #>> '{}')::numeric, 2) end as plan_surplus_kg
      from public.plan_week p
     cross join lateral jsonb_each(case when jsonb_typeof(p.surplus_kg_by_key) = 'object' then p.surplus_kg_by_key else '{}'::jsonb end) s
     where p.deleted_at is null
  ), answer as (
    select distinct on (r.plan_week_id, r.key) r.plan_week_id, r.key, r.surplus_kg, r.response, r.absorb_kg, r.price, r.responded_by, r.responded_at
      from public.surplus_response r
     where r.deleted_at is null
     order by r.plan_week_id, r.key, r.responded_at desc, r.id desc
  ), k as (
    select plan_week_id, key from plan_surplus union select plan_week_id, key from answer
  )
  select p.week_start, p.version as plan_version, k.plan_week_id, k.key, ps.plan_surplus_kg,
         a.surplus_kg as answered_surplus_kg, a.response, a.absorb_kg, a.price, a.responded_by, a.responded_at
    from k
    join public.plan_week p on p.id = k.plan_week_id and p.deleted_at is null
    left join plan_surplus ps on ps.plan_week_id = k.plan_week_id and ps.key = k.key
    left join answer a on a.plan_week_id = k.plan_week_id and a.key = k.key
   where (select public.is_app_user())
     and (not (select public.has_role('sales'))
          or exists (select 1 from public.sales_assignment sa
                     where sa.active and lower(sa.email) = public.current_email() and public.assignment_covers(sa.key, k.key)));
revoke all on public.surplus_for_sales_v52 from public, anon;
grant select on public.surplus_for_sales_v52 to authenticated;

-------------------------------------------------------------------------------- A-REL-4 / O21 / B-REL-7 Sales PO lines
-- Scope of one line for the signed-in Sales user: an active assignment whose customer is null (every customer) or the
-- line's customer, and whose key covers the line's key. A line without a customer is in scope of a customer-bound
-- assignment only when it is a new spot sale (p_spot_insert).
create or replace function public.sales_line_in_scope(p_customer text, p_key text, p_spot_insert boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sales_assignment a
    where a.active and lower(a.email) = public.current_email()
      and (a.customer is null
           or (p_customer is not null and lower(a.customer) = lower(p_customer))
           or (p_customer is null and coalesce(p_spot_insert, false)))
      and public.assignment_covers(a.key, p_key))
$$;
revoke all on function public.sales_line_in_scope(text, text, boolean) from public, anon, authenticated;

create or replace function public.tg_sales_line_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if public.app_role() is distinct from 'sales' then return new; end if;
  -- UPDATE and soft delete: the line as it was must be the user's too (no taking over another rep's PO)
  if tg_op = 'UPDATE' then
    k := public.sales_key(old.item_code, old.key_manual);
    if not public.sales_line_in_scope(old.customer, k, false) then
      raise exception 'Baris % % bukan dalam assignment Anda; tidak bisa diubah atau dihapus', coalesce(old.customer, '(tanpa pelanggan)'), coalesce(k, old.item_code, '')
        using errcode = '42501';
    end if;
  end if;
  k := public.sales_key(new.item_code, new.key_manual);
  if not public.sales_line_in_scope(new.customer, k, tg_op = 'INSERT' and new.channel is not distinct from 'spot') then
    raise exception 'Baris % % tidak ditugaskan kepada Anda', coalesce(new.customer, '(tanpa pelanggan)'), coalesce(k, new.item_code, '') using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_sales_line_scope() from public, anon, authenticated;

-------------------------------------------------------------------------------- A-REL-7 / O21 surplus answers
alter policy surplus_response_upd on public.surplus_response
  using ((select public.has_role('admin','commercial_lead'))
         or ((select public.has_role('sales')) and responded_by = public.current_email()))
  with check ((select public.has_role('admin','commercial_lead'))
              or ((select public.has_role('sales')) and responded_by = public.current_email()));

create or replace function public.tg_surplus_response_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, new.key)) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  -- the responder is whoever wrote the answer last (insert or update)
  new.responded_by := public.current_email(); new.responded_at := now();
  return new;
end $$;

-------------------------------------------------------------------------------- O21 commitments (K26 guard of 20261024000200)
create or replace function public.tg_commitment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.app_role(); prev uuid;
begin
  if r is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Komitmen dibuat sebagai draft, lalu dikunci Kepala Sales' using errcode = '42501'; end if;
    if r = 'sales' and not exists (select 1 from public.sales_assignment a
        where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, new.key)) then
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
  -- R40: the admin retires a row (soft delete); status, figures and the lock stay as they were
  if r = 'admin' and old.deleted_at is null and new.deleted_at is not null and new.status = old.status
     and new.fresh_kg is not distinct from old.fresh_kg and new.frozen_kg is not distinct from old.frozen_kg and new.price is not distinct from old.price then
    return new;
  end if;
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
  -- Sales change a draft only of a key they cover, before and after the change
  if r = 'sales' and (not exists (select 1 from public.sales_assignment a
                                   where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, new.key))
                      or not exists (select 1 from public.sales_assignment a
                                   where a.active and lower(a.email) = public.current_email() and public.assignment_covers(a.key, old.key))) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  new.locked_by := null; new.locked_at := null;
  return new;
end $$;
revoke execute on function public.tg_commitment_guard() from public, anon, authenticated;

alter policy sales_commitment_read on public.sales_commitment
  using ((select public.is_app_user())
         and (not (select public.has_role('sales'))
              or exists (select 1 from public.sales_assignment a
                         where a.active and lower(a.email) = public.current_email()
                           and public.assignment_covers(a.key, sales_commitment.key))));
alter policy discount_approval_sales_scope on public.discount_approval
  using (not (select public.has_role('sales'))
         or requested_by = public.current_email()
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email()
                      and public.assignment_covers(a.key, discount_approval.key)));

-------------------------------------------------------------------------------- A-REL-9 locked price list (K24, R40)
-- A locked row does not change. The admin may retire it once: deleted_at (and deleted_by) set, every other column as
-- it was. A retired row is never updated again (deleted_at is not cleared, the price is not changed).
create or replace function public.tg_price_list_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
  keep text[] := array['deleted_at','deleted_by','updated_at','updated_by'];
begin
  if r is null then return new; end if;
  if tg_op = 'UPDATE' and old.locked_at is not null then
    if r = 'admin' and old.deleted_at is null and new.deleted_at is not null and (to_jsonb(old) - keep) = (to_jsonb(new) - keep) then
      return new;
    end if;
    if old.deleted_at is not null then
      raise exception 'Price list minggu % untuk % sudah dikunci dan diarsip; tidak bisa diubah atau dihidupkan lagi', old.week_start, old.key using errcode = '42501';
    end if;
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

-------------------------------------------------------------------------------- A-REL-10 / O31(a) lock of next week's commitments
-- As 20261024000300, plus: a week that has started (Monday <= today WIB) is locked by the admin only; the locked
-- versions of one key must carry one price over all sizes (else 23514 with the keys, nothing changes); that price is
-- written to the price list; a locked price-list row (live or retired, A-REL-9) is left as it is.
create or replace function public.lock_commitments(p_week_start date, p_price_frozen jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0; missing text; prev_w uuid; pf numeric; src text;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if not (select public.has_role('admin','commercial_lead')) then
    raise exception 'Komitmen dikunci oleh Kepala Sales' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then raise exception 'Minggu harus hari Senin' using errcode = '22023'; end if;
  if p_week_start <= today and not (select public.has_role('admin')) then
    raise exception 'Minggu % sudah berjalan (hari ini %): komitmen dikunci sebelum minggunya; koreksi oleh Admin', p_week_start, today
      using errcode = '42501';
  end if;
  select string_agg(c.key, ', ' order by c.key) into missing
    from public.sales_commitment c
   where c.week_start = p_week_start and c.status = 'draft' and c.deleted_at is null
     and length(trim(coalesce(c.reason, ''))) < 5
     and exists (select 1 from public.sales_commitment l where l.week_start = c.week_start and l.key = c.key
                   and coalesce(l.size_kg, 0) = coalesce(c.size_kg, 0) and l.status = 'locked' and l.deleted_at is null);
  if missing is not null then
    raise exception 'Versi baru setelah kunci wajib alasan: %', missing using errcode = '23514';
  end if;
  for d in select c.id from public.sales_commitment c
            where c.week_start = p_week_start and c.status = 'draft' and c.deleted_at is null order by c.key, c.size_kg loop
    update public.sales_commitment set status = 'locked' where id = d.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Tidak ada draft komitmen untuk minggu %', p_week_start using errcode = '22023'; end if;
  -- O31(a): one price per key over its sizes (the whole call is undone when not)
  select string_agg(x.key, ', ' order by x.key) into missing
    from (select c.key from public.sales_commitment c
           where c.week_start = p_week_start and c.status = 'locked' and c.deleted_at is null and c.price is not null
           group by c.key having count(distinct c.price) > 1) x;
  if missing is not null then
    raise exception 'Harga komitmen berbeda antar ukuran untuk key yang sama: %; samakan harga per key lalu kunci lagi', missing using errcode = '23514';
  end if;
  select w.id into prev_w from public.week w where w.week_start = p_week_start - 7;
  for d in select c.key, min(c.price) as price from public.sales_commitment c
            where c.week_start = p_week_start and c.status = 'locked' and c.deleted_at is null and c.price is not null
            group by c.key order by c.key loop
    if exists (select 1 from public.price_list_week p where p.week_start = p_week_start and p.key = d.key and p.locked_at is not null) then continue; end if;
    pf := nullif(coalesce(p_price_frozen, '{}'::jsonb) ->> d.key, '')::numeric;
    src := case when pf is not null then 'form' end;
    if pf is null and prev_w is not null then
      select sp.ref_sell_price into pf from public.sku_price sp where sp.week_id = prev_w and sp.key = public.base_key(d.key) || '|Frozen';
      src := case when pf is not null then 'sku_price' end;
    end if;
    insert into public.price_list_week (week_start, key, price_fresh, price_frozen, price_frozen_source, locked_at, deleted_at, deleted_by)
    values (p_week_start, d.key, d.price, pf, src, now(), null, null)
    on conflict (week_start, key) do update
      set price_fresh = excluded.price_fresh, price_frozen = excluded.price_frozen, price_frozen_source = excluded.price_frozen_source,
          locked_at = excluded.locked_at, deleted_at = null, deleted_by = null;
  end loop;
  return n;
end $$;
revoke all on function public.lock_commitments(date, jsonb) from public, anon;
grant execute on function public.lock_commitments(date, jsonb) to authenticated;

-------------------------------------------------------------------------------- B-REL-2 / O38 override policy by migration only
-- Who may override which control is set here and in later migrations, never through the API (Admin included).
revoke insert, update, delete, truncate on public.release_override_policy from public, anon, authenticated;
alter policy release_override_policy_upd on public.release_override_policy using (false) with check (false);

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.1') on conflict (version) do nothing;

-------------------------------------------------------------------------------- 3/3 20261025000300_v52_release.sql
-- v5.2 B2/3 — release gates computed by the database (docs/PRD-v5.2-B-db.md B-R84, K68; A-REL-5, A-REL-6, B-REL-3;
-- O22(b), O28(b), O32(b)). Additive and re-runnable.
--
-- release_week (same signature; everything of 20261024000100 kept unless amended here):
--   * v5_costing on (global flag): the snapshot must carry controls_v3 with C53, else "snapshot tidak lengkap". C53 is
--     computed from the tables (Aktual batch of the week, no WP, past its deadline: cut date + wp_due_hours rounded to
--     days, at wp_due_time WIB, as apps/web/lib/v5/costing.ts wpDueAt and packages/engine c53). The DB result, or the
--     snapshot's C53 BELUM DIISI, holds the release in every mode (O22b) unless Finance recorded override C53.
--     v5_costing off: C53 of the snapshot as in v5.1 (strict mode only).
--   * v5_input on: a week without any grid row is refused (K45, as v5.1); every date ws … min(ws+6, today WIB − 1)
--     needs at least one cell (O28b) — "grid belum dibangun untuk <tanggal>"; missing days and red cells are lifted by
--     Finance's override K35.
--   * the DB's C53 is compared with the snapshot's; a difference (and what an override K35 lifted) is written to
--     release.note (new column).
-- release_month (same signature): V1 with C55 not LULUS in the snapshot is refused in every mode unless Finance
--   recorded override C55 for the month's V1 (O32b; policy row C55 added here, migrations only by O38).
-- Registers schema version 5.2.2.

-------------------------------------------------------------------------------- release.note
alter table public.release add column if not exists note text;
comment on column public.release.note is 'PRD v5.2 K68: difference between the controls computed by release_week and the client snapshot (null = none)';

-------------------------------------------------------------------------------- override policy C55 (O32b)
insert into public.release_override_policy (code, allowed_roles, note)
values ('C55', array['finance'], 'PRD v5.2 O32(b): V1 dengan beban tetap bulan ini masih estimasi (C55 PERIKSA); Finance dengan alasan dan bukti')
on conflict (code) do nothing;

-------------------------------------------------------------------------------- helpers
-- C53 from the tables: Aktual batches of the week without WP whose deadline has passed at p_at (null = none)
create or replace function public.c53_late_batches(p_week_id uuid, p_at timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(coalesce(b.batch_ref, b.id::text) || ' tenggat ' || to_char(d.due at time zone 'Asia/Jakarta', 'DD/MM HH24.MI'), ', '
                    order by b.date, b.batch_ref, b.id)
    from public.batch b
    join public.week w on w.id = b.week_id
    left join public.parameter p on p.week_id = b.week_id
   cross join lateral (
     select ((b.date + greatest(1, round(coalesce(p.wp_due_hours, 24)::numeric / 24))::int)
             + date_trunc('minute', coalesce(p.wp_due_time, time '12:00')::interval)) at time zone 'Asia/Jakarta' as due
   ) d
   where b.week_id = p_week_id and b.status = 'Aktual' and b.deleted_at is null and b.superseded_at is null
     and b.date between w.week_start and w.week_start + 6
     and b.wp_received_at is null and d.due < p_at
$$;
revoke all on function public.c53_late_batches(uuid, timestamptz) from public, anon, authenticated;

-- O28: dates ws … min(ws+6, today WIB − 1) without any grid cell (the release task is not a cell, K44); null = none
create or replace function public.k35_grid_gaps(p_week_start date) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(to_char(g.d, 'DD/MM'), ', ' order by g.d)
    from generate_series(p_week_start::timestamp,
                         least(p_week_start + 6, (now() at time zone 'Asia/Jakarta')::date - 1)::timestamp,
                         interval '1 day') g(d)
   where not exists (select 1 from public.input_completeness_daily c where c.date = g.d::date and c.kind <> 'release_week')
$$;
revoke all on function public.k35_grid_gaps(date) from public, anon, authenticated;

-------------------------------------------------------------------------------- release_week (v4 §7.2 + K35, K44, K45, K47 + K68, O22, O28)
create or replace function public.release_week(p_week_id uuid, p_json text, p_sha text, p_pdf_path text, p_ops jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.week%rowtype; snap jsonb; is_strict boolean; costing_on boolean; input_on boolean;
  bad text; stale text; red text; gaps text; late text; snap_c53 text; db_c53 text; diff text; c53_lifted boolean; k35_lifted boolean;
  rid uuid; email text := public.current_email();
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
  costing_on := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_costing'), false);
  input_on := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_input'), false);
  bad := public.release_rejections(snap -> 'controls' -> 'controls', null, 'week', w.week_start::text, is_strict);

  -- C53
  if costing_on then
    -- K68: the snapshot is the evidence of the release; with v5_costing on it carries C53 (lib/v3/week.ts)
    if jsonb_typeof(snap -> 'controls_v3') is distinct from 'array'
       or not exists (select 1 from jsonb_array_elements(snap -> 'controls_v3') e where e ->> 'code' = 'C53') then
      raise exception 'Rilis ditolak: snapshot tidak lengkap — v5_costing hidup, tetapi snapshot tanpa controls_v3 C53'
        using errcode = '22000', hint = 'Buat snapshot ulang dari aplikasi dengan modul costing hidup.';
    end if;
    select string_agg(distinct coalesce(e ->> 'status', '-'), ',') into snap_c53
      from jsonb_array_elements(snap -> 'controls_v3') e where e ->> 'code' = 'C53';
    late := public.c53_late_batches(w.id, now());
    db_c53 := case when late is null then 'LULUS' else 'BELUM DIISI' end;
    c53_lifted := exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                            and o.code = 'C53' and o.deleted_at is null);
    -- O22(b): held in every mode while v5_costing is on, by the database's C53 or the snapshot's
    if not c53_lifted then
      if late is not null then
        bad := concat_ws('; ', bad, 'C53 BELUM DIISI: WP belum masuk lewat tenggat ' || late);
      elsif snap_c53 ~ '(BELUM DIISI|GAGAL|STALE)' then
        bad := concat_ws('; ', bad, 'C53 ' || snap_c53 || ' (snapshot)');
      end if;
    end if;
    if snap_c53 is distinct from db_c53 then
      diff := 'K68 C53: DB ' || db_c53 || coalesce(' (' || late || ')', '') || ' ≠ snapshot ' || snap_c53
              || case when c53_lifted then '; dilepas override C53' else '' end;
    end if;
  else
    -- v5.1 K47: C53 of the snapshot's controls_v3, strict mode as release_rejections
    bad := nullif(concat_ws('; ', bad, public.release_rejections(snap -> 'controls_v3', array['C53'], 'week', w.week_start::text, is_strict)), '');
  end if;

  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  end if;

  -- K35 (flag v5_input), without the release task itself (K44): no grid → no release (K45); a day up to yesterday without
  -- a cell (O28) and red cells (late, or not due when built and past the deadline now) → no release unless override K35
  if input_on then
    if not exists (select 1 from public.input_completeness_daily c where c.date between w.week_start and (w.week_start + 6) and c.kind <> 'release_week') then
      bad := concat_ws('; ', bad, 'K35: grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas');
    else
      k35_lifted := exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                              and o.code = 'K35' and o.deleted_at is null);
      gaps := public.k35_grid_gaps(w.week_start);
      select string_agg(c.kind || ' ' || to_char(c.date, 'DD/MM'), ', ' order by c.date, c.kind) into red
        from public.input_completeness_daily c
       where c.date between w.week_start and (w.week_start + 6)
         and c.kind <> 'release_week'
         and (c.status = 'late' or (c.status = 'not_due' and c.due_at is not null and c.due_at <= now()));
      if not k35_lifted then
        if gaps is not null then bad := concat_ws('; ', bad, 'K35: grid belum dibangun untuk ' || gaps); end if;
        if red is not null then bad := concat_ws('; ', bad, 'K35 kelengkapan data merah: ' || red); end if;
      elsif gaps is not null or red is not null then
        diff := concat_ws('; ', diff, 'K35 dilepas override: ' || concat_ws(' | ', 'grid belum dibangun ' || gaps, 'merah ' || red));
      end if;
    end if;
  end if;

  if coalesce(bad, '') <> '' then
    raise exception 'Rilis ditolak: %', bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.release (week_id, update_date, engine_version, snapshot, snapshot_sha256, pdf_path, control_status, controls, ops_rows, released_by, note)
  values (w.id, w.update_date, coalesce(snap ->> 'engineVersion', ''), snap, p_sha, p_pdf_path, coalesce(snap -> 'controls' ->> 'overall', ''), snap -> 'controls',
          coalesce(p_ops, '[]'::jsonb), email, diff)
  returning id into rid;
  update public.week set status = 'released' where id = w.id and status = 'open';
  return rid;
end $$;
revoke all on function public.release_week(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.release_week(uuid, text, text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- release_month (20261019000100 + O32b C55)
create or replace function public.release_month(p_month date, p_version text, p_json text, p_sha text, p_cut_off date,
  p_totals jsonb, p_rule_version text, p_anomaly_days jsonb, p_po_share numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', p_month)::date; last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  today date := (now() at time zone 'Asia/Jakarta')::date;
  mo public.month_outlook%rowtype; snap jsonb; bad text; stale text; c48 text; c55 text; open_reg text; lock_week int; vid uuid;
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
  bad := nullif(concat_ws('; ', bad, public.release_rejections(snap -> 'controls', mand, 'month', m::text || ':' || p_version, v4 or is_strict)), '');
  -- O32(b): C55 not LULUS (fixed costs of the month still estimated) holds V1 in every mode, lifted by Finance's override C55
  if p_version = 'V1' then
    select string_agg(distinct coalesce(e ->> 'status', '-'), ',') into c55
      from jsonb_array_elements(case when jsonb_typeof(snap -> 'controls') = 'array' then snap -> 'controls' else '[]'::jsonb end) e
     where coalesce(e ->> 'code', 'C' || (e ->> 'no')) = 'C55' and coalesce(e ->> 'status', '-') <> 'LULUS';
    if c55 is not null and not exists (select 1 from public.release_override o where o.scope_kind = 'month' and o.scope = m::text || ':V1'
                                         and o.code = 'C55' and o.deleted_at is null) then
      bad := concat_ws('; ', bad, 'C55 ' || c55 || ': beban tetap bulan ini masih estimasi; isi jadwal beban tetap, atau override Finance C55');
    end if;
  end if;
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

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.2') on conflict (version) do nothing;

-------------------------------------------------------------------------------- bukti bundel pada registry
-- sha256 dari ketiga file disambung urut nama (lihat kepala berkas); versi 5.1.0 berasal dari bundel v5.1 dan tidak diisi
update public.schema_registry set bundle_sha256 = 'e33e57167d24b64ddcc38fd95f60ded2cd8defc1bc6639a5a1c64302a5d68c7b' where version in ('5.2.0', '5.2.1', '5.2.2');

-------------------------------------------------------------------------------- PostgREST memuat ulang skema (B-REL-6)
notify pgrst, 'reload schema';

-------------------------------------------------------------------------------- cek: semua baris harus true
select m.no, m.cek, m.ada
from (values
  (1,  '0100 schema_registry: RLS, tanpa hak anon, tulis hanya service role',
         (select c.relrowsecurity from pg_class c where c.oid = 'public.schema_registry'::regclass)
         and not has_table_privilege('anon', 'public.schema_registry', 'select')
         and not has_table_privilege('authenticated', 'public.schema_registry', 'insert')
         and not has_table_privilege('authenticated', 'public.schema_registry', 'update')
         and not has_table_privilege('authenticated', 'public.schema_registry', 'delete')
         and has_table_privilege('authenticated', 'public.schema_registry', 'select')),
  (2,  '0100 schema_version(): definer, search_path kosong, untuk authenticated, bukan anon, = 5.2.2 atau lebih',
         (select p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x = 'search_path=""') from pg_proc p where p.oid = to_regprocedure('public.schema_version()'))
         and has_function_privilege('authenticated', 'public.schema_version()', 'execute')
         and not has_function_privilege('anon', 'public.schema_version()', 'execute')
         and string_to_array(public.schema_version(), '.')::int[] >= array[5,2,2]),
  (3,  '0100 versi 5.1.0 (bundel v5.1), 5.2.0, 5.2.1, 5.2.2 tercatat',
         (select count(*) from public.schema_registry where version in ('5.1.0', '5.2.0', '5.2.1', '5.2.2')) = 4),
  (4,  '0200 assignment_covers (O21b)',
         public.assignment_covers('A|B', 'A|B|Frozen') and public.assignment_covers('A|B|Fresh', 'A|B|Fresh') and public.assignment_covers(null, 'X')
         and not public.assignment_covers('A|B|Fresh', 'A|B|Frozen') and not public.assignment_covers('A|B|Fresh', 'A|B') and not public.assignment_covers('A|B', 'A|C|Fresh')),
  (5,  '0200 tg_week_guard + advance_update_date (K69)',
         (select prosrc like '%kgr.advance%' and prosrc like '%old.status%' from pg_proc where oid = to_regprocedure('public.tg_week_guard()'))
         and (select prosrc like '%kgr.advance%' from pg_proc where oid = to_regprocedure('public.advance_update_date(uuid,date)'))),
  (6,  '0200 view Sales v4 dan v5: biaya tersembunyi, 20 dan 23 kolom',
         pg_get_viewdef('public.commercial_daily_sales'::regclass) like '%sales_sees_cost%' and pg_get_viewdef('public.commercial_daily_sales_v5'::regclass) like '%sales_sees_cost%'
         and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales') = 20
         and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales_v5') = 23),
  (7,  '0200 plan_week_class dan demand_class_weekly tidak terbaca Sales; surplus_response per assignment',
         (select count(*) from pg_policy where polname in ('plan_week_class_read', 'demand_class_weekly_read') and pg_get_expr(polqual, polrelid) like '%sales%') = 2
         and (select pg_get_expr(polqual, polrelid) like '%assignment_covers%' from pg_policy where polname = 'surplus_response_read')),
  (8,  '0200 view surplus_for_sales_v52 (tanpa hak anon)',
         to_regclass('public.surplus_for_sales_v52') is not null and not has_table_privilege('anon', 'public.surplus_for_sales_v52', 'select')),
  (9,  '0200 tg_sales_line_scope menilai OLD dan NEW; sales_key memakai norm_code (B-REL-7)',
         (select prosrc like '%old.customer%' from pg_proc where oid = to_regprocedure('public.tg_sales_line_scope()'))
         and (select prosrc like '%norm_code%' from pg_proc where oid = to_regprocedure('public.sales_key(text,text)'))),
  (10, '0200 jawaban surplus: Sales hanya miliknya, stempel di UPDATE',
         (select pg_get_expr(polqual, polrelid) like '%responded_by%' from pg_policy where polname = 'surplus_response_upd')
         and (select prosrc like '%new.responded_by := public.current_email()%' from pg_proc where oid = to_regprocedure('public.tg_surplus_response_guard()'))),
  (11, '0200 price list terkunci satu arah (A-REL-9)',
         (select prosrc like '%dihidupkan lagi%' from pg_proc where oid = to_regprocedure('public.tg_price_list_guard()'))),
  (12, '0200 lock_commitments: minggu berjalan dan harga per ukuran (O31a)',
         (select prosrc like '%Asia/Jakarta%' and prosrc like '%berbeda antar ukuran%' from pg_proc where oid = to_regprocedure('public.lock_commitments(date,jsonb)'))),
  (13, '0200 release_override_policy hanya lewat migrasi (O38b)',
         not has_table_privilege('authenticated', 'public.release_override_policy', 'insert') and not has_table_privilege('authenticated', 'public.release_override_policy', 'update')
         and not has_table_privilege('authenticated', 'public.release_override_policy', 'delete') and not has_table_privilege('authenticated', 'public.release_override_policy', 'truncate')),
  (14, '0200 floor_of tidak bisa dipanggil klien',
         not has_function_privilege('authenticated', 'public.floor_of(text,date)', 'execute') and not has_function_privilege('anon', 'public.floor_of(text,date)', 'execute')),
  (15, '0300 release.note dan kebijakan override C55 (Finance)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'release' and column_name = 'note')
         and (select allowed_roles = array['finance'] from public.release_override_policy where code = 'C55')),
  (16, '0300 release_week menghitung C53 dan grid K35 di DB (K68)',
         (select prosrc like '%c53_late_batches%' and prosrc like '%k35_grid_gaps%' and prosrc like '%snapshot tidak lengkap%' from pg_proc where oid = to_regprocedure('public.release_week(uuid,text,text,text,jsonb)'))),
  (17, '0300 release_month menahan V1 pada C55 (O32b)',
         (select prosrc like '%O32(b)%' and prosrc like '%C55%' from pg_proc where oid = to_regprocedure('public.release_month(date,text,text,text,date,jsonb,text,jsonb,numeric)'))),
  (18, '0300 c53_late_batches dan k35_grid_gaps tidak untuk klien',
         not has_function_privilege('authenticated', 'public.c53_late_batches(uuid,timestamptz)', 'execute') and not has_function_privilege('authenticated', 'public.k35_grid_gaps(date)', 'execute')),
  (19, 'semua SECURITY DEFINER di public: search_path tetap',
         not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
                      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))),
  (20, 'tidak ada fungsi SECURITY DEFINER di public yang bisa dieksekusi anon',
         not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute'))),
  (21, 'satu fungsi per nama untuk yang diganti (tanpa overload baru)',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('release_week', 'release_month', 'lock_commitments', 'advance_update_date', 'sales_key')) = 5),
  (22, 'bundle_sha256 terisi untuk 5.2.0, 5.2.1, 5.2.2',
         (select count(*) from public.schema_registry where version in ('5.2.0', '5.2.1', '5.2.2') and bundle_sha256 = 'e33e57167d24b64ddcc38fd95f60ded2cd8defc1bc6639a5a1c64302a5d68c7b') = 3),
  (23, '0200 assignment_covers dipakai guard komitmen, jawaban surplus dan baris PO (O21b)',
         (select prosrc like '%assignment_covers%' from pg_proc where oid = to_regprocedure('public.tg_commitment_guard()'))
         and (select prosrc like '%assignment_covers%' from pg_proc where oid = to_regprocedure('public.tg_surplus_response_guard()'))
         and (select prosrc like '%assignment_covers%' from pg_proc where oid = to_regprocedure('public.sales_line_in_scope(text,text,boolean)'))),
  (24, '0200 assignment_covers dipakai policy baca komitmen dan permintaan diskon (O21b)',
         (select count(*) from pg_policy where polname in ('sales_commitment_read', 'discount_approval_sales_scope') and pg_get_expr(polqual, polrelid) like '%assignment_covers%') = 2)
) as m(no, cek, ada)
order by m.no;
