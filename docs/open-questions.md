# Open questions and Excel ↔ PRD differences

Rule: when the PRD and `reference/KGR_Weekly_Outlook.xlsx` disagree, **the Excel wins** and the difference is logged here with the cell reference and the amount affected in the example week (24–30 Aug 2026, update 27 Aug). Nothing below has been "fixed" in the engine — each item keeps the Excel behaviour until the owner decides.

Status legend: **OPEN** = needs a decision; **INFO** = documented behaviour, no decision needed.

## A. Differences found while reading the Excel (engine keeps the Excel behaviour)

| # | Topic | Excel (cell) | PRD | Amount affected (example week) | Status |
| --- | --- | --- | --- | --- | --- |
| A1 | Controls 14, 17, 18 pass with one exception | `Z_Kontrol!F18`, `F21`, `F22` use `ABS(C)<=1` → 1 unmapped account, 1 uncategorised cash line or 1 cash-plan row without counter line still shows LULUS | §8: pass condition "0" | 0 (all counts are 0) | OPEN — recommend `=0`; one line changed in `packages/engine/src/controls.ts` |
| A2 | Block 5 "Kas keluar" is structurally zero | `O_Outlook!B50:C56` sum batches dated d − 7 (any status) and **counted** trading receipts dated d − 14. Rows of previous weeks are not in the week's sheets, and "counted" requires a date inside the week, so trading payments can never appear and live-bird payments only if last week's batches are kept in T_Batch | §5.5 "Cash out by day" | Rp 0 every day (Excel and engine) | OPEN — the app keeps all weeks; should block 5 read previous weeks' batches/receipts? Same for `O_BS!B64:B66` (payments due this week) |
| A3 | Yields from all Aktual batches, no date filter | `I_Parameter!E19:E24` SUMIFS over the whole T_Batch | §5.3 "this week's Aktual batches" | none (T_Batch holds only this week) | INFO — the app stores batches per week, so identical |
| A4 | Trading planned receipts not filtered by source | `O_Outlook!D30:D40` = key + Rencana + date in [today, week end] | §5.4 "Rencana, Beli Trading" | none (only trading keys) | INFO |
| A5 | Controls 1–2 count an unmapped row twice | `Z_Kontrol!C5` = COUNTIF(G,"KODE BARU") + COUNTIF(N,"?") | §8 "0 unmapped" | 0 | INFO — status is right, the displayed count is ×2 |
| A6 | Control 6 checks sales rows only | `Z_Kontrol!C10` | §8 "Rows outside the current week" | 0 | OPEN — add receipts/batches? |
| A7 | Control 17 only catches "?" (account not in I_COA) | `T_GL!S` takes I_COA column F; a mapped counter account with an **empty** cash-flow category gives an empty category, not "?" | §8 "Cash lines without a cash-flow category" | 0 (control 16 would catch the gap) | OPEN — recommend counting empty categories too |
| A8 | Run-rate days-in-month uses the month of the update date | `O_PnL!D12` `DAY(EOMONTH(I_Parameter!C4,0))` | §5.6 | none in August; a week spanning two months uses the update date's month | INFO |
| A9 | Stock-age limit parameter is not used in any formula | `I_Parameter!C13` (30 days); kg over the limit is an input in `I_Stok_Awal!G` | §4 parameter `stock_age_limit` | n/a | OPEN — v1 keeps kg-over-limit as an input of the Monday upload; computing it from FIFO receipt dates is a v2 item (PRD §3) |
| A10 | Block 1 "kg aktual s.d. kemarin" includes every Aktual row of the week | `O_Outlook!B6` uses the counted flag, not the date < today | §5.2 | 0 (no Aktual dated ≥ 27 Aug) | INFO |
| A11 | Daily cash table uses all cash-plan rows of the day | `O_CF!B31:B34` SUMIFS on date only; category totals use the counted flag | §5.8 | none (identical for days ≥ today) | INFO |
| A12 | "Affiliate payables" in the PRD golden list = Other Payable – Related Parties only | `O_BS!E26` = 5.600,0 jt; block 8 `O_Outlook!C85` = E26 + E24 = 5.238,8 jt (planned payment of trade payables – affiliates −361,2 jt) | §10 "affiliate payables 5.600,0 jt" | — | INFO — both are shown: the BS line on Neraca, the combined figure in block 8 |
| A13 | Empty reference price propagates as "blank" | `O_Stok!W29` shows 0 but `X29` is blank because `W=""` is true for an empty source cell (LibreOffice-style blank propagation in the cached values) | — | RPA\|Lemak\|Fresh, RPA\|Usus\|Frozen | INFO — the engine models an empty price as `null`, which reproduces every cached value |
| A14 | P&L line names | `O_PnL!A6:A37` ("Delivery Expenses", "Commission Expenses", "Storage Expenses", …) | §5.6 ("Delivery", "Commission", "Storage", …) | — | INFO — Excel names used (they are also the I_COA mapping values) |
| A15 | Item master size | `I_Item` holds 125 codes | §7 "129 codes" | — | INFO — seed loads the 125 codes in the Excel |
| A16 | Control 10 compares output kg to production receipts of the counted rows only | `Z_Kontrol!D14` | §8 | 0 | INFO |
| A17 | P&L actual columns follow the journal (invoice date) while block 1 follows deliveries (DO) | `O_PnL!A39` note | §5.6 | revenue this week: GL 589,0 jt vs DO 571,1 jt | INFO — as designed in the Excel |
| A18 | Counter account of a cash line is matched on the amount rounded to Rp | `T_GL!P6` key = voucher & `ROUND(O,0)`; `T_GL!Q6` MATCHes the rounded MAXIFS → when two non-cash lines of one voucher round to the same rupiah (e.g. 100,1 and 100,4) the first in sheet order wins, not the exact largest | §5.8 "largest counter account" | 0 vouchers of 606 in the example week | OPEN — engine keeps the Excel rule (`classifyCashLines`); matching the exact largest amount is a one-line change if preferred |

## B. PRD §11 open questions (decide before go-live)

| # | Question | v1 default in the app (placeholder) |
| --- | --- | --- |
| B1 | Minimum trading spread — who sets it, one number or per SKU? | Rp 2.000/kg, one number per week (`parameter.min_trading_spread`) |
| B2 | Payment terms per supplier type | LB 7 days, trading 14, freight/maklon 30 (`parameter.terms_*`) |
| B3 | Collections: manual cash plan or AR aging with customer terms? | Manual cash plan (T_Kas_Rencana) |
| B4 | HPP of actual sales: DO value from inventory valuation, or weekly average cost? | DO value when uploaded (`sales_line.hpp_actual`), else weekly average cost |
| B5 | Karkas by size (Uk 0,5–2,0)? | Fresh/frozen only |
| B6 | Hosting/ownership: SAMB Vercel/Supabase accounts, user administration | Supabase project `uxqbtverhnpiryhzbenr` and Vercel project `kgr-weekly-outlook` (https://kgr-weekly-outlook.vercel.app, root `apps/web`, see `docs/handover.md` §2); Admin manages users in the app. Move both to SAMB-owned accounts before go-live |
| B7 | Accurate API on the current licence? | Uploads only |
| B8 | Horizon fresh days 3, target shrink 3%, stock-age limit 30 days | Seeded as placeholders, flagged in `parameter.placeholder_note` |

## C. Implementation choices to confirm

| # | Topic | Choice | Why |
| --- | --- | --- | --- |
| C1 | PDF export | Server-side PDF generated in Node (pdfmake) from the engine snapshot, A4 landscape; the browser print view uses the same layout via print CSS | PRD §9 suggests headless Chromium; a Chromium binary in a Vercel function is fragile and slow on cold start during the 06:00–10:00 window. Numbers come from the same snapshot, so they match the screen |
| C2 | Week rollover opening stock | From the Sunday inventory-valuation upload; if missing, carried from last week's projected closing per key and flagged `source = Ops` until the upload lands | PRD §2 weekly routine |
| C3 | Money in the database | `numeric(18,2)`; kg `numeric(12,2)`; engine uses decimal.js | PRD §9 |
| C4 | Login | E-mail + password; logins are created by the Admin (Admin → Pengguna) or, for the first Admin, with `set_login_password` in the SQL editor. Self sign-up is refused by the `auth.users` trigger; Google OAuth is optional and still limited to the allow-list | PRD §9 asks for Supabase Auth with Google Workspace e-mail. The Google provider needs an OAuth client in SAMB's Google Workspace (not available during the build), and Supabase's built-in mailer only delivers to project members (no SMTP configured), so e-mail links would not reach the team. Password logins work today; the "Masuk dengan Google" button is already built — enable the provider, add the redirect URL and set `NEXT_PUBLIC_AUTH_GOOGLE=1` |
| C5 | Supabase URL / publishable key | Defaults in `apps/web/lib/env.ts`; env vars override | The publishable key is public by design (shipped to the browser, RLS protects data); a fresh Vercel import works without configuration |
| C6 | Mobile | All pages render on a phone; input navigation is hidden below 760 px, wide tables scroll inside their card with the line label pinned | PRD §9 "mobile read-only Outlook and statement summary". Writes stay possible for roles that have them (the server and RLS do not depend on screen size) |

## D. Pilot log (M5 — two live weeks in parallel with the Excel)

One row per difference between the app and the Excel during the pilot. Rule unchanged until the owner decides; a decided change gets a test, a CHANGELOG line and a parity re-run.

| Date | Week | Block / statement line | Excel (cell, value) | App (value) | Cause | Decision | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — |

## E. v3 — data fixes (D1–D9), default decisions (PRD v3 §9 Q1–Q20) and implementation choices

Rule (PRD v3 §9, prompt rule 7): execution does not wait for answers. Every default below is in use, can be changed through the
parameter / master named in the row without changing code, and lists what moves when it changes. Status: **OPEN** = owner
decision still needed; **DEFAULT** = default in use; **FIXED** = script/control in place; **INFO** = documented.

### E.1 Data issues D1–D9 (PRD v3 §1, Fase 0)

| ID | Issue | Decision / fix | Control that flags it | Where it changes | Impact if it changes | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Hasil potong per batch (WP kolom K5) vs Σ hasil SKU (kolom I) selisih 8–10% (contoh Pot_ISA30: 17.568,9 vs 15.893,9 kg = 9,5%) | Diperlakukan sebagai susut proses (Q4) sampai PPIC konfirmasi; alokasi biaya memakai Σ kg SKU (semua biaya batch habis ke SKU) | C22 (Fase 1) GAGAL bila gap > `parameter.yield_gap_tolerance` (2%) | `parameter.yield_gap_tolerance`; WP dari PPIC | Toleransi naik → C22 hijau tanpa memperbaiki data; bila gap ternyata output yang tidak ditimbang, COGS/kg SKU turun ±9% | OPEN (PPIC) |
| D2 | Batch Pot_AGRO28, Pot_AGRO29, Pot_AGRO30 tanpa output SKU (kolom I kosong, Σ=0) | Batch tetap dibuat dari header WP; tanpa `batch_output_sku` tidak ada lot dan alokasi (`allocation_run` tidak bisa jalan) | C22 GAGAL (Σ output 0); C24 (rilis bulanan) GAGAL selama batch Aktual belum `posted` | Upload ulang WP setelah PPIC mengisi output | Setelah diisi: lot terbentuk, COGS/kg batch itu muncul | OPEN (PPIC / cost_accounting) |
| D3 | Stok awal 3.955,0 jt (kartu stok, `I_Stok_Awal` E306 = 3.954.932.012) vs persediaan neraca 3.780,6 jt (`O_Outlook` B83 = 3.780.606.405) — selisih 174.325.607 | `supabase/fixes/F0-D3.sql`: selisih per minggu dicatat sebagai baris penyesuaian beralasan di `data_fix` (D3, `opening_vs_bs`); stok awal **tidak** diubah (engine v1 dan Excel memakai kartu stok). Dugaan penyebab: HPP faktur unbilled sudah mengkredit persediaan di GL, DO in-transit | C27 (Fase 2) nilai MA ledger vs neraca persediaan, dengan pos rekonsiliasi D3 | Inventory Accounting mencocokkan per item ke Inventory Valuation; penyesuaian dibukukan di Accurate | Bila dibukukan: neraca naik 174,3 jt, C27 hijau tanpa pos D3 | FIXED (dicatat) / OPEN (pembukuan) |
| D4 | Tanda utang dagang di proyeksi (debit) — contoh minggu: Trade Payables - Third Parties debit 707,8 jt akhir minggu lalu, 420,3 jt kemarin; Trade Payables - Affiliates −361,2 jt di proyeksi dari rencana kas | `supabase/fixes/F0-D4.sql` mencatat setiap pos utang bersaldo debit per minggu di `data_fix` (D4); tidak mengubah jurnal (penyebab: pembayaran sebelum PI / pos lawan rencana kas) | C37 (Fase 5) AP bertanda negatif di proyeksi | Finance: reklas uang muka pemasok di Accurate; pos lawan di Input → Kas | CF kategori "Bayar pemasok" dan DPO (CCC) berubah arah | FIXED (dicatat) / OPEN (pembukuan) |
| D5 | Blok 5 (kas keluar model) vs arus kas tidak cocok | Tetap perilaku Excel (A2: blok 5 struktural nol untuk pembayaran minggu lalu). Satu angka kas di v3 = posisi kas harian M6 (`cash_position_daily`) dari saldo rekening + rencana | C35 (Σ rekening vs kas neraca), C36 (hari kerja tanpa upload kas) | M6 template kas harian | Blok 5 tidak lagi dipakai manajemen; headline memakai kas terendah 13 minggu | DEFAULT |
| D6 | Revenue 25 Agu 2026 = 0 (hari kerja, GL tanpa penjualan) | Hari itu ditandai anomali; run-rate harian M4 mengecualikan hari `anomaly=true` (revenue 0 pada hari kerja atau > 3σ) | `pl_daily.anomaly` (Fase 4) | Otomatis dari data; bila penjualan 25 Agu diposting belakangan, anomali hilang | Run-rate naik bila hari nol ikut dihitung | DEFAULT |
| D7 | Depresiasi September belum dibukukan (FS Sep 0 vs 10.393.461 Jan–Agu) | `supabase/fixes/F0-D7-D9-runrate.sql`: run-rate D&A minggu ≥ 1 Sep = 10.393.461 bila 0/kosong; dari Fase 4 masuk `fixed_cost_schedule` (seed 10.400.000) | C34 (pos tetap actual MTD vs jadwal) | `runrate` / `fixed_cost_schedule` | NI outlook −10,4 jt/bulan | FIXED |
| D8 | Kontrol neraca −0,32 (FS Sep, `BS - Management Report` L8) | `supabase/fixes/F0-D8.sql`: baris pembulatan TB ke `7100008 Rounding - KGR` (−Σ TB) bila 0 < |Σ| ≤ 1, minggu ≥ 1 Sep | Kontrol 12 / 15 tetap; selisih menjadi 0 | `tb_opening` | Other Income berubah ≤ Rp 1 | FIXED |
| D9 | Run-rate gaji di app 29,8 jt vs FS 85,6 jt (Agu 85.565.549; Sep 82.677.332) | Skrip yang sama: run-rate gaji = gaji FS bulan tutup terakhir bila lebih kecil (Sep → Agu 85.565.549; Okt+ → Sep 82.677.332); Fase 4: nominal di `fixed_cost_schedule` diisi Finance | C33/C34 (Fase 4) | `runrate` / `fixed_cost_schedule` | Opex outlook naik ~55 jt/bulan | FIXED |

### E.2 Default decisions PRD v3 §9 (Q1–Q20)

| ID | Decision | Default in use | Where it is changed | Impact when changed |
| --- | --- | --- | --- | --- |
| Q1 | By-product: joint vs NRV | `joint` — by-product ikut share relative sales value | `parameter.by_product_method` (`joint`/`nrv`) | `nrv`: by-product dinilai NRV, sisa biaya ke produk utama → COGS/kg karkas naik |
| Q2 | Cost pool: PI saja atau PI + akrual | PI + akrual GL; tie-out ke GL akun biaya RPA | `cost_pool_line` (sumber), `cost_pool.total_gl` | PI saja → C23 GAGAL selama akrual belum ada PI |
| Q3 | Harga alokasi fresh vs frozen | Harga daftar WP / `sku_price` minggu potong; key fresh dan frozen berbeda | `allocation_run.price_list_week_id`, Master → Harga | Share per SKU bergeser; total biaya batch tetap |
| Q4 | Arti gap hasil potong 8–10% (D1) | Susut proses; C22 toleransi 2% | `parameter.yield_gap_tolerance` | Lihat D1 |
| Q5 | Sumber ekor per batch | `batch.head_count` dari WP; kosong → `lb_kg / parameter.avg_lb_kg_default` (2,0 kg; `KGR_Demand_Forecast.xlsx` I_Live_Bird B3) | `batch.head_count`, `parameter.avg_lb_kg_default` | Overhead mode own per ekor dan rencana ekor berubah |
| Q6 | Lot di DO | Tidak ada di Accurate → FIFO per key, baris `lot_movement.assumed=true`; target: kolom lot di DO Ops | C25 menampilkan % kg keluar assumed | SI per lot lebih akurat bila lot dicatat di DO |
| Q7 | Tabel substitusi | Kosong (tidak ada substitusi) | tabel `substitution` | Netting demand memakai stok SKU pengganti |
| Q8 | Fresh window / cut-off | 48 jam / 14:00 | `sku_key.fresh_window_hours`, `parameter.cut_off_time` | Lebih panjang → lebih sedikit blast ke frozen |
| Q9 | Penyebab 63% frozen | Ditampilkan sebagai `rp_downgrade` di rencana mingguan; tidak diputuskan sistem | `plan_week` | — |
| Q10 | Threshold approval downgrade | Rp 25 jt per minggu | `parameter.downgrade_approval_threshold` | Rencana dengan downgrade di atasnya butuh `approved_by` |
| Q11 | MA Accurate per item atau per gudang | Per item (kode Accurate); `sku_balance_daily` = agregat per key | — (aturan engine `ledger.ts`) | Per gudang butuh kolom gudang di upload |
| Q12 | V1 lock | Hari kerja ke-20 bulan | `parameter.v1_lock_day` | Versi V1 dikunci lebih awal/lambat |
| Q13 | Toleransi forecast | ±10% porsi forecast | `parameter.forecast_tolerance_pct` | Lebar band outlook |
| Q14 | Unbilled DO | Masuk actual basis `do_unbilled`, dinilai harga PO | `pl_daily.basis` | Actual MTD bergeser antara jurnal dan DO |
| Q15 | Margin acuan commercial | Margin/kg pada harga list dan realisasi 7 hari | `commercial_daily` | Ranking urgensi tidak berubah; kolom margin berubah |
| Q16 | Granularitas budget | Bulanan per pl_line | `month_outlook.budget_*`, `outlook_assumption` | "Butuh per hari" dihitung dari budget bulanan |
| Q17 | Sales lihat cost? | Ya: cost/kg MA per SKU, harga lantai, margin; tidak: cost pool, biaya per batch, SI per lot | `parameter.sales_sees_cost` | `false` → kolom cost/kg disembunyikan untuk sales |
| Q18 | Urgensi fresh/frozen | Fresh > 24 jam = jual hari ini; frozen > 21 hari = jual minggu ini; > `frozen_age_limit_days` (30) = di atas batas umur | tabel `urgency_rule`, `sku_key.frozen_age_limit_days` | Status urgensi dan ranking berubah |
| Q19 | Batas approval diskon commercial_lead | Rp 500/kg; di atas itu Finance | `parameter.discount_limit_rp_per_kg` | Antrian approval berpindah ke Finance |
| Q20 | Bobot Tentative / Forecast | 70% / 50% | `parameter.tentative_weight`, `parameter.forecast_weight` | Demand berbobot dan rencana ekor berubah |

### E.3 Implementation choices (v3)

| ID | Topic | Choice | Why | Where it changes |
| --- | --- | --- | --- | --- |
| V1 | Feature flag value | `app_setting.value = {"enabled": bool, "roles": [..]}`; tanpa `roles` = semua peran | PLAN: "flag on untuk admin dulu", lalu peran pemakai, lalu semua | `/admin/modul` |
| V2 | Penulisan data mart | RPC `mart_replace(table, scope, rows)` (security definer, hanya tabel di `mart_table`, hanya peran penulis); baris yang tidak berubah tidak disentuh, sehingga `tg_audit` hanya mencatat perubahan nyata | `tg_audit` wajib di setiap tabel baru; rebuild harian tanpa perubahan tidak boleh membanjiri `audit_log` | `supabase/migrations/20261016000100_v3_foundation.sql` |
| V3 | Uji RLS di CI | Job `rls` dengan PostgreSQL 16 (service container) + `supabase/tests/supabase_shim.sql` (stand-in `auth`/`storage`), semua migrasi dijalankan dua kali (idempoten), seed, lalu `rls_roles.sql`; hasil bertanda `(!)` = gagal | Tidak ada database Supabase uji di CI; production tidak disentuh | `scripts/test-rls.sh` |
| V4 | Backup | `.github/workflows/backup.yml`: `pg_dump` harian + manual dispatch; artefak privat 14 hari, dan ke bucket privat `backups` bila secret service role tersedia | PLAN §0 | Secret `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` di GitHub |
| V5 | `batch_output_sku` grain | Satu baris per batch × key × **item code** (unique `(batch_id, key, item_code)`), bukan batch × key | Harga daftar WP berbeda per item dalam satu key (Premium 37.000 vs Grade A 34.000 untuk key Karkas Frozen); per-key = jumlah baris. PRD §4.2 menulis unique(batch_id, key) | `supabase/migrations/20261016000200_m1_costing.sql` |
| V6 | Upload WP ke batch yang sudah ada | Batch dicocokkan per minggu (nama sheet = `batch_ref`, atau tanggal sama + kg LB ±0,5); kolom v1 batch yang cocok tidak diubah (hanya `costing_status`, `processed_kg` bila kosong); batch baru dibuat Aktual dengan `out_*` agregat dari SKU | Angka mingguan v1 tidak bergeser diam-diam; batch yang belum ada tetap lengkap untuk blok 2/6 | `apps/web/lib/v3/costing.ts` |
| V7 | Halaman Costing untuk sales | Tidak tersedia (404) dan RLS menolak baca cost pool / alokasi / tarif | PRD Q17: sales tidak melihat biaya per batch; PRD §6 menulis "semua" | `lib/modules-core.ts` `MODULE_NAV`, RLS `*_read` |
| V8 | Harga acuan alokasi | `batch_output_sku.price_ref` (harga daftar WP minggu potong); kosong → `sku_price.ref_sell_price` minggu itu (Q3) | WP adalah sumber harga kolom L | `lib/v3/costing.ts` `allocationInput` |

### E.4 Target numbers (PRD v3 §8) — reproduced / not reproduced

| Module | Target | Result | Test |
| --- | --- | --- | --- |
| M1 | Kolom L `Pot_ISA` / `Pot_AGRO` per SKU ± Rp 1 | **Reproduced**: 26 sheet, 637 baris SKU, L dan M ± Rp 1, Σ M = total per sheet (dari fixture openpyxl dan dari file xlsx lewat parser SheetJS) | `packages/engine/test/costing.test.ts`, `packages/parsers/test/costing-wp.test.ts` |
