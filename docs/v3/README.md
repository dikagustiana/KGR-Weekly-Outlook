# v3 — bukti per fase

Spesifikasi: [`docs/PRD-v3-kgr-platform.md`](../PRD-v3-kgr-platform.md) · rencana: [`docs/PLAN-v3.md`](../PLAN-v3.md) ·
keputusan default dan koreksi data: [`docs/open-questions.md`](../open-questions.md) §E · desain per fase: `docs/v3/F<n>-design.md`.

Aturan yang dijaga di setiap fase: migrasi hanya menambah (file baru, idempoten), `computeWeek` dan golden v1 tidak bergeser
(`pnpm test`, `pnpm parity` + `git diff --exit-code docs/parity.md docs/parity-cells.csv`, `pnpm snapshot:diff` bersih),
setiap modul baru di belakang feature flag (default off), tidak ada `db push` ke production oleh Claude Code.

## Cara verifikasi lokal

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test
pnpm parity && git diff --exit-code -- docs/parity.md docs/parity-cells.csv
pnpm outlook --week 2026-08-24 --today 2026-08-27 --blocks 1-7
pnpm snapshot:diff
pnpm build
# role tests on a disposable PostgreSQL (CI job "rls" does the same with a postgres:16 service container)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm test:rls
```

Catatan lingkungan sesi Claude Code: `cdn.sheetjs.com` (sumber `xlsx@0.20.3` di lockfile) diblokir proxy sesi, sehingga
`pnpm install --frozen-lockfile` gagal di sesi ini. Uji lokal memakai `xlsx@0.18.5` dari npm registry sementara (lockfile dan
`package.json` dikembalikan, tidak di-commit). CI GitHub memakai lockfile asli. `SUPABASE_DB_URL` tidak tersedia di sesi:
migrasi dan uji RLS dijalankan pada PostgreSQL 16 lokal dengan shim `supabase/tests/supabase_shim.sql`.

---

## F0 — Data fixes, fondasi, backup

Branch `v3/f0-data-fixes` · desain [`F0-design.md`](F0-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `supabase/migrations/20261016000100_v3_foundation.sql` | peran `commercial_lead`, `cost_accounting` (constraint); `app_setting` + 8 flag modul (off); `module_enabled()`; `rebuild_queue` + `tg_needs_rebuild()`; `data_fix`; `mart_table` + `mart_replace()`; policy peran baru di tabel lama; `tg_price_guard` (commercial_lead = sales); bucket privat `backups` |

### Perintah untuk manusia (production, setelah PR di-merge)

1. GitHub → Actions → **Backup** → *Run workflow* (isi secret `SUPABASE_DB_URL`, opsional `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` dulu). Pastikan artefak / objek `backups/kgr-*.dump` ada.
2. Salin data production ke database uji (PLAN F0 butir 3): `pg_dump` production → restore ke Supabase branch, lalu jalankan langkah 3–4 di branch itu dulu.
3. `supabase db push` (menerapkan `20261016000100_v3_foundation.sql`).
4. SQL Editor (production), berurutan, periksa output tiap skrip: `supabase/fixes/F0-D3.sql`, `F0-D4.sql`, `F0-D7-D9-runrate.sql`, `F0-D8.sql`.
5. Flag: semua tetap **off** (`/admin/modul`). Tidak ada flag yang dinyalakan di F0.
6. Buat login peran baru bila perlu (Admin → Pengguna, peran "Kepala Sales" / "Cost Accounting", lalu "Set kata sandi").

### Bukti (sesi ini)

```
pnpm typecheck                → engine, parsers, web: Done
pnpm test                     → engine 68 passed · parsers 10 passed · web 9 passed (baru: lib/modules.test.ts 4)
pnpm parity                   → parity: 17161/17161 cells match; git diff --exit-code docs/parity.md docs/parity-cells.csv → clean
pnpm outlook --week 2026-08-24 --today 2026-08-27 --blocks 1-7 → OK
pnpm snapshot:diff            → diff vs baseline (without block2.action, block7[].audience): EMPTY — byte-identical
sha256 tests/snapshots/outlook-2026-08-24.before.json = 947ce20306eb3232c122cd44b20854d921c1fda40fb494c7e4a658010e434a83 (tidak berubah)
pnpm build                    → exit 0; route baru ƒ /admin/modul
pnpm test:rls (PG16 lokal)    → semua migrasi diterapkan 2× (idempoten), seed, rls_roles.sql:
  v1: sales insert order OK; sales insert batch denied; sales update parameter rows=0; sales buy price denied; mgmt insert denied;
      ppic receipt trading denied; purch update shrink denied; stranger read weeks=0; self sign-up denied
  v3: admin set flag rows=1; admin m1 on=true; sales m1 on=false; sales set flag rows=0; sales queue rebuild OK; sales data_fix denied;
      mgmt read flags=8; mgmt queue rebuild denied; mgmt mart_replace denied; cl insert order OK; cl sell price rows=41;
      cl buy price denied; cl insert batch denied; ca insert order denied; ca upload OK; fin data_fix OK
  test:rls OK
supabase/fixes/F0-*.sql (seed minggu contoh, dijalankan 2×):
  D3 2026-08-24 selisih Rp 174.325.606,86 (open) — kartu stok 3.954.932.012 vs neraca 3.780.606.405
  D4 2026-08-24 Trade Payables - Third Parties debit 707.804.509,60 (akhir minggu lalu) / 420.329.749,60 (kemarin)
  D7/D9 minggu contoh tidak diubah (hanya minggu ≥ 2026-09-01); D8 TB contoh Σ 0,03 tidak diubah
```

Snapshot minggu contoh tidak berubah: koreksi D3/D4/D8 tidak menyentuh minggu contoh (D3/D4 hanya dicatat, D7–D9/D8 hanya minggu ≥ 1 Sep).

---

## F1 — M1 Costing per batch → SKU

Branch `v3/f1-costing` (di atas `v3/f0-data-fixes`) · desain [`F1-design.md`](F1-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `20261016000200_m1_costing.sql` | kolom costing `batch`, `sku_key.group_code/cut_component`, parameter costing; tabel `cost_pool`, `cost_pool_line`, `batch_output_sku`, `overhead_rate`, `allocation_run`, `allocation_line`; RLS (sales tidak membaca detail biaya), index |
| `20261016000300_m1_backfill.sql` | grup/komponen potong default per key; `batch_output_sku` dari `out_*` batch Aktual (source `manual`, note "assumed") |

### Perintah untuk manusia (setelah PR F0 dan F1 di-merge)

1. Workflow **Backup** (manual dispatch).
2. `supabase db push` → menerapkan `20261016000200_m1_costing.sql`, `20261016000300_m1_backfill.sql` (setelah `20261016000100` dari F0).
3. `/admin/modul`: `m1_costing` **on untuk Admin + Cost Accounting** (DoD PLAN F1). Setelah diterima: tambah peran baca (Finance, Management, PPIC) atau kosongkan daftar peran (semua kecuali sales — halaman Costing menolak sales).
4. Cost Accounting: Upload → "WP potong per batch" (`202609_Data_COGS_LB.xlsx`), lalu "Daftar PI pemasok"; Input costing → isi Σ GL cost pool → Alokasikan → Posting.

### Bukti

```
pnpm typecheck     → Done (engine, parsers, web)
pnpm test          → engine 109 passed (baru: costing.test.ts 39, snapshot v3 2) · parsers 15 passed (baru: costing-wp.test.ts 5) · web 9 passed
pnpm parity        → 17161/17161; git diff --exit-code docs/parity.md docs/parity-cells.csv → clean
pnpm snapshot:diff → EMPTY — byte-identical (exit 0)
pnpm build         → exit 0; ƒ /w/[week]/costing, ƒ /w/[week]/input/costing
pnpm test:rls      → OK; F1: ca insert cost_pool/line OK; ca upsert batch_output_sku rows=2 (nulls not distinct);
                     ca update batch costing rows=1; sales read cost_pool=0, allocation_run=0, batch_output_sku>0;
                     mgmt read cost_pool=1; ppic insert cost_pool/overhead_rate denied
Golden M1          → 26 sheet Pot_ISA*/Pot_AGRO*, 637 baris SKU: kolom L (COGS/kg) dan M (COGS/item) ± Rp 1;
                     Σ M = total biaya sheet; C21 hijau untuk batch berisi output; D2: Pot_AGRO28/29/30 tanpa output;
                     D1: Pot_ISA30 Σ SKU 15.893,9 vs hasil potong 17.568,9 kg (9,5%) → C22 GAGAL pada toleransi 2%
Migrasi lokal      → 20261016000200/000300 diterapkan 2× (idempoten); backfill minggu contoh: 14 baris SKU dari out_*
```

Screenshot halaman: tidak dibuat di sesi ini (tidak ada database Supabase uji / login; production tidak boleh disentuh).
Verifikasi visual di Vercel preview setelah `db push` ke branch uji: login Admin dan Cost Accounting, buka `/w/<minggu>/input/costing` dan `/w/<minggu>/costing`; login Sales → `/w/<minggu>/costing` harus 404.

---

## F2 — M2 Lot ledger + stok per SKU

Branch `v3/f2-ledger` (di atas `v3/f1-costing`) · desain [`F2-design.md`](F2-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `20261016000400_m2_ledger.sql` | kolom ledger `sku_key`/`parameter`; `lot`, `lot_movement`, `lot_balance_daily`, `sku_balance_daily`, `stock_card_snapshot`, `blast_event`; `mart_replace` (keep_col); trigger `needs_rebuild` |
| `20261016000500_m2_backfill.sql` | mengantrikan setiap tanggal sejak minggu pertama ber-stok-awal (lot dibangun engine) |

### Perintah untuk manusia

1. Backup → `supabase db push` (`20261016000400`, `20261016000500`).
2. `/admin/modul`: `m2_ledger` on untuk Admin → **Proses antrian sekarang** (membangun seluruh ledger dari antrian backfill) → periksa `/sku` dan kartu Ledger di Stok (C25–C27).
3. Setelah diterima: `m2_ledger` on untuk semua kecuali sales (centang semua peran selain Sales; sales melihat stok lewat M7).
4. Inventory Accounting: upload "saldo stok per item (kartu stok)" Accurate untuk C26.

### Bukti

```
pnpm typecheck     → Done
pnpm test          → engine 123 passed + 1 todo (baru: ledger.test.ts 14 + 1 todo) · parsers 15 · web 9
pnpm parity        → 17161/17161, diff bersih · pnpm snapshot:diff → EMPTY (exit 0) · pnpm build → exit 0 (ƒ /sku, ƒ /sku/[key])
pnpm test:rls      → OK; F2: sales read lot=0, lot_balance_daily=0, sku_balance_daily>0; sales insert blast denied;
                     ia manual adjust OK; ia derived movement denied; ia stock card OK; manual adjust queued rebuild=1;
                     ppic insert blast OK; mgmt read lot>0
mart_replace       → payload engine 24 Agu: lot 167, lot_movement 122, lot_balance_daily 107, sku_balance_daily 34 ditulis;
                     run kedua 0 ditulis / 0 dihapus (idempoten, audit hanya perubahan nyata)
Golden M2          → saldo awal per key = stok awal (162.687,92 kg; Rp 3.954.932.012); roll-forward 162.687,92 → 156.956,05 kg;
                     setiap hari × key = O_Stok ± 0,01 kg; MA = HPP Accurate 30/34 baris (target 95%: todo, §E.4);
                     C25 assumed 100%; C27 dengan pos rekonsiliasi D3 = 0
```
