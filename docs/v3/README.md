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

## F3a — M3 Demand → rencana mingguan / harian

Branch `v3/f3a-demand` (di atas `v3/f2-ledger`) · desain [`F3a-design.md`](F3a-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `20261016000600_m3_planning.sql` | kolom PO `sales_line`; parameter M3; `weight_class`, `yield_matrix`, `substitution`, `forecast_line`, `capacity`, `lb_supply`, `plan_week`, `plan_day`, `allocation`, `demand_weekly` (mart); guard approval; `tg_needs_rebuild` + `week_start` |
| `20261016000700_m3_backfill.sql` | Order lama → Confirmed + `delivery_date = date`; seed kelas STD + yield placeholder; antrikan Senin minggu ber-PO |

### Perintah untuk manusia

1. Backup → `supabase db push` (`20261016000600`, `20261016000700`), setelah F0–F2.
2. PPIC: ganti yield placeholder (`yield_matrix`, upload "PPIC — yield matrix") dan kelas berat bila ada lebih dari STD; isi kapasitas harian di `/w/[minggu]/rencana`.
3. `/admin/modul`: `m3_planning` on untuk Admin → **Proses antrian** → periksa `/w/[minggu]/demand` dan `/rencana`; lalu on untuk sales, commercial_lead, ppic, finance, management.
4. Sales mulai upload "Sales — PO lines" (status demand, tanggal kirim, sales) dan "forecast per minggu"; Purchasing upload "supply live bird".

### Bukti

```
pnpm typecheck     → Done (exit 0)
pnpm test          → engine 138 passed + 1 todo (baru: demand.test.ts 15) · parsers 18 (baru: m3-tables.test.ts 3) · web 9
pnpm parity        → 17161/17161 cells match, git diff --exit-code docs/parity.md docs/parity-cells.csv bersih
pnpm snapshot:diff → diff vs baseline … EMPTY — byte-identical
pnpm build         → ✓ Compiled successfully (ƒ /w/[week]/demand, ƒ /w/[week]/rencana)
pnpm test:rls      → OK (DB baru, semua migrasi dua kali); F3a: sales insert PO line OK; bad demand_status denied;
                     sales insert forecast OK; sales insert plan denied; sales insert demand_weekly denied; sales read yield_matrix=14;
                     cl insert forecast OK; ppic insert yield / capacity / plan_day OK; ppic approve plan denied; ppic insert forecast denied;
                     purch insert lb_supply OK; purch insert yield denied; finance approve plan rows=1; finance edit plan denied;
                     mgmt read plan=1; mgmt mart_replace denied; forecast queued rebuild=1
mart_replace       → payload engine minggu contoh (98 baris Order, yield seed): demand_weekly 12 key ditulis, run kedua 0 ditulis / 0 dihapus
Golden M3          → O_Demand_Rate C:E, O_Demand_Forecast D7:K30 per sel, O_Optimizer G6:I13, B16 BLD, B20 7.051, C24:M32,
                     B34:B40 (Base 70.817.907); app flow weekDemand → proposeWeekPlan = 7.051 ekor, surplus = F24:F31
```

## F3b — M3 Alokasi FEFO + cut-off

Branch `v3/f3b-alokasi` (di atas `v3/f3a-demand`) · desain [`F3b-design.md`](F3b-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `20261016000800_m3_allocation.sql` | kebijakan tulis `allocation` untuk ppic / commercial_lead; trigger `needs_rebuild` di `allocation`; index |

### Perintah untuk manusia

1. Backup → `supabase db push` (`20261016000800`), setelah F3a.
2. Dengan `m2_ledger` dan `m3_planning` on: buka **Alokasi hari ini** (`/hari/[tanggal]/alokasi`) → "Alokasikan hari ini" → "Terkirim" per PO → setelah jam cut-off (Parameter, default 14:00) PPIC menekan "Cut-off" → Admin → Modul → Proses antrian (ledger memakai alokasi dan blast).
3. Coba alur [1]–[4] di preview untuk satu hari: upload PO lines → `/w/[minggu]/demand` → `/rencana` (simpan, setujui bila perlu) → alokasi hari itu.

### Bukti

```
pnpm typecheck     → exit 0
pnpm test          → engine 148 passed + 1 todo (baru: allocation.test.ts 10) · parsers 18 · web 9
pnpm parity        → 17161/17161, diff bersih · pnpm snapshot:diff → EMPTY — byte-identical
pnpm build         → ✓ Compiled successfully (ƒ /hari/[date]/alokasi)
pnpm test:rls      → OK; F3b: ppic allocate OK; zero kg allocation denied; cl update allocation rows=1; mgmt allocate denied;
                     mgmt read allocation=1; finance allocate denied; allocation queued rebuild=1
Golden M3          → B_Alokasi_Stok D61 100.000, E49/E61 2.000, F61 98.000, D:H 53:60, E66:F86
End-to-end engine  → minggu contoh 27 Agu: 161 lot (167.057,25 kg); 28 baris PO (13.775,62 kg) → 36 alokasi FEFO (12.964,33 kg),
                     1 baris tanpa stok (811,29 kg); Terkirim → out_sale per lot teralokasi (tidak assumed);
                     cut-off 40 lot fresh 28.127,39 kg → lot frozen blast:*; C29/C31 LULUS
```

## F4a — M5 Biaya dengan driver

Branch `v3/f4a-drivers` (di atas `v3/f3b-alokasi`) · desain [`F4a-design.md`](F4a-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `20261016000900_m5_drivers.sql` | kolom driver `coa_map` (+ guard Finance), kolom `cash_plan`, `fixed_cost_schedule` + seed FS Sep 2026, driver default |

### Perintah untuk manusia

1. Backup → `supabase db push` (`20261016000900`), setelah F3b.
2. Finance di `/m/[bulan]/biaya` (flag `m5_drivers` on untuk admin + finance): isi nominal **gaji**, **sewa ABF NMG**, **bunga** (seed kosong, angka FS di catatan), konfirmasi depresiasi September (FS 0) dan driver default per akun; isi Rp/kg untuk pos variabel.
3. Flag: `m5_drivers` on (admin, finance) sebelum `m4_monthly` (F4b memakai jadwal ini).

### Bukti

```
pnpm typecheck     → exit 0
pnpm test          → engine 153 passed + 1 todo (baru: drivers.test.ts 5) · parsers 18 · web 9
pnpm parity        → 17161/17161, diff bersih · pnpm snapshot:diff → EMPTY — byte-identical
pnpm build         → ✓ Compiled successfully (ƒ /m/[month]/biaya)
pnpm test:rls      → OK; F4a: finance insert schedule OK; finance set driver rows=1; finance rename account denied;
                     bad driver_type denied; sales read schedule=0; sales set driver rows=0; mgmt read schedule=1; ppic insert schedule denied
Golden M5          → PREPAID RENT!D11 1.133.790.000 ÷ 12 = 94.482.500 (94,48 jt) mulai 2026-11-01; depresiasi Agu jurnal = jadwal,
                     Sep jurnal 0 → outlook = jadwal; gaji tanpa nominal → outlook = jurnal (Agu 85.565.549 / Sep 82.677.332)
Migrasi lokal      → dijalankan dua kali tanpa error; seed 7 baris jadwal; driver: fixed 24, variable 15, runrate 45, none 23 (Revenue/Other Income)
```

## F4b — M4 Outlook bulanan

Branch `v3/f4b-monthly` (di atas `v3/f4a-drivers`) · desain [`F4b-design.md`](F4b-design.md)

### Migrasi

| File | Isi |
| --- | --- |
| `20261016001000_m4_monthly.sql` | `month_outlook`, `month_outlook_version` (immutable), `outlook_assumption`, `closing_adjustment` (+ seed DI-01…DI-05 Sep 2026), `pl_daily` (mart), `outlook_accuracy`, `week.month_outlook_id`, parameter `v1_lock_day` / `forecast_tolerance_pct`, `needs_rebuild` di `gl_line` |

### Perintah untuk manusia

1. Backup → `supabase db push` (`20261016001000`), setelah F4a.
2. Urutan flag: `m5_drivers` (admin, finance) → `m4_monthly` (admin dulu) → `/m/[bulan]` "Bangun ulang" → periksa vs P&L mingguan → `m4_monthly` untuk semua peran.
3. Finance: isi budget bulanan (Q16) di `/m/[bulan]`; kunci V1 pada hari kerja ke-20, V2 menjelang akhir bulan, FINAL setelah tutup buku di `/m/[bulan]/tutup-buku`; konfirmasi tanda DI-02 / DI-03 (V32) dan posting penyesuaian September.

### Bukti

```
pnpm typecheck     → exit 0
pnpm test          → engine 161 passed + 3 todo (baru: monthly.test.ts 8 + 2 todo) · parsers 18 · web 9
pnpm parity        → 17161/17161, diff bersih · pnpm snapshot:diff → EMPTY — byte-identical
pnpm build         → ✓ Compiled successfully (ƒ /m/[month], ƒ /m/[month]/tutup-buku)
pnpm test:rls      → OK; F4b: finance lock V1 OK; edit locked version denied; finance adjustment OK; finance accuracy OK;
                     finance direct pl_daily denied; finance mart_replace pl_daily written=1; sales read versions=1;
                     sales adjustment denied; mgmt read pl_daily=1; mgmt set budget rows=0
Golden M4          → aktual 1–26 Agu = O_PnL!G9 6.385.876.039 / G15 347.403.254,84; PO 27/28/29 Agu 457,74 / 232,08 / 378,00 jt
                     (target ± 0,1 jt, pembulatan per segmen); 30 Agu = 0; 25 Agu anomali (D6)
Tidak tereproduksi → run-rate 31 Agu: app 319,29 vs 258,7 jt; forecast 1.387,12 / −35,17 vs 1.326,5 / −54,0;
                     outlook 7.773,00 / 312,24 vs 7.712,4 / 293,4; ber-PO 77,0% vs 80,5% (§E.4, test todo)
```

