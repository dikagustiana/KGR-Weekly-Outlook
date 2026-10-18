-- KGR-OS: migrasi v5.2 B6 (Sales tidak lagi membaca rencana dan demand), untuk SQL Editor Supabase (satu kali Run).
-- Dijalankan MANUSIA oleh koordinator, bukan oleh agen kode. BELUM dijalankan di KGR-OS.
--
-- Urutan wajib: (1) kode irisan A1c (cabang v5.2/a1c-db-objects: jawab surplus Sales lewat view, halaman Demand, Kontrol, snapshot,
-- pratinjau Outlook dan kartu Input tanpa membaca plan_week atau demand_weekly sebagai Sales) sudah ada di production; (2) backup
-- (B0-1); (3) bundel ini. Dijalankan sebelum kode itu ada di production, kolom dan halaman Sales yang masih membaca dua tabel itu
-- tampil kosong atau menampilkan 0. Prasyarat basis data: bundel B5 terpasang (schema_version() = 5.2.4 atau lebih); bundel ini
-- menolak jalan bila belum (cek prasyarat di bawah).
--
-- Isi: file supabase/migrations/20261025000600_v52_sales_plan.sql apa adanya. Tambahan di luar file migrasi hanya empat: cek
-- prasyarat di awal, pengisian bundle_sha256 di registry, notify pgrst, dan tabel cek di akhir. SQL Editor menjalankan semuanya
-- dalam satu transaksi: error di mana pun membatalkan semuanya. File bisa dijalankan ulang (bukti: docs/v5.2/bukti/b6-migrasi-rerun.txt,
-- docs/v5.2/bukti/b6-bundel.txt). Hasil yang benar: tabel cek 15 baris, kolom ada semuanya true; select public.schema_version() = 5.2.5.
-- Tidak ada flag yang dinyalakan, tidak ada data yang ditambah selain baris schema_registry 5.2.5.
--
-- Yang berubah bagi pengguna (ringkas; rinci di docs/v5.2/b6.md):
--   * Sales tidak lagi membaca plan_week (ekor, output dan surplus per SKU, frozen, downgrade, persetujuan) dan demand_weekly
--     (demand per SKU per minggu). Peran lain membaca keduanya seperti sebelumnya. Hak tulis tidak berubah.
--   * jejak ubah di audit_log untuk plan_week, plan_week_class, demand_weekly dan demand_class_weekly (nilai lama dan baru: ekor, kg,
--     surplus) tidak lagi terbaca Sales: daftar redaksi Sales di audit_log memuat keempat tabel itu.
--   * view surplus_for_sales_v52 (surplus SKU yang ditugaskan kepada Sales, tanpa detail rencana) tetap memberi Sales barisnya, dan
--     kini menamai surplus per unit produksi ("Karkas") dengan kunci SKU "RPA|Karkas", sama seperti jawaban dan assignment
--     (sebelumnya surplus berkunci unit tidak terlihat oleh Sales dan terpecah dua baris bagi Kepala Sales). Kolom view tidak berubah.
--   * fungsi pemeriksa versi alasan C58 (trigger plan_check_reason) dijalankan sebagai pemiliknya (SECURITY DEFINER, search_path
--     tetap, tanpa execute untuk klien); isi dan tanda tangan tidak berubah.
--
-- sha256 file sumber (cek: sha256sum supabase/migrations/<file>); satu file, jadi sama dengan schema_registry.bundle_sha256:
--   b8e5af9f2401e5cdb0674e007f1c9e935b356f673cf9bb4b2851e221357fdd65  20261025000600_v52_sales_plan.sql

-------------------------------------------------------------------------------- prasyarat: B5 sudah terpasang
do $$
begin
  if to_regprocedure('public.schema_version()') is null or to_regclass('public.schema_registry') is null then
    raise exception 'Bundel B2 dan B5 belum terpasang di database ini (docs/v5.2/kgr-os-migrasi-v52-b2.sql, lalu docs/v5.2/kgr-os-migrasi-v52-b5.sql); v5.2 B6 tidak dijalankan';
  end if;
  if string_to_array(coalesce(public.schema_version(), '0'), '.')::int[] < array[5,2,4] then
    raise exception 'schema_version() = %, B6 butuh 5.2.4 atau lebih (bundel B5); v5.2 B6 tidak dijalankan', public.schema_version();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_week' and policyname = 'plan_week_read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demand_weekly' and policyname = 'demand_weekly_read')
     or to_regclass('public.surplus_for_sales_v52') is null or to_regclass('public.surplus_response') is null or to_regclass('public.sales_assignment') is null
     or to_regprocedure('public.assignment_covers(text,text)') is null or to_regprocedure('public.tg_plan_check_reason_scope()') is null
     or to_regprocedure('public.has_role(text[])') is null or to_regprocedure('public.is_app_user()') is null or to_regprocedure('public.current_email()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plan_check_reason' and column_name = 'plan_week_id') then
    raise exception 'Objek bundel B2 atau B5 tidak lengkap di database ini (plan_week_read, demand_weekly_read, surplus_for_sales_v52, tg_plan_check_reason_scope, plan_check_reason.plan_week_id); v5.2 B6 tidak dijalankan';
  end if;
end $$;

-------------------------------------------------------------------------------- 1/1 20261025000600_v52_sales_plan.sql
-- v5.2 B6 — Sales no longer read PPIC's plan and demand (docs/v5.2/b6.md; docs/v5/QUESTIONS.md Q-v5.2-15). Additive and
-- re-runnable: policies altered, one trigger function and one view replaced (same signature, same columns). Registers schema version 5.2.5.
--
-- Q-v5.2-15 closes in steps. B2 (20261025000200, A-REL-3) took plan_week_class and demand_class_weekly away from Sales and
-- gave them the view surplus_for_sales_v52 (the surplus of their assigned keys, nothing of the plan). Left open there, on
-- purpose, until the code stopped reading them as Sales: plan_week (heads, output and surplus per key, frozen kg, the Rp
-- downgrade, approval) and demand_weekly (the demand per SKU and week: PO kg, weighted kg, net kg, heads). The code of v5.2
-- A1c no longer reads either as Sales (the answer to the surplus goes through the view; the Demand page, the control list and
-- the snapshot, the management preview and the Input card say "tidak ditampilkan untuk Sales"), so the read policies lose Sales:
--   plan_week_read, demand_weekly_read: every app user, except Sales (the same shape as B2's plan_week_class_read).
-- Write policies, the restrictive "no client write" policies of the demand mart and the approval policy of Finance are not touched.
-- The view surplus_for_sales_v52 keeps giving Sales their rows: it is not security_invoker, so it reads plan_week as its owner
-- (as B2 relies on), and the foreign key of surplus_response.plan_week_id is checked as the owner of plan_week as well, so a
-- Sales answer to the surplus still goes in (both proved in supabase/tests/rls_roles.sql, block "v5.2 B6").
--
-- Three more changes in this file, all found while checking what else depends on, or bypasses, a Sales read of plan_week (b6.md):
--   * (Q-v5.2-74) the audit trail. audit_log is read by every app user and the audit trigger of these tables copies the old and new
--     values of every change (plan_week: heads, output and surplus per key, downgrade; demand_weekly and demand_class_weekly: kg per
--     SKU and size; plan_week_class: kg LB and heads per class), so a table closed to Sales stayed readable to them through its
--     trail. The Sales redaction of audit_log (the restrictive policy of 20261017000200, extended by B5) now lists the four tables
--     Sales no longer read: plan_week, plan_week_class, demand_weekly, demand_class_weekly. plan_day follows its own table
--     (Q-v5.2-72): still readable, so its trail is too.
--   * (Q-v5.2-73) the BEFORE trigger of plan_check_reason (B5, A2: the plan version of a reason must belong to the reason's week)
--     read plan_week as the user who writes. Nobody but Admin and PPIC may write a reason, but the trigger fires before the
--     row-level security check, so a Sales user who tried to would be told "bukan milik versi rencana" (the trigger saw no plan)
--     instead of being refused by the policy. It is now SECURITY DEFINER (search_path fixed, no execute for clients, same body and
--     signature): an integrity check does not depend on who may read the table.
--   * (Q-v5.2-71) the view. The plan lists its surplus per production unit ("Karkas"); the answers and the assignments name the SKU
--     key ("RPA|Karkas"). B2's view joined the two on the raw key, so for a unit-keyed plan it showed Sales nothing (an assignment
--     RPA|Karkas does not cover the key "Karkas") and showed the lead two rows for one surplus (the plan row without its answer, the
--     answer without its plan kg). The view now names a unit by the base key of its RPA SKU, the way the app stores an answer
--     (apps/web/lib/v5/surplus.ts surplusKeys). Same columns, names, order and types as B2; a key that already has a "|" is unchanged.

-------------------------------------------------------------------------------- plan_week and demand_weekly: not read by Sales
alter policy plan_week_read on public.plan_week
  using ((select public.is_app_user()) and not (select public.has_role('sales')));
alter policy demand_weekly_read on public.demand_weekly
  using ((select public.is_app_user()) and not (select public.has_role('sales')));

-------------------------------------------------------------------------------- the audit trail of the closed tables is not for Sales either
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    alter policy audit_log_sales_redact on public.audit_log
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly']));
  else
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly']));
  end if;
end $$;

-------------------------------------------------------------------------------- the version check of plan_check_reason runs as its owner
create or replace function public.tg_plan_check_reason_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.plan_week_id is not null
     and not exists (select 1 from public.plan_week p where p.id = new.plan_week_id and p.week_start = new.week_start) then
    raise exception 'Alasan % untuk minggu % bukan milik versi rencana yang disebut', new.code, new.week_start using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_plan_check_reason_scope() from public, anon, authenticated;

-------------------------------------------------------------------------------- surplus_for_sales_v52: a unit is the base key of its RPA SKU
create or replace view public.surplus_for_sales_v52 with (security_barrier = true) as
  with plan_surplus as (
    select p.id as plan_week_id,
           case when s.key like '%|%' then s.key else 'RPA|' || s.key end as key,
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

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.5') on conflict (version) do nothing;

-------------------------------------------------------------------------------- bukti bundel pada registry
-- sha256 file di atas (lihat kepala berkas)
update public.schema_registry set bundle_sha256 = 'b8e5af9f2401e5cdb0674e007f1c9e935b356f673cf9bb4b2851e221357fdd65' where version = '5.2.5';

-------------------------------------------------------------------------------- PostgREST memuat ulang skema (B-REL-6)
notify pgrst, 'reload schema';

-------------------------------------------------------------------------------- cek: semua baris harus true
select m.no, m.cek, m.ada
from (values
  (1,  '0600 plan_week_read: SELECT untuk semua app user kecuali Sales (Q-v5.2-15)',
        (select pg_get_expr(polqual, polrelid) like '%is_app_user%' and pg_get_expr(polqual, polrelid) like '%has_role%' and pg_get_expr(polqual, polrelid) like '%sales%' and pg_get_expr(polqual, polrelid) like '%NOT%'
                and polcmd = 'r' and polpermissive from pg_policy where polname = 'plan_week_read' and polrelid = 'public.plan_week'::regclass)),
  (2,  '0600 demand_weekly_read: SELECT untuk semua app user kecuali Sales (Q-v5.2-15)',
        (select pg_get_expr(polqual, polrelid) like '%is_app_user%' and pg_get_expr(polqual, polrelid) like '%has_role%' and pg_get_expr(polqual, polrelid) like '%sales%' and pg_get_expr(polqual, polrelid) like '%NOT%'
                and polcmd = 'r' and polpermissive from pg_policy where polname = 'demand_weekly_read' and polrelid = 'public.demand_weekly'::regclass)),
  (3,  '0600 policy tulis plan_week dan demand_weekly tidak berubah (7 policy)',
        (select count(*) from pg_policies where schemaname = 'public' and policyname in ('plan_week_ins', 'plan_week_upd', 'plan_week_approve', 'demand_weekly_ins', 'demand_weekly_upd', 'demand_weekly_no_client_ins', 'demand_weekly_no_client_upd')) = 7),
  (4,  '0600 tidak ada policy lain yang membuka plan_week atau demand_weekly untuk SELECT',
        (select count(*) from pg_policies where schemaname = 'public' and tablename in ('plan_week', 'demand_weekly') and cmd in ('SELECT', 'ALL')) = 2),
  (5,  '0600 audit_log_sales_redact: restriktif, memuat plan_week, plan_week_class, demand_weekly, demand_class_weekly dan daftar lama (Q-v5.2-74)',
        (select not polpermissive and pg_get_expr(polqual, polrelid) like '%plan_week%' and pg_get_expr(polqual, polrelid) like '%plan_week_class%' and pg_get_expr(polqual, polrelid) like '%demand_weekly%'
                and pg_get_expr(polqual, polrelid) like '%demand_class_weekly%' and pg_get_expr(polqual, polrelid) like '%price_floor_rule%' and pg_get_expr(polqual, polrelid) like '%allocation_run%'
                and pg_get_expr(polqual, polrelid) like '%closing_adjustment%'
           from pg_policy where polname = 'audit_log_sales_redact' and polrelid = 'public.audit_log'::regclass)),
  (6,  '0600 view surplus_for_sales_v52: 11 kolom, nama, urutan dan tipe seperti B2',
        (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'surplus_for_sales_v52')
          = 'week_start:date,plan_version:integer,plan_week_id:uuid,key:text,plan_surplus_kg:numeric,answered_surplus_kg:numeric,response:text,absorb_kg:numeric,price:numeric,responded_by:text,responded_at:timestamp with time zone'),
  (7,  '0600 view surplus_for_sales_v52: unit produksi bernama kunci SKU RPA (Q-v5.2-71)',
        regexp_replace(pg_get_viewdef('public.surplus_for_sales_v52'::regclass), '\s+', ' ', 'g') like '%''RPA|''::text || s.key%'),
  (8,  '0600 view surplus_for_sales_v52: security_barrier, SELECT untuk authenticated, tanpa hak anon',
        (select coalesce(reloptions::text, '') like '%security_barrier=true%' from pg_class where oid = 'public.surplus_for_sales_v52'::regclass)
        and has_table_privilege('authenticated', 'public.surplus_for_sales_v52', 'select') and not has_table_privilege('anon', 'public.surplus_for_sales_v52', 'select')),
  (9,  '0600 tg_plan_check_reason_scope: SECURITY DEFINER, search_path kosong, tanpa execute untuk klien, trigger masih terpasang (Q-v5.2-73)',
        (select p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x = 'search_path=""') from pg_proc p where p.oid = to_regprocedure('public.tg_plan_check_reason_scope()'))
        and not has_function_privilege('authenticated', 'public.tg_plan_check_reason_scope()', 'execute') and not has_function_privilege('anon', 'public.tg_plan_check_reason_scope()', 'execute')
        and exists (select 1 from pg_trigger where tgname = 'plan_check_reason_scope' and tgrelid = 'public.plan_check_reason'::regclass and tgfoid = to_regprocedure('public.tg_plan_check_reason_scope()'))),
  (10, 'semua SECURITY DEFINER di public: search_path tetap',
        not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
                     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))),
  (11, 'tidak ada fungsi SECURITY DEFINER di public yang bisa dieksekusi anon',
        not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute'))),
  (12, 'satu fungsi per nama untuk yang diganti (tanpa overload baru)',
        (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_plan_check_reason_scope') = 1),
  (13, '0600 versi 5.2.5 tercatat dan schema_version() = 5.2.5 atau lebih',
        exists (select 1 from public.schema_registry where version = '5.2.5') and string_to_array(public.schema_version(), '.')::int[] >= array[5,2,5]),
  (14, 'bundle_sha256 terisi untuk 5.2.5',
        (select count(*) from public.schema_registry where version = '5.2.5' and bundle_sha256 = 'b8e5af9f2401e5cdb0674e007f1c9e935b356f673cf9bb4b2851e221357fdd65') = 1),
  (15, 'versi sebelumnya tetap tercatat (5.2.0 sampai 5.2.4)',
        (select count(*) from public.schema_registry where version in ('5.2.0', '5.2.1', '5.2.2', '5.2.3', '5.2.4')) = 5)
) as m(no, cek, ada)
order by m.no;
