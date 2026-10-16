Digantikan oleh docs/PRD-v5.md sejak 16 Okt 2026; lihat §1.3 untuk pasal yang dicabut. Pasal lain tetap berlaku sebagai rujukan v4 §x.

# PRD v4 — KGR Operations & Finance Platform

Status: Draft untuk review pemilik produk, lalu handoff ke Claude Code · Owner: Dika (Group Project Finance, SAMB) · Tanggal: 16 Okt 2026 (WIB)
Repo: `dikagustiana/KGR-Weekly-Outlook` · Basis audit: commit `23f973f23941e74ecc79077e9b577babea19e94b` (merge PR #7, v3 F0–F7) · Supabase ref `uxqbtverhnpiryhzbenr` · Vercel `kgr-weekly-outlook`

Dokumen ini adalah **satu-satunya otoritas produk**. Ia menyerap dan menggantikan: `docs/PRD.md` §3 ke atas, `docs/PRD-management-view-v2.md`, `docs/PRD-v3-kgr-platform.md`, `docs/PLAN-v3.md`, PRD revisi ChatGPT (16 Okt 2026), dan spesifikasi proses P1–P14 / flowchart 8.1–8.4 dari sesi desain. Bagian dari dokumen lama yang masih berlaku ditulis ulang di sini; bagian yang tidak ditulis ulang berarti dicabut (Bab 0.2). `docs/PRD.md` §1–2 dan Excel di `reference/` tetap spesifikasi untuk perilaku v1 yang parity-nya sudah dibuktikan.

> **Cara baca untuk Claude Code.** Baca Bab 0 dulu: setiap keputusan K dan setiap pasal cabut mengikat. Lalu Bab 2 (prinsip), Bab 3 (engine), Bab 5–6 (desain dan halaman), Bab 9–10 (acceptance dan irisan). Kerjakan per irisan (Bab 10), satu branch dan satu PR per irisan, dan berhenti di akhir tiap irisan untuk sign-off. Jangan mengaktifkan modul, menjalankan SQL ke production, atau merge. Jika HEAD berubah dari `23f973f`, perbarui analisis dampak dulu. Kalau dua pasal dokumen ini tampak bertentangan, berhenti dan tanya; jangan memilih yang paling konservatif secara diam-diam, karena itu yang membuat tiga handoff sebelumnya meleset.

Konvensi angka di dokumen ini: titik untuk ribuan, koma untuk desimal (Rp 2.782,2 jt; 9,0%). "jt" = juta rupiah, "M" tidak dipakai. Setiap angka menyebut sumbernya; angka yang belum diverifikasi ditandai *(belum diverifikasi)*.

---

## 0. Keputusan dan daftar cabut

### 0.1 Log keputusan

Status "default" berarti dipakai sampai pemilik keputusan mengubahnya; eksekusi tidak menunggu. Status "ditetapkan" berarti sudah diputuskan pemilik produk dalam percakapan 15–16 Okt 2026.

| # | Keputusan | Pilihan yang dipakai | Pemilik | Status | Efek |
|---|---|---|---|---|---|
| K1 | Konversi demand ke ekor | Ekor ditentukan oleh **produk utama** saja (karkas dan potongan yang berasal dari karkas). By-product (kepala, ceker, usus, HJA, lemak) tidak ikut menentukan ekor; kekurangan by-product terhadap order ditampilkan sebagai sinyal beli lewat trading atau pengurangan order. Di antara produk utama, aturan "binding cut" workbook tetap berlaku. | PPIC + Group Project Finance | ditetapkan (flow pemilik produk; PRD v3 §4.4 langkah 3) | `headsByPattern` dibatasi ke produk utama; golden workbook 7.051 ekor / BLD tetap; golden minggu KGR baru (§3.1) |
| K2 | Forecast untuk demand tanpa PO | Forecast statistik dari histori `sales_line` Aktual per SKU per hari kerja (fungsi `demandRate` / `forecastDaily` yang sudah ada di engine), hari stockout dibuang dari rata-rata (stok bebas 0 di ledger). Upload forecast sales menimpa per SKU per minggu. | Sales + Group Project Finance | default | `forecast_line.source` ('stat' / 'sales'); mart `demand_weekly` memuat keduanya |
| K3 | Run-rate revenue untuk hari kerja tanpa PO | Rata-rata revenue hari kerja dalam **7 hari kalender terakhir sebelum cut-off**; hari kerja dengan revenue 0 atau di luar 3σ dikeluarkan dan ditandai anomali. Faktor Minggu/libur dari pola actual. Untuk Agustus 2026: 31 Agu = **310,4 jt** (5 hari kerja 20–26 Agu tanpa 25 Agu). | Group Project Finance | ditetapkan (spec P3) | PRD v3 §4.5 "20 hari kerja" dicabut; engine `monthly.ts` diubah; parameter `runrate_window_days` = 7 |
| K4 | Golden outlook Agustus | Target 7.712,4 jt / 293,4 jt **dicabut** (dihitung dengan hari nol 25 Agu di dalam run-rate dan sudah terbukti meleset 649,4 jt dari actual final). Golden baru dihitung engine dengan K3, K5, K11 pada fixture `month-2026-08`, direview, lalu dikunci. Uji akurasi memakai actual final Agustus: revenue 8.361,8 jt, GP 306,7 jt (FS Sep 2026, `PL - Management Report` K12, K15). | Finance | ditetapkan | `fixtures/month-2026-08/golden.json` ditulis ulang (§9) |
| K5 | GP headline | **GP P&L** (revenue jurnal − seluruh akun COGS yang dipetakan, termasuk ekspedisi dan blasting) adalah headline di view mingguan dan bulanan. **GP produk** (revenue DO/order − HPP per key) tetap dihitung dan tampil per segmen/SKU. Bridge GP produk → GP P&L wajib tampil; residual > Rp 1 memblokir klaim "rekonsiliasi". | Management + Finance | default | Headline mingguan berubah dari −47,6 jt (produk) ke −67,5 jt (P&L) untuk minggu contoh |
| K6 | Biaya tetap | Template 8.3 dipakai penuh: nominal per bulan per COA, berlaku dari/sampai, basis bagi (hari kalender default / hari kerja), jadwal posting, dasar, pemilik, versi; `cost_event` untuk biaya satu kali. Biaya harian normal = nominal ÷ hari; outlook bulan = actual MTD + max(0, nominal − actual MTD). Dipakai di P&L harian, mingguan (v4), dan bulanan. Tabel `runrate` v1 pensiun untuk pos berdriver Tetap (engine v1 tetap membacanya untuk minggu contoh agar snapshot tidak berubah). | Finance | ditetapkan (spec 8.3) | §3.3; skrip `F0-D7-D9-runrate.sql` hanya penambal sementara |
| K7 | Pengiriman parsial | `delivered_kg` dicatat per pengiriman (tabel `delivery`); outstanding = kg − Σ delivered − cancelled. "Terkirim" meminta kg, bukan menutup baris. | Sales + Inventory Accounting | ditetapkan | `fulfilled_kg` tidak lagi diisi `= kg` otomatis |
| K8 | Sisa fresh tanpa PO | Urutan: tawarkan **spot** lewat Commercial view (status `jual_hari_ini`) sampai `cut_off_time`; sisanya **blast** ke frozen saat cut-off. Rp downgrade dicatat di keduanya. | PPIC + Commercial lead | default | `allocation.ts` tidak berubah; halaman alokasi menambah langkah spot |
| K9 | Versi outlook bulanan | V1 dikunci di rapat outlook bulanan **minggu ke-3** (parameter `v1_lock_week` = 3, pada hari rilis mingguan Kamis) oleh Group Project Finance; V2 opsional tiap Kamis dengan bridge; FINAL setelah tutup buku. Toleransi ±10% hanya pada porsi forecast. MAPE = N/A bila actual 0. | Group Project Finance | ditetapkan (P9, P11, P12) | parameter `v1_lock_day` (20) diganti `v1_lock_week` |
| K10 | Solvabilitas | Blok pendanaan dan solvabilitas (ekuitas, utang pihak berelasi, bunga, kas, bulan sampai ekuitas negatif) ada di **layar pertama** view manajemen mingguan dan bulanan. | Management | ditetapkan | §6.1, §6.3 |
| K11 | Revenue actual bulanan | Jurnal GL per tanggal posting **ditambah DO terkirim belum difaktur** (dinilai harga PO, basis `do_unbilled`, dibalik saat faktur terbit). Keduanya tampil terpisah. | Finance | default (P1, Q14) | `pl_daily.basis` |
| K12 | Hari 25 Agu 2026 | Tidak ada baris penjualan maupun jurnal pada hari itu (fixture `week-2026-08-24/sales_lines.json`, `gl_lines.json`). Diperlakukan sebagai **anomali / data hilang**, bukan nol sah, sampai Sales dan Finance memastikan. | Finance + Sales | default | masuk register asumsi dengan status "belum disepakati" |
| K13 | By-product dalam costing | `joint` (ikut share relative sales value), opsi NRV tersedia lewat parameter. | Finance + Cost Accounting | default (Q1) | tidak berubah dari PRD v3 |
| K14 | Bahasa visual | Satu bahasa visual untuk seluruh app: grammar samb-bi (grid tile 12 kolom, kartu dengan baris pembanding, chart sebagai tulang punggung, slicer periode, drawer "cara hitung"). MV v2 §3 ("tidak redesign palet, tipografi, grid") dicabut. | Pemilik produk | ditetapkan | Bab 5 |
| K15 | Keputusan RPA harian | Pindah ke workspace PPIC (halaman Rencana). Di view manajemen diganti **Outlook mingguan**; pemicu ekonominya (harga LB vs breakeven) tetap tampil sebagai baris di tabel segmen. | Pemilik produk | ditetapkan | MV v2 R2–R4 dicabut; engine `block2.action` tetap ada di snapshot |
| K16 | Satuan | Rp jt satu desimal di seluruh view manajemen, termasuk headline dan sumbu chart. Rp penuh hanya di drilldown dan ekspor. Tanda minus "−" (U+2212). | Pemilik produk | ditetapkan | `fmt.ts` |
| K17 | Sumber angka view manajemen | Semua halaman manajemen membaca data mart harian (`pl_daily`, `sku_balance_daily`, `cash_position_daily`, `commercial_daily`, `demand_weekly`) yang dibangun engine. Tidak ada halaman yang menghitung ulang. Blok v1 (`computeWeek`) tetap untuk view preparer, PDF rilis mingguan, dan parity. | Pemilik produk | ditetapkan | PRD v3 prinsip 4 ditegakkan |
| K18 | Blok 5 "Kas keluar" | Tidak dirender di view manajemen (keputusan `open-questions.md` D5 yang belum ditegakkan di kode). Kas manajemen = posisi kas harian + arus kas dari jurnal. | Pemilik produk | ditetapkan | `OutlookBody.tsx` |

### 0.2 Daftar cabut

Pasal di bawah tidak berlaku lagi sejak PRD v4 disetujui. Claude Code tidak boleh mengembalikannya.

| Dokumen | Pasal | Isi yang dicabut | Diganti oleh |
|---|---|---|---|
| `PRD-management-view-v2.md` | §3 Non-goals | "Tidak redesign palet, tipografi, atau grid" | K14, Bab 5 |
| `PRD-management-view-v2.md` | R2 | Headline tiga angka termasuk "Keputusan RPA hari ini" | K15, §6.1 |
| `PRD-management-view-v2.md` | R3, R4 | Seksi 2 restruktur dan rekomendasi satu aksi di view manajemen | K15, §6.4 (aksi hidup di workspace PPIC) |
| `PRD-management-view-v2.md` | R7 | "Tidak ada kolom yang dihapus" | §6.1 (tabel segmen 9 kolom, sisanya drilldown) |
| `PRD-management-view-v2.md` | §5 | Kriteria `[data-reco]` "tepat satu aksi" di view manajemen | §9 (kriteria pindah ke halaman PPIC) |
| `PRD-v3-kgr-platform.md` | §4.4 langkah 3 (implementasi) | Ekor = maksimum kebutuhan semua SKU termasuk by-product | K1 |
| `PRD-v3-kgr-platform.md` | §4.5 | Run-rate = rata-rata 20 hari kerja terakhir | K3 |
| `PRD-v3-kgr-platform.md` | §4.5 | GP hari ber-PO hanya `kg × (price − cost_per_kg)` sebagai GP outlook | K5, §3.2 P6 |
| `PRD-v3-kgr-platform.md` | §4.6 | `fixed_cost_schedule` tanpa basis bagi, dasar, pemilik, versi; tidak dipakai mingguan | K6, §3.3 |
| `PRD-v3-kgr-platform.md` | §6 | Urutan view manajemen "headline → segmen → keputusan RPA + batch → …" | §6.1 |
| `PRD-v3-kgr-platform.md` | §8 M4 | Acceptance "outlook Agustus = 7.712,4 jt / 293,4 jt" | K4, §9 |
| `PRD-v3-kgr-platform.md` | §9 Q12 | V1 dikunci hari kerja ke-20 | K9 |
| PRD revisi ChatGPT (16 Okt) | §4 | Navigasi 10 menu ("Ringkasan, Tugas Saya, …") dan "setiap status memakai teks dan ikon" | §5.4 (workspace per peran), §5.1 (status teks, tanpa ikon) |
| PRD revisi ChatGPT (16 Okt) | §5 | "Pertahankan satu aksi RPA dan hierarchy headline" | K15 |
| PRD revisi ChatGPT (16 Okt) | §2 | Artifact dan prototipe sebagai "lampiran historis, bukan instruksi" | §5.5 (mockup di `reference/design/` adalah spec) |
| `docs/open-questions.md` | D5 | "Blok 5 tidak lagi dipakai manajemen" (keputusan benar, kode belum mengikuti) | K18 ditegakkan |
| Spesifikasi sesi desain | P3 contoh angka | 31 Agu = 258,7 jt (memasukkan hari nol, bertentangan dengan aturan P3 sendiri) | K3 |

Keputusan Q1–Q20 di `PRD-v3-kgr-platform.md` §9 dan A/B di `docs/open-questions.md` tetap berlaku sejauh tidak dicabut di atas.

---
## 1. Masalah, konteks, dan tujuan

### 1.1 Kondisi perusahaan (FS Sep 2026)

Sumber: `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx`, sheet `BS - Management Report` dan `PL - Management Report` (sel disebut per baris). Rp jt.

| Indikator | Agustus | September | Sel |
|---|---|---|---|
| Revenue | 8.361,8 | 5.039,9 | PL K12 / L12 |
| GP P&L | 306,7 (3,7%) | −475,4 (−9,4%) | PL K15 / L15 |
| Laba sebelum pajak | −26,5 | −910,1 | PL K51 / L51 |
| Gaji | 85,6 | 82,7 | PL K23 / L23 |
| Bunga | 31,9 | 54,0 | PL K43 / L43 |
| Depresiasi (per bulan) | 10,4 | 0 (belum dibukukan) | PL K34 / L34 |
| Persediaan produk + trading | 1.492,9 + 2.039,7 = 3.532,6 | 4.724,2 + 1.928,2 = 6.652,4 | BS K23+K24 / L23+L24 |
| Utang pihak berelasi | 5.627,1 | 9.845,9 | BS K51 / L51 |
| Kas | 495,4 | 103,0 | BS K14 / L14 |
| Ekuitas | 1.612,6 | 702,6 | BS K77 / L77 |
| Modal disetor | 5.000,0 | 5.000,0 | BS K68 / L68 |

Turunan: DIO September ≈ 6.652,4 ÷ (5.515,3 ÷ 30) ≈ 36 hari (COGS September = revenue − GP = 5.039,9 + 475,4); DIO Agustus ≈ 14 hari. Bila rugi September berulang, ekuitas habis dalam 702,6 ÷ 910,1 ≈ 0,8 bulan.

Rantai sebabnya sudah terlihat di data yang ada di app: 63% karkas September dipotong tanpa PO dan masuk frozen (PRD v3 §1), persediaan naik 88%, dibiayai utang afiliasi yang naik 4.218,8 jt dalam sebulan. Sewa RPA Rawa Terate 1.133,8 jt per tahun (BS `PREPAID RENT` D11) mulai diamortisasi 1 Nov 2026 sebesar 94,5 jt per bulan (`PREPAID RENT` BE11: 94.482.500), ditambah sewa ABF NMG 62,5 jt (`DI - Note` D46) yang baru muncul September. Biaya tetap naik tajam mulai November dan outlook harus menunjukkannya sebelum terjadi.

### 1.2 Masalah produk

Aplikasi sekarang punya engine mingguan yang parity-nya terbukti (17.161 sel Excel), parser, dan 7 modul v3 di belakang flag. Tiga hal membuatnya belum dipercaya sebagai satu rantai operasi-ke-keuangan:

1. **Aturan bisnis menyimpang dari spec.** Konversi ekor memakai by-product sebagai pembatas (dry run minggu 24–30 Agu: 19.778 ekor karena order usus, padahal karkas hanya butuh 9.179 — Lampiran B.3). Run-rate memakai jendela yang berbeda dari spec. Biaya tetap yang diinput belum sampai ke P&L mingguan.
2. **Integritas data dan akses longgar.** `mart_replace` dapat dipanggil role sales dengan JSON hasil hitung apa pun (`20261016000100_v3_foundation.sql` baris 118); Sales tanpa assignment melihat semua SKU (`komersial/page.tsx` baris 28); "Terkirim" menutup seluruh PO (`input/actions.ts` baris 103).
3. **Tampilan tidak dirancang untuk pembacanya.** View manajemen adalah halaman tabel dengan judul topik, satuan campur, dan navigasi sampai 36 link untuk admin. Bentuk yang diinginkan pemilik produk adalah dashboard BI (grammar samb-bi): periode dipilih dari slicer, kartu dengan pembanding, chart sebagai tulang punggung, temuan terbaca dalam 5 detik.

### 1.3 Tujuan terukur

| ID | Tujuan | Ukuran penerimaan |
|---|---|---|
| O1 | Satu rantai operasi: PO → demand → rencana → produksi → alokasi → pengiriman | Journey C dan D (§9.3) berjalan end-to-end pada fixture minggu KGR; golden §3.1 lulus |
| O2 | Satu rantai keuangan: revenue → COGS → GP → NIBT → kas, harian | `pl_daily` Σ hari = P&L MTD (±Rp 1); outlook bulanan dan mingguan dari mart yang sama |
| O3 | Integritas akses | Matriks RLS 9 peran lulus; tidak ada jalur tulis mart dari klien |
| O4 | Integritas stok | Roll-forward kg per key ±0,01 kg; C26 hijau 4 minggu berturut sebelum cutover sumber stok |
| O5 | Manajemen membaca keputusan dalam 5 detik | Halaman §6.1 memuat temuan, 5 kartu, dan solvabilitas di atas fold 1366×768 tanpa scroll; screenshot banding lulus |
| O6 | Rilis yang dapat diaudit | Rilis ditolak di server bila kontrol wajib gagal; snapshot immutable dengan provenance |

---

## 2. Prinsip yang tidak boleh dilanggar

1. **Engine tetap fungsi murni.** `@kgr/engine`: input → output, tanpa I/O, semua angka decimal.js. Modul baru menambah fungsi dan tipe, tidak menambah efek samping.
2. **Snapshot minggu contoh identik.** SHA-256 `947ce203…a83` untuk 24–30 Agu 2026 tidak berubah. Field baru ditambahkan di bawah key baru. Kalau D3/D4/D8 memerlukan koreksi data, SHA baru dicatat di CHANGELOG dengan diff per field.
3. **Migrasi Supabase hanya menambah.** Tidak ada `drop`, tidak ada rename kolom yang dipakai engine, tidak mengubah migrasi yang sudah diterapkan. Perbaikan lewat migrasi repair yang idempoten.
4. **Satu angka.** Semua halaman membaca data mart yang sama (K17). Tidak ada halaman yang menghitung ulang.
5. **Setiap angka membawa empat label**: periode, basis (`journal` / `do_unbilled` / `po` / `runrate` / `fixed` / `variable` / `event`), status (`missing` / `draft` / `validated` / `released` / `final`), dan sumber (tabel + upload_id). Angka berstatus `missing` tidak pernah tampil sebagai 0.
6. **Spec = dokumen ini + fixture golden.** Excel tetap spec untuk v1. Konflik antara Excel dan aturan baru ditulis sebagai diff angka, asal, dan keputusan; golden lama tidak diganti diam-diam.
7. **Feature flag per irisan.** Default off di production sampai irisan diterima (Bab 10).
8. **Mockup adalah spec.** File di `reference/design/` (§5.5) setara dengan pasal dokumen ini. Perbedaan antara mockup dan teks diselesaikan dengan bertanya, bukan dipilih sendiri.

---

## 3. Engine per modul

### 3.0 Konvensi

- Money `numeric(18,2)`, Rp/kg `numeric(18,4)`, kg `numeric(12,2)`, ekor `integer`. Kalender Asia/Jakarta, minggu Senin–Minggu. Pembulatan hanya di titik yang ditetapkan fixture; residual alokasi ke satu baris deterministik.
- Format tiap proses: **Input · Proses · Output · Kontrol · Pemilik / waktu · Contoh · Perubahan vs kode sekarang.** Contoh memakai fixture `week-2026-08-24` dan `month-2026-08` kecuali disebut lain.
- Kontrol: C1–C20 (v1, `packages/engine/src/controls.ts`), C21–C40 (v3, `controls-v3.ts` dan modul), C41–C48 baru (Bab 7). Status: `LULUS`, `PERIKSA`, `BELUM DIISI`, `GAGAL`, ditambah `STALE` (mart lebih lama dari input) dan `N/A` (domain tidak berkontribusi ke angka rilis).

### 3.1 M3 — Demand → rencana produksi → alokasi

Alur (flow pemilik produk):

```
PO lines (SKU, kg, tgl kirim)
   → [1] Demand per SKU per minggu (PO berbobot + forecast non-PO)
   → netting stok yang layak pada tanggal kirim
   → konversi yield matrix → kebutuhan karkas → ekor per weight class   (produk utama saja, K1)
   → [2] Rencana mingguan (ekor, size, pola potong, proyeksi surplus)
   → [3] Rencana harian (tgl kirim − lead time × kapasitas × supply LB)
   → actual output per potongan (WP batch, M1) vs rencana
   → [4] Alokasi FEFO ke PO lines → pengiriman (parsial) → sisa ke spot → blast saat cut-off
```

**P3.1 · PO lines**
- Input: `sales_line` status `Order` dengan `delivery_date`, `demand_status` ('Confirmed' 100% / 'Tentative' 70% / 'Forecast' 50%; parameter `tentative_weight`, `forecast_weight`), `customer`, `price`, `sales_rep`, `po_ref`. Upload `po_lines` (CSV: `tgl_po, no_po, customer, kode_item, kg, harga, tgl_kirim, status_demand, sales_rep`).
- Proses: outstanding = kg − Σ `delivery.kg` − cancelled (K7). Perubahan kg/status/tgl kirim mengantrekan rebuild rentang tanggal terdampak.
- Output: baris PO terbuka per SKU × tanggal kirim.
- Kontrol: C7 (order lewat tanggal belum terkirim), C28 (Confirmed lewat tanggal kirim, outstanding > 0), harga kosong → baris ditolak di upload.
- Pemilik / waktu: Sales, harian.
- Contoh: minggu 24–30 Agu, 98 baris Order, semua tanggal kirim 27–29 Agu; RPA 23.784 kg, Trading 16.654 kg (fixture `sales_lines.json`; blok 1 `kgOrder`).
- Perubahan vs kode: tabel `delivery` baru; `fulfilled_kg` diturunkan dari Σ delivery (bukan `= kg`); `input/actions.ts` baris 103 dan `hari/[date]/alokasi/actions.ts` baris 51 diubah.

**P3.2 · Demand per SKU per minggu**
- Input: P3.1; `forecast_line` (K2: `source` 'stat' dari `forecastDaily`, 'sales' dari upload `forecast_sales`); bobot.
- Proses: `confirmed_kg`, `tentative_kg × 0,7`, `forecast_kg × 0,5`; untuk SKU × minggu yang punya baris 'sales', baris 'stat' tidak dipakai. Forecast statistik: `demandRate` = rata-rata kg per hari kerja Normal (hari stockout, yaitu stok bebas 0 di `sku_balance_daily`, dikeluarkan); `forecastDaily` per skenario Bear/Base/Bull dengan `ForecastConfig` yang ada.
- Output: mart `demand_weekly` (week_start, key, confirmed, tentative, forecast, weighted, source_forecast).
- Kontrol: C44 (baru): SKU dengan histori ≥ 20 hari kerja tapi tanpa forecast → `BELUM DIISI`.
- Pemilik / waktu: Sales (PO, upload forecast); otomatis untuk 'stat' tiap rebuild Senin.
- Contoh: RPA Karkas Fresh 12.307 kg Confirmed (semua baris backfill = Confirmed, `20261016000700_m3_backfill.sql`).
- Perubahan vs kode: `apps/web/lib/v3/planning.ts` memanggil `demandRate`/`forecastDaily` dari histori (sekarang hanya dipakai tes golden); kolom `forecast_line.source`.

**P3.3 · Netting stok layak**
- Input: `lot_balance_daily` pada stock date (Minggu sebelum minggu rencana), `fresh_window_hours` dan `frozen_age_limit_days` per key (default 48 jam / 30 hari), `substitution`.
- Proses: `eligibleFree(lots, daysAhead, windows)` lalu `netDemand` (stok sendiri → substitusi berurut prioritas, maksimum `max_pct`). Kelayakan dihitung pada **tanggal kirim**, bukan tanggal lihat layar.
- Output: `stock_free_kg`, `substituted_kg`, `net_kg` per key.
- Kontrol: C11 (stok proyeksi minus) tetap; C45 (baru): mart stok lebih lama dari upload terakhir → `STALE`, rencana tidak boleh disimpan.
- Contoh: Karkas Frozen order 4.228 kg tertutup stok frozen (umur rata-rata 18,7 hari); Karkas Fresh 12.307 kg tidak tertutup karena stok awal fresh melewati 48 jam pada 27 Agu (Lampiran B.3).
- Perubahan vs kode: tidak ada di engine; `planning.ts` harus menolak simpan bila `STALE`.

**P3.4 · Konversi ke ekor (K1)**
- Input: `net_kg` per key; `sku_key.product_class` ('main' / 'by_product', kolom baru); `yield_matrix` (weight_class × cut_pattern × unit → yield_pct), `weight_class.avg_kg`.
- Proses, per pola potong p dan weight class w:
  ```
  unit(key)        = sku_key.sku untuk key RPA (fresh dan frozen satu unit); null untuk Trading
  kg_per_head(u,p) = avg_kg(w) × yield_pct(w, p, u)
  heads_u          = ceil(net_kg_u / kg_per_head(u,p))                untuk u dengan product_class = 'main'
  heads_p          = max(heads_u)  → unit pemberi max = binding cut
  by-product       : output_bp = heads_p × kg_per_head(bp,p); kurang_bp = max(0, net_kg_bp − output_bp)
  karkas_setara_u  = heads_u × avg_kg × yield_karkas(w)
  ```
  SKU yang hanya bisa dari size tertentu menentukan minimum ekor size itu (bottleneck size). SKU tanpa yield tidak dipotong dan ditandai.
- Output: ekor per pola per weight class, binding cut, `kurang_bp` per by-product (sinyal beli trading / kurangi order).
- Kontrol: C41 (baru): by-product dengan `kurang_bp` > 0 → `PERIKSA` dengan saran "beli trading" bila `replacement_buy_price` ada; C42 (baru): `yield_matrix` masih bernote "Placeholder" → `BELUM DIISI` (rencana boleh disimpan dengan label "yield sementara", tidak boleh disalin ke batch).
- Pemilik / waktu: PPIC (yield, size, pola); otomatis tiap rebuild.
- Contoh (yield placeholder, STD 2,0 kg, Lampiran B.3): Karkas net 13.118 kg → 9.179 ekor; Usus net 1.673 kg → 19.778 ekor **tidak dipakai** (by-product). Rencana = 9.179 ekor (18.358 kg LB). Kekurangan by-product: HJA 1.022 kg, Usus 897 kg, Kepala 842 kg, Ceker 548 kg.
- Perubahan vs kode: `headsByPattern` (`demand.ts` baris 297) menerima daftar unit `main`; `topUps` hanya di antara produk utama; `weekDemand` mengeluarkan `shortfalls`. Golden workbook (7.051 ekor, BLD binding) tetap lulus karena BLD adalah produk utama.

**P3.5 · Rencana mingguan**
- Input: ekor per pola (P3.4), `lb_supply` confirmed, `capacity`, `sku_price` fresh/frozen minggu itu, `downgrade_approval_threshold` (Q10, 25 jt).
- Proses: `proposeWeekPlan`: `head_count = max(ekor dibutuhkan, Σ supply komitmen)`, dibatasi kapasitas; `weight_class_mix` dan `cut_pattern_mix`; `surplus_kg_by_key = output − demand`; `frozen_planned_kg`; `rp_downgrade = Σ (price_fresh − price_frozen) × surplus` hanya bila kedua harga ada (bila tidak: `missing`, rencana tidak bisa disetujui).
- Output: `plan_week` versi n (approval bila `rp_downgrade` > threshold).
- Kontrol: C46 (baru): harga fresh/frozen kosong untuk SKU bersurplus → `BELUM DIISI`. Batas kapasitas diuji di harian (C30).
- Pemilik / waktu: PPIC, Senin; approval admin/finance.
- Perubahan vs kode: tidak ada di `plan.ts` selain input dari P3.4; `savePlan` menolak bila C42/C45/C46 bukan LULUS.

**P3.6 · Rencana harian**
- Input: `plan_week`, `lead_time_days` (1), `capacity` per tanggal (`cut_capacity_head`, `chiller_kg`, `abf_kg`), `lb_supply` per tanggal.
- Proses: `splitHeadsByDay` (porsi PO per tanggal kirim − lead time; forecast dibagi rata), lalu `dailyPlan` (lebih dari kapasitas/supply digeser ke hari sebelumnya; sisa `unplaced` ditampilkan). Baris `plan_day` → `batch` Rencana hanya lewat tombol "Salin ke batch rencana" (tidak otomatis; blok 2 v1 tidak bergeser diam-diam).
- Output: `plan_day` (date, head_count, weight_class, cut_pattern, supplier, target_kg_by_key).
- Kontrol: C30; C47 (baru): tanggal dalam rencana tanpa baris `capacity` → `BELUM DIISI` (rencana harian tidak dibatasi = tidak boleh disalin ke batch).
- Pemilik / waktu: PPIC; kapasitas diisi sekali per periode (maklon s.d. Okt; Rawa Terate mulai 1 Nov).
- Perubahan vs kode: `capacity` wajib ada untuk hari rencana; seed `capacity` dua periode dengan nilai `null` dan deskripsi (nilai diisi PPIC).

**P3.7 · Actual output per potongan**
- Input: `batch` Aktual + `batch_output_sku` (upload `costing_wp`, M1).
- Proses: varian per SKU per hari = output aktual − `target_kg_by_key`; varian ekor = `head_count` aktual − rencana.
- Output: tabel varian di halaman Rencana dan di view manajemen (demand vs rencana vs aktual).
- Kontrol: C22 (Σ output SKU vs kg diproses, toleransi 2%); batch tanpa output → C48 (baru) `GAGAL` dan tidak boleh diposting (contoh: AGRO28–30, D2; transport 12 jt terparkir di P&L, DI-03).
- Pemilik / waktu: Cost Accounting (upload WP), PPIC (membaca varian).
- Perubahan vs kode: halaman `rencana` menambah blok varian; belum ada di `rencana/page.tsx`.

**P3.8 · Alokasi FEFO dan pengiriman**
- Input: PO terbuka dengan `delivery_date` = hari ini (urut Confirmed → Tentative → Forecast, lalu tanggal, lalu nilai), lot layak dari ledger (`lotsForAllocation`), alokasi manual yang ada.
- Proses: `allocateFEFO`; reservasi tidak mengurangi fisik; dispatch (DO) mengurangi fisik dan reservasi; `delivery` mengurangi outstanding (K7). Tolak qty negatif, lot tidak layak (hold/expired), lintas assignment, over-allocation (termasuk transaksi paralel: unique `(sales_line_id, lot_ref)` + cek Σ ≤ kg di trigger).
- Output: `allocation`, `lot_movement out_sale` saat DO; `delivery` per pengiriman.
- Kontrol: C29 (Σ alokasi ≤ kg), C25 (porsi lot diduga).
- Pemilik / waktu: PPIC (alokasi), Sales (Terkirim dengan kg).
- Contoh golden: B_Alokasi_Stok 2.000 kg dari 100.000 kg (fixture `demand-2026-09`) tetap; contoh baru: PO 1.800 kg dikirim 600 kg → outstanding 1.200 kg.
- Perubahan vs kode: tabel `delivery`; trigger Σ alokasi; `allocation.ts` web tidak mengisi `fulfilled_kg = kg`.

**P3.9 · Sisa fresh: spot lalu blast (K8)**
- Input: lot fresh sisa setelah alokasi hari ini dan PO hari-hari berikut yang masih bisa dilayani selagi fresh (`cutoffBlasts` sudah menghitung ini), `cut_off_time` (14:00), `commercial_daily`.
- Proses: sebelum cut-off, sisa tampil di Commercial view sebagai `jual_hari_ini` dengan harga lantai; penjualan spot = `sales_line` tanpa `po_ref`, `channel = 'spot'`. Saat cut-off, sisa yang belum terjual → `blast_event reason='cutoff'`, `rp_downgrade`.
- Output: penjualan spot, `blast_event`.
- Kontrol: C31 (blast tanpa lot tujuan), C39 (SKU jual hari ini tanpa order).
- Pemilik / waktu: Commercial lead (spot), PPIC (cut-off).
- Perubahan vs kode: kolom `sales_line.channel` ('po' / 'spot'); tombol Cut-off tetap.

**Golden M3 (baru): fixture `fixtures/plan-2026-08-24`.** Dibangun dari `week-2026-08-24` (order, stok awal, item map) + seed yield placeholder + STD 2,0 kg. Nilai acuan sementara (Lampiran B.3): ekor 9.179 (karkas binding), kg LB 18.358, kekurangan by-product seperti di P3.4. Golden final dikunci setelah PPIC mengisi yield dan weight class sebenarnya; sampai saat itu tes memakai nilai sementara dengan label `placeholder: true`.

### 3.2 M4 — Outlook bulanan dan versi forecast (P1–P14)

**P1 · Actual harian dari jurnal (K11)**
- Input: `gl_line` (tanggal posting, akun, debit/kredit, voucher), `coa_map.pl_line`, DO terkirim belum difaktur (`sales_line` Aktual tanpa faktur).
- Proses: revenue harian per segmen (LB main, LB by-product, Trading) = Σ (kredit − debit) akun revenue; COGS harian = Σ akun COGS termasuk ekspedisi dan blasting; opex per baris. DO belum difaktur = kg × harga PO, basis `do_unbilled`, dibalik saat faktur terbit.
- Output: `pl_daily` (date, segment, pl_line, actual, basis ∈ {journal, do_unbilled}, anomaly, upload_id).
- Kontrol: C49 (baru): Σ `pl_daily` 1 s.d. cut-off = P&L MTD halaman Laba Rugi (±Rp 1). Agustus 1–26: revenue 6.385,9 jt, COGS 6.038,5 jt, GP 347,4 jt (fixture `month-2026-08`; `O_PnL` G9/G15, `docs/v3/F4b-design.md`).
- Pemilik / waktu: Inventory Accounting + Finance, upload harian 16.00; cut-off maju hanya bila upload hari itu lolos validasi.
- Contoh: revenue jurnal 24 Agu 226,7 jt, 25 Agu 0, 26 Agu 362,3 jt (`gl_lines.json`); revenue DO hari yang sama 221,8 / 0 / 349,4 jt (`sales_lines.json`). Selisih 17,8 jt untuk tiga hari ini adalah bagian bridge revenue jurnal − revenue DO (§3.4).

**P2 · PO Confirmed per tanggal kirim**
- Input: PO terbuka (P3.1) dengan tanggal kirim dalam sisa bulan.
- Proses: revenue per hari = Σ outstanding × harga PO per segmen; Tentative dan Forecast tidak masuk forecast bulanan (Q20 hanya untuk planning).
- Output: `pl_daily` basis `po`.
- Kontrol: PO lewat tanggal tidak dihitung (C7/C28); harga kosong → ditolak.
- Contoh: 27 Agu 457,8 jt, 28 Agu 232,1 jt, 29 Agu 378,0 jt; total 1.067,8 jt, 40.437 kg (`open-questions.md` §E.4, direproduksi ±0,1 jt).

**P3 · Run-rate hari kerja tanpa PO (K3)**
- Input: `pl_daily` basis `journal` 7 hari kalender terakhir sebelum cut-off; kalender hari kerja; faktor Minggu/libur.
- Proses: `runrate = rata-rata revenue hari kerja dalam jendela, tanpa hari anomali` (revenue 0 pada hari kerja, atau > 3σ dari rata-rata jendela). Faktor Minggu = pola actual (Agustus: 0). Dipakai hanya untuk hari kerja setelah cut-off yang tidak punya PO.
- Output: `pl_daily` basis `runrate`, daftar hari yang dibuang.
- Kontrol: porsi run-rate terhadap total forecast selalu tampil.
- Contoh: jendela 20–26 Agu, revenue hari kerja 301,4 / 579,3 / 82,3 / 226,7 / **0** / 362,3 jt (`gl_lines.json`); 25 Agu dibuang → run-rate 31 Agu = **310,4 jt**. Varian untuk uji: dengan 25 Agu 258,7 jt; 20 hari kerja tanpa anomali 319,3 jt (`open-questions.md` §E.4).
- Perubahan vs kode: `monthly.ts` jendela 20 hari → parameter `runrate_window_days` 7; sebelumnya 25 Agu sudah dibuang (3σ/nol) tapi jendela berbeda.

**P4 · Budget per bulan**
- Input: budget tahunan disetujui, per bulan × segmen × metrik (kg, revenue, GP, opex), opsional per minggu dan per grup SKU.
- Proses: upload sekali setahun; revisi = versi budget baru; budget harian = budget bulan ÷ hari kerja.
- Output: tabel `budget`.
- Kontrol: Σ 12 bulan = budget tahunan; bulan berjalan terkunci; kosong → kartu "budget belum diisi", tidak ada angka pengganti.
- Pemilik: Finance. Agustus–Desember 2026 kosong sampai budget diisi.

**P5 · Actual sampai cut-off** — hari ≤ cut-off memakai actual dan terkunci; tidak ada hari yang berisi actual dan forecast sekaligus. Output: actual MTD per segmen × pl_line.

**P6 · Forecast sisa bulan**
- Revenue per hari: PO bila ada (P2), run-rate bila tidak (P3).
- GP (K5, basis P&L):
  - hari ber-PO: `kg × (harga − MA per SKU pada hari itu)` untuk porsi yang tertutup stok bebas; kekurangannya dinilai pada **cost rencana** M1/M3 (`lb_price_today × kg LB per kg SKU via yield + ekspedisi + maklon/overhead` atau `replacement_buy_price` untuk trading); dikurangi COGS lain (ekspedisi, blasting) dari driver M5. Bila cost rencana tidak tersedia: status `missing`, V1 tidak bisa dikunci.
  - hari run-rate: `revenue × margin acuan` (default margin MTD; setelah M1 hidup: margin dari costing per SKU).
- Di bawah GP: opex mengikuti driver M5 (§3.3), bukan run-rate mingguan.
- Output: `pl_daily` forecast per hari × segmen × pl_line dengan basis.
- Contoh (nilai acuan, Lampiran B.2): forecast revenue 27–31 Agu = 1.067,8 + 310,4 = 1.378,2 jt; GP hari ber-PO −68,0 jt (GP produk −52,5 jt dikurangi ekspedisi 3,6 jt dan blasting 11,8 jt, artifact Mingguan); GP 31 Agu 310,4 × 5,4% = 16,8 jt; GP forecast ≈ −51,2 jt. Angka ini acuan untuk review, bukan golden (K4).

**P7 · Outlook dan rentang**
```
outlook = actual MTD + forecast sisa bulan
rentang = actual MTD + forecast × (1 ± toleransi)       toleransi default 10%, hanya pada porsi forecast
```
Dihitung untuk revenue, GP, NIBT, per segmen dan total. Contoh acuan Agustus: revenue 6.385,9 + 1.378,2 = 7.764,1 jt (rentang 7.626,3–7.902,0); GP 347,4 − 51,2 ≈ 296,2 jt (3,8%). Outlook bulan lalu yang sudah tutup = actual final, tanpa forecast tersisa.

**P8 · Uji run-rate** — `deviasi = forecast hari kerja ÷ rata-rata actual 7 hari − 1`, per segmen; faktor Minggu diuji terhadap pola actual. Di luar toleransi → alasan wajib di register; tanpa alasan V1 tidak bisa dikunci.

**P9 · Vs budget** — `selisih = outlook − budget` (Rp dan %); `butuh per hari = (budget − actual MTD) ÷ hari kerja tersisa`; dipecah volume / harga / margin bila budget punya kg. Kartu "vs Budget" dan garis budget kumulatif.

**P10 · Register asumsi** — satu baris per asumsi: versi, nama, nilai, dasar/sumber, pemilik, tanggal disepakati, catatan deviasi. Pemilik: Sales (PO, volume), Commercial lead (harga), Finance (margin, akrual, budget), Group Project Finance (toleransi, run-rate). Asumsi tanpa pemilik/tanggal → "belum disepakati", versi tidak bisa dikunci. Untuk Agustus, baris "25 Agu revenue 0" berstatus belum disepakati (K12).

**P11 · Kunci V1 (K9)** — snapshot outlook harian per segmen, semua asumsi, cut-off, siapa dan kapan; SHA-256; satu V1 per bulan; hanya role yang ditunjuk; database menolak modifikasi versi terkunci.

**P12 · V2 dan bridge**
```
Δ actual  = Σ (actual − forecast V1)      untuk hari yang berpindah forecast → actual
Δ volume  = Σ (kg V2 − kg V1) × harga V1   hari yang masih forecast
Δ harga   = Σ (harga V2 − harga V1) × kg V2
Δ cost    = Σ (cost V2 − cost V1) × kg V2  (GP dan NIBT)
Δ event   = PO tambahan, libur, stop line, asumsi berubah
Σ Δ       = outlook V2 − outlook V1          (C32, residual ≤ Rp 1 untuk revenue, GP, NIBT)
```
Bridge ditampilkan sebagai **waterfall**.

**P13 · Akurasi** — terhadap FINAL (actual final + penyesuaian tutup buku), dihitung sebelum dan sesudah penyesuaian: abs error, bias, MAPE untuk revenue (N/A bila actual 0); abs error dan bias untuk GP dan NIBT. Dipisah hari ber-PO vs run-rate; selisih hari ber-PO dipecah kg kirim vs harga. Contoh: V1 Agustus (artifact) 7.712,4 jt vs final 8.361,8 jt (+649,4 jt, +8,4%), porsi forecast +49%; penyebab utamanya penyesuaian tutup buku (revenue belum difaktur, Inv 311 DI-05, revaluasi COGS unbilled DI-01). Angka ini yang membuat K11 wajib.

**P14 · Roll-forward** — setiap upload jurnal harian yang lolos, cut-off maju satu hari; P6–P9 dihitung ulang; V1/V2 tetap. Hari pertama bulan berikutnya: bulan lalu ditutup menjadi FINAL setelah jurnal penyesuaian; bulan baru mulai dengan cut-off hari pertama. Kalibrasi: run-rate dan margin default bulan berikutnya ditulis ke register dengan `source = 'kalibrasi'`.

### 3.3 M5 — Biaya dengan driver (template 8.3, K6)

Setiap `pl_line` biaya di `coa_map` punya tepat satu `driver_type` ∈ {tetap, variabel, run-rate, event}; driver diganti hanya lewat master dengan tanggal berlaku (C33).

**Biaya tetap — input Finance (`fixed_cost_input`, satu baris per COA per periode):**

| Field | Isi |
|---|---|
| COA | hanya COA berdriver Tetap |
| Nominal per bulan | Rp, sebelum pajak |
| Berlaku dari / sampai | bulan mulai dan akhir (kontrak sewa, pinjaman, jadwal penyusutan) |
| Basis bagi | hari kalender (default) atau hari kerja |
| Jadwal posting | tanggal biasa dibukukan (gaji 25, sewa 1, bunga akhir bulan) |
| Dasar | kontrak, payroll, jadwal penyusutan, perjanjian pinjaman |
| Pemilik | HR (gaji), GA (sewa), Finance (bunga, penyusutan) |
| Versi, catatan | perubahan nominal dan alasannya |

```
biaya harian normal    = nominal bulan ÷ hari (kalender atau kerja) bulan itu
outlook bulan          = actual MTD + max(0, nominal − actual MTD)        (tidak pernah dobel)
forecast per hari sisa = max(0, nominal − actual MTD) ÷ sisa hari
actual > nominal       → outlook = actual, peringatan "melebihi input" di register (C34)
```

Biaya harian normal dipakai di P&L harian, mingguan (v4) dan bulanan, sehingga tiap minggu menanggung bagian yang wajar. Ini menyelesaikan masalah lama P&L mingguan: gaji, sewa, bunga MTD = 0 padahal run-rate mingguan menghitungnya, dan run-rate gaji 29,8 jt vs FS 85,6 jt (D9).

**Seed dari FS Sep 2026** (nilai diisi Finance; seed hanya baris dengan nominal kosong dan deskripsi): gaji (Agu 85.565.549, Sep 82.677.332; PL K23/L23), depresiasi 10.393.461 per bulan (PL baris 34; September 0 → D7), sewa RPA Rawa Terate 94.482.500 per bulan mulai 2026-11-01 dari prepaid 1.133.790.000 (`PREPAID RENT` D11, BE11; grace 2 bulan), sewa ABF NMG 62.450.000 (`DI - Note` D46; intercompany), bunga (Agu 31,9 jt, Sep 54,0 jt; PL K43/L43), deposit DS Solutions (prepaid other).

**Klasifikasi driver:**

| Baris P&L | Driver | Dasar forecast |
|---|---|---|
| Salaries and allowance; Rent; Professional fee (retainer); Interest; Depreciation & amortisation | Tetap | input 8.3 |
| Other COGS – Expedition; Delivery; Packaging | Variabel | Rp/kg kirim × kg forecast (M3) |
| COGS – Blasting | Variabel | Rp/kg × kg frozen terencana (P3.5) |
| Commission | Variabel | % revenue |
| Storage | Variabel | Rp/kg-hari stok di cold storage (ledger lot) |
| Office transportation; Office supplies & utilities | Run-rate | rata-rata harian actual tanpa hari anomali |
| Maintenance; Other operating | Run-rate + event | biaya satu kali dicatat `cost_event`, tidak dirata-rata |
| Tax expenses | perlu dicek | PPh 22 pembelian LB → variabel % nilai LB; selain itu run-rate |

Tarif variabel = actual 4 minggu ÷ kg basis yang sama. Validasi upload: COA berdriver Tetap, nominal > 0, periode tidak tumpang tindih, total dibandingkan budget bulan. Baris tetap tanpa input bulan berjalan memakai nominal bulan lalu dengan label "belum diperbarui" (C43, baru).

Perubahan vs kode: `fixed_cost_schedule` (ada) ditambah kolom `day_basis`, `posting_day`, `basis_doc`, `owner`, `version`; tabel `cost_event` baru; `drivers.ts` membaca basis; P&L mingguan v4 (§3.4) membaca `dailyFixed`.

### 3.4 Outlook mingguan (pengganti Keputusan RPA di view manajemen, K15)

- Input: `pl_daily` untuk 7 hari minggu terpilih (actual basis `journal`+`do_unbilled` sampai kemarin; forecast basis `po`/`runrate`/`fixed`/`variable` untuk sisa minggu) — **aturan yang sama dengan bulanan**, dihitung sekali oleh engine (K17).
- Output per minggu: revenue, COGS, GP P&L, opex, NIBT; porsi ber-PO; Δ vs minggu lalu (dari snapshot rilis minggu lalu); per segmen.
- GP produk (blok 1 v1) tetap dihitung dan tampil per segmen; bridge GP produk → GP P&L per minggu:
  ```
  GP produk (DO/order − HPP per key)
  + revenue jurnal − revenue DO        (timing faktur, by-product, lain)
  − ekspedisi − blasting − COGS lain   (akun COGS yang tidak ada di HPP per key)
  ± penyesuaian / mapping
  = GP P&L
  ```
- Contoh minggu 24–30 Agu: GP produk −47,6 jt (blok 1 TOTAL KGR); GP P&L −67,5 jt (laporan laba rugi mingguan; artifact Mingguan); revenue DO 24–26 Agu 571,1 jt vs jurnal 589,0 jt (Lampiran B.1).
- Catatan: di minggu contoh forecast mingguan = order 1.067,8 jt (tidak ada hari kerja tanpa PO di 27–29 Agu); 30 Agu Minggu = 0. Jadi angka revenue proyeksi tetap 1.639,0 jt; yang berubah hanya basis GP headline.
- Perubahan vs kode: fungsi engine baru `weekOutlook(plDailyRows, week)` (tanpa mengubah `computeWeek`); `OutlookBody` v4 tidak lagi merender blok 2 dan blok 5 di view manajemen.

### 3.5 M1 — Costing per batch → SKU

Tetap seperti PRD v3 §4.2 (relative sales value, NRV, cost pool PI + akrual tie-out GL, C21–C24, upload `costing_wp` hanya kolom nama SKU / kg / %), ditambah:
- **Mode RPA sendiri mulai 1 Nov 2026**: cost pool batch = LB + tenaga kerja langsung + overhead pabrik; `overhead_rate` per kg LB atau per ekor dari budget overhead ÷ basis kg; `idle_cost = (basis_kg − actual_kg_lb) × rate` sebagai biaya periode (`pl_line = 'Biaya kapasitas idle'`), bukan COGS/kg. Perbaikan mesin 38,8 jt dan boots 9,3 jt (DI-02) adalah contoh overhead.
- **Batch tanpa output ditolak** (C48): biaya kirim LB 12 jt untuk AGRO28–30 (DI-03; kg 9.822 / 9.061,9 / 8.960,2) adalah kasus nyata.
- **Tanggal biaya vs tanggal faktur** untuk revenue akrual: COGS unbilled dinilai MA pada tanggal revenue dan direvaluasi saat faktur terbit (DI-01, 48,4 jt); ledger menyimpan keduanya.
- Golden tetap: `fixtures/costing-2026-09`, Pot_ISA dan Pot_AGRO ±Rp 1 per SKU.

### 3.6 M2 — Lot ledger

Tetap seperti PRD v3 §4.3 (MA per key untuk buku, SI per lot untuk manajemen, FIFO assumed untuk DO tanpa lot, blast sebagai out/in berpasangan, opening stock backfill assumed, C25–C27), ditambah:
- Rekon dipisah: (a) kg per key vs kartu stok, (b) MA vs HPP aktual, (c) nilai persediaan vs GL/neraca, (d) SI per lot, (e) saldo awal dengan penyesuaian beralasan. Selisih tidak ditutup plug tanpa voucher dan persetujuan Finance (D3: opening 3.955,0 jt vs neraca 3.780,6 jt, gap 174,4 jt).
- Backfill tanggal lampau wajib membangun ulang semua saldo turunan sesudahnya, atau mart berstatus `STALE` sampai selesai.
- Cutover sumber stok v1 → ledger hanya setelah 4 minggu paralel C26/C27 hijau dan persetujuan pemilik produk (Fase 8 PLAN v3, tidak dikerjakan di irisan mana pun di Bab 10).
- Acceptance M2 lama (MA = `hpp_actual` ±Rp 1/kg pada ≥ 95% baris) saat ini 88,2% (`ledger.test.ts` todo); tetap wajib lulus atau diberi pengecualian tertulis sebelum C27 dipakai sebagai syarat rilis.

### 3.7 M6 — Kas, CCC, solvabilitas

Tetap seperti PRD v3 §4.7 (template kas harian, 13 minggu, 12 bulan, CCC, C35–C37), ditambah:
- Arus operasi dan pendanaan afiliasi tampil terpisah; skenario "tanpa fasilitas afiliasi" ditampilkan dengan status asumsi. Contoh minggu 24–30 Agu (artifact Mingguan, sumber arus kas v1): saldo terendah Jumat 28 Agu 289,7 jt termasuk pinjaman afiliasi 1.200,0 jt; tanpa pinjaman ≈ −910 jt; bayar jasa proyeksi 1.229,0 jt (lima kali minggu lalu).
- Blok 5 v1 pensiun untuk manajemen (K18).
- **Solvabilitas** (`solvency_monthly`): ekuitas, modal disetor, utang dan piutang afiliasi, bunga, kas, `months_to_negative_equity = ekuitas ÷ (−NIBT outlook)` hanya bila NIBT < 0. September: 702,6 ÷ 910,1 = 0,8 bulan.
- Kas 12 bulan tanpa basis outlook bulanan → status "tidak tersedia", bukan nol.

### 3.8 M7 — Commercial

Tetap seperti PRD v3 §4.8 (harga lantai = MA + markup, urgensi Q18, ranking, approval diskon Q19, scorecard, C38–C40, sales melihat cost/kg MA tapi tidak cost pool / batch / SI per lot), ditambah jalur spot (P3.9): SKU `jual_hari_ini` dapat dijual tanpa PO sebelum cut-off; penjualan spot masuk `sales_line.channel = 'spot'` dan ikut scorecard (kg spot, kg ke frozen tanpa terjual).

### 3.9 Rilis dan versi

- Rilis mingguan tetap: snapshot JSON + PDF, layout PDF tidak berubah (parity).
- Rilis bulanan: V1 / V2 / FINAL (P11–P14), PDF A4 landscape 2 halaman (ringkasan + bridge).
- Setiap versi menyimpan: cut-off, zona waktu, upload_id sumber, versi engine dan aturan, parameter, daftar hari anomali, porsi PO, driver, actor, approver, status kontrol, SHA snapshot, timestamp.
- Rilis ditolak di server (Bab 7) bila kontrol wajib `GAGAL` / `BELUM DIISI` / `STALE`.

---
## 4. Model data — delta terhadap migrasi yang ada

Konvensi sama dengan PRD v3 §4: money `numeric(18,2)`, Rp/kg `numeric(18,4)`, kg `numeric(12,2)`, soft delete, provenance (`source, document_ref, upload_id, created_*, updated_*`), audit trigger, RLS. Hanya perubahan yang ditulis; tabel M1–M7 yang sudah ada di `20261016000100`–`20261016001300` tetap.

### 4.1 Kolom baru pada tabel yang ada

| Tabel | Kolom baru | Keterangan |
|---|---|---|
| `sku_key` | `product_class text check in ('main','by_product') default 'main'` | K1; seed: Kepala, Ceker, Usus, HJA, Lemak = `by_product` |
| `sales_line` | `channel text check in ('po','spot') default 'po'`, `cancelled_kg numeric(12,2) default 0` | K8, K7; `fulfilled_kg` menjadi kolom turunan (= Σ `delivery.kg`), diisi trigger |
| `forecast_line` | `source text check in ('stat','sales') default 'sales'`, `scenario text` | K2 |
| `fixed_cost_schedule` | `day_basis text check in ('calendar','working') default 'calendar'`, `posting_day integer`, `basis_doc text`, `owner text`, `version integer default 1` | K6 (template 8.3) |
| `coa_map` | `driver_type` ditambah nilai `'event'`; `segment text` (LB main / LB by-product / Trading) | §3.3, P1 |
| `pl_daily` | `segment text`, `basis` ditambah `'event'`; primary key menjadi `(date, segment, pl_line, basis)` — **tabel data mart, dibangun ulang, bukan migrasi destruktif**: buat `pl_daily_v4` dan arahkan pembaca ke sana, `pl_daily` lama dibiarkan | P1, P6 |
| `parameter` | `runrate_window_days integer default 7`, `v1_lock_week integer default 3`, `spot_enabled boolean default false` | K3, K9, K8 |
| `month_outlook_version` | `rule_version text`, `anomaly_days jsonb`, `po_share numeric(8,6)`, `approved_by` | §3.9 |

### 4.2 Tabel baru

```
delivery             id, sales_line_id, date, kg, document_ref (DO/surat jalan), received_by, created_*   (K7)
                     trigger: Σ kg per sales_line ≤ sales_line.kg − cancelled_kg; sales_line.fulfilled_kg = Σ kg
cost_event           id, date, account, pl_line, amount, reason, owner, document_ref, created_*            (§3.3)
budget               id, version, month, segment, metric ('kg','revenue','gp','opex','nibt'), value,
                     approved_by, approved_at, locked boolean                                                (P4)
demand_shortfall     week_start, key, net_kg, output_kg_at_plan, shortfall_kg, suggested_action
                     ('buy_trading','reduce_order'), primary key(week_start, key)    ← data mart (P3.4, C41)
plan_variance_daily  date, key, planned_kg, actual_kg, variance_kg, planned_heads, actual_heads,
                     primary key(date, key)                                          ← data mart (P3.7)
assumption_register  id, month_outlook_id, version, code, name, value_num, value_text, basis, owner,
                     agreed_at, deviation_note, status ('proposed','agreed','superseded')   (P10; menggantikan
                     outlook_assumption untuk versi baru; outlook_assumption dibiarkan)
forecast_accuracy_daily month_outlook_id, version, date, segment, forecast, actual, diff, day_kind
                     ('po','runrate'), diff_kg, diff_price, primary key(version, date, segment)   (P13)
```

### 4.3 Status data

Setiap mart dan tabel sumber punya `status` ∈ {`missing`, `draft`, `validated`, `reconciliation_pending`, `reconciliation_failed`, `reviewed`, `released`, `superseded`, `final`} dan `built_at`, `input_fingerprint`, `stale_from`. Pemetaan status ke tabel lama (`week.status`, `batch.costing_status`, `month_outlook.status`) ditulis eksplisit di migrasi; arti status lama tidak berubah.

### 4.4 Upload

Tetap PRD v3 §5 (`costing_wp`, `cost_pool_pi`, `po_lines`, `forecast_sales`, `stock_card`, `cash_daily`, `yield_matrix`, `lb_supply`) ditambah `fixed_cost` (template 8.3, xlsx), `budget` (xlsx per bulan × segmen × metrik), `delivery` (CSV: `no_po, kode_item, tgl, kg, no_dokumen`). Semua lewat wizard stage → preview → commit, idempoten (`line_key`), issue per baris dengan pemilik; preview menampilkan efek hilir (mart mana yang akan dibangun ulang) sebelum commit.

---

## 5. Desain

### 5.1 Prinsip copy dan angka

Berlaku untuk semua halaman, diperiksa saat review PR (Bab 9).

1. **Judul menyebut temuan, bukan topik.** "COGS proyeksi 1.724,3 jt, naik 147,8 jt dari minggu lalu", bukan "Harga pokok penjualan minggu ini". Judul tile boleh label pendek (kartu, slicer); judul seksi dan headline halaman wajib temuan. Templat headline otomatis ada di §6.1.
2. **Satu satuan.** Rp jt satu desimal di seluruh view manajemen, termasuk sumbu chart dan headline (K16). Tidak ada "M", tidak ada Rupiah penuh kecuali drilldown dan ekspor. Tanda minus "−".
3. **Satu makna per warna.** Merah (`--bad`) hanya untuk nilai negatif dan delta yang memburuk. Hijau (`--good`) hanya untuk delta yang membaik. Tidak ada latar merah/kuning. Status ditulis sebagai teks (`Kurang`, `Jual`, `Di atas batas umur`, `belum diisi`), tanpa ikon dan tanpa badge berwarna.
4. **Satu istilah per konsep**, konsisten di semua halaman dan PDF: Revenue, COGS, GP produk, GP P&L, NIBT, outlook, forecast, run-rate, stok bebas, lot. Tidak bergantian dengan "Penjualan", "HPP", "Laba kotor".
5. **Tanpa ornamen**: tidak ada panah "→" di teks link (link ditulis sebagai kata kerja: "detail per SKU"), tidak ada em-dash sebagai pemisah judul, tidak ada paragraf metodologi di atas angka. Cara hitung ada di drawer, catatan di bawah tile.
6. **Setiap angka punya label basis dan periode** di tooltip/drawer (prinsip 5 Bab 2). Angka `missing` ditampilkan sebagai teks "belum diisi" / "tidak tersedia", tidak pernah 0.
7. Bahasa UI Bahasa Indonesia; istilah akuntansi dan pabrik mengikuti FS dan WP KGR.

### 5.2 Token

Diturunkan dari `samb-bi/samb_bi/web/styles.css` (grammar yang sama dengan alat BI internal SAMB), dengan penyesuaian kontras.

```css
:root {
  --bg: #f4f5f7;  --surface: #ffffff;  --surface-2: #f6f7f9;
  --text: #1d2330;  --muted: #6b7280;   /* 4,83:1 di atas putih — lulus 4,5:1 */
  --line: #e3e6eb;
  --accent: #0f6cbd;  --accent-soft: #e6f0fa;
  --good: #1a7f4b;  --bad: #c4314b;
  --chart-1: #0f6cbd;  --chart-2: #9fb8d8;  --chart-3: #6b7280;  /* seri 2 harus ≥ 3:1 vs putih */
  --radius: 10px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px;
  --font: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 14px; --fs-lg: 20px; --fs-value: 30px;   /* hanya lima ukuran */
}
```

Aturan: tidak ada hex di komponen; tidak ada `fontSize` inline; semua jarak dari `--space-*`; satu `--radius`; shadow hanya untuk drawer/dialog. Kontras teks ≥ 4,5:1, elemen grafis ≥ 3:1 (bar seri kedua `#9fb8d8` diganti bila < 3:1 saat diukur).

### 5.3 Komponen

| Komponen | Isi | Keadaan |
|---|---|---|
| `TileGrid` | grid 12 kolom, baris 76px, gap 12px; tile punya `x, y, w, h`; di < 900px menjadi 2 kolom, kartu 1 kolom | — |
| `Slicer` | periode (minggu dari daftar rilis; bulan), single-select, tombol; `required` | loading (disabled), kosong ("belum ada minggu") |
| `ModeToggle` | dua pilihan (Aktual s.d. kemarin / Proyeksi minggu; MTD / outlook bulan) | — |
| `Card` | judul kecil, nilai `--fs-value` tabular, sampai 3 baris pembanding (`label · nilai · delta` dengan warna hanya pada delta), tombol "cara hitung" | loading, `missing` ("belum diisi"), error |
| `Chart` | ECharts (column, line, combo, waterfall, stacked bar); periode terpilih disorot; klik bar memfilter tile yang `linked`; label nilai tampil bila titik ≤ 12; tooltip membawa basis | loading, kosong ("tidak ada data untuk periode ini"), error |
| `Table` | header sticky, kolom numerik rata kanan tabular, baris total, sortir, klik baris memfilter tile `linked`; kolom keputusan `600`, kolom pendukung `--muted` | loading, kosong, error, terpotong ("menampilkan 50 dari N, buka detail") |
| `Note` | teks temuan di bawah tile (1–3 kalimat) | — |
| `StatusText` | teks status tanpa warna latar | — |
| `CaraHitungDrawer` | aturan (nama fungsi engine + rumus dalam kata), baris sumber (tabel, upload_id, tanggal), link ke halaman sumber; dibuka dari tombol di tile, Enter/Space, Esc menutup | loading, error |
| `ReleaseLine` | "Rilis 27 Agu 2026 · 18/20 kontrol lulus · 2 belum diisi" (R12 MV v2 tetap) | — |
| `ActionBar` | tombol primer satu per halaman (Unduh PDF / Simpan rencana / Alokasikan) + sekunder | disabled dengan alasan |
| `Stepper` | langkah 1–4 (PPIC) dengan status per langkah | locked ("selesaikan langkah 2 dulu") |

Keyboard: semua kontrol dapat di-tab, fokus terlihat (outline `--accent` 2px), drawer mengembalikan fokus. Target sentuh ≥ 44px pada mobile.

### 5.4 Arsitektur informasi dan workspace per peran

Navigasi satu baris, maksimum 7 item per peran; item yang tidak berizin atau flag-nya mati tidak dirender.

| Peran | Workspace (urutan nav) | Halaman awal |
|---|---|---|
| management | Minggu ini · Outlook bulan · Kas & solvabilitas · Stok · Komersial · Rilis | Minggu ini |
| ppic | Rencana (langkah 1–4) · Alokasi hari ini · Stok · Batch · Upload | Rencana |
| sales / commercial_lead | Komersial · Pesanan (PO, pengiriman) · Approval · Scorecard · Upload | Komersial |
| purchasing | Supply LB · Harga acuan · Upload | Supply LB |
| inventory_accounting | Stok per SKU · Rekon kartu stok · Upload · Kontrol | Stok per SKU |
| cost_accounting | Costing (WP, cost pool, alokasi) · Kontrol costing · Upload | Costing |
| finance | Outlook bulan · Biaya tetap & driver · Tutup buku · Kas · Rilis · Kontrol · Upload | Outlook bulan |
| admin | semua di atas + Admin (minggu, master, pengguna, modul, audit) | Minggu ini |

Preparer dapat membuka pratinjau view manajemen (toggle MV v2 R1 tetap). Pemilih periode ada di topbar untuk semua workspace; halaman harian (Alokasi) mengambil tanggal dari periode terpilih atau menyatakan "hari ini", tidak diam-diam melompat ke tanggal lain.

Mobile (< 900px): baca dan telusur; grid 2 kolom; tabel scroll di dalam tile dengan kolom pertama sticky; hak tulis mengikuti role/server, bukan ukuran layar. PDF: rilis mingguan layout lama (parity); rilis bulanan A4 landscape 2 halaman; PDF mengambil snapshot yang sama dengan layar.

### 5.5 Mockup sebagai spec

Berkas di `reference/design/` (dibuat di irisan 1, sebelum kode halaman):

| Berkas | Isi |
|---|---|
| `minggu-ini.html` | §6.1 dengan angka fixture `week-2026-08-24` |
| `outlook-bulan.html` | §6.2 dengan angka fixture `month-2026-08` (K3) |
| `kas-solvabilitas.html` | §6.3 dengan angka FS Sep 2026 |
| `ppic-rencana.html` | §6.4 dengan dry run Lampiran B.3 |
| `samb-bi-*.png` | screenshot samb-bi halaman Kinerja, Outlook, Ringkasan sebagai acuan grammar |
| `tokens.css` | §5.2 |

Mockup adalah HTML biasa (bukan bundle), dapat dibuka tanpa server, dan dicek oleh pemeriksa screenshot yang sama dengan halaman produksi (§9.4). Mockup lama `KGR Management View v2` (Claude Design) disimpan di `reference/design/archive/` sebagai sumber isi dan temuan, bukan sebagai target visual.

---

## 6. Spesifikasi halaman

Format tile: `id · x,y,w,h · isi · sumber angka · interaksi`. Koordinat dalam grid 12 kolom (§5.3). Semua angka dari mart (K17).

### 6.1 Manajemen · Minggu ini

Audiens: management (baca saja). Tujuan: dalam 5 detik tahu GP P&L minggu ini dan penyebabnya, stok yang berisiko, kas terendah, dan posisi solvabilitas.

| Tile | x,y,w,h | Isi | Sumber | Interaksi |
|---|---|---|---|---|
| `slicer-minggu` | 0,0,6,1 | minggu dari daftar rilis (terbaru default) | `week` | memfilter semua tile |
| `mode` | 6,0,3,1 | Aktual s.d. kemarin / Proyeksi minggu | — | mengubah kolom tabel dan seri chart |
| `rilis` | 9,0,3,1 | `ReleaseLine` + Unduh PDF | `release` | — |
| `headline` | 0,1,12,1 | satu kalimat temuan (templat di bawah) | `weekOutlook`, blok 1, `sku_balance_daily` | — |
| `c-outlook` | 0,2,3,2 | **Outlook minggu**: revenue proyeksi; GP P&L proyeksi (%); porsi ber-PO; Δ GP vs minggu lalu | `weekOutlook` (§3.4), snapshot minggu lalu | cara hitung |
| `c-stok` | 3,2,2,2 | **Stok di atas batas umur**: Rp jt; kg · jumlah SKU | `sku_balance_daily.over_age_kg × cost_per_kg_ma` | klik → §6.5 stok |
| `c-kas` | 5,2,2,2 | **Kas terendah minggu ini**: Rp jt, hari; baris "tanpa pinjaman afiliasi: Rp jt" | `cash_position_daily` / arus kas v1 bila M6 off | klik → §6.3 |
| `c-bulan` | 7,2,2,2 | **Outlook bulan**: revenue, GP P&L; "vs budget: belum diisi" bila kosong | `month_outlook` (P7), `budget` | klik → §6.2 |
| `c-solvabilitas` | 9,2,3,2 | **Solvabilitas**: ekuitas (% modal disetor); utang afiliasi; bulan sampai ekuitas negatif | `solvency_monthly` (§3.7) | klik → §6.3 |
| `ch-harian` | 0,4,7,4 | **Revenue dan GP P&L per hari Sen–Min**: kolom revenue (aktual gelap, order/run-rate muda), garis GP; label nilai; hari terpilih di slicer disorot | `pl_daily` 7 hari | klik hari → memfilter `t-segmen` |
| `ch-bridge` | 7,4,5,4 | **Waterfall GP produk → GP P&L** (§3.4) | blok 1, `pl_daily` | cara hitung per batang |
| `t-segmen` | 0,8,7,4 | tabel RPA / Trading / Total: kg proyeksi, revenue proyeksi, GP aktual, GP order, GP produk proyeksi, GP %, GP/kg lalu, Δ GP/kg (9 kolom; R7 dicabut); baris pemicu di bawah RPA: "harga LB rata-rata 23.903 vs breakeven 21.539 Rp/kg" | blok 1, blok 6 | klik segmen → memfilter `ch-cogs`, `t-stok` |
| `ch-cogs` | 7,8,5,4 | **COGS/kg vs revenue/kg per segmen** (bar berpasangan, label nilai) | `cogsBySegment` | — |
| `t-input` | 0,12,6,4 | **Input minggu ini** (wajib): live bird aktual/rencana (kg, harga, nilai), pembelian trading per SKU, ekspedisi, maklon/TKL/overhead; kolom catatan (di atas breakeven, di atas harga jual, stok lama) | `inputSummary`, `batch`, `receipt_line`, `cost_pool` | klik baris → cara hitung |
| `t-cogs` | 6,12,6,4 | **COGS dan mutasi persediaan** (wajib): baris P&L mingguan COGS (minggu lalu, aktual, sisa, proyeksi, Δ, basis); COGS/kg per grup SKU (M1); roll-forward kg dan Rp awal + masuk − keluar − blast ± penyesuaian = akhir, selisih vs neraca (M2) | `pl_daily`, `groupCostPerKg`, `rollForward` | — |
| `ch-stok-umur` | 0,16,6,4 | **Stok per umur per SKU** (stacked bar: 0–7, 8–30, > 30 hari; label nilai) + tabel 7 SKU teratas (kg, Rp, umur, order sisa, biaya/kg, harga acuan) | `sku_balance_daily`, `lot_balance_daily` | klik SKU → memfilter tabel |
| `kas` | 6,16,6,4 | **Kas harian aktual vs rencana** (kolom, label nilai, saldo awal) + tabel arus kas minggu lalu vs proyeksi (penerimaan pelanggan, bayar pemasok, bayar jasa, karyawan dan lain-lain, pinjaman afiliasi net, arus kas bersih) | `cash_position_daily`, arus kas v1 | klik → §6.3 |
| `t-trading` | 0,20,6,3 | **Spread trading per SKU** dengan order sisa minggu: harga jual, biaya stok rata-rata, selisih/kg, GP order; catatan SKU tanpa order yang sebaiknya dijual | blok 3 | — |
| `demand` | 6,20,3,3 | PO pasti / tentatif / forecast / berbobot / dari stok / kebutuhan potong / rencana potong (ekor); varian aktual vs rencana | `demand_weekly`, `plan_week`, `plan_variance_daily` | klik → §6.4 (baca saja) |
| `peringatan` | 9,20,3,3 | daftar teks "Peringatan: …" audiens manajemen (R10 tetap) + kontrol belum diisi | blok 7, kontrol | — |
| `catatan` | 0,23,12,1 | catatan bernomor (definisi GP, status stok, termin) | — | — |

Templat headline (dihitung engine, tiga slot, maksimal dua kalimat):

```
"GP P&L minggu ini diproyeksikan Rp {gp_pl} jt ({gp_pct}); {segmen_terburuk} menyumbang Rp {gp_segmen} jt.
 Stok di atas batas umur Rp {stok} jt{, kas Jumat turun ke Rp {kas} jt bila kas_terendah < 0,25 × rata-rata}."
```
Contoh minggu 24–30 Agu: "GP P&L minggu ini diproyeksikan Rp −67,5 jt (−4,1%); RPA menyumbang Rp −62,6 jt. Stok di atas batas umur Rp 2.782,2 jt, kas Jumat turun ke Rp 289,7 jt." *(persentase −4,1% = −67,5 ÷ 1.639,0; belum diverifikasi dari engine)*

Di atas fold 1366×768 tanpa scroll: baris 0–3 (slicer, headline, lima kartu) wajib terlihat; dicek pemeriksa §9.4.

Keadaan: minggu belum dirilis → `ReleaseLine` "belum dirilis", data tetap tampil dengan label "draft"; modul mati → tile yang bergantung padanya tidak dirender (bukan "tidak tersedia"), kecuali `t-input` dan `t-cogs` yang selalu ada (dari engine mingguan).

### 6.2 Manajemen · Outlook bulan

Mengikuti pola halaman Outlook samb-bi.

| Tile | x,y,w,h | Isi | Sumber |
|---|---|---|---|
| `slicer-bulan` | 0,0,6,1 | bulan; label versi aktif ("V1 dikunci 27 Agu 2026 · cut-off 26 Agu") | `month_outlook` |
| `rilis` | 9,0,3,1 | Unduh PDF (versi terpilih) | — |
| `headline` | 0,1,12,1 | temuan: "Revenue {bulan} diproyeksikan Rp … jt, GP P&L Rp … jt ({%}); sisa bulan {po_share} ber-PO" | P7 |
| `c-actual` | 0,2,2,2 | Actual s.d. cut-off: revenue; GP | P5 |
| `c-forecast` | 2,2,2,2 | Forecast sisa bulan: revenue; GP; porsi run-rate | P6 |
| `c-outlook` | 4,2,3,2 | Outlook: revenue (rentang); GP (%); NIBT | P7 |
| `c-po` | 7,2,2,2 | Sisa bulan ber-PO: % ; kg | P2 |
| `c-budget` | 9,2,3,2 | vs Budget: selisih revenue, GP; butuh per hari; atau "budget belum diisi" | P9 |
| `ch-harian` | 0,4,7,4 | revenue per hari: aktual, PO, run-rate (tiga tone), penanda cut-off, hari anomali ditandai teks di tooltip bukan warna merah | `pl_daily` |
| `t-sisa` | 7,4,5,4 | tabel hari sisa bulan: tanggal, dasar (PO / run-rate / tidak ada pengiriman), revenue, rincian segmen | `pl_daily` |
| `ch-kumulatif` | 0,8,8,4 | revenue kumulatif: aktual (garis), outlook (putus-putus), band ±10% pada porsi forecast, budget kumulatif bila ada; label titik MTD dan outlook | P7, P9 |
| `register` | 8,8,4,4 | register asumsi: asumsi, nilai, dasar, pemilik, disepakati; baris "belum disepakati" ditandai teks | P10 |
| `ch-bridge` | 0,12,7,4 | waterfall V1 → V2 (Δ actual, volume, harga, cost, event); "V2 belum ada" bila belum | P12 |
| `t-versi` | 7,12,5,4 | versi: V1/V2/FINAL, cut-off, revenue, GP, NIBT, dikunci (tanpa email), PDF/JSON | P11 |
| `akurasi` | 0,16,6,3 | akurasi bulan terakhir yang FINAL: MAPE/bias revenue, abs error GP dan NIBT, sebelum vs sesudah penyesuaian; hari PO vs run-rate | P13 |
| `solvabilitas` | 6,16,6,3 | sama dengan `c-solvabilitas` §6.1 diperluas: ekuitas, utang afiliasi, bunga, kas, bulan ke negatif | §3.7 |

Tidak ada form di halaman ini untuk management; Finance mengedit budget, cut-off, dan mengunci versi dari workspace Finance (§6.6) dengan `ActionBar` yang hanya dirender untuk role yang berhak.

### 6.3 Manajemen · Kas & solvabilitas

| Tile | x,y,w,h | Isi | Sumber |
|---|---|---|---|
| `headline` | 0,0,12,1 | temuan kas: posisi, terendah 13 minggu, tanpa fasilitas afiliasi | §3.7 |
| `c-saldo` / `c-terendah` / `c-afiliasi` / `c-ekuitas` / `c-bulan-negatif` | 0..12,1,w=2–3,h=2 | saldo per hari ini; terendah 13 minggu (tanggal); utang afiliasi dan bunga bulan ini; ekuitas (% modal); bulan sampai ekuitas negatif | `cash_position_daily`, `solvency_monthly` |
| `ch-13minggu` | 0,3,7,4 | saldo akhir per minggu 13 minggu, dua seri: dengan dan tanpa pendanaan afiliasi; label nilai | §3.7 |
| `t-rekening` | 7,3,5,4 | saldo per rekening, tanggal data, "hari kerja tanpa upload" | C36 |
| `ch-12bulan` | 0,7,6,4 | perubahan kas dan saldo akhir 12 bulan; "tidak tersedia" bila tanpa basis outlook | §3.7 |
| `ccc` | 6,7,6,4 | DIO/DSO/DPO/CCC dengan slider termin (simulasi), modal kerja terikat | PRD v3 §4.7 |
| `t-arus` | 0,11,12,4 | arus kas operasi vs pendanaan afiliasi per minggu, minggu lalu vs proyeksi | arus kas |

### 6.4 PPIC · Rencana (langkah 1–4 dalam satu halaman)

`Stepper` di atas: 1 Demand → 2 Rencana mingguan → 3 Rencana harian → 4 Alokasi (link ke §6.5). Setiap langkah adalah grup tile; langkah berikutnya terkunci sampai kontrol langkah sebelumnya LULUS atau PERIKSA dengan alasan.

| Langkah | Tile | Isi | Aksi |
|---|---|---|---|
| 1 | `t-demand` | per SKU: PO pasti / tentatif / forecast (sumber stat/sales), berbobot, stok layak, substitusi, net, unit, pola, kg/ekor, ekor, karkas-setara, binding; by-product dengan kolom **kurang** dan saran | pilih weight class; upload forecast |
| 1 | `ch-ekor` | ekor per produk utama (bar), binding disorot; by-product ditampilkan sebagai bar abu dengan teks "tidak menentukan ekor" | — |
| 2 | `t-rencana` | ekor, size mix, pola, output per key, surplus, frozen terencana, Rp downgrade, perlu approval; versi | Simpan rencana versi n; Minta approval |
| 2 | `ekonomi` | breakeven LB porsi fresh rencana vs harga LB hari ini; margin/kg LB; perkiraan margin potong rencana (blok 2 v1, aksi enum `NEGOSIASI ≤ …` / `POTONG …` ditampilkan dalam kapitalisasi kalimat) | — |
| 3 | `t-harian` | per tanggal: ekor, weight class, pola, supplier, kapasitas, LB supply, target kg per key; `unplaced`; baris tanpa kapasitas ditandai "belum diisi" | Salin ke batch rencana (hanya bila C42, C45, C46, C47 LULUS) |
| 3 | `t-varian` | aktual vs rencana per SKU per hari (P3.7) | — |
| 4 | link | ke Alokasi hari ini | — |

Kontrol langkah ditampilkan sebagai `StatusText` di tiap grup; `Simpan` dan `Salin` disabled dengan alasan bila kontrol gagal.

### 6.5 PPIC/Sales · Alokasi hari ini, Stok

Alokasi: PO kirim hari ini → lot layak → usulan FEFO → `Alokasikan hari ini` → DO → `Terkirim` (form kg, nomor dokumen; outstanding tersisa) → sisa fresh: daftar spot (link Komersial) → `Cut-off` (konfirmasi, hanya PPIC/admin setelah `cut_off_time`). Rekap stok bebas vs teralokasi per SKU (B_Alokasi_Stok). Stok: per SKU/grup hari ini (fresh/frozen/free/reserved), MA dan SI, umur, drill ke lot dan movement; rekon kartu stok (C26) dan nilai (C27) dengan selisih dipisah kg dan Rp.

### 6.6 Finance · Biaya tetap & driver, Tutup buku, Rilis

- **Biaya tetap & driver**: tabel template 8.3 (edit inline untuk role finance/admin), driver per akun dengan tanggal berlaku, `cost_event`, outlook pos tetap bulan ini (actual MTD, sisa, label "belum diperbarui"), C33/C34/C43.
- **Tutup buku**: penyesuaian DI-xx, posting ke FINAL, akurasi dihitung, kalibrasi ditulis ke register.
- **Rilis**: matriks kontrol (Bab 7) dengan tombol rilis yang disabled bila kontrol wajib gagal; riwayat versi.

### 6.7 Sales/Commercial · Komersial

Tetap PRD v3 §6 (`/komersial`, `/komersial/[key]`, approval, scorecard) dalam grammar §5.3: kartu (SKU jual hari ini, Rp risiko turun ke frozen, SKU dengan stok bebas), tabel ranking (stok bebas fresh/frozen, umur, MA, harga lantai, harga list, margin/kg list dan realisasi 7 hari, rugi simpan/hari, urgensi), jalur spot (K8), antrian approval. Harga lantai atau MA kosong = "belum diisi", bukan 0; order di bawah lantai ditolak tanpa approval (C38) di server.

### 6.8 Admin

Pengguna dan assignment, master (item, SKU, COA, weight class, yield, kapasitas), flag per modul, antrian rebuild (lihat, picu; tidak menerima baris hasil hitung), audit tersaring.

---
## 7. Kontrol dan rilis

### 7.1 Matriks kontrol

| Kode | Modul | Isi | Wajib untuk |
|---|---|---|---|
| C1–C20 | v1 | tetap (`controls.ts`): key terdaftar, status terisi, order lewat tanggal, kg vs laporan Accurate, stok awal vs Inventory Valuation, output batch vs penerimaan, stok proyeksi minus, TB dan jurnal seimbang, akun tanpa mapping, neraca dan kas, Ops vs Accurate | rilis mingguan (seperti sekarang) |
| C21–C24 | M1 | alokasi = total biaya; output SKU vs diproses (2%); cost pool vs GL; batch Aktual posted | rilis bulanan bila M1 on |
| C25–C27 | M2 | lot diduga; kg ledger vs kartu stok; nilai MA vs neraca | C26 wajib sebelum alokasi dipercaya; C27 sebelum cutover |
| C28–C31 | M3 | PO lewat tanggal; Σ alokasi ≤ kg; ekor ≤ kapasitas; blast tanpa lot tujuan | simpan rencana, alokasi |
| C32 | M4 | bridge V1→V2 = 0 | kunci V2 |
| C33–C34 | M5 | driver per pos; actual tetap ≤ jadwal | kunci V1 |
| C35–C37 | M6 | Σ rekening = kas neraca; hari tanpa upload kas; AP debit | rilis bulanan bila M6 on |
| C38–C40 | M7 | di bawah lantai tanpa approval; jual hari ini tanpa order; sales tanpa assignment | simpan order |
| **C41** | M3 | by-product kurang terhadap order (saran beli trading / kurangi) | PERIKSA, tidak memblokir |
| **C42** | M3 | yield_matrix masih placeholder | memblokir "Salin ke batch" |
| **C43** | M5 | biaya tetap bulan berjalan belum diperbarui | PERIKSA di register |
| **C44** | M3 | SKU dengan histori ≥ 20 hari kerja tanpa forecast | BELUM DIISI |
| **C45** | M2/M3 | mart stok lebih lama dari upload terakhir (STALE) | memblokir simpan rencana dan alokasi |
| **C46** | M3 | harga fresh/frozen kosong untuk SKU bersurplus | memblokir approval rencana |
| **C47** | M3 | tanggal rencana tanpa baris kapasitas | memblokir "Salin ke batch" |
| **C48** | M1/M3 | batch Aktual tanpa output SKU | GAGAL; memblokir posting costing dan rilis bulanan |
| **C49** | M4 | Σ `pl_daily` actual = P&L MTD (±Rp 1) | kunci V1, rilis bulanan |

Status tambahan: `STALE` (input lebih baru dari mart) dan `N/A` (flag modul mati **dan** domain itu tidak berkontribusi ke angka rilis; bila angka rilis bergantung pada domain yang mati, status `BELUM DIISI`).

### 7.2 Rilis

Rilis mingguan dan bulanan diperiksa **di server dalam transaksi rilis** (fungsi `release_week` / `release_month`, SECURITY DEFINER, `search_path` tetap), bukan hanya di banner UI. Rilis ditolak bila ada kontrol wajib `GAGAL`, `BELUM DIISI`, atau `STALE`; alasan penolakan dikembalikan per kontrol. Override hanya lewat tabel `release_override` (kontrol, alasan, bukti, role yang diizinkan per kontrol); tidak ada override generik admin. Setelah rilis, perubahan input menghasilkan draft berlabel; angka yang sudah dipakai tidak berubah; PDF/JSON membaca snapshot yang sama dengan layar.

---

## 8. Keamanan dan otorisasi

Temuan yang diverifikasi di commit `23f973f` dan perbaikannya:

| # | Temuan | Lokasi | Perbaikan |
|---|---|---|---|
| S1 | `mart_replace(p_table, p_scope, p_rows)` di-grant ke `authenticated` dan lolos untuk 8 role operasional; role sales dapat menulis JSON hasil hitung apa pun ke tabel mart mana pun | `20261016000100_v3_foundation.sql` baris 118–146; grant diulang di `20261016000400_m2_ledger.sql` baris 56 | `revoke execute` dari `authenticated`; hanya role `rebuild_job` (service role server) yang boleh memanggil; `rebuildDay` berjalan di server action dengan client service role; uji: panggilan dari sesi sales harus 42501 |
| S2 | Sales tanpa assignment melihat semua SKU (`assignedKeys = null`) | `apps/web/app/komersial/page.tsx` baris 28; view `commercial_daily_sales` | default deny: tanpa assignment → tabel kosong + pesan "minta penugasan ke commercial lead"; RLS pada view dan RPC, bukan hanya halaman |
| S3 | "Terkirim" mengisi `fulfilled_kg = kg` → pengiriman parsial menutup PO | `apps/web/app/w/[week]/input/actions.ts` baris 103; `hari/[date]/alokasi/actions.ts` baris 51 | K7: tabel `delivery`, trigger Σ ≤ kg |
| S4 | Audit log tidak dibagi menurut sensitivitas | `admin/audit` | Sales tidak dapat membaca old/new payload yang memuat cost pool, biaya batch, overhead, SI per lot; redaksi di view audit per role |
| S5 | Invarian harga lantai, Σ alokasi, versi terkunci baru dijaga di form | `discount.ts`, `allocation.ts` | trigger database untuk C38, C29, immutability versi |
| S6 | SECURITY DEFINER | semua fungsi v3 | `set search_path = ''` (sudah ada di `mart_replace`), grant terbatas, validasi identitas dan scope; regression test memakai session role sebenarnya (`supabase/tests/rls_roles.sql` diperluas) |

Tidak ada secret di repo atau browser. Env Vercel tidak berubah. Retensi data pelanggan/keuangan mengikuti kebijakan organisasi; yang belum ada dicatat sebagai keputusan sebelum go-live.

---

## 9. Acceptance

### 9.1 Gate

| Gate | Bukti |
|---|---|
| G1 Source parity | `pnpm test`, `pnpm typecheck`, `pnpm parity`, `pnpm build` hijau di CI; snapshot minggu contoh byte-identik kecuali perubahan terdokumentasi per field dan disetujui; normalisasi CRLF tidak menyamarkan selisih |
| G2 Auth | matriks RLS/RPC per 9 peran: akses valid berhasil; lintas customer/SKU, audit rahasia, tulis mart, approval sendiri, tulis versi terkunci ditolak. Uji UI saja tidak cukup |
| G3 Costing/ledger | golden Pot_ISA/Pot_AGRO ±Rp 1/SKU; C21–C24; roll-forward 162.687,92 → 156.956,05 kg; ≥ 95% baris HPP aktual ±Rp 1/kg atau pengecualian tertulis; C26/C27 jelas |
| G4 Demand/fulfillment | golden workbook 7.051 ekor / BLD binding tetap; golden minggu KGR §3.1 (K1); FEFO tidak memilih hold/expired; PO 1.800 kg dikirim 600 kg menyisakan 1.200 kg; cancel, retry, dan permintaan paralel tidak membuat stok negatif/ganda |
| G5 Monthly/finance | Agustus: `pl_daily` actual 1–26 = 6.385,9 / 6.038,5 / 347,4 jt (C49); PO 27–29 = 1.067,8 jt; run-rate 31 Agu = 310,4 jt (K3); outlook = angka yang dihitung engine dengan K3/K5/K11 dan direview (bukan 7.712,4); akurasi vs final 8.361,8 / 306,7 tampil sebelum dan sesudah penyesuaian; C32, C33/C34, C49 |
| G6 Cash | C35/C36/C37; pendanaan afiliasi terpisah dari operasi; saldo minimum dan skenario tanpa fasilitas; data kosong tidak tampil sebagai nol; solvabilitas September 702,6 jt / 0,8 bulan |
| G7 UX | journey A–J (§9.3) di desktop dan mobile baca saja dengan role dan session sebenarnya; management tidak dapat mutasi; setiap halaman punya keadaan kosong/loading/gagal/terkunci sesuai §5.3; keyboard untuk tugas utama; screenshot banding (§9.4) lulus |
| G8 Release | rilis ditolak di server bila kontrol wajib gagal; snapshot immutable; provenance dapat dibuka; rollback satu migrasi diuji pada salinan data; backup/restore terverifikasi |

Go/no-go: G2, G3, G4, G8 hijau sebelum workflow terkait dibuka ke banyak pengguna; G5, G6 sebelum angka manajemen dinyatakan resmi. Flag tetap mati sampai gate irisannya hijau. Empat minggu paralel untuk penggantian sumber stok. Tes unit hijau bukan bukti production-ready.

### 9.2 Golden fixture

| Fixture | Isi | Status |
|---|---|---|
| `week-2026-08-24` | minggu contoh v1, 17.161 sel | ada, tidak berubah |
| `costing-2026-09` | Pot_ISA / Pot_AGRO | ada |
| `demand-2026-09` | workbook demand: 7.051 ekor, BLD, B_Alokasi_Stok | ada |
| `month-2026-08` | actual 1–26, PO 27–29 | ada; `golden.json` ditulis ulang dengan K3 (K4) |
| `fs-2026-09` | seed biaya tetap, solvabilitas | ada; diperluas dengan field 8.3 |
| **`plan-2026-08-24`** | M3 end-to-end di SKU KGR (P3.1–P3.9), nilai sementara Lampiran B.3 | baru |
| **`accuracy-2026-08`** | V1 (artifact) vs final FS: 7.712,4 vs 8.361,8; 293,4 vs 306,7 | baru |
| **`delivery-partial`** | PO 1.800 / kirim 600 / sisa 1.200; cancel; paralel | baru |

### 9.3 Journey

| ID | Aktor dan pemicu | Hasil yang dapat diamati |
|---|---|---|
| A | Management melihat GP P&L menyimpang | headline → segmen → SKU → driver (LB vs breakeven) → sumber; GP produk vs GP P&L terjelaskan lewat waterfall |
| B | Sales melihat stok tua dan membuat PO di bawah lantai | MA/lantai/margin/umur terlihat sesuai assignment; PO pending; tidak bisa dialokasi sampai approval sah |
| C | PPIC mendapat demand baru | langkah 1–3 berubah terukur; by-product kurang tampil sebagai saran beli; ekor tidak naik karena by-product |
| D | PO dikirim dan diterima parsial | stok/reservasi/outstanding berubah sekali; status customer tidak "selesai" dini |
| E | Finance mengunggah jurnal terlambat | preview isu, commit, rentang kotor, rekalkulasi, before/after GP, audit |
| F | Management membuka bulan | actual vs forecast harian, porsi PO, run-rate dan hari anomali, budget, V1/V2 waterfall terbaca tanpa hak edit |
| G | Finance menyelidiki selisih stok | selisih kg dan Rp terpisah; drill ke GRN/DO/MA/GL dan voucher koreksi bila disetujui |
| H | Management menilai kas | operasi vs pendanaan afiliasi terpisah; tanpa pendanaan terlihat saldo minimum dan kewajiban yang mendorong defisit |
| I | Pengguna terbatas meminta aksi istimewa | UI menolak; server/RLS juga menolak permintaan langsung; audit tidak membuka data rahasia |
| J | Rilis dibanding actual final | versi immutable, cut-off/sumber jelas, bridge dan akurasi tersedia |

Tiap journey diuji juga pada keadaan kosong, loading, invalid, tidak lengkap, gagal, dan terkunci.

### 9.4 Screenshot banding

Pemeriksa Playwright yang sudah ada (`docs/management-view/README.md`, viewport 1366×768) diperluas: untuk tiap halaman di §6 dan mockup §5.5, screenshot di 1366×768 (above fold) dan full page; dibandingkan per tile (posisi, ukuran, judul, nilai). Bukti PR = pasangan screenshot + daftar selisih yang disetujui. Tambahan: grep DOM view manajemen untuk `I_`, `O_`, `T_`, alamat email, "bersumber Ops", "→", "M " sebagai satuan, dan `#` hex inline → semuanya 0.

---

## 10. Irisan pengiriman

Satu branch dan satu PR per irisan; tiap PR membawa: requirement ID yang dipenuhi, aturan/angka yang berubah, bukti fixture, tes role-negatif, dampak snapshot, status keputusan K yang dipakai. Demo di staging (Supabase branch) dengan fixture; sign-off pemilik produk sebelum irisan berikutnya.

| Irisan | Branch | Isi | Selesai bila |
|---|---|---|---|
| 0 | `v4/0-foundation` | commit PRD v4 + `reference/design/`; S1–S6; K7 (`delivery`); C45; migrasi kolom §4.1 dan tabel §4.2 (kosong); parameter K3/K9 | G2 hijau; G1 tetap hijau; snapshot tidak berubah |
| 1 | `v4/1-design-system` | token §5.2, komponen §5.3, shell dan nav §5.4, mockup §5.5; halaman **Minggu ini** (§6.1) dengan `weekOutlook` (§3.4) dan waterfall; blok 2/5 keluar dari view manajemen | screenshot banding §6.1 lulus; above-fold lulus; DOM grep 0; snapshot tidak berubah |
| 2 | `v4/2-monthly-cash` | M4 dengan K3/K5/K11 (P1–P14), register, waterfall V1→V2, akurasi; M5 template 8.3 + `cost_event`; halaman **Outlook bulan** (§6.2), **Kas & solvabilitas** (§6.3), **Biaya tetap & driver** (§6.6) | G5, G6; golden `month-2026-08` baru dikunci; `accuracy-2026-08` lulus |
| 3 | `v4/3-ppic` | M3 dengan K1/K2/K8 (P3.1–P3.9), `demand_shortfall`, `plan_variance_daily`, kapasitas seed; halaman **Rencana** (§6.4) dan **Alokasi** (§6.5) | G4; golden `plan-2026-08-24`; paralel 2–4 minggu dengan rencana PPIC (selisih dijelaskan) sebelum flag on |
| 4 | `v4/4-finance-close` | M1 mode RPA sendiri, C48, tanggal biaya vs faktur; tutup buku; rilis server-side (§7.2); M2 rekon terpisah | G3, G8 |
| 5 | `v4/5-commercial` | M7 dalam grammar baru, jalur spot, approval dan lantai di trigger | C38 tidak bisa dibypass lewat API; journey B |

Fase 8 PLAN v3 (cutover sumber stok) tidak termasuk; hanya setelah 4 minggu C26/C27 hijau dan keputusan pemilik produk.

---

## 11. Instruksi handoff untuk Claude Code

1. **Prasyarat lingkungan**: `SUPABASE_DB_URL` menunjuk ke database uji (Supabase branch atau `supabase start`), bukan ref `uxqbtverhnpiryhzbenr`; `gh auth status` login; Node ≥ 20, pnpm 10.28.0.
2. **Langkah pertama (irisan 0)**: simpan dokumen ini sebagai `docs/PRD-v4.md`; salin `reference/design/` (mockup, screenshot samb-bi, `tokens.css`); tambahkan ke `docs/PRD.md`, `docs/PRD-management-view-v2.md`, `docs/PRD-v3-kgr-platform.md`, `docs/PLAN-v3.md` satu baris di atas: "Digantikan oleh docs/PRD-v4.md sejak 16 Okt 2026; lihat §0.2 untuk pasal yang dicabut." Commit sebelum menyentuh kode.
3. **Urutan baca**: Bab 0 → 2 → 3 (modul irisan yang dikerjakan) → 5–6 (halaman irisan itu) → 7–9 → 10.
4. **Larangan**: mengubah `computeWeek` dan golden v1; `drop`/rename kolom; mengaktifkan flag di production; menjalankan SQL ke production (skrip `supabase/fixes/*.sql` dijalankan manusia); menyalin angka mockup ke seed production; memilih sendiri di antara dua pasal yang bertentangan; menganggap berkas di `reference/design/` sebagai lampiran historis.
5. **Format PR**: judul `v4/<irisan>: <isi>`; deskripsi memuat tabel requirement ID → bukti; screenshot banding; keluaran `pnpm snapshot:diff`; daftar keputusan K yang dipakai dan status.
6. **Kalau ragu**: berhenti dan tanya dengan menyebut pasal yang bertentangan. Tidak ada keputusan akuntansi (K-default) yang boleh difinalkan oleh implementasi.

---

## Lampiran A — Sumber

| Sumber | Dipakai untuk |
|---|---|
| `fixtures/week-2026-08-24/*.json` | blok 1–8, order, stok awal, jurnal harian 1–26 Agu, item map, parameter |
| `fixtures/month-2026-08`, `docs/v3/F4b-design.md`, `docs/open-questions.md` §E.4 | actual MTD 6.385,9 / 347,4; PO 27–29; varian run-rate |
| `fixtures/demand-2026-09`, `reference/KGR_Demand_Forecast.xlsx` | golden 7.051 ekor / BLD; yield boneless |
| `fixtures/costing-2026-09`, `reference/202609_Data_COGS_LB.xlsx` | golden costing |
| `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` | Bab 1 tabel (sel disebut); seed biaya tetap; akurasi final Agustus |
| `supabase/migrations/20261016*.sql` | skema v3; `mart_replace` (S1); seed yield placeholder (`20261016000700` baris 19–34) |
| `apps/web/components/OutlookBody.tsx`, `Headline.tsx`, `v3/ManagementV3.tsx`, `app/globals.css` | kondisi view manajemen saat ini |
| `packages/engine/src/demand.ts`, `plan.ts`, `allocation.ts`, `monthly.ts`, `drivers.ts` | fungsi yang diubah |
| `samb-bi/samb_bi/web/styles.css`, screenshot samb-bi 16 Okt 2026 | token dan grammar visual |
| Artifact Claude Design "KGR Management View v2" (Mingguan, Bulanan), dibongkar ke HTML | isi dan temuan: GP P&L −67,5 jt; COGS lain sisa minggu 15,4 jt; kas 289,7 / −910 / 1.229,0 jt; stok 2.782,2 jt; GP sisa minggu −68,0 jt |
| Spesifikasi sesi desain: P1–P14, flowchart 8.1–8.4, template 8.3 | §3.2, §3.3 |
| PRD revisi ChatGPT 16 Okt 2026 | S1–S6 (diverifikasi), journey A–J, definisi GP bridge |

## Lampiran B — Perhitungan acuan

### B.1 Revenue aktual 24–26 Agu: dua basis

| Hari | Baris penjualan (DO) | Jurnal | Sumber |
|---|---|---|---|
| 24 Agu | 221,8 | 226,7 | `sales_lines.json` Aktual; `gl_lines.json` akun Revenue |
| 25 Agu | 0 (tidak ada baris) | 0 (tidak ada baris) | K12 |
| 26 Agu | 349,4 | 362,3 | |
| **Total** | **571,1** | **589,0** | selisih 17,8 jt = komponen bridge revenue jurnal − DO |

### B.2 Run-rate dan outlook Agustus

Revenue jurnal hari kerja 20–26 Agu (jt): Kam 301,4 · Jum 579,3 · Sab 82,3 · Sen 226,7 · Sel 0 · Rab 362,3.

| Aturan | Nilai 31 Agu | Status |
|---|---|---|
| 6 hari termasuk 25 Agu | 258,7 | dicabut (sumber angka 7.712,4) |
| 5 hari tanpa 25 Agu (K3) | 310,4 | berlaku |
| 20 hari kerja tanpa anomali (PRD v3) | 319,3 | dicabut |

GP sisa minggu 27–30 Agu di artifact Bulanan = −68,0 jt = GP produk atas order −52,5 jt (blok 1 `gpOrder`) − ekspedisi 3,6 jt − blasting 11,8 jt (artifact Mingguan, COGS lain sisa minggu). Dengan K3: forecast 27–31 Agu = 1.067,8 + 310,4 = 1.378,2 jt; GP forecast ≈ −68,0 + 310,4 × 5,4% = −51,2 jt; outlook ≈ 7.764,1 jt / 296,2 jt. Nilai acuan untuk review (K4), bukan golden.

### B.3 Dry run M3 minggu 24–30 Agu (yield placeholder, STD 2,0 kg)

Order 27–29 Agu setelah netting stok layak (stok awal fresh melewati 48 jam; frozen 21.860 kg menutup Karkas Frozen 4.228 kg):

| Unit | Net kg | kg/ekor (0,7146 karkas; by-product 0,0453 / 0,0285 / 0,0423 / 0,0543) | Ekor bila binding |
|---|---|---|---|
| Karkas (fresh 12.307 + n/a 811) | 13.118 | 1,4292 | **9.179** |
| HJA | 2.019 | 0,1086 | 18.588 (tidak dipakai, K1) |
| Kepala | 1.674 | 0,0906 | 18.478 (tidak dipakai) |
| Ceker | 1.071 | 0,0570 | 18.778 (tidak dipakai) |
| Usus | 1.673 | 0,0846 | 19.778 (tidak dipakai) |

Rencana K1: 9.179 ekor = 18.358 kg LB. Output by-product pada 9.179 ekor dan kekurangannya: HJA 997 kg (kurang 1.022), Usus 776 kg (kurang 897), Kepala 832 kg (kurang 842), Ceker 524 kg (kurang 548). Tanpa K1 engine merencanakan 19.778 ekor (39.556 kg LB) dengan surplus karkas ≈ 15.149 kg yang akan masuk frozen. Angka ini nilai sementara sampai PPIC mengisi yield dan weight class sebenarnya (C42).

### B.4 Solvabilitas September

Ekuitas 702,6 jt ÷ rugi sebelum pajak 910,1 jt = 0,8 bulan (FS `BS - Management Report` L77; `PL - Management Report` L51). Utang pihak berelasi naik 5.627,1 → 9.845,9 jt (BS K51 → L51). Persediaan 3.532,6 → 6.652,4 jt (BS K23+K24 → L23+L24).
