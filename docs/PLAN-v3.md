# Plan v3 — eksekusi PRD v3 di repo dan Supabase yang sudah ada

Pasangan dari `docs/PRD-v3-kgr-platform.md`. Setiap fase = satu branch, satu PR, satu set migrasi, satu entri CHANGELOG, satu bukti di `docs/v3/README.md`. Fase berikutnya tidak dimulai sebelum PR fase sebelumnya merge dan deploy preview diverifikasi.

---

## 0. Aturan main untuk mengubah repo dan Supabase yang hidup

**Repo**
- Branch dari `main`: `v3/f0-data-fixes`, `v3/f1-costing`, … `v3/f8-cutover`.
- Tidak mengubah file migrasi yang sudah ada di `supabase/migrations/` (000100–000600). Migrasi baru bernomor `20261016xxxxxx_*.sql` dan seterusnya, satu file per topik, dapat dijalankan ulang (`if not exists`, `on conflict do nothing`).
- Engine v1 (`computeWeek`) tidak diubah kecuali fase yang menyebutnya. Golden tests v1 (`golden.test.ts`, `prd-golden.test.ts`, `snapshot-baseline.test.ts`) wajib hijau di setiap commit.
- Setiap modul engine baru: file sendiri, tipe input/output sendiri, golden test sendiri dari fixture, rule test per cabang. Tidak ada `number` di aritmetika; pakai `decimal.ts` yang ada.
- Setiap tabel baru: trigger `tg_stamp`, `tg_audit`, RLS select/insert/update per peran, dicatat di `supabase/tests/rls_roles.sql`.
- Feature flag di `app_setting` per modul. Default `false`. Halaman dan server action memeriksa flag lewat satu helper `moduleEnabled('m1_costing')`.
- CI ditambah: `pnpm test:rls` (psql terhadap Supabase branch/preview DB kalau tersedia; kalau tidak, skip dengan peringatan), `pnpm snapshot:diff` terhadap baseline.

**Supabase (project hidup, ada data pilot)**
- Urutan per fase: (1) terapkan migrasi ke **Supabase branch** (preview) atau database lokal `supabase start`; (2) jalankan RLS test; (3) jalankan backfill; (4) bandingkan snapshot mingguan contoh; (5) baru `supabase db push` ke production; (6) flag modul tetap off; (7) verifikasi di Vercel preview; (8) flag on untuk admin dulu; (9) flag on untuk semua.
- Backfill selalu migrasi terpisah (`…_backfill_*.sql`), idempoten, memakai `assumed=true` untuk data yang direkonstruksi.
- Rollback = flag off + migrasi kompensasi (tidak drop; tandai `deprecated` di comment). Data tabel baru boleh dibiarkan.
- `pg_dump` sebelum setiap `db push` production (GitHub Action `backup.yml`, sudah diputuskan; dibuat di Fase 0 kalau belum ada).

**Bukti per fase** (`docs/v3/README.md`): hash commit, migrasi yang diterapkan, output `pnpm test`, SHA snapshot minggu contoh sebelum/sesudah, screenshot halaman, keputusan yang diambil.

---

## Fase 0 — Data fixes, fondasi, backup (1 PR)

Tujuan: data yang dipakai modul baru bisa dipercaya; infrastruktur fase berikutnya ada.

Pekerjaan:
1. `backup.yml`: GitHub Action harian `pg_dump` (schema + data) ke bucket privat `backups`; secret `SUPABASE_DB_URL`. Manual dispatch sebelum `db push`.
2. Migrasi `…_v3_foundation.sql`: `app_setting`, `rebuild_queue`, `moduleEnabled` helper SQL (`public.module_enabled(text)`), role check `app_user` diperluas (`commercial_lead`, `cost_accounting`), `ROLE_LABEL` dan `W` di `roles.ts`.
3. **Salinan data production untuk uji.** `pg_dump` production → restore ke database uji (`SUPABASE_DB_URL`: Supabase branch atau `supabase start` lokal). Semua backfill dan koreksi data diuji di sini dulu. Claude Code tidak menyentuh production.
4. D1–D9 (PRD §1): untuk tiap item, salah satu: skrip koreksi data di `supabase/fixes/F0-<id>.sql` (idempoten, dicatat audit, dijalankan manusia ke production setelah diuji), atau kontrol baru yang menandainya, atau keputusan di `docs/open-questions.md` §E. Minimal yang harus punya skrip: D3 (opening stock 174,4 jt — cari selisihnya per item vs Inventory Valuation Accurate; kalau tidak ketemu per item, catat selisih sebagai baris penyesuaian beralasan), D4 (tanda AP), D8 (BS −0,32). D7 (depresiasi Sep) dan D9 (run-rate gaji) diperbaiki di `runrate` lewat skrip yang sama. D6 (25 Agu = 0) dicatat anomali (`pl_daily.anomaly`, dibuat di Fase 4; sementara di open-questions). D1/D2 menunggu PPIC/cost_accounting, kontrol C22 menandai.
5. Fixture baru (skeleton, diisi di fase masing-masing): `fixtures/costing-2026-09/`, `fixtures/month-2026-08/`, `fixtures/demand-2026-09/`. `scripts/extract_fixtures.py` ditambah ekstraktor untuk `202609_Data_COGS_LB.xlsx`, `KGR_Demand_Forecast.xlsx`, dan FS Sep 2026 (PL/BS, prepaid, DI notes). File sumber masuk `reference/` (bukan `fixtures/`).
6. Snapshot baseline: kalau D3/D4/D8 mengubah angka minggu contoh, jalankan `snapshot-baseline.ts`, catat SHA lama → baru dan diff per field di CHANGELOG.
7. `docs/v3/README.md` dibuat.

Definition of done: CI hijau; backup pertama ada di bucket; `docs/open-questions.md` §E berisi D1–D9 dengan status; flag `m1…m7` ada dan off.

---

## Fase 1 — M1 Costing per batch → SKU (1 PR)

Migrasi `…_m1_costing.sql`: kolom baru `batch`, `sku_key.group_code/cut_component`, `cost_pool`, `cost_pool_line`, `batch_output_sku`, `overhead_rate`, `allocation_run`, `allocation_line`, RLS, index `(batch_id)`, `(allocation_run_id, key)`.

Parser `packages/parsers/src/costing-wp.ts`: baca sheet `Pot_*`; kenali header batch (tanggal, supplier, ekor, kg LB, harga, ekspedisi, maklon) via mapping tersimpan per sheet; ambil hanya nama SKU, kg, %; item name → `item_map` → key; issues: SKU tak terpeta, Σ% ≠ 100 ± toleransi, kg ≤ 0.

Engine `costing.ts`:
```
allocateBatch({batch, outputs, costLines, priceList, overheadRate?, options}) → AllocationResult
  options: byProductMethod 'joint'|'nrv', mode 'maklon'|'own', sellingCostPerKg
computeCostPool({pool, lines, glLines}) → tie-out
groupCostPerKg(allocations, skuKeys) → per group_code
```
Golden: `fixtures/costing-2026-09/` dari kolom L Excel per SKU (Pot_ISA, Pot_AGRO), ±Rp 1.

Web: `/w/[week]/input/costing` (upload wizard kind `costing_wp`, `cost_pool_pi`; tabel cost pool + tie-out; tombol Alokasikan → `allocation_run`; status batch), `/w/[week]/costing` (per batch, per SKU, per grup, idle). Kontrol C21–C24 ditambahkan ke `controls.ts` di bawah key baru `controls_v3` (snapshot v1 tidak berubah).

Backfill `…_m1_backfill.sql`: untuk batch Aktual yang punya `out_*` tapi belum ada `batch_output_sku`, buat baris dari `out_*` dengan `source='manual'` dan key default per komponen (karkas fresh/frozen, kepala, ceker, usus, hja, lemak) — ditandai `assumed` lewat note.

DoD: PRD §8 M1. Flag `m1_costing` on untuk admin + cost_accounting.

---

## Fase 2 — M2 Lot ledger + near-live SKU (1 PR)

Migrasi `…_m2_ledger.sql`: `lot`, `lot_movement`, `lot_balance_daily`, `sku_balance_daily`, `stock_card_snapshot`, `blast_event` (dipakai M3 juga), `sku_key.storage_cost_per_kg_day/fresh_window_hours/frozen_age_limit_days`, `parameter.blast_cost_per_kg/cut_off_time`.

Engine `ledger.ts`:
```
buildLots({batches, allocations, receipts(trading), openingStock, conversions}) → Lot[]
applyMovements({lots, sales(Aktual), blasts, adjustments, fifoFallback:true}) → Movement[] (assumed flag)
balanceAt(date, lots, movements) → {perLot, perKey(MA, SI, age, free, reserved)}
reconcile(perKey, stockCardSnapshot, bsInventory) → C26, C27
```
MA per key; SI per lot; blast = out + in dengan parent.

Rebuild: server action `rebuildDay(date)` → tulis `lot_balance_daily`, `sku_balance_daily`; trigger `needs_rebuild` pada commit upload sales/batch/costing dan pada insert `blast_event`/`lot_movement adjust`. `/admin/modul` menampilkan antrian.

Backfill `…_m2_backfill.sql`: lot `origin='opening'` dari `opening_stock` minggu paling awal yang ada; lot dari setiap batch Aktual × `batch_output_sku`; movement `out_sale` FIFO assumed dari `sales_line` Aktual; `in` trading dari `receipt_line`. Jalankan `rebuildDay` untuk setiap tanggal sejak minggu paling awal.

Web: `/sku`, `/sku/[key]` (drill lot → movement), tab "Ledger" di `/w/[week]/stok` (preparer) dengan C25–C27. Engine v1 **tetap** memakai `opening_stock`/`receipt_line`.

Golden: roll-forward Agu 162.687 → 156.956 kg; MA vs `hpp_actual` ≥ 95% baris ±Rp 1/kg.

DoD: PRD §8 M2. Flag `m2_ledger` on untuk semua kecuali sales (sales lihat lewat M7).

---

## Fase 3 — M3 Demand → rencana → alokasi (2 PR: 3a demand+rencana, 3b alokasi+cut-off)

Migrasi `…_m3_planning.sql`: `sales_line` kolom baru, `weight_class`, `yield_matrix`, `substitution`, `forecast_line`, `demand_weekly`, `capacity`, `lb_supply`, `plan_week`, `plan_day`, `allocation`; parameter `tentative_weight`, `forecast_weight`, `downgrade_approval_threshold`, `lead_time_days`.

Parser: `po_lines`, `forecast_sales`, `yield_matrix`, `lb_supply` (CSV). Upload `po_lines` menulis `sales_line` Order dengan `delivery_date`, `demand_status`, `sales_rep`; `line_key = no_po|kode_item|n`.

Engine:
```
demand.ts   weeklyDemand({orders, forecasts, weights, weekStart}) → per key
            netDemand({demand, balances, substitutions, windows}) → net per key
            toHeads({net, yieldMatrix, cutComponents, weightClasses}) → heads per weight class, bottleneck
plan.ts     weeklyPlan({heads, supplyCommitted, capacity, priceList, threshold}) → plan_week (surplus, downgrade Rp, needsApproval)
            dailyPlan({planWeek, orders, capacity, lbSupply, leadTime}) → plan_day[]
allocation.ts allocateFEFO({orders(today), lotBalances, windows}) → allocation[] + unallocated
            cutoff({unallocatedFresh, blastCost, priceList}) → blast_event[]
```
Golden: `fixtures/demand-2026-09/` dari `KGR_Demand_Forecast.xlsx` (7.051 ekor, BLD binding, profit Base 70,8 jt; B_Alokasi_Stok 2.000 kg dari 100 t).

Web 3a: `/w/[week]/demand`, `/w/[week]/rencana` (approval downgrade). Web 3b: `/hari/[date]/alokasi` (tombol "Alokasikan hari ini", "Cut-off" → blast_event + lot_movement), kolom `Terkirim` pada order memicu `out_sale` pada lot teralokasi (menggantikan FIFO assumed untuk baris baru). `Input → Penjualan` menampilkan `delivery_date`, `demand_status`, `sales_rep`.

Kontrol C28–C31. Engine v1: `horizon_fresh_days` dan rencana batch tetap jalan; hasil `plan_week` **tidak** otomatis menjadi `batch Rencana` di fase ini — ada tombol "Salin ke batch rencana" (PPIC) supaya blok 2 Excel-paritas tidak berubah diam-diam.

DoD: PRD §8 M3. Flag `m3_planning`.

---

## Fase 4 — M5 Driver biaya, lalu M4 Outlook bulanan (2 PR: 4a driver, 4b outlook)

M5 dulu karena M4 memakainya.

Migrasi `…_m5_drivers.sql`: `coa_map` kolom driver, `fixed_cost_schedule`, `cash_plan.fixed_cost_schedule_id`; seed `fixed_cost_schedule` dari FS (description terisi, amount null kecuali yang pasti: sewa RPA 94.480.000 mulai 2026-11-01 amortize dari prepaid 1.133.790.000; depresiasi 10.400.000; gaji dibiarkan null dengan note "FS Sep: 85,6 jt / Agu: 82,7 jt").

Engine `drivers.ts`: `dailyFixed(schedule, date)`, `monthFixedOutlook(schedule, actualMtd, month)`, `variableCost(rpPerKg, kgForecast)`, `runrateDaily(runrate, workingDays)`.

Migrasi `…_m4_monthly.sql`: `month_outlook`, `month_outlook_version`, `outlook_assumption`, `closing_adjustment`, `pl_daily`, `outlook_accuracy`, `week.month_outlook_id`, parameter `v1_lock_day`, `forecast_tolerance_pct`.

Engine `monthly.ts`:
```
actualDaily({glLines, coaMap, salesUnbilled, maCost}) → pl_daily actual
forecastDaily({orders, forecasts, runrate(anomaly-excluded), drivers, gpPct4w, cutOff, monthEnd}) → pl_daily forecast
outlook({actual, forecast, budget, tolerance}) → totals, range, needPerDay
bridge(v1, v2) → {dActual, dVolume, dPrice, dEvent, check=0}
accuracy(final, versions, adjustments) → MAPE, bias (pre/post adjustment)
calibrate(final) → runrate & yield proposals
```
Golden: `fixtures/month-2026-08/` — cut-off 26 Agu: actual 6.385,9 / 347,4; forecast 1.326,5 / −54,0; outlook 7.712,4 / 293,4; per hari 27–31 Agu (457,8 / 232,1 / 378,0 / 0 / 258,7). FINAL Agustus dari GL penuh. September dari FS.

Web: `/m/[month]` (chart harian, kumulatif + band, register, versi, bridge, akurasi), `/m/[month]/biaya`, `/m/[month]/tutup-buku`, rilis bulanan (snapshot + PDF 2 halaman), headline management ditambah outlook bulan.

Kontrol C32–C34. Flag `m4_monthly`, `m5_drivers`.

---

## Fase 5 — M6 Kas, CCC, solvabilitas (1 PR)

Migrasi `…_m6_cash.sql`: `bank_account`, `cash_daily`, `cash_daily_plan`, `cash_position_daily`, `ccc_daily`, `solvency_monthly`. Template xlsx untuk Finance di `reference/templates/Template_Kas_Harian.xlsx` (dibuat oleh script, 2 sheet, validasi dropdown kategori CF dari `coa_map`).

Parser `cash_daily`. Engine `cash.ts` (posisi harian, proyeksi 13 minggu dari `cash_daily_plan` + termin AR/AP dari M4, 12 bulan dari outlook), `ccc.ts` (DIO/DSO/DPO 90 hari, simulasi, modal kerja), `solvency` di `statements.ts` (ekuitas dari BS mingguan terakhir, afiliasi dari `coa_map.intercompany`).

Web: `/kas`, `/kas/ccc`, blok solvabilitas di management headline dan `/m/[month]`. Kontrol C35–C37 (C37 menutup D4). Flag `m6_cash`.

---

## Fase 6 — M7 Commercial view (2 PR: 6a view, 6b approval + scorecard)

Migrasi `…_m7_commercial.sql`: `sales_assignment`, `sales_target`, `urgency_rule` (seed Q18), `price_floor_rule`, `discount_approval`, `commercial_daily`, `sales_scorecard_weekly`, view `commercial_daily_sales` (tanpa kolom cost), parameter `sales_sees_cost`, `discount_limit_rp_per_kg`.

Engine `commercial.ts`: `commercialRows({balances, priceList, realized7d, rules, storage, blastCost}) → commercial_daily`, `urgency(rules, age, form)`, `priorityScore`, `scorecard({targets, actuals, blasts, forecastErr, discounts})`.

Web 6a: `/komersial` (sales: filter by assignment, tanpa cost; lead/management: semua + cost), `/komersial/[key]`. Web 6b: guard di `Input → Penjualan` dan upload `po_lines` (price < floor → butuh approval), `/komersial/approval`, `/komersial/scorecard`, headline management: SKU jual hari ini. Kontrol C38–C40. Flag `m7_commercial` (6a) dan `m7_approval` (6b) terpisah — PRD §10 risiko sales.

---

## Fase 7 — Rilis bulanan, PDF, mobile, management view v3 (1 PR)

- PDF bulanan (pdfmake, pola `lib/pdf.ts`).
- Management view v2 + headline baru (outlook bulan, kas terendah, SKU jual hari ini) dengan aturan v2 (tanpa istilah tabel, satu warna merah untuk negatif).
- Management view mingguan: seksi Input dan COGS sesuai PRD §6 (sumber batch + cost_pool + ledger), seksi demand dan akurasi.
- Mobile: `/sku`, `/komersial`, `/m/[month]` baca-saja.
- `docs/handover.md` ritme harian diperbarui (cost_accounting, commercial_lead, cut-off 14:00, upload kas).

---

## Fase 8 — Cutover sumber stok (1 PR, opsional, setelah ≥ 4 minggu paralel)

Hanya kalau C26/C27 hijau 4 minggu berturut: engine v1 membaca stok awal dari `sku_balance_daily` (hari Senin) alih-alih `opening_stock` upload, lewat flag `stock_source='ledger'`. Snapshot mingguan berubah → baseline baru dicatat. Kalau tidak dicapai, fase ini tidak dijalankan dan dua sumber tetap hidup dengan kontrol.

---

## Urutan dan estimasi

| Fase | PR | Migrasi | Engine | Web | Bergantung pada |
| --- | --- | --- | --- | --- | --- |
| 0 | 1 | foundation, backfill opening fix | — | admin/modul | — |
| 1 | 1 | m1 | costing | input/costing, costing | 0 |
| 2 | 1 | m2 + backfill | ledger, rebuild | sku, stok/ledger | 1 |
| 3 | 2 | m3 | demand, plan, allocation | demand, rencana, alokasi | 2 |
| 4 | 2 | m5, m4 | drivers, monthly | m/[month], biaya, tutup-buku | 2 (MA untuk GP), 3 (PO untuk forecast) |
| 5 | 1 | m6 | cash, ccc, solvency | kas, kas/ccc | 4 |
| 6 | 2 | m7 | commercial | komersial, approval, scorecard | 2, 3 |
| 7 | 1 | — | — | PDF, headline, mobile | 4, 5, 6 |
| 8 | 1 | flag | week.ts (sumber stok) | — | 2 (4 minggu hijau) |

Total 12 PR. Fase 3 dan 4a bisa paralel setelah Fase 2. Fase 6a bisa paralel dengan 4b.

---

## Verifikasi per PR (checklist yang dijalankan sebelum minta review)

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test                         # golden v1 + golden modul baru + rules + parsers + web
pnpm parity && git diff --exit-code -- docs/parity.md docs/parity-cells.csv
pnpm outlook --week 2026-08-24 --today 2026-08-27 --blocks 1-7
pnpm snapshot:diff                # vs baseline; harus kosong kecuali fase yang mengubah baseline
pnpm build
supabase db reset (lokal) && psql -f supabase/tests/rls_roles.sql
```
Lalu: deploy preview Vercel, login per peran (admin, cost_accounting, sales, management), screenshot halaman baru ke `docs/v3/`, cek DOM sales tidak memuat `cost_per_kg|cost_pool|batch_ref` di `/komersial`.
