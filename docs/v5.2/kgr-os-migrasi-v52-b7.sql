-- KGR-OS: migrasi v5.2 B7 (Sales tidak lagi membaca plan_day), untuk SQL Editor Supabase (satu kali Run).
-- Dijalankan MANUSIA oleh koordinator, bukan oleh agen kode. BELUM dijalankan di KGR-OS.
--
-- Urutan wajib: (1) kode irisan A1c (sudah di production: tidak ada bacaan plan_day sebagai Sales); (2) bundel B6
-- (docs/v5.2/kgr-os-migrasi-v52-b6.sql, schema_version() = 5.2.5); (3) backup (B0-1); (4) bundel ini. Bundel ini menolak jalan bila B6
-- belum terpasang (cek prasyarat di bawah). Dijalankan sebelum kode A1c ada di production, kolom dan halaman Sales yang masih membaca
-- plan_day (rencana harian) tampil kosong.
--
-- Isi: file supabase/migrations/20261025000700_v52_sales_plan_day.sql apa adanya. Tambahan di luar file migrasi hanya empat: cek
-- prasyarat di awal, pengisian bundle_sha256 di registry, notify pgrst, dan tabel cek di akhir. SQL Editor menjalankan semuanya dalam
-- satu transaksi: error di mana pun membatalkan semuanya. File bisa dijalankan ulang (bukti: docs/v5.2/bukti/b7-migrasi-rerun.txt,
-- docs/v5.2/bukti/b7-bundel.txt). Hasil yang benar: tabel cek 13 baris, kolom ada semuanya true; select public.schema_version() = 5.2.6.
-- Tidak ada flag yang dinyalakan, tidak ada data yang ditambah selain baris schema_registry 5.2.6.
--
-- Yang berubah bagi pengguna (ringkas; rinci di docs/v5.2/b7.md):
--   * Sales tidak lagi membaca plan_day (ekor per tanggal potong, kelas berat, pola potong, pemasok dan target_kg_by_key rencana).
--     Peran lain membaca seperti sebelumnya. Hak tulis (Admin dan PPIC) tidak berubah.
--   * jejak ubah plan_day di audit_log (nilai lama dan baru) tidak lagi terbaca Sales: daftar redaksi Sales memuat plan_day di
--     samping dua puluh enam tabel yang sudah ada di daftar (B2, B5, B6).
--
-- sha256 file sumber (cek: sha256sum supabase/migrations/<file>); satu file, jadi sama dengan schema_registry.bundle_sha256:
--   8ed656125d82d5aa03701ef997a7200321ea2913c1de8043b89d11e91b9b9acb  20261025000700_v52_sales_plan_day.sql

-------------------------------------------------------------------------------- prasyarat: B6 sudah terpasang
do $$
begin
  if to_regprocedure('public.schema_version()') is null or to_regclass('public.schema_registry') is null then
    raise exception 'Bundel B6 belum terpasang di database ini (docs/v5.2/kgr-os-migrasi-v52-b6.sql); v5.2 B7 tidak dijalankan';
  end if;
  if string_to_array(coalesce(public.schema_version(), '0'), '.')::int[] < array[5,2,5] then
    raise exception 'schema_version() = %, B7 butuh 5.2.5 atau lebih (bundel B6); v5.2 B7 tidak dijalankan', public.schema_version();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_day' and policyname = 'plan_day_read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_week' and policyname = 'plan_week_read' and qual like '%sales%')
     or to_regprocedure('public.has_role(text[])') is null or to_regprocedure('public.is_app_user()') is null then
    raise exception 'Objek bundel B6 tidak lengkap di database ini (plan_day_read, audit_log_sales_redact, plan_week_read tanpa Sales); v5.2 B7 tidak dijalankan';
  end if;
end $$;

-------------------------------------------------------------------------------- 1/1 20261025000700_v52_sales_plan_day.sql
-- v5.2 B7 — Sales no longer read plan_day (docs/v5.2/b7.md; docs/v5/QUESTIONS.md Q-v5.2-72, Q-v5.2-74). Additive and re-runnable:
-- two policies altered, nothing dropped, renamed or replaced. Registers schema version 5.2.6.
--
-- B6 (20261025000600) closed plan_week and demand_weekly to Sales and left plan_day open on purpose: Q-v5.2-15 names the first two,
-- and the code of v5.2 A1c still had to stop reading plan_day as Sales first. It has (apps/web: the readers of plan_day are
-- loadPlanning, the copy to batch and the plan writes; none runs as Sales, proved by the register test planning-readers.test.ts and by
-- sales-plan-reads.test.tsx, where a Sales session never asks for plan_day). plan_day is the plan's days: heads per cut date, weight class,
-- cut pattern, supplier and target_kg_by_key (the plan's kg per SKU per day), so a Sales reader of it saw what plan_week now hides.
-- Q-v5.2-72 closes it the way B6 closed its two tables:
--   plan_day_read: every app user, except Sales (the same shape as plan_week_read, demand_weekly_read, plan_week_class_read).
-- The write policies (plan_day_ins, plan_day_upd: Admin and PPIC) are not touched.
--
-- Second change, the audit trail (Q-v5.2-74: "plan_day ikut saat Q-v5.2-72 dikerjakan"). tg_audit copies the old and new values of
-- every change of plan_day into audit_log (heads, supplier, target_kg_by_key per day), audit_log_read opens all of audit_log to every app
-- user and only the restrictive audit_log_sales_redact narrows it for Sales. plan_day joins its list, which keeps every table it names
-- since B5/B6 (the twenty-six of B6) and gains plan_day.
--
-- Nothing else reads plan_day as the invoker (checked in a migrated database, b7.md section 4): no function, view, materialized view,
-- policy of another table, trigger or constraint names it. Its own triggers do not read it as the invoker (tg_audit is SECURITY DEFINER,
-- tg_stamp reads no table), its foreign key to plan_week is checked as the table owner, and the rebuild reads it with the service client.

-------------------------------------------------------------------------------- plan_day: not read by Sales
alter policy plan_day_read on public.plan_day
  using ((select public.is_app_user()) and not (select public.has_role('sales')));

-------------------------------------------------------------------------------- the audit trail of plan_day is not for Sales either
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact') then
    alter policy audit_log_sales_redact on public.audit_log
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly','plan_day']));
  else
    create policy audit_log_sales_redact on public.audit_log as restrictive for select to authenticated
      using (not (select public.has_role('sales')) or table_name <> all (array[
        'cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly','plan_day']));
  end if;
end $$;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.6') on conflict (version) do nothing;

-------------------------------------------------------------------------------- bukti bundel pada registry
-- sha256 file di atas (lihat kepala berkas)
update public.schema_registry set bundle_sha256 = '8ed656125d82d5aa03701ef997a7200321ea2913c1de8043b89d11e91b9b9acb' where version = '5.2.6';

-------------------------------------------------------------------------------- PostgREST memuat ulang skema (B-REL-6)
notify pgrst, 'reload schema';

-------------------------------------------------------------------------------- cek: semua baris harus true
select m.no, m.cek, m.ada
from (values
  (1,  '0700 plan_day_read: SELECT untuk semua app user kecuali Sales (Q-v5.2-72)',
        coalesce((select pg_get_expr(polqual, polrelid) like '%is_app_user%' and pg_get_expr(polqual, polrelid) like '%has_role%' and pg_get_expr(polqual, polrelid) like '%sales%' and pg_get_expr(polqual, polrelid) like '%NOT%'
                and polcmd = 'r' and polpermissive from pg_policy where polname = 'plan_day_read' and polrelid = 'public.plan_day'::regclass), false)),
  (2,  '0700 policy tulis plan_day tidak berubah (plan_day_ins dan plan_day_upd, Admin dan PPIC)',
        (select count(*) from pg_policies where schemaname = 'public' and tablename = 'plan_day' and policyname in ('plan_day_ins', 'plan_day_upd')
            and with_check like '%admin%' and with_check like '%ppic%') = 2),
  (3,  '0700 tidak ada policy lain yang membuka plan_day untuk SELECT (satu pintu), tiga policy seluruhnya, RLS aktif',
        (select count(*) from pg_policies where schemaname = 'public' and tablename = 'plan_day' and cmd in ('SELECT', 'ALL')) = 1
        and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'plan_day') = 3
        and (select relrowsecurity from pg_class where oid = 'public.plan_day'::regclass)),
  (4,  '0700 tidak ada policy plan_day atau audit_log yang menyebut anon atau public',
        not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('plan_day', 'audit_log') and roles && array['anon', 'public']::name[])),
  (5,  '0700 audit_log_sales_redact: restriktif, memuat plan_day dan dua puluh enam tabel lama (B2, B5, B6) (Q-v5.2-74)',
        coalesce((select not p.polpermissive and bool_and(position('''' || t.n || '''::text' in pg_get_expr(p.polqual, p.polrelid)) > 0)
                    from pg_policy p
                   cross join unnest(array['cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
                     'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
                     'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
                     'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
                     'plan_week','plan_week_class','demand_weekly','demand_class_weekly','plan_day']) as t(n)
                   where p.polname = 'audit_log_sales_redact' and p.polrelid = 'public.audit_log'::regclass
                   group by p.polpermissive), false)),
  (6,  '0700 audit_log tetap punya tiga policy (audit_log_read, audit_log_fs_redact, audit_log_sales_redact), tidak ada policy baru',
        (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_log') = 3
        and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname in ('audit_log_read', 'audit_log_fs_redact', 'audit_log_sales_redact')) = 3),
  (7,  '0700 penutupan B6 tetap utuh: plan_week_read dan demand_weekly_read tanpa Sales',
        (select count(*) from pg_policies where schemaname = 'public' and tablename in ('plan_week', 'demand_weekly') and policyname in ('plan_week_read', 'demand_weekly_read')
            and cmd = 'SELECT' and permissive = 'PERMISSIVE' and qual like '%is_app_user%' and qual like '%has_role%' and qual like '%sales%' and qual like '%NOT%') = 2),
  (8,  '0700 tidak ada fungsi, view, view materialized atau policy tabel lain yang menyebut plan_day, selain daftar audit_log_sales_redact (tidak ada pembaca plan_day sebagai pemanggil)',
        not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~* '\mplan_day\M')
        and not exists (select 1 from pg_views where schemaname = 'public' and definition ~* '\mplan_day\M')
        and not exists (select 1 from pg_matviews where definition ~* '\mplan_day\M')
        and not exists (select 1 from pg_policies where schemaname = 'public' and tablename <> 'plan_day' and not (tablename = 'audit_log' and policyname = 'audit_log_sales_redact')
                        and (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mplan_day\M')),
  (9,  'semua SECURITY DEFINER di public: search_path tetap',
        not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
                     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))),
  (10, 'tidak ada fungsi SECURITY DEFINER di public yang bisa dieksekusi anon',
        not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute'))),
  (11, '0700 versi 5.2.6 tercatat dan schema_version() = 5.2.6 atau lebih',
        exists (select 1 from public.schema_registry where version = '5.2.6') and string_to_array(public.schema_version(), '.')::int[] >= array[5,2,6]),
  (12, 'bundle_sha256 terisi untuk 5.2.6',
        (select count(*) from public.schema_registry where version = '5.2.6' and bundle_sha256 = '8ed656125d82d5aa03701ef997a7200321ea2913c1de8043b89d11e91b9b9acb') = 1),
  (13, 'versi sebelumnya tetap tercatat (5.2.0 sampai 5.2.5)',
        (select count(*) from public.schema_registry where version in ('5.2.0', '5.2.1', '5.2.2', '5.2.3', '5.2.4', '5.2.5')) = 6)
) as m(no, cek, ada)
order by m.no;
