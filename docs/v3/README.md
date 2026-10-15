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
