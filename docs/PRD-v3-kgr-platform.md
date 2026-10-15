Digantikan oleh docs/PRD-v4.md sejak 16 Okt 2026; lihat §0.2 untuk pasal yang dicabut.

# PRD v3 — KGR Weekly Outlook → KGR Operations & Finance Platform

Status: Draft untuk eksekusi · Owner: Dika (Group Project Finance, SAMB) · Tanggal: 15 Okt 2026
Repo: `dikagustiana/KGR-Weekly-Outlook` · Supabase ref `uxqbtverhnpiryhzbenr` (ap-northeast-1) · Vercel `kgr-weekly-outlook`

Dokumen ini menggantikan cakupan `docs/PRD.md` §3 ("v1 dan sesudahnya") dan memperluas `docs/PRD-management-view-v2.md`. Keduanya tetap berlaku untuk apa yang sudah ada. Yang tidak disebut di sini tidak berubah.

---

## 0. Ringkasan satu halaman

Aplikasi sekarang: satu "minggu" = satu set input (parameter, master, stok awal, penjualan, penerimaan, batch, GL, TB, run-rate, rencana kas) → engine murni → blok 1–8, P&L/BS/CF mingguan, 20 kontrol → rilis PDF/JSON. Parity 17.161 sel Excel. Management view v2 sudah jadi.

Aplikasi target: hal yang sama, ditambah tujuh modul yang saling menyambung di satu data mart harian:

| # | Modul | Satu kalimat |
| --- | --- | --- |
| M1 | Costing per batch → SKU | Upload WP potong per batch (format `Data_COGS_LB`), biaya batch dialokasikan ke SKU dengan metode relative sales value, hasilnya COGS/kg per SKU dan per grup SKU. Maklon s.d. Okt 2026, RPA sendiri mulai Nov 2026. |
| M2 | Lot ledger | Setiap batch × SKU adalah lot. Masuk dari WP potong, keluar dari DO/faktur, blast fresh→frozen, opname. Cost per lot: moving average (buku, cocok Accurate) dan specific identification (manajemen). Near-live per SKU. |
| M3 | Demand → rencana → alokasi | PO lines + forecast → [1] demand per SKU per minggu → netting stok → yield matrix → ekor per size → [2] rencana mingguan → [3] rencana harian → actual output → [4] alokasi FEFO ke PO. Ada PO = fresh, tidak ada PO = frozen. |
| M4 | Outlook bulanan | Actual s.d. cut-off + forecast (PO dulu, run-rate untuk hari tanpa PO) = outlook bulan berjalan. Versi V1 dikunci, V2 bridge, penyesuaian tutup buku, actual final, akurasi (MAPE, bias), kalibrasi. |
| M5 | Biaya dengan driver | Setiap pos P&L punya driver: Tetap (nominal + jadwal, dibagi hari kalender), Variabel (Rp/kg × kg), Run-rate. Flag intercompany. |
| M6 | Kas, CCC, solvabilitas | Template kas harian untuk Finance (saldo per rekening + rencana), arus kas 13 minggu dan 12 bulan, CCC = DIO + DSO − DPO dengan simulasi, blok solvabilitas (ekuitas, hutang afiliasi). |
| M7 | Commercial view | Per SKU: stok bebas, umur, cost, harga lantai, margin/kg, rugi per hari ditahan, status urgensi, ranking jual dulu, scorecard sales. Diskon di bawah harga lantai wajib approval. |

Prinsip yang tidak boleh dilanggar:

1. **Engine tetap fungsi murni.** `WeekInputs → output`. Modul baru menambah input dan output, bukan efek samping. Semua angka decimal.js.
2. **Snapshot minggu contoh tetap identik.** SHA-256 `947ce203…a83` untuk minggu 24–30 Agu 2026 harus sama byte-per-byte sampai fase yang secara eksplisit mengubahnya (lihat Plan). Field baru ditambahkan di bawah key baru, bukan menyisip ke struktur lama.
3. **Migrasi Supabase hanya menambah.** Tidak ada `drop`, tidak ada rename kolom yang dipakai engine, tidak mengubah file migrasi yang sudah diterapkan. Backfill dari data lama berjalan di migrasi terpisah dan idempoten.
4. **Satu angka.** Stok, cost, revenue di semua halaman dibaca dari data mart yang sama. Tidak ada halaman yang menghitung ulang sendiri.
5. **Excel tetap spesifikasi untuk yang lama.** Modul baru spesifikasinya adalah dokumen ini plus fixture golden baru (`fixtures/month-2026-08`, `fixtures/costing-2026-09`).

---

## 1. Konteks bisnis (dari FS Sep 2026 dan fixture Agu 2026)

- PT Karya Gudang Rabat: RPA (potong ayam, maklon s.d. Okt 2026, RPA sendiri di Rawa Terate mulai 1 Nov 2026) + trading karkas/frozen.
- Agustus 2026 (1–26): revenue 6.385,9 jt, GP 347,4 jt (5,4%). Outlook bulan 7.712,4 jt / GP 293,4 jt (3,8%). 80,5% revenue ber-PO.
- Minggu 24–30 Agu: GP proyeksi −47,6 jt. COGS/kg RPA 32.721 vs revenue/kg 30.914. Trading BLP Frozen dijual di bawah cost (−4.113/kg).
- 63% karkas tanpa PO → masuk frozen. Inventory +88% di September. Stok di atas batas umur Rp 2,78 M.
- Ekuitas 702,6 jt dari modal disetor 5.000 jt. Hutang afiliasi 9.845,9 jt.
- Biaya tetap yang diketahui dari FS: gaji ~83–86 jt/bulan, depresiasi 10,4 jt/bulan, sewa RPA Rawa Terate 94,48 jt/bulan mulai Nov 2026 (prepaid 1.133,79 jt), sewa ABF NMG, deposit DS Solutions (CS/ABF), bunga.
- Penyesuaian tutup buku September (DI-01 s.d. DI-05): revaluasi COGS unbilled 48,35 jt, biaya RPA terparkir 48,08 jt, transport LB AGRO 12 jt, sewa ABF NMG 62,45 jt + inventory adj 69,66 jt, Inv 311.

Masalah data yang sudah teridentifikasi dan harus beres sebelum modul baru dipercaya (Fase 0):

| ID | Masalah | Dampak |
| --- | --- | --- |
| D1 | Hasil potong per batch vs Σ hasil SKU selisih 8–10% | Alokasi biaya ke SKU salah basis |
| D2 | Batch AGRO28–30 output kosong | Lot tidak terbentuk, COGS/kg batch itu tak terhitung |
| D3 | Opening stock 3.955,0 jt vs neraca 3.780,6 jt, gap 174,4 jt | Ledger tidak cocok Accurate sejak hari pertama |
| D4 | Tanda AP di proyeksi (+143,5 debit) | CF dan CCC salah arah |
| D5 | Block 5 vs CF tidak cocok | Dua angka kas |
| D6 | Revenue 25 Agu = 0 | Run-rate tercemar |
| D7 | Depresiasi Sep belum dibukukan | Biaya tetap understated |
| D8 | Kontrol BS −0,32 | Neraca tidak balance |
| D9 | Run-rate gaji di app (29,8 jt) vs FS (85,6 jt) | Payroll understated ~3× |

---

## 2. Pengguna dan peran

Peran yang ada: `admin, inventory_accounting, sales, ppic, purchasing, finance, management`. Ditambah:

| Peran baru | Siapa | Bisa |
| --- | --- | --- |
| `commercial_lead` | Kepala sales | Semua yang bisa `sales`, plus: approve diskon di bawah harga lantai sampai batas `discount_limit_rp_per_kg`, melihat scorecard semua sales, mengubah target per sales |
| `cost_accounting` | Yang mengerjakan WP costing | Upload WP potong per batch, set cost pool, tarif overhead, jalankan alokasi, melihat cost pool tie-out. Tidak bisa mengubah penjualan |

`sales` sekarang melihat **Commercial view** (M7) selain input order, dibatasi ke customer/SKU yang ditugaskan kepadanya (`sales_assignment`). `management` melihat semua view baca.

Hak tulis baru (ditambahkan ke `apps/web/lib/roles.ts` dan RLS):

| Area | Peran |
| --- | --- |
| `costing_upload`, `cost_pool`, `overhead_rate`, `allocation_run` | admin, cost_accounting |
| `lot_adjust` (opname, koreksi lot) | admin, inventory_accounting |
| `blast_event` | admin, ppic |
| `po_line` (PO, status demand, tgl kirim) | admin, sales |
| `forecast_line` | admin, sales, commercial_lead |
| `sales_target`, `sales_assignment` | admin, commercial_lead |
| `discount_approval` | admin, commercial_lead, finance |
| `yield_matrix`, `weight_class`, `capacity`, `lb_supply`, `plan_week`, `plan_day` | admin, ppic |
| `fixed_cost_schedule`, `cost_driver`, `cash_daily`, `monthly_outlook_version`, `closing_adjustment` | admin, finance |
| `urgency_rule`, `price_floor_rule` | admin, finance, commercial_lead |

---

## 3. Arsitektur target

```
Sumber ──► Upload + validasi ──► Tabel input (Supabase) ──► Engine (@kgr/engine, murni)
                                                              │
                                                              ▼
                                                 Data mart harian (tabel materialized
                                                 per hari: lot_balance_daily, pl_daily,
                                                 cash_daily_position) ── dibangun oleh
                                                 job "rebuild" idempoten per tanggal
                                                              │
                      ┌───────────────────────────────────────┼─────────────────────┐
                      ▼                                       ▼                     ▼
               Management view                        Commercial view          Preparer view
       (weekly outlook, bulanan, kas, solvabilitas)   (SKU, urgensi, scorecard)  (semua + cara hitung)
```

- Engine dipecah per modul di `packages/engine/src/`: `costing.ts`, `ledger.ts`, `demand.ts`, `plan.ts`, `allocation.ts`, `monthly.ts`, `drivers.ts`, `cash.ts`, `ccc.ts`, `commercial.ts`. Setiap modul: `input type → output type`, tanpa I/O, dengan golden test sendiri.
- `computeWeek` yang ada tetap. Ditambah `computeMonth(MonthInputs)`, `computeLedger(LedgerInputs)`, `computeCommercial(CommercialInputs)`.
- Data mart dibangun oleh server action `rebuildDay(date)` yang memanggil engine dan menulis hasil ke tabel `*_daily`. Dipanggil setelah setiap commit upload dan setiap perubahan input yang relevan (trigger `needs_rebuild` + queue sederhana di tabel `rebuild_queue`). Tidak ada cron eksternal di fase ini; tombol "Bangun ulang" untuk Admin.
- Snapshot dan rilis: rilis mingguan tetap. Ditambah rilis bulanan (V1, V2, final) dengan snapshot JSON dan SHA.

---

## 4. Domain model — tabel baru dan perubahan

Konvensi sama seperti skema v1: money `numeric(18,2)`, Rp/kg `numeric(18,4)`, kg `numeric(12,2)`, ekor `integer`, tanggal kalender Asia/Jakarta, soft delete, kolom provenance (`source, document_ref, upload_id, created_*, updated_*`), audit trigger, RLS.

### 4.1 Perubahan tabel yang ada (hanya tambah kolom)

| Tabel | Kolom baru | Keterangan |
| --- | --- | --- |
| `sales_line` | `delivery_date date`, `demand_status text check in ('Confirmed','Tentative','Forecast')`, `sales_rep text`, `po_ref text`, `fulfilled_kg numeric(12,2) default 0`, `price_floor_at_sale numeric(18,4)`, `discount_approval_id uuid` | Baris `status='Order'` adalah PO line. `delivery_date` = target pengiriman. `date` tetap tanggal dokumen. Default `demand_status='Confirmed'` untuk baris Order yang sudah ada |
| `batch` | `cost_mode text check in ('maklon','own') default 'maklon'`, `head_count integer`, `avg_lb_kg numeric(8,3)`, `weight_class text`, `cut_pattern text`, `costing_status text check in ('none','uploaded','allocated','posted') default 'none'`, `cost_pool_id uuid` | Kolom `out_*` lama tetap untuk engine v1; detail SKU ada di `batch_output_sku` |
| `coa_map` | `driver_type text check in ('fixed','variable','runrate','none') default 'none'`, `rp_per_kg numeric(18,4)`, `intercompany boolean default false`, `driver_basis text` | M5 |
| `sku_key` | `group_code text`, `storage_cost_per_kg_day numeric(18,4)`, `fresh_window_hours integer`, `frozen_age_limit_days integer`, `cut_component text` | `group_code` = grup pelaporan (Karkas 0,9 + 1,0 → `KARKAS`). `cut_component` = komponen potong di yield matrix |
| `cash_plan` | `account_no text`, `fixed_cost_schedule_id uuid`, `kind text check in ('plan','actual') default 'plan'` | Rencana kas bisa dirujuk ke jadwal biaya tetap |
| `parameter` | `cut_off_time time default '14:00'`, `blast_cost_per_kg numeric(18,4)`, `fresh_frozen_price_gap_default numeric(18,4)`, `discount_limit_rp_per_kg numeric(18,4)`, `forecast_tolerance_pct numeric(8,6) default 0.10` | |
| `week` | `month_outlook_id uuid` | tautan ke outlook bulanan yang mencakup minggu ini |
| `app_user` | role check ditambah `'commercial_lead','cost_accounting'` | via `alter table … drop constraint … add constraint` (constraint saja, bukan kolom) |

### 4.2 Tabel baru — M1 costing

```
cost_pool            id, period_start, period_end, mode ('maklon'|'own'), description,
                     total_pi numeric(18,2), total_gl numeric(18,2), tie_out_diff (generated),
                     status ('open'|'tied'|'posted'), posted_at, posted_by
cost_pool_line       id, cost_pool_id, component ('LB','freight','maklon','labour','overhead','blast','other'),
                     account, document_ref, amount, batch_id nullable (biaya langsung ke batch), note
batch_output_sku     id, batch_id, key (→sku_key), kg, pct_of_processed, source ('WP'|'manual'),
                     unique(batch_id, key)
overhead_rate        id, period_start, period_end, rate_per_kg_lb numeric(18,4), basis_kg numeric(12,2),
                     budget_overhead numeric(18,2), note
allocation_run       id, batch_id, method ('relative_sales_value'), price_list_week_id, run_at, run_by,
                     total_cost numeric(18,2), total_allocated numeric(18,2), diff (generated), status
allocation_line      id, allocation_run_id, key, kg, price_ref numeric(18,4), sales_value, share numeric(12,8),
                     allocated_cost, cost_per_kg numeric(18,4), by_product_method ('joint'|'nrv'),
                     nrv_floor numeric(18,4), nrv_writedown numeric(18,2)
```

Rumus alokasi (relative sales value) per batch:
```
sales_value_i  = kg_i × price_ref_i          (price_ref dari sku_price minggu price_list_week_id; fresh ≠ frozen)
share_i        = sales_value_i / Σ sales_value
allocated_i    = share_i × total_cost_batch  (total_cost_batch = Σ cost_pool_line untuk batch itu
                                              + untuk mode 'own': head_count×avg_lb_kg × overhead_rate.rate_per_kg_lb)
cost_per_kg_i  = allocated_i / kg_i
NRV test       = if cost_per_kg_i > price_ref_i − biaya jual: nrv_writedown = (cost_per_kg_i − nrv_floor) × kg_i
```
By-product (kepala, ceker, usus, HJA, lemak): default `joint` (ikut share). Opsi `nrv`: by-product dinilai pada NRV, sisa biaya ke produk utama. Pilihan per `cost_pool.mode` disimpan di `parameter.by_product_method`.

Alokasi faktur: setiap PI pemasok (LB, ekspedisi, maklon, TKL, sewa, listrik) masuk `cost_pool_line` dengan `batch_id` kalau faktur itu untuk satu batch (LB, ekspedisi, maklon per batch), atau tanpa `batch_id` kalau biaya periode (sewa, TKL, listrik) — yang terakhir masuk `overhead_rate` dan dibebankan per kg LB. Tie-out: Σ `cost_pool_line.amount` = Σ GL akun biaya RPA periode itu (C23). Faktur penjualan: `sales_line` Aktual ↔ DO ↔ lot lewat `allocation.sales_line_id`, sehingga setiap faktur punya COGS per lot (SI) dan per key (MA).

Kapasitas idle (mode own): `idle_cost = (basis_kg − actual_kg_lb) × rate_per_kg_lb` dicatat sebagai biaya periode (`pl_line = 'Biaya kapasitas idle'`), bukan masuk cost_per_kg.

Kontrol baru: C21 Σ allocated = total_cost (±Rp 1). C22 Σ batch_output_sku.kg vs batch.processed_kg (toleransi `parameter.yield_gap_tolerance`, default 2%; D1 saat ini 8–10% → GAGAL sampai dibereskan). C23 cost_pool tie-out PI vs GL (±Rp 1). C24 setiap batch 'Aktual' punya allocation_run status 'posted' sebelum rilis bulanan.

### 4.3 Tabel baru — M2 lot ledger

```
lot                  id, batch_id nullable, key, form ('fresh'|'frozen'), origin ('batch'|'trading'|'opening'|'conversion'),
                     origin_date date, parent_lot_id nullable, kg_in numeric(12,2), cost_in numeric(18,2),
                     cost_per_kg_si numeric(18,4), assumed boolean default false ("lot diduga"), note
lot_movement         id, lot_id, date, time, type ('in','out_sale','out_blast','in_blast','adjust','transfer','writedown'),
                     kg (signed), cost (signed), ref_table, ref_id, document_ref, sales_line_id nullable,
                     created_*, unique(ref_table, ref_id, lot_id, type)
lot_balance_daily    date, lot_id, key, form, kg, cost_ma numeric(18,2), cost_per_kg_ma numeric(18,4),
                     cost_si, cost_per_kg_si, age_days, hours_to_cutoff, reserved_kg (terikat PO), free_kg,
                     primary key(date, lot_id)       ← data mart, dibangun rebuildDay
sku_balance_daily    date, key, group_code, kg, free_kg, reserved_kg, cost_per_kg_ma, cost_per_kg_si,
                     oldest_age_days, over_age_kg, primary key(date, key)
```

Aturan:
- MA dihitung per `key` (bukan per lot): `ma_baru = (saldo_cost + cost_masuk) / (saldo_kg + kg_masuk)`; keluar pada MA berjalan. Ini yang harus cocok ke kartu stok Accurate.
- SI dihitung per lot: keluar pada `cost_per_kg_si` lot itu. Dipakai manajemen dan commercial view.
- Keluar penjualan: DO/faktur dialokasikan ke lot via `allocation` M3 (FEFO). Kalau DO tidak membawa lot (data Accurate lama), fallback FIFO per key dan baris `lot_movement` diberi `assumed=true`; kontrol C25 menghitung % kg keluar yang assumed.
- Blast fresh→frozen: satu `out_blast` dari lot fresh + satu `in_blast` ke lot frozen baru (`parent_lot_id`), cost = cost lot fresh + `blast_cost_per_kg × kg`. Downgrade Rp = `(price_fresh − price_frozen) × kg` dicatat di `blast_event` untuk pelaporan, bukan ke ledger.
- Opening stock v1 (`opening_stock`) di-backfill menjadi lot `origin='opening'`, `assumed=true`, cost_per_kg = value/kg.
- Rekon harian: `sku_balance_daily.kg` vs kartu stok Accurate (upload `stock_card`) → kontrol C26 per key (toleransi 0,01 kg), C27 nilai MA vs neraca persediaan (±Rp 1 setelah penyesuaian tutup buku).

### 4.4 Tabel baru — M3 demand, rencana, alokasi

```
weight_class         code, min_kg, max_kg, sort_order
yield_matrix         id, weight_class, cut_pattern, key, yield_pct numeric(8,6), effective_from, effective_to,
                     unique(weight_class, cut_pattern, key, effective_from)
substitution         id, key_demand, key_substitute, priority, max_pct, note
forecast_line        id, week_start, key, sales_rep, customer nullable, kg, price_expected, basis, created_*
demand_weekly        week_start, key, confirmed_kg, tentative_kg, forecast_kg, stock_free_kg, net_kg,
                     karkas_kg_equiv, primary key(week_start, key)                  ← data mart
capacity             date, cut_capacity_head integer, chiller_kg, abf_kg, note
lb_supply            date, supplier, weight_class, head_count, price_per_kg, status ('offer','confirmed','received')
plan_week            id, week_start, version, head_count, weight_class_mix jsonb, cut_pattern_mix jsonb,
                     surplus_kg_by_key jsonb, frozen_planned_kg, frozen_planned_rp_downgrade, approved_by, approved_at
plan_day             id, plan_week_id, date, head_count, weight_class, cut_pattern, supplier,
                     target_kg_by_key jsonb, status ('plan'|'cut'|'closed')
allocation           id, date, sales_line_id, lot_id, kg, method ('FEFO'|'manual'), created_*
                     unique(sales_line_id, lot_id)
blast_event          id, date, time, lot_id_from, lot_id_to, kg, reason ('cutoff'|'planned'|'quality'),
                     rp_downgrade, approved_by nullable
```

Alur (tiap langkah adalah fungsi engine, output tersimpan di data mart):

1. **Demand per SKU per minggu** = Σ `sales_line` Order dengan `delivery_date` di minggu itu, dibagi `demand_status`, + `forecast_line`. Bobot: Confirmed 100%, Tentative `parameter.tentative_weight` (default 70%), Forecast `forecast_weight` (default 50%). Hari tanpa PO tidak diisi dengan forecast untuk keperluan alokasi, hanya untuk rencana potong.
2. **Netting** = demand − `free_kg` yang masih layak kirim pada `delivery_date` (umur ≤ `fresh_window_hours` untuk fresh; frozen ≤ `frozen_age_limit_days`), setelah substitusi (tabel `substitution`, urut prioritas, maksimum `max_pct`).
3. **Konversi yield** = net_kg per SKU → kg karkas setara (via `cut_component`) → ekor per weight class: `head = ceil(karkas_kg / (avg_lb_kg × yield_karkas(weight_class)))`. Bottleneck size: SKU yang hanya bisa dari size tertentu menentukan minimum ekor size itu.
4. **Rencana mingguan** = `head_count = max(kebutuhan fresh, min supply komitmen)`; dibatasi `capacity`. Surplus per SKU = output rencana − demand → `frozen_planned_kg`, `rp_downgrade = Σ (price_fresh − price_frozen) × kg`. Kalau rp_downgrade > `parameter.downgrade_approval_threshold` → butuh `approved_by`.
5. **Rencana harian** = plan_week dipecah per `delivery_date − lead_time_days` (default 1), dibatasi `cut_capacity_head`, `chiller_kg`, dan `lb_supply` confirmed hari itu.
6. **Actual output** = `batch` Aktual + `batch_output_sku`. Varian vs plan_day tampil per SKU.
7. **Alokasi** = untuk setiap sales_line Order yang `delivery_date = hari ini` (urut: Confirmed dulu, lalu delivery_date, lalu nilai), ambil lot `form` sesuai, FEFO (origin_date tertua dulu, yang masih layak), tulis `allocation` + `lot_movement out_sale` saat DO terbit (`fulfilled_kg`). Sisa fresh yang tidak teralokasi pada `cut_off_time` → `blast_event reason='cutoff'`.

Kontrol: C28 PO line Confirmed dengan delivery_date lewat dan fulfilled_kg < kg (PERIKSA). C29 Σ allocation.kg per sales_line ≤ kg. C30 plan_day.head_count ≤ capacity. C31 blast_event tanpa lot_to (GAGAL).

### 4.5 Tabel baru — M4 outlook bulanan

```
month_outlook        id, month date (hari pertama), cut_off_date, status ('open'|'v1_locked'|'v2'|'final'),
                     budget_revenue, budget_gp, budget_nibt, created_*
month_outlook_version id, month_outlook_id, version ('V1'|'V2'|'FINAL'), locked_at, locked_by, snapshot jsonb,
                     snapshot_sha256, revenue, cogs, gp, opex, nibt, note
outlook_assumption   id, month_outlook_id, version, code, description, value_text, value_num, source, owner
closing_adjustment   id, month_outlook_id, code ('DI-01'…), description, pl_line, amount, kind
                     ('unbilled_revaluation'|'parked_cost'|'inventory_adj'|'accrual'|'other'), gl_voucher nullable, posted boolean
pl_daily             date, pl_line, actual numeric(18,2), forecast numeric(18,2), basis ('journal'|'do_unbilled'|'po'|'runrate'|'fixed'|'variable'),
                     anomaly boolean, primary key(date, pl_line, basis)          ← data mart
outlook_accuracy     month_outlook_id, version, metric ('MAPE'|'bias'|'abs_err'), scope ('revenue'|'gp'|'nibt'), value
```

Aturan:
- Actual per hari = jurnal GL (akun P&L via `coa_map.pl_line`) + DO belum difaktur (`sales_line` Aktual tanpa faktur, dinilai harga PO, COGS pada MA hari itu) dengan `basis='do_unbilled'`.
- Forecast per hari setelah cut-off: revenue = Σ PO Confirmed/Tentative berbobot pada `delivery_date`; hari tanpa PO = run-rate = rata-rata revenue harian 20 hari kerja terakhir **tanpa** hari `anomaly=true` (revenue 0 pada hari kerja, atau > 3σ). GP hari ber-PO = `kg × (price − cost_per_kg)`, dengan `cost_per_kg` = MA SKU hari itu sejauh `free_kg` menutup PO; kekurangannya dinilai pada **cost rencana** dari M1/M3: `(lb_price_today × kg LB per kg SKU via yield + ekspedisi + maklon/overhead) / yield` untuk SKU hasil potong, atau `replacement_buy_price` untuk trading. Hari run-rate = run-rate × GP% 4 minggu terakhir. Jadi P&L forecast benar-benar turunan dari demand forecast + rencana penjualan + costing per SKU, bukan GP% rata-rata saja.
- Biaya mengikuti driver (M5).
- Outlook = actual MTD + forecast sisa hari. Range = ± `forecast_tolerance_pct` pada porsi forecast saja.
- Vs budget: budget bulanan ÷ hari kalender bulan → "butuh per hari" sisa = (budget − actual MTD) / sisa hari.
- V1 dikunci pada hari kerja ke-`v1_lock_day` (default 20). V2 bridge: ΔActual (hari yang semula forecast), ΔVolume, ΔHarga, ΔEvent (asumsi berubah), harus menutup ke Rp 0 (kontrol C32).
- Penyesuaian tutup buku dicatat di `closing_adjustment` sebelum FINAL. Akurasi dihitung vs FINAL **sebelum** dan **sesudah** penyesuaian (dua angka).
- Kalibrasi: setelah FINAL, hitung ulang run-rate dan yield default; simpan sebagai `outlook_assumption` bulan berikutnya dengan `source='kalibrasi'`.

### 4.6 Tabel baru — M5 driver biaya

```
fixed_cost_schedule  id, pl_line, account nullable, description, amount_per_month, start_date, end_date nullable,
                     amortize boolean, prepaid_total nullable, intercompany boolean, vendor, cash_day_of_month nullable,
                     active, created_*
```
- Per hari: `amount_per_month / hari_kalender_bulan` untuk tanggal dalam [start_date, end_date].
- Outlook biaya tetap bulan = `actual MTD (jurnal) + max(0, nominal_jadwal_bulan − actual MTD)`. Tidak pernah dua kali.
- Variabel: `rp_per_kg × kg forecast` dari M3 (kg potong untuk biaya RPA, kg jual untuk biaya kirim).
- Run-rate: tabel `runrate` yang ada, kini per bulan (`monthly_amount`), dengan basis 20 hari kerja.
- Seed awal dari FS: gaji, depresiasi, sewa RPA Rawa Terate 94,48 jt/bulan mulai 2026-11-01 (prepaid 1.133,79 jt, amortize), sewa ABF NMG, bunga, deposit DS Solutions (prepaid other). Nilai pasti diisi Finance; seed hanya baris dengan `amount_per_month` null dan `description`.

Kontrol: C33 setiap pl_line biaya di `coa_map` punya `driver_type` ≠ 'none' (BELUM DIISI kalau tidak). C34 pos tetap dengan actual MTD > nominal jadwal (PERIKSA).

### 4.7 Tabel baru — M6 kas, CCC, solvabilitas

```
bank_account         account_no, bank, name, currency, coa_account, active
cash_daily           id, date, account_no, opening numeric(18,2), closing numeric(18,2), note, source, upload_id,
                     unique(date, account_no)
cash_daily_plan      id, date, account_no, cf_category, description, amount, fixed_cost_schedule_id nullable,
                     status ('plan'|'done'|'cancelled'), done_date
cash_position_daily  date, total_closing, total_plan_in, total_plan_out, projected_closing, lowest_next_13w, primary key(date) ← data mart
ccc_daily            date, dio_days, dso_days, dpo_days, ccc_days, inventory_value, ar_value, ap_value, cogs_ttm_daily, revenue_ttm_daily
solvency_monthly     month, equity, paid_in_capital, affiliate_payable, affiliate_receivable, months_to_negative_equity, basis_nibt
```
Template kas harian (file Excel/CSV untuk Finance, satu baris per rekening per hari): `tanggal, no_rekening, saldo_awal, saldo_akhir, catatan` + sheet rencana: `tanggal, no_rekening, kategori_cf, deskripsi, jumlah, id_jadwal_tetap`. Upload kind baru `cash_daily`.

CCC: DIO = inventory_value / (COGS 90 hari / 90); DSO = AR / (revenue 90 hari / 90); DPO = AP / (COGS 90 hari / 90). Simulasi: slider termin (terms_lb_days, terms_trading_days, hari stok target) → CCC dan kebutuhan modal kerja = (CCC/365) × COGS tahunan.

Solvabilitas: ekuitas dari neraca mingguan terakhir; `months_to_negative_equity = equity / −nibt_outlook` kalau nibt < 0.

Kontrol: C35 Σ cash_daily.closing semua rekening vs saldo kas neraca (±Rp 1). C36 hari kerja tanpa upload kas (BELUM DIISI). C37 AP tanda negatif di proyeksi (D4).

### 4.8 Tabel baru — M7 commercial

```
sales_assignment     sales_rep, customer nullable, key nullable, active
sales_target         week_start, sales_rep, key nullable, target_kg, target_rp
urgency_rule         id, form, age_from, age_to, status ('aman'|'jual_minggu_ini'|'jual_hari_ini'), sort
price_floor_rule     id, key nullable, group_code nullable, markup_rp_per_kg, markup_pct, effective_from
discount_approval    id, sales_line_id, requested_price, floor_price, rp_per_kg_below, kg, total_below,
                     requested_by, status ('pending'|'approved'|'rejected'), decided_by, decided_at, reason
commercial_daily     date, key, group_code, free_fresh_kg, free_frozen_kg, oldest_age_days, hours_to_cutoff,
                     cost_per_kg_ma, cost_per_kg_si, price_floor, price_list, margin_per_kg_list,
                     realized_price_7d, margin_per_kg_realized, holding_loss_per_day, downgrade_risk_rp,
                     urgency ('aman'|'jual_minggu_ini'|'jual_hari_ini'), priority_score, primary key(date, key) ← data mart
sales_scorecard_weekly week_start, sales_rep, target_kg, actual_kg, pct, kg_to_frozen_unsold, rp_downgrade,
                     forecast_mape, discount_count, discount_rp
```
- `price_floor = cost_per_kg_ma + markup` (rule per key/grup; default markup = `storage_cost_per_kg_day × 7 + blast_cost_per_kg`).
- `holding_loss_per_day = storage_cost_per_kg_day × free_kg`; untuk fresh yang akan lewat cut-off: + `downgrade_risk_rp = (price_fresh − price_frozen) × free_fresh_kg`.
- `priority_score = (holding_loss_per_day + downgrade_risk_rp / max(1, hours_to_cutoff/24)) × 1`; ranking turun.
- Sales dan commercial_lead melihat per SKU: `free_kg` (fresh/frozen), umur, `cost_per_kg_ma`, `price_floor`, `price_list`, `margin_per_kg` (list dan realisasi), `holding_loss_per_day`, `downgrade_risk_rp`, urgensi, ranking. Yang **tidak** terlihat oleh sales: cost pool, biaya per batch, `cost_per_kg_si` per lot, overhead rate (itu detail finance). Parameter `sales_sees_cost` default `true`; kalau diset `false`, kolom cost per kg disembunyikan dan hanya harga lantai + margin yang tampil.
- Jual di bawah `price_floor`: input order ditolak kecuali ada `discount_approval` status approved; `commercial_lead` sampai `discount_limit_rp_per_kg`, di atas itu `finance`.
- Scorecard mingguan dihitung Senin untuk minggu lalu.

Kontrol: C38 order dengan price < price_floor tanpa approval (GAGAL). C39 SKU `jual_hari_ini` tanpa order hari ini (PERIKSA, tampil ke commercial_lead). C40 sales_rep tanpa `sales_assignment` (BELUM DIISI).

### 4.9 Infrastruktur

```
rebuild_queue        id, date, reason, requested_at, started_at, finished_at, status, error
app_setting          key, value jsonb, updated_*        (feature flag per modul: m1_costing … m7_commercial)
```
Feature flag default `false` di production sampai fase itu diterima. Halaman modul yang flag-nya off tidak dirender dan server action-nya menolak.

---

## 5. Upload baru (`packages/parsers`)

| Kind | Sumber | Format | Target | Peran |
| --- | --- | --- | --- | --- |
| `costing_wp` | WP potong (format `202609_Data_COGS_LB.xlsx`, sheet per pemasok `Pot_ISA`, `Pot_AGRO`) | hanya kolom: nama SKU, hasil potong kg, hasil potong % ; header batch (tgl, supplier, ekor, kg LB, harga, ekspedisi, maklon) | `batch` (update), `batch_output_sku` | cost_accounting, admin |
| `cost_pool_pi` | Daftar PI/faktur pemasok dari Accurate | CSV/xlsx | `cost_pool_line` | cost_accounting, admin |
| `po_lines` | Sales (CSV) | `tgl_po, no_po, customer, kode_item, kg, harga, tgl_kirim, status_demand, sales_rep` | `sales_line` (Order) | sales, admin |
| `forecast_sales` | Sales (CSV) | `minggu, kode_item, sales_rep, kg, harga` | `forecast_line` | sales, commercial_lead |
| `stock_card` | Accurate kartu stok per item | sudah ada parser v1 → sekarang juga dipakai rekon lot | `stock_card_snapshot` (baru, ringan: date, item_code, kg, value) | inventory_accounting |
| `cash_daily` | Template kas Finance | xlsx 2 sheet | `cash_daily`, `cash_daily_plan` | finance |
| `yield_matrix` | PPIC | CSV | `yield_matrix` | ppic, admin |
| `lb_supply` | Purchasing | CSV | `lb_supply` | purchasing |

Semua idempoten (`line_key`), lewat wizard yang ada (stage → plan → commit), dengan issues per baris. Item code tak terpeta → kontrol 1–3 yang ada.

---

## 6. Halaman

Tetap: semua halaman v1/v2. Baru (prefix `/w/[week]/` untuk mingguan, `/m/[month]/` untuk bulanan, `/sku/` untuk near-live):

| Rute | View | Isi |
| --- | --- | --- |
| `/w/[week]/input/costing` | preparer | Upload WP, cost pool, tie-out PI vs GL, tombol "Alokasikan", hasil per SKU, NRV |
| `/w/[week]/costing` | semua | COGS/kg per batch, per SKU, per grup; maklon vs own; kapasitas idle |
| `/sku` dan `/sku/[key]` | semua | Near-live: saldo per SKU/grup hari ini (fresh/frozen/free/reserved), MA dan SI, umur; drill ke lot dan movement |
| `/w/[week]/demand` | sales, ppic, management | [1] demand per SKU, netting, substitusi |
| `/w/[week]/rencana` | ppic | [2] mingguan (ekor, size, pola, surplus, downgrade Rp, approval) dan [3] harian |
| `/hari/[date]/alokasi` | ppic, sales | [4] alokasi FEFO, DO, sisa, blast; tombol cut-off |
| `/m/[month]` | management | Outlook bulanan: actual vs forecast harian (chart), kumulatif dengan band, vs budget, register asumsi, versi V1/V2/FINAL, bridge, akurasi |
| `/m/[month]/biaya` | finance | Jadwal biaya tetap, driver per pos, run-rate, intercompany |
| `/m/[month]/tutup-buku` | finance | Penyesuaian DI-xx, posting ke FINAL |
| `/kas` | finance, management | Posisi harian per rekening, rencana, 13 minggu, 12 bulan |
| `/kas/ccc` | management | CCC dan simulasi |
| `/komersial` | sales, commercial_lead, management | Commercial view per SKU, ranking, status urgensi |
| `/komersial/scorecard` | commercial_lead, management | Scorecard per sales |
| `/komersial/approval` | commercial_lead, finance | Antrian diskon |
| `/admin/modul` | admin | Feature flag, rebuild queue, backfill |

Management view mingguan (v2) **wajib** memuat, urut dari atas: headline (GP proyeksi, keputusan RPA, stok di atas umur, + baru: outlook bulan berjalan revenue/GP vs budget, kas terendah 13 minggu, SKU `jual_hari_ini` jumlah dan Rp risiko) → segmen → keputusan RPA + batch → **Input** (pembelian LB kg/Rp, pembelian trading, biaya batch: ekspedisi, maklon/TKL/overhead; sumber: batch + receipt_line + cost_pool) → **COGS** (baris P&L mingguan, COGS/kg vs revenue/kg per segmen, COGS/kg per grup SKU dari M1, roll-forward persediaan kg dan Rp dari M2: awal + masuk − keluar − blast = akhir, dibandingkan neraca) → spread trading → stok per umur → kas (chart + tabel CF) → demand (PO vs forecast vs rencana potong, dari M3) → akurasi (dari M4) → peringatan. Seksi Input dan COGS tidak boleh hilang; keduanya bagian acceptance criteria. Tanpa istilah tabel, merah hanya untuk nilai negatif.

---

## 7. Non-functional

- Semua perhitungan di engine, tested. Target coverage modul baru: golden per fixture + rule test per cabang.
- Rebuild satu hari < 5 detik untuk volume saat ini (≈ 100 batch/bulan, ≈ 3.000 sales line/bulan, ≈ 300 lot aktif).
- RLS untuk setiap tabel baru, uji di `supabase/tests/rls_roles.sql` diperluas.
- Backup: paket Supabase Pro + `pg_dump` harian via GitHub Actions ke storage privat (sudah diputuskan).
- Tidak ada secret di repo. Env Vercel tidak berubah.
- PDF rilis mingguan tidak berubah layout. PDF rilis bulanan baru (A4 landscape, 2 halaman: ringkasan + bridge).

---

## 8. Acceptance criteria per modul

| Modul | Lulus bila |
| --- | --- |
| Fase 0 | D1–D9 masing-masing: diperbaiki di data, atau dicatat di `docs/open-questions.md` §E dengan keputusan dan kontrol yang menandainya. Snapshot minggu contoh SHA tidak berubah kecuali D3/D4/D8 memerlukan koreksi data — bila ya, SHA baru dicatat di CHANGELOG dengan diff field per field |
| M1 | Upload `202609_Data_COGS_LB.xlsx` → batch_output_sku terisi untuk semua batch di file; alokasi Pot_ISA dan Pot_AGRO cocok ke angka kolom L di Excel ±Rp 1 per SKU (fixture `costing-2026-09`); C21–C24 hijau untuk fixture |
| M2 | Backfill lot dari fixture Agu → `sku_balance_daily` 24 Agu = opening stock per key (±0,01 kg); roll-forward 162.687 → 156.956 kg direproduksi; MA per key sama dengan `hpp_actual` sales_line Aktual Agu ±Rp 1/kg pada ≥ 95% baris; C25 assumed % tampil |
| M3 | Fixture demand (`KGR_Demand_Forecast.xlsx`): 7.051 ekor dan BLD binding direproduksi; alokasi B_Alokasi_Stok 2.000 kg dari 100 t direproduksi; alur [1]–[4] jalan end-to-end di UI untuk satu hari contoh; cut-off memindahkan sisa fresh ke blast_event |
| M4 | Outlook Agustus pada cut-off 26 Agu = 7.712,4 jt revenue / 293,4 jt GP (fixture `month-2026-08`, dari mockup Bulanan); V1 lock → V2 bridge menutup ke 0; FINAL = P&L Agustus Accurate; MAPE tampil |
| M5 | Seed jadwal tetap dari FS; biaya tetap per hari = nominal/hari kalender; outlook tidak menghitung dua kali (uji: actual MTD > jadwal → sisa 0) |
| M6 | Upload template kas → posisi harian; Σ rekening = kas neraca (C35); 13 minggu dan 12 bulan tampil; CCC dihitung dan simulasi mengubah angka; solvabilitas tampil |
| M7 | Commercial view untuk `sales` memuat cost/kg MA per SKU tetapi tidak memuat string cost pool / batch_ref / SI per lot di DOM; order < price_floor ditolak tanpa approval; ranking berubah saat umur berubah; scorecard mingguan terbentuk |
| Semua | `pnpm test`, `pnpm typecheck`, `pnpm parity`, `pnpm build` hijau; RLS test hijau; snapshot mingguan contoh sesuai aturan Fase 0; feature flag off = halaman tidak ada |

---

## 9. Keputusan terbuka dan asumsi default

Eksekusi tidak menunggu jawaban. Setiap item dipakai dengan default di bawah, dicatat di `docs/open-questions.md` §E, dan bisa diubah lewat parameter/master tanpa mengubah kode.

| # | Keputusan | Default yang dipakai |
| --- | --- | --- |
| Q1 | By-product: joint vs NRV | joint |
| Q2 | Cost pool: PI saja atau PI + akrual | PI + akrual GL, tie-out ke GL |
| Q3 | Harga alokasi fresh vs frozen | `sku_price` minggu potong; key fresh dan frozen berbeda |
| Q4 | Arti gap hasil potong 8–10% (D1) | susut proses; kontrol C22 toleransi 2% sampai PPIC konfirmasi |
| Q5 | Sumber ekor per batch | kolom `head_count` dari WP; kalau kosong = lb_kg / avg_lb_kg parameter |
| Q6 | Lot di DO | tidak ada di Accurate sekarang → FIFO assumed; target: kolom lot di DO Ops |
| Q7 | Tabel substitusi | kosong (tidak ada substitusi) |
| Q8 | Fresh window / cut-off | 48 jam / 14:00 |
| Q9 | Penyebab 63% frozen | ditampilkan sebagai `rp_downgrade` di rencana mingguan; bukan diputuskan sistem |
| Q10 | Threshold approval downgrade | Rp 25 jt per minggu |
| Q11 | MA di Accurate: per item atau per gudang | per item |
| Q12 | V1 lock | hari kerja ke-20 |
| Q13 | Toleransi forecast | ±10% porsi forecast |
| Q14 | Unbilled DO | masuk actual basis `do_unbilled`, dinilai harga PO |
| Q15 | Margin acuan commercial | margin/kg pada harga list dan realisasi 7 hari |
| Q16 | Granularitas budget | bulanan per pl_line |
| Q17 | Sales lihat cost? | ya: cost/kg MA per SKU, harga lantai, margin; tidak lihat cost pool, biaya per batch, SI per lot |
| Q18 | Urgensi fresh | > 24 jam = jual hari ini; frozen > 21 hari = jual minggu ini; > `frozen_age_limit_days` (30) = di atas batas umur |
| Q19 | Batas approval diskon commercial_lead | Rp 500/kg; di atas itu Finance |
| Q20 | Bobot Tentative / Forecast | 70% / 50% |

---

## 10. Risiko

| Risiko | Mitigasi |
| --- | --- |
| Backfill lot merusak angka stok v1 | Ledger M2 hidup paralel; engine v1 tetap baca `opening_stock`/`receipt_line`; kontrol C26/C27 menunjukkan selisih; switch sumber stok ke ledger hanya di fase terakhir dengan flag |
| WP costing tidak konsisten antar pemasok | Parser hanya ambil 4 kolom (nama SKU, kg, %); header batch dipetakan lewat mapping tersimpan per sheet |
| Akurasi forecast buruk di awal | Band ±10% dan register asumsi membuat ini terlihat, bukan tersembunyi |
| Sales menolak harga lantai | Flag `m7_commercial` on per tahap: lihat dulu, approval diaktifkan dua minggu kemudian |
| Rebuild lambat | Per tanggal, idempoten, antrian; index per (date, key) |
| RLS bocor detail finance ke sales | View `commercial_daily_sales` hanya kolom PRD §4.8 (tanpa cost pool, batch, SI per lot); uji RLS khusus |
