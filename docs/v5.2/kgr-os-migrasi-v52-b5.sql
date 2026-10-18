-- KGR-OS: 2 migrasi v5.2 B5 sekaligus (costing, fs), untuk SQL Editor Supabase (satu kali Run).
-- Dijalankan MANUSIA setelah sign-off dan setelah lulus di staging (PRD v5.2-B K66, K67; Q-v5.2-4). BELUM dijalankan di KGR-OS.
--
-- Urutan wajib: backup (B0-1) -> bundel v5.1 (docs/v5.1/kgr-os-migrasi-v51.sql) -> bundel B2 (docs/v5.2/kgr-os-migrasi-v52-b2.sql,
-- tabel cek 24 baris true, schema_version() = 5.2.2) -> bundel ini. Bundel ini menolak jalan bila B2 belum terpasang (cek prasyarat di bawah).
--
-- Isi: file supabase/migrations/20261025000400 dan 20261025000500, disambung urut nama, isi tiap file tidak diubah.
-- Tambahan di luar file migrasi hanya empat: cek prasyarat di awal, pengisian bundle_sha256 di registry, notify pgrst,
-- dan tabel cek di akhir. SQL Editor menjalankan semuanya dalam satu transaksi: error di mana pun membatalkan semuanya.
-- Semua file bisa dijalankan ulang (bukti: docs/v5.2/bukti/b5-bundel.txt, docs/v5.2/bukti/b5-migrasi-rerun.txt).
-- Hasil yang benar: tabel cek 26 baris, kolom ada semuanya true; select public.schema_version() = 5.2.4.
-- Tidak ada flag yang dinyalakan. Data yang ditambah: baris schema_registry (5.2.3, 5.2.4), 15 baris seed fs_line_map
-- (semua status draft, tanpa angka FS: impor FS adalah B-R91) dan baris kebijakan override C59 (Finance).
--
-- Yang berubah bagi pengguna (ringkas; rinci di docs/v5.2/b5.md):
--   * batch.lb_price_source (R51), plan_check_reason.plan_week_id dan plan_week_class.detail (A2): kolom baru, kosong.
--   * post_allocation_override(run ids, alasan): Finance/Admin memposting alokasi yang punya SKU tanpa harga acuan
--     (R61, A3); Finance tidak mendapat hak tulis langsung di allocation_run atau batch.
--   * week.opening_stock_flag boleh diubah inventory_accounting dan finance saat minggu open (Q-v5.2-13).
--   * view Sales: holding_loss_per_day dan downgrade_risk_rp kosong bila sales_sees_cost=false; Sales tidak membaca
--     price_floor_rule, dan tidak membaca jejak ubahnya di audit_log (Q-v5.2-18).
--   * tabel fs_statement_line (baris FS per bulan, baris terkunci tidak bisa diubah atau dihapus siapa pun) dan fs_line_map
--     (pemetaan baris app dan baris FS, draft sampai Finance menyetujui); baca admin/finance/management/operations_director,
--     tulis finance/admin (B-R86); jejak audit_log tabel FS hanya terbaca pembaca tabelnya (policy restrictif).
--   * kebijakan override C59 (Finance) untuk rekonsiliasi dashboard dengan FS.
--
-- sha256 file sumber (cek: sha256sum supabase/migrations/<file>):
--   e77526572fef255670e2b79f3e1042167638e9b7cc8fce4873a67f745a1f7ebb  20261025000400_v52_costing.sql
--   0d3402496dfd735042984d47469448dfb24e85a16db0d7c018c71b6f2a1c354c  20261025000500_v52_fs.sql
-- sha256 keduanya disambung urut nama (cek: cat <dua file urut> | sha256sum), disimpan di schema_registry.bundle_sha256:
--   bb43b8ff231ff204d0db570f1eec3a7d4d666cfee964161c6377d988eb5c56e7

-------------------------------------------------------------------------------- prasyarat: B2 sudah terpasang
do $$
begin
  if to_regprocedure('public.schema_version()') is null or to_regclass('public.schema_registry') is null then
    raise exception 'Bundel B2 belum terpasang di database ini (docs/v5.2/kgr-os-migrasi-v52-b2.sql dulu, lalu notify pgrst); v5.2 B5 tidak dijalankan';
  end if;
  if string_to_array(coalesce(public.schema_version(), '0'), '.')::int[] < array[5,2,2] then
    raise exception 'schema_version() = %, B5 butuh 5.2.2 atau lebih (bundel B2); v5.2 B5 tidak dijalankan', public.schema_version();
  end if;
  if to_regprocedure('public.assignment_covers(text,text)') is null
     or to_regprocedure('public.c53_late_batches(uuid,timestamptz)') is null
     or to_regprocedure('public.k35_grid_gaps(date)') is null
     or to_regclass('public.surplus_for_sales_v52') is null
     or to_regclass('public.commercial_daily_sales_v5') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'release' and column_name = 'note')
     or not exists (select 1 from public.release_override_policy where code = 'C55')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.tg_week_guard()') and prosrc like '%kgr.advance%') then
    raise exception 'Objek bundel B2 tidak lengkap di database ini (docs/v5.2/kgr-os-migrasi-v52-b2.sql dulu); v5.2 B5 tidak dijalankan';
  end if;
  if to_regclass('public.allocation_run') is null or to_regclass('public.allocation_line') is null or to_regclass('public.batch_output_sku') is null
     or to_regclass('public.plan_week_class') is null or to_regclass('public.plan_check_reason') is null or to_regclass('public.price_floor_rule') is null
     or to_regprocedure('public.week_writable(uuid)') is null or to_regprocedure('public.tg_audit()') is null or to_regprocedure('public.tg_stamp()') is null then
    raise exception 'Tabel costing atau perencanaan (v3 s.d. v5) tidak lengkap di database ini; v5.2 B5 tidak dijalankan';
  end if;
end $$;

-------------------------------------------------------------------------------- 1/2 20261025000400_v52_costing.sql
-- v5.2 B5/1 — costing and the leftovers of B2 (docs/PRD-v5.2-B-db.md B-R85, only what PRD v5.2-A asked for through
-- Q-v5.2; Q-v5.2-13, Q-v5.2-18). Additive and re-runnable: new columns, new objects, create or replace with the same
-- signatures, alter policy. Registers schema version 5.2.3.
--
-- B-R85 / R51: batch.lb_price_source — where the LB price of a batch came from (the decision of its class, the decision
--   for all classes, or typed by hand); null = none yet (C57). Written by whoever writes batch (admin, ppic, cost_accounting
--   through the existing batch policies): no new privilege.
-- B-R85 / A2 (R51, R52 stage 1): plan_check_reason.plan_week_id binds a written reason (C58) to the plan version it was
--   written for; plan_week_class.detail keeps the split per cut date a saved plan produced (null = a row saved before
--   v5.2). Both tables keep the write rights they have (admin, ppic).
-- B-R85 / A3 (R61): Finance posts an allocation that has an SKU without a reference price. allocation_run is updated by
--   admin and cost_accounting only, and batch by admin, ppic and cost_accounting; the override touches both (the run
--   becomes posted with the reason in issues, the batch costing_status becomes posted). Narrowest way: one
--   SECURITY DEFINER function, post_allocation_override(run ids, reason), that does exactly that and nothing else; no
--   write right on either table is opened to Finance.
-- Q-v5.2-13: tg_week_guard lets inventory_accounting and finance change week.opening_stock_flag while the week is open
--   (the stock upload writes it as inventory_accounting); every other column and the update_date rule are unchanged.
-- Q-v5.2-18: the two Sales views also hide holding_loss_per_day and downgrade_risk_rp unless the viewer sees cost (same
--   column lists, names, order and types as B2); price_floor_rule (markup per key) is not read by Sales, and its old and
--   new values are not read by Sales through audit_log either (the Sales redaction list of 20261017000200 gains the table).
--
-- NOT created, on purpose: save_class_plan (O33(b) postpones K27 stage 2), cost_snapshot and sales_stock_age_v52 (PRD A
-- did not ask for them; B-R85 says "only what PRD A asks for"). Q-v5.2-15 (Sales no longer read plan_week and
-- demand_weekly) is not here either: it waits for the code of A2 that reads the surplus through surplus_for_sales_v52.

-------------------------------------------------------------------------------- batch.lb_price_source (R51)
alter table public.batch add column if not exists lb_price_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'batch_lb_price_source_check' and conrelid = 'public.batch'::regclass) then
    alter table public.batch add constraint batch_lb_price_source_check
      check (lb_price_source in ('keputusan_kelas', 'keputusan_semua_kelas', 'manual'));
  end if;
end $$;
comment on column public.batch.lb_price_source is
  'PRD v5.2 R51: where lb_price came from: keputusan_kelas (decision of the batch class) > keputusan_semua_kelas (decision for all classes) > manual; null = no price yet (C57)';

-------------------------------------------------------------------------------- plan_check_reason.plan_week_id (C58 per plan version)
alter table public.plan_check_reason add column if not exists plan_week_id uuid references public.plan_week(id) on delete restrict;
comment on column public.plan_check_reason.plan_week_id is
  'PRD v5.2 R51: the plan version (plan_week) this reason was written for; null = written before v5.2 (counted by time only)';
-- one live reason per plan version and control. The older index (week_start, code) where deleted_at is null is kept (no
-- drop): while it stands, the reason of an older version is retired (deleted_at) before the next version gets its own.
create unique index if not exists plan_check_reason_plan_code
  on public.plan_check_reason (plan_week_id, code) where deleted_at is null and plan_week_id is not null;

-- the version must be a version of the same week
create or replace function public.tg_plan_check_reason_scope() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.plan_week_id is not null
     and not exists (select 1 from public.plan_week p where p.id = new.plan_week_id and p.week_start = new.week_start) then
    raise exception 'Alasan % untuk minggu % bukan milik versi rencana yang disebut', new.code, new.week_start using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_plan_check_reason_scope() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'plan_check_reason_scope' and tgrelid = 'public.plan_check_reason'::regclass) then
    create trigger plan_check_reason_scope before insert or update on public.plan_check_reason
      for each row execute function public.tg_plan_check_reason_scope();
  end if;
end $$;

-------------------------------------------------------------------------------- plan_week_class.detail (R52 stage 1)
alter table public.plan_week_class add column if not exists detail jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_week_class_detail_check' and conrelid = 'public.plan_week_class'::regclass) then
    alter table public.plan_week_class add constraint plan_week_class_detail_check
      check (detail is null or jsonb_typeof(detail) in ('object', 'array'));
  end if;
end $$;
comment on column public.plan_week_class.detail is
  'PRD v5.2 R52 stage 1: split of the class over the cut dates, as the plan was saved; null = a row saved before v5.2 (the split is derived from the demand profile)';

-------------------------------------------------------------------------------- R61 Finance override of an allocation posting
-- Posts draft allocations that carry an SKU with kg and no reference price (null or 0), which the normal posting (admin,
-- cost_accounting) refuses in the app (R61, K50). Checks, in the database:
--   * the caller is Finance or Admin; the reason has at least 10 characters (as the app asks);
--   * every run exists, is a draft, is balanced (|diff| <= 1, C21), has at least one unpriced SKU line (a priced run is
--     posted the normal way, so the override is never a general right to post), its batch is live (not deleted, not
--     superseded) and its batch's week is not closed (admin excepted, as week_writable);
--   * per run: status posted, posted_at / posted_by, the override sentence appended to issues (same wording as the app),
--     and batch.costing_status = 'posted'. C48 (a run without output) is still refused by its own trigger.
-- All runs or none. Returns the number of runs posted.
create or replace function public.post_allocation_override(p_run_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  reason text := trim(coalesce(p_reason, ''));
  email text := public.current_email();
  today date := (now() at time zone 'Asia/Jakarta')::date;
  ids uuid[]; r record; keys text; n integer := 0;
begin
  if not (select public.has_role('admin', 'finance')) then
    raise exception 'Override posting alokasi hanya oleh Finance atau Admin' using errcode = '42501';
  end if;
  if char_length(reason) < 10 then
    raise exception 'Override posting: alasan minimal 10 karakter' using errcode = '23514';
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_run_ids) x where x is not null;
  if ids is null then
    raise exception 'Pilih alokasi yang diposting dengan override' using errcode = '22023';
  end if;
  if (select count(*) from public.allocation_run a where a.id = any (ids)) <> cardinality(ids) then
    raise exception 'Ada alokasi yang tidak ditemukan' using errcode = '22023';
  end if;
  for r in
    select a.id, a.status, a.diff, a.issues, a.batch_id, coalesce(b.batch_ref, b.id::text) as batch_ref, b.week_id, b.deleted_at, b.superseded_at
      from public.allocation_run a join public.batch b on b.id = a.batch_id
     where a.id = any (ids) order by a.id for update of a
  loop
    if r.deleted_at is not null or r.superseded_at is not null then
      raise exception 'Batch % sudah dihapus atau digantikan', r.batch_ref using errcode = '22023';
    end if;
    if r.status <> 'draft' then
      raise exception 'Alokasi batch % berstatus %: hanya draft yang bisa diposting', r.batch_ref, r.status using errcode = '22023';
    end if;
    if abs(r.diff) > 1 then
      raise exception 'Alokasi batch % belum seimbang (selisih %): override tidak berlaku untuk C21', r.batch_ref, r.diff using errcode = '23514';
    end if;
    if not public.week_writable(r.week_id) then
      raise exception 'Minggu batch % sudah ditutup', r.batch_ref using errcode = '42501';
    end if;
    select string_agg(k, ', ' order by k) into keys
      from (select distinct coalesce(l.key, l.item_code, '?') as k
              from public.allocation_line l
             where l.allocation_run_id = r.id and l.kg > 0 and coalesce(l.price_ref, 0) = 0) u;
    if keys is null then
      raise exception 'Alokasi batch % berharga acuan lengkap: diposting dengan posting biasa, bukan override', r.batch_ref using errcode = '22023';
    end if;
    update public.allocation_run
       set status = 'posted', posted_at = now(), posted_by = email,
           issues = (case when jsonb_typeof(r.issues) = 'array' then r.issues else '[]'::jsonb end)
                    || to_jsonb(format('override Finance: diposting tanpa harga acuan %s — %s (%s, %s)', keys, reason, email, to_char(today, 'YYYY-MM-DD')))
     where id = r.id;
    update public.batch set costing_status = 'posted' where id = r.batch_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.post_allocation_override(uuid[], text) from public, anon;
grant execute on function public.post_allocation_override(uuid[], text) to authenticated;

-------------------------------------------------------------------------------- Q-v5.2-13 week guard: opening_stock_flag
-- As 20261025000200 (A-REL-1, K69), one added line: inventory_accounting and finance may change opening_stock_flag while
-- the week is open (before: any role but admin was refused, after the upload had already written its other rows).
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
    if k = 'opening_stock_flag' and r in ('inventory_accounting','finance') and old.status = 'open' then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-------------------------------------------------------------------------------- Q-v5.2-18 Sales views: the last two cost-derived columns
-- Same as 20261025000200 (names, order, types), with holding_loss_per_day and downgrade_risk_rp inside case when sees.
-- sees: not Sales, or the week of the row has sales_sees_cost = true; no week / no parameter row = false for Sales.
create or replace view public.commercial_daily_sales with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff,
         (case when s.sees then c.cost_per_kg_ma end)::numeric(18,4) as cost_per_kg_ma,
         (case when s.sees then c.price_floor end)::numeric(18,4) as price_floor,
         c.price_list,
         (case when s.sees then c.margin_per_kg_list end)::numeric(18,4) as margin_per_kg_list,
         c.realized_price_7d,
         (case when s.sees then c.margin_per_kg_realized end)::numeric(18,4) as margin_per_kg_realized,
         (case when s.sees then c.holding_loss_per_day end)::numeric(18,2) as holding_loss_per_day,
         (case when s.sees then c.downgrade_risk_rp end)::numeric(18,2) as downgrade_risk_rp,
         c.urgency, c.priority_score, c.rank, c.ordered_today_kg
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
         (case when s.sees then c.holding_loss_per_day end)::numeric(18,2) as holding_loss_per_day,
         (case when s.sees then c.downgrade_risk_rp end)::numeric(18,2) as downgrade_risk_rp,
         c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
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

-- the markup per key is the floor's recipe: Sales do not read it (every other role reads it as before)
alter policy price_floor_rule_read on public.price_floor_rule
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
-- ... nor through the audit trail: audit_log keeps the old and new markup of every change, and every app user reads
-- audit_log. The Sales redaction of 20261017000200 (S4) lists the tables whose trail is not for Sales; the same list plus
-- price_floor_rule.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    alter policy audit_log_sales_redact on public.audit_log
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule']));
  else
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule']));
  end if;
end $$;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.3') on conflict (version) do nothing;

-------------------------------------------------------------------------------- 2/2 20261025000500_v52_fs.sql
-- v5.2 B5/2 — the FS as the reference of the dashboard (docs/PRD-v5.2-B-db.md B-R86; K70, O25–O27). Additive and re-runnable.
-- Registers schema version 5.2.4.
--
-- fs_statement_line: the rows of the Management Report sheets of the financial statements, per month, as they are in the
--   file (the source file name and its sha256 travel with every row). A row with locked_at never changes and is never
--   deleted, by any role (Admin included); a correction is a new version (K70). Imported by B-R91, not by this file.
-- fs_line_map: which app line is compared with which FS row, and with which sign (app amount × sign against the FS row).
--   Finance keeps it; status draft until Finance agrees. Seeded below with the 15 pairs of the minimum mapping of PRD
--   v5.2-A R68 (packages/engine/src/fs-map.ts FS_MIN_MAP), all draft.
-- Read: admin, finance, management, operations_director. Write: finance, admin. Nobody else, anon nothing.
-- release_override_policy gets C59 (Finance), by this migration only (O38).
-- audit_log is read by every app user and the audit trigger of fs_statement_line copies the old and new values (the
--   amounts) of an update or a delete: a restrictive policy keeps the trail of the two FS tables to the readers of the
--   tables. fs_line_map has no audit trigger (tg_audit names a row by id, key, item_code, account, email or week_id; this
--   table has none): updated_by and updated_at tell who wrote last.
--
-- Seed provenance. Every row number and label was read again from the workbook
-- reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx (sha256 7e68aa89…04c5), sheets "PL - Management Report" and
-- "BS - Management Report" (cells in column K = 31 Aug 2026 and L = 30 Sep 2026 of the same row); the app line is a key
-- of packages/engine/src/fs-app.ts (appPlLines / appBsLines). Both sides use the same sign (revenue and assets positive,
-- costs negative on the P&L; liabilities and equity positive on the balance sheet), hence sign 1 everywhere. Rows without
-- a pair in the app (rincian beban, aset tetap, pajak dibayar di muka, akrual, …) are left out: Finance adds them.
-- docs/v5.2/b5.md lists the cells and values per row; docs/v5.2/bukti/b5-fs-seed.txt is the check against the workbook.

-------------------------------------------------------------------------------- fs_statement_line (B-R86, K70)
create table if not exists public.fs_statement_line (
  id            uuid primary key default gen_random_uuid(),
  month         date not null check (extract(day from month) = 1),
  statement     text not null check (statement in ('PL', 'BS')),
  sheet         text not null,
  row_no        integer not null check (row_no > 0),
  line          text not null,
  amount        numeric(20,2),
  source_file   text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  version       integer not null default 1 check (version >= 1),
  locked_at     timestamptz,
  created_by    text default nullif(public.current_email(), ''),
  created_at    timestamptz not null default now(),
  unique (month, statement, row_no, version)
);
comment on table public.fs_statement_line is 'PRD v5.2 B-R86 / K70: rows of the FS Management Report per month as imported (file + sha256); a row with locked_at is never changed or deleted, a correction is a new version';
comment on column public.fs_statement_line.month is 'first day of the month the row belongs to';
comment on column public.fs_statement_line.row_no is 'Excel row of the sheet (the "b." number of fs_line_map)';
comment on column public.fs_statement_line.amount is 'Rupiah as in the file; null = the row has no number in that month';
comment on column public.fs_statement_line.locked_at is 'set = the row is final: no update, no delete, by any role';

-- a locked row does not change and is not deleted (42501), whoever asks: Admin and the service role included
create or replace function public.tg_fs_statement_line_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    raise exception 'Baris FS % % b.% versi % sudah dikunci (%): koreksi = versi baru', to_char(old.month, 'YYYY-MM'), old.statement, old.row_no, old.version, old.locked_at::text
      using errcode = '42501';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
revoke execute on function public.tg_fs_statement_line_lock() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fs_statement_line_lock' and tgrelid = 'public.fs_statement_line'::regclass) then
    create trigger fs_statement_line_lock before update or delete on public.fs_statement_line
      for each row execute function public.tg_fs_statement_line_lock();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.fs_statement_line'::regclass) then
    create trigger audit after insert or update or delete on public.fs_statement_line for each row execute function public.tg_audit();
  end if;
end $$;

-------------------------------------------------------------------------------- fs_line_map (B-R86, O25–O27)
create table if not exists public.fs_line_map (
  statement  text not null check (statement in ('PL', 'BS')),
  row_no     integer not null check (row_no > 0),
  app_line   text not null check (length(trim(app_line)) > 0),
  sign       integer not null check (sign in (-1, 1)),
  note       text,
  status     text not null default 'draft' check (status in ('draft', 'agreed')),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (statement, row_no)
);
comment on table public.fs_line_map is 'PRD v5.2 B-R86: pairs an app line with a row of fs_statement_line (compared as app amount × sign against the FS row); Finance keeps it, draft until agreed';
comment on column public.fs_line_map.row_no is 'Excel row of the FS sheet (PL or BS - Management Report), as fs_statement_line.row_no';
comment on column public.fs_line_map.app_line is 'key of an app line (packages/engine/src/fs-app.ts)';
comment on column public.fs_line_map.status is 'draft = proposed, agreed = Finance agreed the pair';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.fs_line_map'::regclass) then
    create trigger stamp before insert or update on public.fs_line_map for each row execute function public.tg_stamp();
  end if;
end $$;

-------------------------------------------------------------------------------- the audit trail of the FS rows is for their readers
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_fs_redact') then
    create policy audit_log_fs_redact on public.audit_log as restrictive for select to authenticated
      using (table_name <> all (array['fs_statement_line', 'fs_line_map'])
             or (select public.has_role('admin', 'finance', 'management', 'operations_director')));
  end if;
end $$;

-------------------------------------------------------------------------------- RLS and privileges (both tables)
alter table public.fs_statement_line enable row level security;
alter table public.fs_line_map enable row level security;

-- the default privileges of a Supabase database hand every table to anon, authenticated and service_role
revoke all on public.fs_statement_line from public, anon, authenticated, service_role;
revoke all on public.fs_line_map from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.fs_statement_line to authenticated, service_role;
grant select, insert, update, delete on public.fs_line_map to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['fs_statement_line', 'fs_line_map'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.has_role(''admin'', ''finance'', ''management'', ''operations_director'')))', t || '_read', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(''finance'', ''admin'')))', t || '_ins', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_upd') then
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(''finance'', ''admin''))) with check ((select public.has_role(''finance'', ''admin'')))', t || '_upd', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_del') then
      execute format('create policy %I on public.%I for delete to authenticated using ((select public.has_role(''finance'', ''admin'')))', t || '_del', t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------- seed: the minimum mapping (all draft)
-- PL = "PL - Management Report", BS = "BS - Management Report"; labels as read from column B of the workbook.
insert into public.fs_line_map (statement, row_no, app_line, sign, note, status, updated_by) values
  ('PL', 12, 'revenue',                   1, 'Σ Revenue - LB Main Product, LB By Product, Trading (jurnal + penyesuaian tutup buku)', 'draft', 'migrasi v52_fs'),                                   -- "Revenue"
  ('PL', 13, 'cogs',                      1, 'Σ COGS dan Other COGS; mode memo (O24 b): tanpa Selisih costing dan Biaya kapasitas idle', 'draft', 'migrasi v52_fs'),                              -- "Cost of Sales"
  ('PL', 15, 'gp',                        1, 'Revenue + COGS (mode memo: tanpa baris v5)', 'draft', 'migrasi v52_fs'),                                                                           -- " GROSS PROFIT "
  ('PL', 37, 'opex',                      1, 'semua baris selain Revenue, COGS, dan pendapatan/beban lain (termasuk penyusutan dan pajak)', 'draft', 'migrasi v52_fs'),                           -- "TOTAL OPERATING EXPENSES"
  ('PL', 49, 'other',                     1, 'Interest Expense, Other Income, Other Expense', 'draft', 'migrasi v52_fs'),                                                                        -- "TOTAL OTHER INCOME (EXPENSE)"
  ('PL', 51, 'nibt',                      1, 'NIBT jurnal; mode memo: tanpa NIBT manajemen', 'draft', 'migrasi v52_fs'),                                                                         -- "INCOME (LOSS) BEFORE TAX"
  ('BS', 14, 'kas',                       1, 'saldo kas dan bank akhir bulan (TB awal + jurnal)', 'draft', 'migrasi v52_fs'),                                                                    -- "Cash and cash equivalents"
  ('BS', 17, 'piutang_pihak_ketiga',      1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Receivables - Third Parties"
  ('BS', 18, 'piutang_pihak_berelasi',    1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Receivables - Related Parties"
  ('BS', 23, 'persediaan_produk',         1, 'saldo buku besar (bs_line Inventory - Product)', 'draft', 'migrasi v52_fs'),                                                                       -- "Inventory - Product"
  ('BS', 24, 'persediaan_trading',        1, 'saldo buku besar (bs_line Inventory - Trading)', 'draft', 'migrasi v52_fs'),                                                                       -- "Inventory - Trading"
  ('BS', 47, 'utang_dagang_pihak_ketiga', 1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Payables - Third Parties"
  ('BS', 48, 'utang_dagang_afiliasi',     1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Payables - Affiliates"
  ('BS', 51, 'utang_lain_afiliasi',       1, 'pinjaman dan utang lain afiliasi', 'draft', 'migrasi v52_fs'),                                                                                     -- "Other Payable - Related Parties"
  ('BS', 77, 'ekuitas',                   1, 'Shareholder Equity + Retained earnings + laba tahun berjalan', 'draft', 'migrasi v52_fs')                                                          -- "TOTAL EQUITY"
on conflict (statement, row_no) do nothing;

-------------------------------------------------------------------------------- C59: Finance's override of the FS reconciliation
insert into public.release_override_policy (code, allowed_roles, note)
values ('C59', array['finance'], 'PRD v5.2 O25–O27: rekonsiliasi dashboard dengan FS (selisih di atas toleransi, atau FS belum diimpor); Finance dengan alasan dan bukti')
on conflict (code) do nothing;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.4') on conflict (version) do nothing;

-------------------------------------------------------------------------------- bukti bundel pada registry
-- sha256 dari kedua file disambung urut nama (lihat kepala berkas)
update public.schema_registry set bundle_sha256 = 'bb43b8ff231ff204d0db570f1eec3a7d4d666cfee964161c6377d988eb5c56e7' where version in ('5.2.3', '5.2.4');

-------------------------------------------------------------------------------- PostgREST memuat ulang skema (B-REL-6)
notify pgrst, 'reload schema';

-------------------------------------------------------------------------------- cek: semua baris harus true
select m.no, m.cek, m.ada
from (values
  (1,   '0400 batch.lb_price_source: text, boleh kosong, check tiga sumber (R51)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'batch' and column_name = 'lb_price_source' and data_type = 'text' and is_nullable = 'YES')
         and (select pg_get_constraintdef(oid) like '%keputusan_kelas%' and pg_get_constraintdef(oid) like '%keputusan_semua_kelas%' and pg_get_constraintdef(oid) like '%manual%'
                from pg_constraint where conname = 'batch_lb_price_source_check' and conrelid = 'public.batch'::regclass)),
  (2,   '0400 plan_check_reason.plan_week_id: FK ke plan_week, unik per versi dan kode, versi harus minggu yang sama (A2)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plan_check_reason' and column_name = 'plan_week_id' and data_type = 'uuid' and is_nullable = 'YES')
         and exists (select 1 from pg_constraint where conrelid = 'public.plan_check_reason'::regclass and contype = 'f' and confrelid = 'public.plan_week'::regclass)
         and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'plan_check_reason_plan_code' and indexdef like 'CREATE UNIQUE INDEX%(plan_week_id, code)%deleted_at IS NULL%')
         and exists (select 1 from pg_trigger where tgname = 'plan_check_reason_scope' and tgrelid = 'public.plan_check_reason'::regclass)),
  (3,   '0400 plan_week_class.detail: jsonb, boleh kosong, check object atau array (A2)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plan_week_class' and column_name = 'detail' and data_type = 'jsonb' and is_nullable = 'YES')
         and exists (select 1 from pg_constraint where conname = 'plan_week_class_detail_check' and conrelid = 'public.plan_week_class'::regclass)),
  (4,   '0400 post_allocation_override: definer, search_path kosong, untuk authenticated, bukan anon (A3, R61)',
         (select p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x = 'search_path=""') from pg_proc p where p.oid = to_regprocedure('public.post_allocation_override(uuid[],text)'))
         and has_function_privilege('authenticated', 'public.post_allocation_override(uuid[],text)', 'execute')
         and not has_function_privilege('anon', 'public.post_allocation_override(uuid[],text)', 'execute')),
  (5,   '0400 override posting: tidak ada policy UPDATE untuk finance di allocation_run dan batch',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('allocation_run', 'batch') and cmd in ('UPDATE', 'ALL') and qual like '%finance%')),
  (6,   '0400 fungsi override: kalimat override Finance dan batch.costing_status posted dalam satu fungsi',
         (select prosrc like '%override Finance: diposting tanpa harga acuan%' and prosrc like '%costing_status = ''posted''%' and prosrc like '%week_writable%'
            from pg_proc where oid = to_regprocedure('public.post_allocation_override(uuid[],text)'))),
  (7,   '0400 tg_week_guard: opening_stock_flag untuk inventory_accounting dan finance saat minggu open; aturan update_date tetap (Q-v5.2-13)',
         (select prosrc like '%k = ''opening_stock_flag'' and r in (''inventory_accounting'',''finance'') and old.status = ''open''%' and prosrc like '%kgr.advance%'
            from pg_proc where oid = to_regprocedure('public.tg_week_guard()'))),
  (8,   '0400 view Sales v4 dan v5: holding_loss_per_day dan downgrade_risk_rp di dalam sales_sees_cost; 20 dan 23 kolom (Q-v5.2-18)',
         regexp_replace(pg_get_viewdef('public.commercial_daily_sales'::regclass), '\s+', ' ', 'g') like '%CASE WHEN s.sees THEN c.holding_loss_per_day%'
         and regexp_replace(pg_get_viewdef('public.commercial_daily_sales'::regclass), '\s+', ' ', 'g') like '%CASE WHEN s.sees THEN c.downgrade_risk_rp%'
         and regexp_replace(pg_get_viewdef('public.commercial_daily_sales_v5'::regclass), '\s+', ' ', 'g') like '%CASE WHEN s.sees THEN c.holding_loss_per_day%'
         and regexp_replace(pg_get_viewdef('public.commercial_daily_sales_v5'::regclass), '\s+', ' ', 'g') like '%CASE WHEN s.sees THEN c.downgrade_risk_rp%'
         and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales') = 20
         and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales_v5') = 23),
  (9,   '0400 dua view Sales: SELECT untuk authenticated, tanpa hak anon',
         has_table_privilege('authenticated', 'public.commercial_daily_sales', 'select') and has_table_privilege('authenticated', 'public.commercial_daily_sales_v5', 'select')
         and not has_table_privilege('anon', 'public.commercial_daily_sales', 'select') and not has_table_privilege('anon', 'public.commercial_daily_sales_v5', 'select')),
  (10,  '0400 price_floor_rule_read: Sales tidak membaca (Q-v5.2-18)',
         (select pg_get_expr(polqual, polrelid) like '%sales%' from pg_policy where polname = 'price_floor_rule_read' and polrelid = 'public.price_floor_rule'::regclass)),
  (11,  '0400 audit_log: redaksi Sales memuat price_floor_rule (jejak ubah markup tidak terbaca Sales, Q-v5.2-18)',
         (select pg_get_expr(polqual, polrelid) like '%price_floor_rule%' and pg_get_expr(polqual, polrelid) like '%allocation_run%' and not polpermissive
            from pg_policy where polname = 'audit_log_sales_redact' and polrelid = 'public.audit_log'::regclass)),
  (12,  '0400 versi 5.2.3 tercatat',
         exists (select 1 from public.schema_registry where version = '5.2.3')),
  (13,  '0500 fs_statement_line: kolom persis B-R86, unik (month, statement, row_no, version), RLS, tanpa hak anon',
         (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'fs_statement_line')
           = 'amount,created_at,created_by,id,line,locked_at,month,row_no,sheet,source_file,source_sha256,statement,version'
         and exists (select 1 from pg_constraint where conrelid = 'public.fs_statement_line'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (month, statement, row_no, version)')
         and (select c.relrowsecurity from pg_class c where c.oid = 'public.fs_statement_line'::regclass)
         and not has_table_privilege('anon', 'public.fs_statement_line', 'select') and not has_table_privilege('anon', 'public.fs_statement_line', 'insert')),
  (14,  '0500 fs_statement_line: baris locked_at tidak bisa diubah atau dihapus siapa pun (trigger, 42501)',
         exists (select 1 from pg_trigger where tgname = 'fs_statement_line_lock' and tgrelid = 'public.fs_statement_line'::regclass and not tgisinternal)
         and (select prosrc like '%old.locked_at is not null%' and prosrc like '%42501%' from pg_proc where oid = to_regprocedure('public.tg_fs_statement_line_lock()'))),
  (15,  '0500 fs tabel: authenticated tanpa truncate, references, trigger; service_role tanpa truncate',
         not has_table_privilege('authenticated', 'public.fs_statement_line', 'truncate') and not has_table_privilege('authenticated', 'public.fs_line_map', 'truncate')
         and not has_table_privilege('authenticated', 'public.fs_statement_line', 'references') and not has_table_privilege('authenticated', 'public.fs_statement_line', 'trigger')
         and not has_table_privilege('service_role', 'public.fs_statement_line', 'truncate') and not has_table_privilege('service_role', 'public.fs_line_map', 'truncate')),
  (16,  '0500 fs_line_map: kolom persis, PK (statement, row_no), status draft/agreed, sign -1/1, RLS, tanpa hak anon',
         (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'fs_line_map')
           = 'app_line,note,row_no,sign,statement,status,updated_at,updated_by'
         and exists (select 1 from pg_constraint where conrelid = 'public.fs_line_map'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (statement, row_no)')
         and exists (select 1 from pg_constraint where conrelid = 'public.fs_line_map'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%draft%' and pg_get_constraintdef(oid) like '%agreed%')
         and exists (select 1 from pg_constraint where conrelid = 'public.fs_line_map'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sign%' and pg_get_constraintdef(oid) like '%-1%')
         and (select c.relrowsecurity from pg_class c where c.oid = 'public.fs_line_map'::regclass)
         and not has_table_privilege('anon', 'public.fs_line_map', 'select') and not has_table_privilege('anon', 'public.fs_line_map', 'insert')),
  (17,  '0500 fs tabel: baca admin/finance/management/operations_director, tulis finance/admin (kedua tabel)',
         (select count(*) from pg_policies where schemaname = 'public' and tablename in ('fs_statement_line', 'fs_line_map') and cmd = 'SELECT'
            and qual like '%admin%' and qual like '%finance%' and qual like '%management%' and qual like '%operations_director%') = 2
         and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('fs_statement_line', 'fs_line_map') and cmd in ('INSERT', 'UPDATE', 'DELETE')
            and coalesce(qual, with_check) like '%finance%' and coalesce(qual, with_check) like '%admin%' and coalesce(qual, with_check) not like '%management%' and coalesce(qual, with_check) not like '%sales%') = 6),
  (18,  '0500 seed fs_line_map: 15 pasangan minimum (statement, baris) dari FS_MIN_MAP',
         (select count(*) from public.fs_line_map where (statement, row_no) in (('PL', 12), ('PL', 13), ('PL', 15), ('PL', 37), ('PL', 49), ('PL', 51),
            ('BS', 14), ('BS', 17), ('BS', 18), ('BS', 23), ('BS', 24), ('BS', 47), ('BS', 48), ('BS', 51), ('BS', 77))) = 15),
  (19,  '0500 kebijakan override C59 (Finance)',
         (select allowed_roles = array['finance'] from public.release_override_policy where code = 'C59')),
  (20,  '0500 audit_log: jejak tabel FS hanya untuk pembaca tabelnya (policy restrictif)',
         exists (select 1 from pg_policy where polname = 'audit_log_fs_redact' and polrelid = 'public.audit_log'::regclass and not polpermissive
                   and pg_get_expr(polqual, polrelid) like '%fs_statement_line%' and pg_get_expr(polqual, polrelid) like '%operations_director%')),
  (21,  '0500 fungsi pembantu trigger (kunci FS, minggu alasan) tidak untuk klien',
         not has_function_privilege('authenticated', 'public.tg_fs_statement_line_lock()', 'execute') and not has_function_privilege('anon', 'public.tg_fs_statement_line_lock()', 'execute')
         and not has_function_privilege('authenticated', 'public.tg_plan_check_reason_scope()', 'execute') and not has_function_privilege('anon', 'public.tg_plan_check_reason_scope()', 'execute')),
  (22,  'semua SECURITY DEFINER di public: search_path tetap',
         not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
                      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))),
  (23,  'tidak ada fungsi SECURITY DEFINER di public yang bisa dieksekusi anon',
         not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute'))),
  (24,  'satu fungsi per nama untuk yang ditambah atau diganti (tanpa overload baru)',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('post_allocation_override', 'tg_week_guard', 'tg_fs_statement_line_lock', 'tg_plan_check_reason_scope')) = 4),
  (25,  '0500 versi 5.2.4 tercatat dan schema_version() = 5.2.4 atau lebih',
         exists (select 1 from public.schema_registry where version = '5.2.4') and string_to_array(public.schema_version(), '.')::int[] >= array[5,2,4]),
  (26,  'bundle_sha256 terisi untuk 5.2.3 dan 5.2.4',
         (select count(*) from public.schema_registry where version in ('5.2.3', '5.2.4') and bundle_sha256 = 'bb43b8ff231ff204d0db570f1eec3a7d4d666cfee964161c6377d988eb5c56e7') = 2)
) as m(no, cek, ada)
order by m.no;
