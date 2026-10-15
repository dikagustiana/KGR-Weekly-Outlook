# F0 — Data fixes, fondasi, backup (desain 1 halaman)

Acuan: `docs/PLAN-v3.md` Fase 0, `docs/PRD-v3-kgr-platform.md` §1 (D1–D9), §2 (peran), §4.9 (infrastruktur), §9 (Q1–Q20).

## Tabel / kolom (migrasi `20261016000100_v3_foundation.sql`)

| Objek | Isi | Catatan |
| --- | --- | --- |
| `app_user` | check `role` + `commercial_lead`, `cost_accounting` | constraint saja (`drop constraint if exists` + `add`), bukan kolom |
| `app_setting` | `key` pk, `value jsonb` (`{"enabled":bool,"roles":[…]?}`), `note`, stamp | seed `m1_costing, m2_ledger, m3_planning, m4_monthly, m5_drivers, m6_cash, m7_commercial, m7_approval` = `{"enabled":false}` (`on conflict do nothing`) |
| `rebuild_queue` | `date`, `reason`, `status` (`queued/running/done/failed`), `error`, waktu | antrian `rebuildDay(date)`; index `(status, date)` |
| `data_fix` | `fix_id` (D1…D9), `week_id`, `scope`, `description`, `amount`, `kg`, `account`, `status` (`open/applied/decided/info`) | log koreksi data F0 (`unique nulls not distinct (fix_id, week_id, scope)`) |
| `mart_table` | registri tabel data mart (`name`, `scope_col`, `key_cols`) | diisi per fase; dipakai RPC `mart_replace` |
| fungsi | `module_enabled(text)`, `mart_replace(table, scope, rows)`, `tg_needs_rebuild()` | `mart_replace` = upsert + hapus baris basi, hanya tabel terdaftar, hanya peran penulis |
| policy baru | `commercial_lead` = semua hak `sales` (order, harga jual, upload, tanggal update); `cost_accounting` = upload + tanggal update | `tg_price_guard` diganti (`create or replace`) agar `commercial_lead` diperlakukan seperti `sales` |
| storage | bucket privat `backups` (tanpa policy untuk `authenticated`) | diisi workflow backup lewat service role |

Semua tabel baru: `tg_stamp`, `tg_audit`, RLS select (semua app user) + insert/update per peran, entri di `supabase/tests/rls_roles.sql`.

## Engine

Tidak ada fungsi baru di F0. `computeWeek`, `toSnapshot`, golden v1 tidak disentuh.

## Web

- `apps/web/lib/modules-core.ts` (murni, diuji): `MODULES`, `isModuleOn(setting, role)`, `navModules()`.
- `apps/web/lib/modules.ts` (server-only): `moduleEnabled(key)`, `requireModulePage(key)` → `notFound()`, `requireModuleAction(key)` → `WriteError`.
- `apps/web/lib/roles.ts`: peran baru di `Role`, `ROLE_LABEL`, area tulis PRD §2 di `W`.
- `apps/web/lib/rebuild.ts`: registri builder per modul + `processRebuildQueue()`; F0 belum punya builder.
- `/admin/modul` (Admin): flag per modul (on/off + peran), antrian rebuild, tombol "Bangun ulang".
- `Shell`: grup nav "Modul" hanya untuk modul yang on dan sesuai peran (F0: kosong).

## Kontrol

Belum ada kontrol baru (C21–C40 di fase modul). D1–D9 dicatat di `docs/open-questions.md` §E dengan kontrol yang menandainya.

## Koreksi data (`supabase/fixes/`, dijalankan manusia setelah diuji di DB uji)

| Skrip | Isi | Minggu contoh 24 Agu |
| --- | --- | --- |
| `F0-D3.sql` | rekonsiliasi Σ `opening_stock.value` vs neraca persediaan (TB + GL s.d. H−1) per minggu; selisih dicatat sebagai baris `data_fix` beralasan (bukan mengubah stok awal Accurate) | dicatat, tidak diubah |
| `F0-D4.sql` | daftar pos utang dagang bersaldo debit per minggu → `data_fix` (status `open`) | dicatat |
| `F0-D7-D9-runrate.sql` | run-rate D&A = 10.393.461 (FS) bila 0/kosong; run-rate gaji = gaji FS bulan tutup terakhir bila lebih kecil | dikecualikan |
| `F0-D8.sql` | TB awal yang tidak nol ≤ Rp 1 → baris pembulatan ke akun `7100008 Rounding - KGR` | dikecualikan (TB contoh 0,03 bagian dari Excel) |

## Fixture

`fixtures/costing-2026-09/`, `fixtures/month-2026-08/`, `fixtures/demand-2026-09/`, `fixtures/fs-2026-09/` (skeleton + `source.json`); `scripts/extract_fixtures.py <costing|demand|fs|month|v3>` (fungsi ekstraksi baru; tanpa argumen tetap mengekstrak minggu contoh v1 — tidak dijalankan di F0).

## Apa yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Constraint role diganti → login lama gagal | daftar lama dipertahankan + 2 peran baru; diuji `rls_roles.sql` |
| `tg_price_guard` diganti | isi lama identik + `commercial_lead`; uji sales/purchasing tetap sama |
| Skrip koreksi menggeser minggu contoh | semua skrip `where week_start <> '2026-08-24'` atau hanya mencatat; fixture tidak diubah; `pnpm snapshot:diff` kosong |
| Workflow backup membocorkan data | bucket privat, secret di GitHub, artefak 14 hari |
