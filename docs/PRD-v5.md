# PRD v5 — KGR Operating Loop: Manajemen · Commercial · PPIC · Input

Status: Draft untuk review pemilik produk, lalu handoff ke Claude Code · Owner: Dika (Group Project Finance, SAMB) · Tanggal: 16 Okt 2026 (WIB)
Repo: `dikagustiana/KGR-Weekly-Outlook` · Basis audit: `origin/main` `ebe4ad8` (merge PR #23, irisan v4 0–5) · Supabase aplikasi: KGR-OS `pczjhmzpkknzkziipvit` (database uji wajib, lihat Bab 12) · Vercel `kgr-weekly-outlook`
Mockup: Claude Design "KGR Management View v2", versi 21 (6 artboard: Manajemen, Commercial, PPIC, Input, Outlook bulan, Kas). Diekspor ke `reference/design/v5/` di irisan 0.

Dokumen ini **menggantikan PRD v4 sebagai otoritas produk**. PRD v4 menata ulang tampilan dan engine per modul. PRD v5 menata ulang **cara kerja perusahaan di dalam aplikasi**: satu putaran mingguan yang menghubungkan Commercial, PPIC, Cost Accounting, Finance dan Manajemen, dengan engine costing sebagai tulang punggung dan layar per peran sebagai pintu masuk. Pasal PRD v4 yang tidak ditulis ulang atau dicabut di Bab 1.3 tetap berlaku dan dirujuk sebagai "v4 §x".

> **Cara baca untuk Claude Code.** Bab 1 (keputusan dan daftar cabut) mengikat. Lalu Bab 3 (putaran mingguan), Bab 4 (engine), Bab 6 (layar), Bab 7–9 (kontrol, akses, acceptance), Bab 10 (irisan). Satu branch dan satu PR per irisan; berhenti di akhir tiap irisan untuk sign-off. Jangan menjalankan SQL ke KGR-OS production, jangan mengaktifkan flag di production, jangan merge. Bila HEAD bukan `ebe4ad8`, perbarui analisis dampak dulu. Bila dua pasal tampak bertentangan, berhenti dan tanya dengan menyebut pasalnya. Angka di Lampiran C bertanda *ilustrasi mockup* tidak boleh dipakai sebagai golden atau seed.

Konvensi angka: titik ribuan, koma desimal (Rp 3.233,3 jt; 6,9%). "jt" = juta rupiah. Minus "−". Setiap angka menyebut sumber; angka yang belum diverifikasi ditandai *(belum diverifikasi)*.

---

## 0. Apa yang berubah dari v4

| Area | v4 | v5 |
|---|---|---|
| Unit desain | Halaman per modul (M1–M7) dan workspace per peran | **Tiga layar utama per pembaca** (Manajemen, Commercial, PPIC) + **layar Input** untuk semua pengisi data; Outlook bulan dan Kas tetap sebagai halaman manajemen |
| Alur | Modul berdiri sendiri, dihubungkan lewat mart | **Putaran mingguan** dengan tenggat dan pemilik: komitmen Commercial (Jumat) → rencana PPIC (Senin) → beli LB (harian, Dir Ops) → potong → WP H+1 (Cost Accounting) → alokasi/spot/blast → P&L → rilis |
| Costing | M1 per batch setelah faktur; Q26 cost rencana belum dibuat | **Engine costing berjalan di tiga mode**: rencana (harga LB × kg LB + tarif), estimasi (hari potong), sementara (WP H+1), final (faktur tie ke GL). Setiap biaya/kg membawa statusnya ke semua layar |
| Konversi demand | Ekor dari kg karkas ÷ (yield × STD 2,0 kg) | **kg per ukuran karkas → kelas berat LB → kg LB**; ekor hanya turunan untuk kapasitas dan by-product |
| Keputusan live bird | K15: dipindah ke PPIC, hilang dari Manajemen | **Simulasi COGS live bird kembali di Manajemen**, untuk Direktur Operasional. Aplikasi hanya menghitung COGS pada harga yang dicoba; tidak merekomendasikan |
| P&L | GP P&L headline; NIBT dari jurnal + driver | Tabel **laba rugi actual vs run-rate dan per minggu** di Manajemen dan Outlook bulan; NIBT selalu tampil dua baris: menurut jurnal dan **setelah beban tetap** |
| Input | Upload wizard per jenis di halaman Upload | **Layar Input per peran**: daftar tugas bertenggat, upload Excel/CSV/tempel dengan cek per baris sebelum simpan, form parameter dengan dampak, grid kelengkapan data yang menahan rilis |

---

## 1. Keputusan dan daftar cabut

### 1.1 Keputusan yang dipertahankan dari v4

K2, K3, K4, K5, K7, K8, K9, K10, K11, K12, K13, K14, K16, K17, K18 tetap berlaku dengan isi v4 §0.1. K6 tetap, diperluas oleh K29. K1 dan K15 diganti (Bab 1.3).

### 1.2 Keputusan baru

"Ditetapkan" = diputuskan pemilik produk dalam percakapan 16 Okt 2026. "Default" = dipakai sampai pemiliknya mengubah. "Usulan" = belum dijawab; dibangun di belakang parameter dan tidak boleh difinalkan oleh implementasi.

| # | Keputusan | Isi | Pemilik | Status |
|---|---|---|---|---|
| K19 | Tiga layar utama + Input | Manajemen (Pak Jo, Bu Lenny) melihat snapshot minggu ini. Commercial melihat stok yang belum dialokasi ke PO, harga jual, dan memberi tahu PPIC. PPIC melihat demand, rencana mingguan (produk apa yang harus dihasilkan) dan rencana harian. Pengisi data bekerja di layar Input. | Pemilik produk | ditetapkan |
| K20 | Costing sebagai tulang punggung | Engine costing harus berjalan untuk rencana dan actual. Status biaya per lot dan per SKU: `rencana` → `estimasi` (hari potong, kg dari yield standar) → `sementara` (WP potong masuk) → `final` (faktur pemasok tie ke GL, C23). Setiap angka biaya/kg dan GP di semua layar menampilkan statusnya. | Pemilik produk | ditetapkan |
| K21 | WP potong H+1 | WP potong per batch diunggah **H+1 jam 12.00** oleh **Cost Accounting**. Faktur pemasok juga diunggah Cost Accounting saat diterima. | Cost Accounting | ditetapkan |
| K22 | Selisih final vs sementara direvaluasi | Saat biaya final berbeda dari sementara, selisihnya **direvaluasi**. Porsi yang belum terjual: nilai stok direvaluasi. Porsi yang sudah terjual: baris **"Selisih costing"** di COGS pada tanggal biaya final. | Finance + Cost Accounting | revaluasi ditetapkan; **perlakuan porsi terjual = usulan** (O1) |
| K23 | By-product joint | By-product ikut alokasi biaya bersama (relative sales value), sama dengan K13. | Finance | ditetapkan |
| K24 | Harga untuk relative sales value | Bobot alokasi biaya bersama memakai **price list minggu lalu yang sudah dikunci**, bukan harga minggu berjalan, supaya harga lantai (= biaya) tidak berputar terhadap dirinya sendiri. | Finance | default |
| K25 | Keputusan live bird | Harga dan volume live bird diputuskan **Direktur Operasional**. Aplikasi hanya menampilkan simulasi: COGS, GP, COGS/kg per SKU, breakeven dan margin per kg LB pada harga yang dicoba. Tidak ada rekomendasi, tidak ada label "TUNDA/BELI". Harga yang diputuskan dicatat sebagai `lb_price_decision` dan dipakai sebagai harga sementara sampai faktur masuk. | Direktur Operasional | ditetapkan |
| K26 | Komitmen mingguan dikunci Jumat | Commercial mengisi komitmen minggu depan per SKU (kg fresh, kg frozen, harga). **Dikunci Jumat 17.00** oleh Kepala Sales. Komitmen terkunci menjadi demand `Confirmed` untuk rencana Senin; perubahan setelah kunci menjadi versi baru dengan alasan. | Kepala Sales | ditetapkan |
| K27 | Rencana mingguan per kelas berat | Rencana mingguan memilih **pola potong per kelas berat** dan membagi **fresh vs frozen per SKU**. Surplus terhadap demand dikirim ke Commercial sebagai permintaan jawaban (serap atau kurangi potong). | PPIC | ditetapkan |
| K28 | kg → kelas → kg LB (mengganti K1) | Demand karkas dibaca **per ukuran** dari PO. Ukuran dipetakan ke **kelas berat LB**. Kebutuhan dibeli dalam **kg LB per kelas** = kg karkas ÷ yield karkas kelas itu. Ekor = kg LB ÷ rata-rata berat kelas; dipakai hanya untuk kapasitas line dan output by-product. By-product tidak menambah kg LB (prinsip K1 v4 tetap). | PPIC | ditetapkan |
| K29 | Beban tetap selalu tampil | P&L harian/mingguan/bulanan selalu memuat baris **"Beban tetap belum dijurnal"** (gaji, penyusutan, bunga, sewa) dan **"NIBT setelah beban tetap"**. Sumber nominal berurutan: jadwal Finance (template 8.3, K6) → bila kosong, nominal bulan FINAL terakhir berlabel "estimasi bulan lalu" (C55). Dibagi per hari kalender. NIBT menurut jurnal tetap tampil di atasnya. | Finance | default |
| K30 | Laba rugi dua tampilan | Tile laba rugi punya dua tampilan: **Actual vs run-rate** (actual s.d. cut-off · PO + run-rate · outlook · % revenue · budget) dan **Per minggu** (minggu kalender Senin–Minggu dipotong batas bulan, termasuk minggu parsial pertama, + total bulan). Tampil di Manajemen dan Outlook bulan. | Pemilik produk | ditetapkan |
| K31 | Grafik kumulatif multi-ukuran | Grafik kumulatif bulan bisa diganti: Revenue / COGS / GP / NIBT jurnal / NIBT setelah beban tetap. Band ±10% pada porsi forecast berlaku untuk semua ukuran (lebar = 10% × |porsi forecast|). Engine wajib mengeluarkan **COGS dan GP per hari forecast**, bukan hanya total. | Pemilik produk | ditetapkan |
| K32 | Akses Commercial | **Kepala Sales** melihat semua SKU dan pelanggan. **Sales** melihat pelanggan dan SKU yang ditugaskan kepadanya (default deny v4 S2 tetap). | Kepala Sales | ditetapkan |
| K33 | Ukuran karkas wajib di PO | Baris PO untuk karkas RPA wajib membawa ukuran (kode item "Uk x.x"). Baris tanpa ukuran tersimpan sebagai order, dihitung PPIC dengan STD 2,0 kg dan ditandai merah (C50). | Sales | default |
| K34 | Upload Excel di layar Input | Semua input tabel bisa masuk lewat file .xlsx/.xls/.csv, salin-tempel dari Excel, atau form. Browser membaca dan menampilkan cek per baris; **server mengulang validasi yang sama** dan menjadi otoritas. Baris lolos boleh disimpan sebagian; baris gagal ditahan dengan alasan dan tindakan. Template per jenis diunduh dari layar yang sama. | Pemilik produk | ditetapkan |
| K35 | Kelengkapan data menahan rilis | Grid input × hari (pemilik, tenggat, status) menjadi syarat rilis mingguan: sel merah untuk minggu yang dirilis harus selesai atau diberi alasan dan disetujui Finance (`release_override`). | Finance | default |
| K36 | Label sumber per angka | Setiap angka utama di tiga layar utama membawa label sumber singkat (`WP sementara · Cost Accounting · 26 Agu 09.12`). Label merah bila input terkait lewat tenggat. Ini wujud tampilan dari prinsip v4 §2 butir 5. | Pemilik produk | ditetapkan |
| K37 | Manajemen boleh melihat semua layar | Role management dan admin dapat membuka Commercial dan PPIC dalam mode baca ("Lihat sebagai"). Commercial dan PPIC tidak melihat layar peran lain kecuali tautan yang disebut di Bab 6. | Pemilik produk | default |

### 1.3 Daftar cabut

| Dokumen | Pasal | Yang dicabut | Diganti |
|---|---|---|---|
| PRD v4 | K1, P3.4 (rumus `kg_per_head = avg_kg × yield`, satu STD) | Ekor sebagai variabel keputusan; satu kelas STD | K28, §4.2 |
| PRD v4 | K15 | Keputusan/simulasi live bird tidak tampil di Manajemen | K25, §6.1 tile `sim-lb` |
| PRD v4 | §5.4 | Workspace per peran dengan navigasi ≤ 7 item sebagai struktur utama | K19, Bab 6 (tiga layar + Input; nav per peran tetap ≤ 7 item) |
| PRD v4 | §6.1 tile `c-outlook`/`c-bulan` (GP saja) | Kartu tanpa NIBT | K29, K30 |
| PRD v4 | §6.4 Stepper PPIC langkah 1–4 berbasis ekor | Langkah 1 berupa tabel unit × ekor | §6.3 |
| PRD v4 | §4.4 Upload (wizard di halaman Upload) | Upload sebagai halaman terpisah per modul | K34, §6.4 |
| PRD v4 | §3.2 P6 "hari run-rate: revenue × margin acuan" sebagai total saja | Forecast GP sebagai satu angka bulan | K31 (per hari) |
| PRD v4 | §3.3 butir "Baris tetap tanpa input bulan berjalan memakai nominal bulan lalu" tanpa sumber | Nominal bulan lalu dari input saja | K29 (fallback ke FINAL terakhir) |
| `docs/v4/QUESTIONS.md` | Q17 (stok di atas umur = per lot) | — tetap, lihat O7 | — |

---

## 2. Masalah, konteks, tujuan

### 2.1 Kondisi (ringkas; detail v4 §1.1)

Agustus 2026 FINAL: revenue 8.361,8 jt, GP 306,7 jt (3,7%), NIBT −26,5 jt. September: GP −475,4 jt, NIBT −910,1 jt, ekuitas 702,6 jt (0,8 bulan bila rugi berulang), utang pihak berelasi 9.845,9 jt, persediaan 6.652,4 jt (FS Sep 2026, v4 §1.1).

Pola yang terlihat di data minggu contoh 24–30 Agu:
- Batch rencana 27.219 kg LB untuk kebutuhan 18.358 kg LB: 8.861 kg LB di atas kebutuhan, ± 6.332 kg karkas menjadi frozen, downgrade 32,0 jt (di atas batas approval 25 jt).
- Live bird 24.600 di atas breakeven kebutuhan PO 23.960: setiap SKU menanggung COGS 102% dari harga list.
- Stok bebas yang belum ke PO 126.434 kg / Rp 3.233,3 jt (26 SKU); 12 SKU dijual di bawah biaya (−144,2 jt); biaya simpan ± 2,9 jt per hari.
- Jurnal s.d. 26 Agu belum memuat gaji, penyusutan dan bunga. NIBT menurut jurnal 79,2 jt; dengan beban tetap estimasi Juli 87,0 jt menjadi −7,8 jt; FINAL −26,5 jt.

### 2.2 Masalah produk

1. **Tidak ada putaran.** Modul v4 menghitung dengan benar sendiri-sendiri, tapi tidak ada tenggat, pemilik dan serah terima: Commercial tidak tahu surplus PPIC, PPIC tidak tahu komitmen, manajemen tidak tahu input mana yang menahan angka.
2. **Costing belum berjalan untuk rencana.** Q26 (cost rencana) dan Q63 (idle cost) terbuka; harga lantai Commercial memakai biaya penerimaan untuk by-product fresh (Ceker fresh 15.996/kg vs harga 3.101; Kepala fresh 13.368 vs 4.029), bukan alokasi joint.
3. **Konversi demand salah dimensi.** PO menyebut ukuran karkas; aplikasi meleburnya ke `RPA|Karkas|Fresh` lalu membagi dengan satu STD 2,0 kg. Pembelian LB per kelas tidak bisa direncanakan.
4. **NIBT menyesatkan sebelum tutup buku.** Lihat 2.1 butir 4.
5. **Input tersebar dan tanpa cek awal.** Pengisi data tidak melihat apa yang harus diisi hari ini, apa yang gagal, dan siapa yang menunggu.

### 2.3 Tujuan terukur

| ID | Tujuan | Ukuran penerimaan |
|---|---|---|
| T1 | Manajemen tahu snapshot minggu ini dalam 5 detik | Layar Manajemen above-fold 1366×768 memuat headline, 5 kartu, laba rugi minggu terpilih; journey K lulus |
| T2 | Putaran mingguan berjalan dengan pemilik dan tenggat | Status putaran (komitmen, rencana, costing, stok bebas) tampil dan berpindah otomatis; journey L lulus pada fixture |
| T3 | Costing berjalan di semua mode | Untuk minggu contoh: biaya rencana, estimasi, sementara per SKU dihitung engine; simulasi LB = Lampiran B.1 ±Rp 0,1 jt; C54 menangkap Ceker/Kepala fresh |
| T4 | Demand per kelas | `plan-2026-08-24` v5: 18.358 kg LB, K 2.548 / S 8.212 / B 6.463 / tanpa kelas 1.135 kg LB (Lampiran B.3) |
| T5 | NIBT jujur sebelum tutup buku | Agustus: NIBT jurnal 79,2, beban tetap 87,0, NIBT setelah beban tetap −7,8 (Lampiran B.2); C55 tampil bila memakai estimasi |
| T6 | Input tervalidasi sebelum simpan | 3 file contoh (Lampiran B.5) menghasilkan cek dan jumlah baris lolos yang sama di browser dan server |

---

## 3. Putaran mingguan

### 3.1 Kalender

| Kapan | Siapa | Apa | Keluaran | Bila terlambat |
|---|---|---|---|---|
| Jumat 17.00 | Kepala Sales | Kunci komitmen minggu depan per SKU + price list minggu depan | `sales_commitment` versi terkunci; `price_list_week` terkunci | Rencana Senin memakai PO saja; C52 merah |
| Senin 10.00 | PPIC | Rencana mingguan: kg LB per kelas, pola potong, fresh/frozen per SKU | `plan_week` versi n | Batch harian tidak bisa disalin |
| Senin–Sabtu 12.00 | Direktur Operasional → Purchasing | Putuskan harga dan volume LB per kelas untuk potong besok; Purchasing isi supply per kelas | `lb_price_decision`, `lb_supply` | Simulasi COGS memakai harga kemarin berlabel; C57 |
| Harian 14.00 | PPIC + Commercial | Alokasi FEFO ke PO hari ini; sisa fresh ditawarkan spot; cut-off → blast | `allocation`, `sales_line channel='spot'`, `blast_event` | v4 P3.8–P3.9 |
| H+1 12.00 | Cost Accounting | WP potong per batch | `batch_output_sku`; lot berpindah `estimasi` → `sementara` | C53; biaya/kg di Commercial tetap estimasi |
| Saat faktur | Cost Accounting | Faktur pemasok, tie ke GL | biaya batch `final`; revaluasi K22 | Costing tetap sementara |
| Harian 16.00 | Inventory Accounting | Jurnal Accurate, stok | `gl_line`; cut-off maju (v4 P14) | Actual P&L berhenti di hari terakhir lolos |
| Kamis | Finance | Rilis mingguan (v4 §7.2) dengan grid kelengkapan (K35) | snapshot + PDF | Rilis ditolak di server |
| Bulanan | Finance | Jadwal beban tetap, budget, register asumsi, V1/V2/FINAL | v4 §3.2–3.3 | C55, kartu "budget belum diisi" |

### 3.2 Serah terima antar layar

```
Commercial ──komitmen (Jum)──▶ PPIC ──surplus/kurang (Sen)──▶ Commercial ──jawaban──▶ PPIC
     ▲                            │                                           
     │                            ▼                                           
 harga lantai              rencana harian ──▶ Dir Ops: harga LB ──▶ Purchasing: supply per kelas
 = biaya (status)                 │
     ▲                            ▼
     └──── Cost Accounting: WP H+1, faktur ◀── batch potong
                                  │
                                  ▼
                 P&L harian → Manajemen (snapshot, simulasi LB, keputusan) → Rilis (Finance)
```

Setiap panah adalah sebuah **tugas** di layar Input pemilik penerima (§4.9) dengan status `belum` / `menunggu` / `masuk` / `lolos cek` / `terlambat`, dan tampil di tile "Status putaran" layar Manajemen.

---

## 4. Engine

Prinsip v4 Bab 2 tetap: engine fungsi murni decimal.js; snapshot minggu contoh v1 tidak berubah; migrasi hanya menambah; semua layar membaca mart (K17). Format proses: Input · Proses · Output · Kontrol · Contoh · Perubahan vs `ebe4ad8`.

### 4.1 Costing (tulang punggung, K20)

**Mode dan status**

| Status | Kapan | Sumber kg | Sumber biaya |
|---|---|---|---|
| `rencana` | rencana mingguan/harian | demand per kelas × yield standar kelas | `lb_price_decision` (atau harga simulasi) × kg LB + tarif angkut+maklon + overhead |
| `estimasi` | hari potong, sebelum WP | kg LB batch × yield standar kelas | harga LB keputusan × kg LB batch + tarif |
| `sementara` | WP potong masuk (H+1) | output SKU dari WP | harga LB keputusan (faktur belum) + tarif aktual |
| `final` | faktur pemasok tie ke GL (C23) | output SKU dari WP | faktur + cost pool PI + akrual (v4 §3.5) |

**Rumus (berlaku di keempat mode)**
```
cost_pool_batch   = kg_LB × (harga_LB + tarif_angkut_maklon) + overhead            tarif_angkut_maklon minggu contoh = 2.552 Rp/kg LB
nilai_jual_SKU    = kg_SKU × harga_acuan_SKU                                       harga acuan = price_list_week terkunci minggu lalu (K24)
k                 = cost_pool_batch ÷ Σ nilai_jual_SKU                             joint, by-product ikut (K23)
cost_per_kg_SKU   = k × harga_acuan_SKU
breakeven_LB      = Σ nilai_jual_SKU ÷ kg_LB − tarif_angkut_maklon − overhead/kg_LB
margin_per_kg_LB  = (Σ nilai_jual_SKU − cost_pool_batch) ÷ kg_LB
idle_cost         = (basis_kg − actual_kg_LB) × overhead_rate                      biaya periode, bukan COGS/kg (Q63 diselesaikan: baris pl_daily_v4 basis 'fixed')
```
- SKU tanpa harga acuan: `cost_per_kg = missing`; tidak boleh tampil 0; batch tidak bisa `final`.
- Revaluasi (K22): saat status naik ke `final`, `Δ = cost_final − cost_sementara` per lot. Porsi lot yang masih ada → `lot_revaluation` (nilai stok). Porsi yang sudah keluar → baris `pl_daily_v4` `pl_line = 'Selisih costing'` pada tanggal final (**usulan O1**, di belakang parameter `revaluation_sold_mode` ∈ {`cogs_line`, `restate_sale_date`}; default `cogs_line`).
- Ini mengganti perilaku `ebe4ad8` di mana lot by-product fresh memakai biaya penerimaan. Kontrol C54 menangkap SKU dengan `cost_per_kg > 3 × harga_acuan`.

**Simulasi live bird (K25)**: fungsi `simulateLivebird({ basis: 'need' | 'batch', price })` memakai rumus di atas pada mode `rencana`. Basis `need` = demand minggu ini per kelas (§4.2); basis `batch` = batch rencana yang sudah diinput. Contoh di Lampiran B.1.

- Kontrol: C21–C24 (v4), C53, C54, C57.
- Perubahan vs kode: fungsi `planCost` dan `simulateLivebird` baru di `costing.ts`; `allocateBatch` menerima mode dan status; kolom `cost_status` di lot dan `sku_balance_daily`; tabel `lot_revaluation`; `commercial.ts` membaca `cost_per_kg` + status dari mart, bukan MA penerimaan untuk lot RPA.

### 4.2 Demand → kelas → kg LB (K28)

**Input**: PO terbuka per tanggal kirim (v4 P3.1) + komitmen terkunci (K26) + forecast (v4 K2); `item.size_kg` (baru, dibaca dari nama item "Uk 1.3" = 1,30 kg/ekor karkas; parser dan kolom master); `weight_class` (kode, min_kg, max_kg, avg_kg LB); `size_class_map` (ukuran → kelas); `yield_matrix` per kelas × pola × unit (v4, sekarang wajib per kelas).

**Proses**
```
net_kg[ukuran]      = demand_kg[ukuran] − stok_layak[ukuran]                       netting v4 P3.3, kelayakan pada tanggal kirim
kelas[ukuran]       = size_class_map(ukuran)                                       tanpa ukuran → kelas 'STD' + C50
kg_LB[kelas]        = Σ net_kg[ukuran ∈ kelas] ÷ yield_karkas[kelas]
ekor[kelas]         = Σ net_kg[ukuran] ÷ titik_tengah_ukuran                       titik tengah Uk x.x = x.x + 0,05 kg (O3)
output_bp[kelas]    = kg_LB[kelas] × yield_bp[kelas]                               by-product, tidak menambah kg LB
kurang_bp           = max(0, net_kg_bp − Σ output_bp)                              sinyal beli trading / kurangi order (C41)
```
- Pola potong lain (parting, boneless) mengikuti v4 P3.4 per kelas: SKU produk utama yang hanya bisa dari kelas tertentu menentukan kg LB minimum kelas itu.
- **Output**: mart `demand_class_weekly` (week, ship_date, ukuran, kelas, net_kg, kg_LB, ekor) dan `demand_shortfall` (v4).
- **Kontrol**: C41, C42 (yield masih placeholder **per kelas**), C50, C51.
- **Contoh** (minggu 24–30 Agu, yield placeholder 71,46% semua kelas, Lampiran B.3): karkas fresh 12.307 kg di 6 ukuran + 811 kg tanpa ukuran → 18.358 kg LB (K 2.548 / S 8.212 / B 6.463 / STD 1.135), ± 9.871 ekor.
- **Perubahan vs kode**: `sku_key` untuk karkas RPA dipecah per ukuran (`RPA|Karkas Uk1.3|Fresh`) **atau** `sales_line.size_kg` dibawa di samping key; pilihan implementasi ditanyakan di PR irisan 3 (O4). `toHeads` dan `headsByPattern` diganti `toClassLB`; golden `plan-2026-08-24` diperbarui (Lampiran B.3), golden workbook 7.051 ekor tetap untuk fungsi lama.

### 4.3 Rencana mingguan (K27)

- **Input**: §4.2; `lb_supply` per kelas; kapasitas; price list fresh/frozen; komitmen; jawaban Commercial atas surplus versi sebelumnya.
- **Proses**: per kelas, PPIC memilih pola potong (karkas utuh / parting / boneless) dan porsi fresh vs frozen per SKU. `surplus = output − demand` per SKU; `downgrade = Σ (harga_fresh − harga_frozen) × kg_frozen_terencana`; biaya rencana per SKU dari §4.1 mode `rencana` pada harga LB keputusan terakhir.
- **Versi**: "usulan kebutuhan" (dihitung engine dari demand) dan "tersimpan" (yang diinput PPIC). Layar menampilkan keduanya berdampingan.
- **Output**: `plan_week` (v4) + `plan_week_class` (kelas, pola, kg_LB, ekor, fresh_kg/frozen_kg per SKU) + tugas "jawab surplus" untuk Commercial bila surplus > 0.
- **Kontrol**: C42, C46 (v4), C58.
- **Contoh**: usulan kebutuhan 18.358 kg LB, frozen terencana 0, GP rencana −11,8 jt di LB 24.600; tersimpan 27.219 kg LB, margin potong −105,5 jt (blok 2 v1), surplus ± 6.332 kg karkas, downgrade −32,0 jt (perlu approval > 25 jt).
- **Perubahan vs kode**: Q47 (simpan vs salin) diselesaikan: simpan boleh dengan C42 PERIKSA berlabel "yield sementara"; salin ke batch butuh C42, C47, C58 LULUS.

### 4.4 Rencana harian

v4 P3.6, ditambah: kebutuhan dibagi per **tanggal kirim × kelas** (bukan porsi PO RPA total), potong H−1 (`lead_time_days` = 1). Contoh Lampiran B.4: potong Rab 26 → 7.461 kg LB (0 / 2.081 / 1.221 ekor K/S/B + 568 tanpa ukuran), Kam 27 → 4.664 kg LB, Jum 28 → 6.233 kg LB. Kontrol C30, C47, C58.

### 4.5 Alokasi, spot, blast

v4 P3.8–P3.9 tetap. Tambahan: lot hari potong berstatus biaya `estimasi`; tampil di Commercial dengan label itu.

### 4.6 Commercial

- **Stok bebas** = saldo lot − reservasi alokasi − komitmen terkunci, per SKU, dengan umur, kg di atas batas umur (fresh 48 jam, frozen 30 hari; Q17 per lot), biaya/kg + status (§4.1), harga acuan.
- **Harga lantai** = `cost_per_kg` (status apa pun; label status wajib). Markup v4 M7 tetap sebagai parameter, default 0.
- **Rugi simpan per hari** = nilai stok × tarif simpan harian; tarif = beban storage bulan lalu ÷ persediaan akhir bulan lalu ÷ hari (Agustus: 97,5 ÷ 3.532,6 ÷ 31 = 0,089%/hari → 2,9 jt/hari untuk 3.233,3 jt).
- **Urgensi** (v4 Q18) dan ranking tetap; filter `jual hari ini` / `lewat batas umur` / `di bawah biaya`.
- **Komitmen minggu depan** (K26): form per SKU (fresh kg, frozen kg, harga), status draft → terkunci; versi baru setelah kunci wajib alasan.
- **Jawaban surplus PPIC**: pilihan `sanggup serap` (dengan kg dan harga) / `tidak sanggup, kurangi potong` / `serap sebagian`; pesan ke PPIC.
- Kontrol: C38–C40 (v4), C52, C54.

### 4.7 Laba rugi harian, mingguan, bulanan (K29–K31)

- Sumber tetap `pl_daily_v4` (v4 P1–P7). Tambahan baris dan basis:
  - `basis = 'fixed_estimate'` untuk "Beban tetap belum dijurnal": untuk tiap hari, `nominal_bulan ÷ hari_kalender − actual_tetap_hari_itu` (tidak pernah negatif per bulan; v4 K6 `outlook = actual MTD + max(0, nominal − actual MTD)`).
  - Nominal: `fixed_cost_input` (K6) → fallback FINAL terakhir per COA tetap (gaji, penyusutan, bunga, sewa) dengan label `estimasi bulan lalu` (C55).
  - Forecast per hari untuk COGS dan GP (K31): hari ber-PO = Σ kg × biaya/kg rencana per SKU (§4.1) dikurangi COGS lain berdriver; hari run-rate = revenue × (1 − margin acuan). Q26 selesai.
- **Agregasi minggu**: Senin–Minggu dipotong batas bulan; minggu parsial pertama (mis. 1–2 Agu) tampil sebagai kolom sendiri. Kolom minggu berjalan = actual s.d. kemarin + PO + run-rate; bila tampilan "Aktual s.d. kemarin", kolom dipecah actual vs sisa.
- **Output**: fungsi `plTable(view: 'rr' | 'wk', month, opts)` → baris Revenue, COGS, GP, GP %, Beban operasi (jurnal), NIBT menurut jurnal, Beban tetap belum dijurnal, NIBT setelah beban tetap, NIBT %; `cumulativeSeries(metric)` 31 titik + band.
- **Kontrol**: C49 (v4), C55.
- **Contoh**: Lampiran B.2 (Agustus actual vs run-rate dan per minggu; semua angka actual dihitung ulang dari `gl_lines.json` dan cocok dengan engine).

### 4.8 Kas dan solvabilitas

v4 §3.7 dan Kas mockup tetap: kartu kas, terendah 13 minggu, utang pihak berelasi, ekuitas, bulan ke ekuitas negatif; utang afiliasi vs ekuitas Mei–Sep; neraca ringkas; CCC dengan simulasi target DIO (7/14/21/30 hari); arus operasi vs pinjaman afiliasi minggu berjalan. Tambahan: bulan ke ekuitas negatif memakai **NIBT setelah beban tetap** (K29).

### 4.9 Input, tugas, dan validasi upload (K34, K35)

**Registry tugas** (`input_task_rule`, seed dari §3.1): kind, pemilik role, aturan tenggat (mis. `batch.date + 1 day 12:00`), mart yang terdampak, kalimat dampak. Instance `input_task` dibuat job harian; status dihitung dari data (bukan dicentang manual).

**Jenis upload dan template**

| Kind | Pemilik | Kolom (baris 1 = judul) | Cek baris | Cek file/batch |
|---|---|---|---|---|
| `po_lines` | Sales | no_po, tanggal_kirim, kode_item, kg, harga, pelanggan | kode di master item; karkas RPA wajib ukuran (C50); tanggal kirim ≥ hari ini; kg > 0; harga > 0; harga ≥ lantai → bila tidak, `warn` dan approval Kepala Sales (C38) | pelanggan sesuai assignment (K32) |
| `costing_wp` | Cost Accounting | batch, kg_lb, ekor (baris pertama batch), kode_item, kg | kode di master; kg > 0 | kg LB vs batch rencana; rata-rata kg/ekor → kelas; Σ SKU vs kg LB × (1 − target susut) dalam toleransi C22; yield karkas 68–76% (O6) |
| `yield_matrix` | PPIC | kelas, kunci, yield_pct (0,715 atau 71,5) | angka valid | kelas terdaftar (C51); Σ yield per kelas ≤ 100%; yield karkas 68–76% |
| `lb_supply` | Purchasing | tanggal, kelas, pemasok, kg_lb, harga | kelas terdaftar | Σ supply vs kebutuhan kelas (C58) |
| `fixed_cost` | Finance | coa, bulan, nominal, basis, dasar | COA berdriver tetap | periode tidak tumpang tindih (v4 §3.3) |
| `supplier_invoice` | Cost Accounting | no_faktur, tanggal, pemasok, batch, kg, nilai | batch ada | tie ke GL (C23) |
| lainnya | — | v4 §4.4 (`cost_pool_pi`, `forecast_sales`, `stock_card`, `cash_daily`, `budget`, `delivery`) | v4 | v4 |

**Aturan parsing** (sama di browser dan server; satu modul `packages/engine/src/upload-validate.ts` dipakai keduanya):
- File: sheet pertama; baris kosong dilewati; judul kolom dinormalisasi (huruf kecil, spasi → `_`).
- Angka: `1.234,5`, `36.705`, `Rp 43.086`, angka Excel. Tanggal: `YYYY-MM-DD`, `DD/MM/YYYY`, tanggal Excel.
- Hasil: `checks[]` (level `ok` / `warn` / `fail` / `info`, judul, detail, hasil) dan `rows[]` (kunci, nama, kg, level, tindakan); `ok_count`, `total`.
- Simpan: hanya baris tanpa `fail`; server menjalankan ulang validasi pada payload mentah, menolak bila hasil berbeda dari pratinjau (fingerprint), lalu commit idempoten (`line_key`, v4 §4.4) dan mengantrekan rebuild mart terdampak.
- Browser memakai SheetJS (build mini, lisensi Apache-2.0) dari bundle app; tempel dari Excel diparse sebagai TSV tanpa library.

**Grid kelengkapan** (`input_completeness_daily` mart): input × tanggal → `masuk_lolos` / `masuk_catatan` / `terlambat` / `belum_jatuh_tempo`, dari `input_task`. Dibaca layar Input (Finance) dan rilis (K35).

---

## 5. Model data — delta terhadap `ebe4ad8`

Konvensi v4 §4 (money `numeric(18,2)`, provenance, soft delete, audit, RLS). Migrasi hanya menambah.

### 5.1 Kolom baru

| Tabel | Kolom | Keterangan |
|---|---|---|
| `item` (master item) | `size_kg numeric(4,2)` | ukuran karkas per ekor; diisi parser dari nama "Uk x.x"; null untuk non-karkas (K28, K33) |
| `sales_line` | `size_kg numeric(4,2)`, `commitment_id uuid` | ukuran dari item; asal komitmen |
| `weight_class` | seed `K`, `S`, `B` dengan `min_kg/max_kg/avg_kg` **null + deskripsi** (diisi PPIC; nilai mockup 1,3–1,6 / 1,6–2,0 / 2,0–2,3 adalah ilustrasi) | K28 |
| `lb_supply` | `price numeric(18,4)` | harga per kelas bila berbeda (O2) |
| `lot`, `sku_balance_daily` | `cost_status text check in ('rencana','estimasi','sementara','final')` | K20 |
| `batch` | `wp_due_at timestamptz`, `wp_received_at`, `invoice_status` | K21, C53 |
| `pl_daily_v4` | `basis` ditambah `'fixed_estimate'`; `pl_line` ditambah `'Selisih costing'`, `'Biaya kapasitas idle'` | K22, K29, Q63 |
| `upload` | `checks jsonb`, `ok_count integer`, `preview_fingerprint text` | K34 |
| `parameter` | `commitment_lock_dow integer default 5`, `commitment_lock_time time default '17:00'`, `wp_due_hours integer default 24`, `wp_due_time time default '12:00'`, `revaluation_sold_mode text default 'cogs_line'`, `cost_anomaly_ratio numeric default 3`, `yield_karkas_min numeric default 0.68`, `yield_karkas_max numeric default 0.76`, `shrink_target numeric default 0.03` | K21, K22, K26, C54, O6 |

### 5.2 Tabel baru

```
size_class_map         size_kg, weight_class, effective_from, effective_to                       (K28)
lb_price_decision      date, weight_class (null = semua), price, volume_kg_lb, decided_by, decided_at, note  (K25)
sales_commitment       id, week_start, version, key, size_kg, fresh_kg, frozen_kg, price, status ('draft','locked','superseded'),
                       locked_by, locked_at, reason                                                (K26)
price_list_week        week_start, key, price_fresh, price_frozen, locked_by, locked_at           (K24)
plan_week_class        plan_week_id, weight_class, cut_pattern, kg_lb, heads, fresh_kg_by_key jsonb, frozen_kg_by_key jsonb (K27)
surplus_response       plan_week_id, key, surplus_kg, response ('absorb','reduce','partial'), absorb_kg, price, by, at, note
lot_revaluation        lot_id, date, cost_from, cost_to, kg_remaining, amount, status_from, status_to   (K22)
demand_class_weekly    week_start, ship_date, size_kg, weight_class, net_kg, kg_lb, heads          ← mart (§4.2)
input_task_rule        kind, owner_role, due_rule, impact_text, marts jsonb                         (§4.9)
input_task             id, rule_kind, ref (batch/week/date), due_at, status, done_at, upload_id      (§4.9)
input_completeness_daily date, kind, owner_role, status                                              ← mart (K35)
```

### 5.3 Role

Role baru `operations_director` (Direktur Operasional): tulis `lb_price_decision`; baca semua layar seperti management. Area izin baru: `lb_decision`, `commitment_lock` (commercial_lead), `surplus_response` (sales, commercial_lead), `price_list_lock` (commercial_lead). Matriks lengkap Bab 8.

---

## 6. Layar

Grammar visual v4 Bab 5 tetap (token, kartu 30px, grid 12 kolom baris 76px gap 12, tile putih border #e3e6eb radius 10, merah hanya negatif, Rp jt satu desimal, "cara hitung"). Mockup v5 adalah spec (prinsip v4 §2 butir 8); perbedaan mockup vs teks diselesaikan dengan bertanya. Lampiran D mendaftar perbedaan yang sudah diketahui.

Header semua layar: logo, nav layar itu (≤ 7 item), **"Lihat sebagai"** (Manajemen · Commercial · PPIC · Input; hanya item yang diizinkan role, K37).

### 6.1 Manajemen · Minggu ini (`Main.dc.html`)

| Tile | Baris | Isi | Sumber |
|---|---|---|---|
| Slicer minggu, Tampilan, Rilis | 1 | minggu (w1–w4, terbaru = draft); Aktual s.d. kemarin / Proyeksi minggu; ReleaseLine | `week`, `release` |
| Headline | 2 | satu kalimat temuan (v4 §6.1 templat) | `weekOutlook` |
| 5 kartu | 3–4 | Outlook minggu · Stok di atas batas umur · Kas terendah 7 hari · Outlook Agustus (GP dan **NIBT setelah beban tetap**) · Solvabilitas | v4 §6.1 + K29 |
| **Laba rugi Agustus** | 5–8 | K30; default tampilan Per minggu; kolom minggu terpilih disorot; tampilan aktual memecah 24–26 / 27–31 | `plTable` |
| **Simulasi harga live bird · untuk Direktur Operasional** | 9–11 kiri | basis (kebutuhan PO / batch rencana di input); tombol harga 20.000–26.000; kartu COGS rencana, GP rencana, breakeven LB, margin/kg LB; tabel COGS/kg per SKU vs harga list; catatan "aplikasi tidak merekomendasikan" | `simulateLivebird` |
| **Perlu keputusan minggu ini** + **Status putaran** | 9–11 kanan | daftar keputusan dengan pemilik (harga LB → Dir Ops; batch vs kebutuhan & downgrade → Dir Ops + PPIC; SKU di bawah biaya → Kepala Sales; pinjaman afiliasi → Direksi); status komitmen, rencana PPIC, costing (n sementara / n final), stok bebas | `input_task`, mart |
| Revenue dan GP per hari + bridge GP produk → GP P&L | 12–15 | v4 §6.1 | v4 |
| Trend revenue / GP per minggu | 16–18 | v4 | v4 |
| GP produk per segmen (klik memfilter) | 19–21 | v4; kolom biaya/kg membawa status K20 | mart |
| COGS/kg vs revenue/kg; Input; COGS + mutasi persediaan | 22–25 | v4 | v4 |
| Keputusan trading | 26–29 | v4 (blok 3) | v1 |
| Stok di atas batas umur; Demand dan rencana potong | 30–33 | demand per kelas (K28) | §4.2 |
| Kas harian, arus kas, peringatan | 34–37 | v4 | v4 |
| Catatan | 38 | label sumber dan rilis | — |

### 6.2 Commercial (`Commercial.dc.html`)

Nav: Komersial · Pesanan · Approval · Scorecard · Upload (Upload membuka layar Input role ini).

| Tile | Isi |
|---|---|
| Filter | semua / jual hari ini / lewat batas umur / di bawah biaya |
| Headline | temuan stok bebas dan SKU di bawah biaya |
| 5 kartu | Stok bebas (Rp jt, kg, jumlah SKU) · Jual hari ini · Di bawah biaya (SKU, Rp jt) · Rugi simpan per hari · Approval menunggu |
| Ranking stok bebas | per SKU: urgensi, kg bebas, umur, kg di atas batas, **status biaya** (Trading final / RPA sementara / estimasi), harga lantai = biaya, harga acuan, margin/kg, rugi simpan/hari, rugi pada harga acuan |
| Komitmen minggu depan | form per SKU (fresh kg, frozen kg, harga); tombol Kunci (Kepala Sales); status dan tenggat Jum 17.00 |
| Dari PPIC | surplus karkas (kg, downgrade) dengan tombol jawaban; kekurangan by-product |
| Spot hari ini | sisa fresh tanpa PO sebelum cut-off 14.00 |

Akses: K32. Sales tidak melihat cost pool, biaya batch, SI per lot (v4 M7).

### 6.3 PPIC (`PPIC.dc.html`)

Nav: Rencana · Alokasi hari ini · Stok · Batch · Upload. Stepper 1–4 dengan status per langkah (Q48 dipakai).

| Tile | Isi |
|---|---|
| Stepper + headline | "Order 27–29 Agu butuh 18.358 kg LB dalam tiga kelas berat (± 9.871 ekor); batch rencana 27.219 kg LB, 8.861 kg di atas kebutuhan." |
| 5 kartu | PO kirim (kg, RPA/Trading, tentatif) · Kebutuhan karkas (per ukuran; tanpa ukuran merah) · Rencana kebutuhan (kg LB per kelas, ekor) · Batch rencana di input (selisih) · Biaya rencana karkas fresh (vs harga list, breakeven) |
| 1 · Demand per ukuran → kelas → kg LB | tabel: ukuran, PO kg, stok layak, net kg, kelas, kg LB/ekor, kg LB, ekor; baris total; catatan aturan |
| Dari Commercial | komitmen, price list, jawaban surplus, spot |
| 2 · Rencana mingguan | versi usulan vs tersimpan; kartu (kg LB/kelas, biaya, GP, frozen); **tabel pembelian per kelas** (rentang, kg LB, ekor, rata-rata, pola potong); tabel output per SKU (output, ke PO fresh, frozen terencana, harga, biaya/kg, downgrade); tombol simpan dengan alasan bila diblokir |
| Ke Commercial dan Direktur Operasional | surplus tanpa pembeli; kekurangan by-product; ukuran kosong di PO |
| 3 · Rencana harian | per tanggal potong: kirim, kg LB, ekor, ekor per kelas K/S/B, target karkas, kapasitas, supply LB; "Salin ke batch" (C42, C47, C58) |
| 4 · Hari ini | PO kirim hari ini, alokasi FEFO, sisa fresh untuk spot, cut-off |
| Batch aktual vs rencana · WP H+1 | kg LB, susut, yield, status biaya |

### 6.4 Input (`Input.dc.html`)

Satu layar untuk semua pengisi data; konten mengikuti role pengguna (admin dan management dapat berganti role untuk melihat).

| Tile | Isi |
|---|---|
| Role + hari ini | tombol role dengan jumlah tugas gagal/terlambat; tanggal, cut-off pembelian LB 12.00, cut-off fresh 14.00 |
| Headline + 4 kartu | per role (contoh Cost Accounting: tugas hari ini, status batch sementara/final, faktur masuk, yang tertahan) |
| Tugas saya | daftar `input_task`: judul, tenggat, status, dampak; klik membuka panel |
| Upload dan cek | pilih file / tempel dari Excel / pakai contoh / buat template; daftar cek; tabel baris (gagal merah dengan tindakan); "Simpan N baris yang lolos"; ringkasan efek setelah simpan |
| Form parameter | nilai berlaku, usulan, dampak ke angka, persetujuan (contoh: tarif overhead, kapasitas, supply per kelas, jadwal beban tetap) |
| Riwayat dan siapa yang menunggu | upload terakhir dan role yang menunggu input ini |
| Kelengkapan data (Finance) | grid input × hari (K35) dengan pengingat dan "Rilis dengan alasan" |

Role di mockup: Cost Accounting, Sales, PPIC, Finance. Wajib juga: Inventory Accounting (jurnal, stok awal, kartu stok), Purchasing (supply LB, harga beli), Kepala Sales (kunci komitmen dan price list), Direktur Operasional (keputusan harga LB).

### 6.5 Outlook bulan (`Bulanan.dc.html`)

v4 §6.2, ditambah: kartu Actual / Forecast / Outlook memuat NIBT jurnal dan NIBT setelah beban tetap; headline menyebut keduanya; **tile laba rugi** (K30, default Actual vs run-rate); **grafik kumulatif dengan pilihan ukuran** (K31); tabel akurasi FINAL memuat baris NIBT jurnal dan NIBT + beban tetap. Grafik harian tetap revenue (pilihan ukuran untuk grafik harian = O9).

### 6.6 Kas & solvabilitas (`Kas.dc.html`)

v4 §6.3 dan §4.8 di atas.

---

## 7. Kontrol

C1–C49 v4 tetap. Baru:

| Kode | Isi | Status bila gagal | Memblokir |
|---|---|---|---|
| C50 | Baris PO karkas RPA tanpa ukuran | PERIKSA | — (dihitung STD, tanda merah) |
| C51 | Kelas berat di yield/supply/upload tidak terdaftar | GAGAL | simpan upload baris itu |
| C52 | Komitmen minggu depan belum dikunci pada tenggat | BELUM DIISI | — (rencana memakai PO saja) |
| C53 | Batch melewati tenggat WP (H+1 12.00) tanpa WP | BELUM DIISI | rilis mingguan untuk GP RPA (override Finance) |
| C54 | `cost_per_kg` SKU > `cost_anomaly_ratio` × harga acuan | PERIKSA | harga lantai SKU itu tampil "periksa biaya" |
| C55 | P&L memakai beban tetap estimasi (bukan jadwal Finance bulan itu) | PERIKSA | kunci V1 |
| C56 | Kode item di upload tidak dikenal | GAGAL | simpan baris itu |
| C57 | Harga LB untuk tanggal potong belum diputuskan | BELUM DIISI | salin ke batch hari itu |
| C58 | Supply LB per kelas < kebutuhan kelas | PERIKSA | salin ke batch (kecuali alasan) |

Rilis: v4 §7.2 + K35.

---

## 8. Akses

| Role | Manajemen | Commercial | PPIC | Input (tulis) | Catatan |
|---|---|---|---|---|---|
| management | baca | baca (K37) | baca (K37) | — | — |
| operations_director | baca | baca | baca | `lb_price_decision` | K25 |
| commercial_lead (Kepala Sales) | — | semua SKU dan pelanggan | baca langkah 1–2 | PO, komitmen + kunci, price list + kunci, approval, jawaban surplus | K26, K32 |
| sales | — | pelanggan & SKU assignment | — | PO, pengiriman, usulan komitmen, jawaban surplus (assignment) | K32 |
| ppic | — | baca stok bebas | penuh | yield, kelas, kapasitas, rencana, alokasi, cut-off | — |
| purchasing | — | — | baca langkah 3 | supply LB, harga beli | — |
| cost_accounting | — | — | baca batch | WP, faktur, cost pool, tarif | K21 |
| inventory_accounting | — | — | baca stok | jurnal, stok awal, kartu stok, pengiriman | — |
| finance | baca + rilis | baca | baca | beban tetap, budget, register, kas, override | K35 |
| admin | semua | semua | semua | semua | tetap tanpa override generik (v4 §7.2) |

Semua batas di atas ditegakkan RLS/RPC, bukan hanya UI (v4 §8 S1–S6 tetap; uji `rls_roles.sql` diperluas untuk role dan area baru).

---

## 9. Acceptance

### 9.1 Gate

G1–G8 v4 tetap. Tambahan:

| Gate | Bukti |
|---|---|
| G9 Costing loop | Untuk minggu contoh: biaya per SKU di keempat mode dihitung; simulasi LB = Lampiran B.1 ±0,1 jt; revaluasi contoh (sementara → final) menghasilkan `lot_revaluation` + baris "Selisih costing" sesuai parameter; C54 menandai Ceker dan Kepala fresh di data `ebe4ad8` lalu hilang setelah alokasi joint |
| G10 Demand per kelas | `plan-2026-08-24` v5 lulus (Lampiran B.3–B.4); baris tanpa ukuran → C50 |
| G11 P&L | `plTable('rr')` dan `plTable('wk')` Agustus = Lampiran B.2 ±0,1 jt; Σ kolom minggu = total bulan; C55 tampil saat jadwal kosong |
| G12 Upload | tiga file contoh Lampiran B.5 menghasilkan cek dan `ok_count` identik di browser dan server; server menolak payload yang diubah setelah pratinjau |
| G13 Putaran | journey L berjalan di fixture: kunci komitmen → rencana → jawaban surplus → keputusan harga LB → WP H+1 → status putaran dan tugas berpindah |

### 9.2 Golden fixture baru / berubah

| Fixture | Isi |
|---|---|
| `plan-2026-08-24` v5 | demand per ukuran/kelas/hari, kg LB per kelas, ekor turunan (`placeholder: true` sampai yield/kelas diisi PPIC) |
| `pl-2026-08` | tabel laba rugi dua tampilan dan seri kumulatif 5 ukuran (Lampiran B.2) |
| `costing-sim-2026-08-24` | simulasi LB dua basis, delapan harga (Lampiran B.1) |
| `upload-samples` | `po_sample.xlsx`, `wp_sample.xlsx`, `yield_sample.xlsx` + `expected.json` (Lampiran B.5) |

### 9.3 Journey baru

| ID | Aktor | Hasil |
|---|---|---|
| K | Pak Jo membuka Manajemen Kamis pagi | headline, 5 kartu, laba rugi per minggu dengan NIBT setelah beban tetap, keputusan yang menunggu dan pemiliknya terbaca tanpa scroll; tidak ada tombol tulis |
| L | Putaran satu minggu | lihat G13 |
| M | Direktur Operasional mencoba harga LB | simulasi berubah per harga; keputusan tersimpan; batch hari itu memakai harga itu berlabel sementara |
| N | Sales mengunggah PO dengan ukuran kosong dan harga di bawah biaya | baris ukuran kosong ditahan dengan tindakan; baris di bawah lantai ke approval; baris lolos tersimpan; demand PPIC berubah |
| O | Cost Accounting mengunggah WP dengan kode tak dikenal dan selisih hasil potong | dua baris ditahan; batch tetap sementara dengan alasan wajib; lot berpindah ke `sementara`; Commercial melihat biaya baru |
| P | Finance membuka kelengkapan data sebelum rilis | sel merah menahan rilis; pengingat terkirim; rilis dengan alasan tercatat di `release_override` |

---

## 10. Irisan pengiriman

| Irisan | Branch | Isi | Selesai bila |
|---|---|---|---|
| 0 | `v5/0-foundation` | commit PRD v5, ekspor mockup ke `reference/design/v5/`, baris "digantikan" di PRD v4; migrasi §5 (tabel/kolom kosong, seed kelas null); role dan area §5.3; registry tugas seed | G1, G2 hijau; snapshot v1 tidak berubah |
| 1 | `v5/1-costing` | §4.1: mode/status, `planCost`, `simulateLivebird`, revaluasi (K22, parameter), idle cost ke `pl_daily_v4`, C53, C54, C57; Commercial membaca biaya + status | G9 |
| 2 | `v5/2-pl` | §4.7: beban tetap fallback (K29), forecast COGS/GP per hari, `plTable`, `cumulativeSeries`, C55; tile laba rugi di Manajemen dan Outlook bulan; grafik kumulatif 5 ukuran | G11 |
| 3 | `v5/3-ppic-class` | §4.2–4.4: ukuran di item/PO, `size_class_map`, `toClassLB`, `plan_week_class`, layar PPIC v5, C50, C51, C58 | G10 |
| 4 | `v5/4-commercial-loop` | §4.6: komitmen + kunci Jumat, price list mingguan (K24), jawaban surplus, layar Commercial v5, C52 | journey L langkah Commercial ↔ PPIC |
| 5 | `v5/5-input` | §4.9: `upload-validate.ts` bersama, layar Input semua role, template, tempel, simpan sebagian, fingerprint, grid kelengkapan, K35 di `release_week` | G12, journey N, O, P |
| 6 | `v5/6-management` | layar Manajemen v5 (simulasi LB, keputusan, status putaran, label sumber K36), "Lihat sebagai" (K37), role `operations_director` | G13, journey K, M; screenshot banding vs mockup |

---

## 11. Pertanyaan terbuka (dibangun di belakang parameter; tidak difinalkan implementasi)

| # | Pertanyaan | Default sementara | Pemilik |
|---|---|---|---|
| O1 | Revaluasi porsi yang sudah terjual: baris "Selisih costing" di COGS tanggal final, atau restate ke tanggal jual? | `cogs_line` | Finance |
| O2 | Harga LB berbeda per kelas berat? | satu harga; kolom `lb_supply.price` disiapkan | Dir Ops + Purchasing |
| O3 | Arti "Uk 1.3": karkas 1,30–1,39 kg/ekor (titik tengah 1,35)? | ya | PPIC + Sales |
| O4 | Ukuran sebagai bagian key SKU, atau kolom terpisah di samping key? | kolom terpisah (`size_kg`) | PPIC + Finance |
| O5 | Rentang kelas K/S/B dan yield per kelas | null sampai diisi; mockup ilustrasi | PPIC |
| O6 | Batas cek WP: toleransi Σ SKU vs hasil potong (C22 v4 = 2%; mockup memakai 3%), target susut 3%, yield karkas 68–76% | C22 2%; susut 3%; 68–76% | Cost Accounting |
| O7 | Definisi stok di atas batas umur untuk kartu Manajemen (per lot, Q17: 685,4 jt vs per SKU 2.782,2 jt) | per lot | Finance |
| O8 | Batas approval parameter (mockup: > 5% atau > Rp 5 jt per minggu) | sesuai mockup | Finance |
| O9 | Grafik harian juga punya pilihan ukuran? | tidak | Pemilik produk |
| O10 | Hari rilis mingguan: Kamis (v4 K9) atau Jumat (teks mockup Input) | Kamis | Finance |
| O11 | Harga lantai untuk by-product fresh sebelum alokasi joint berjalan: tetap biaya penerimaan dengan C54, atau sembunyikan? | tampil dengan C54 | Kepala Sales |
| O12 | Kunci service role untuk rebuild di server (Q2 v4) | dibutuhkan; disimpan di env server Vercel oleh manusia | Pemilik produk |
| O13 | Pengecualian tertulis MA vs HPP 88,2% (Q69) | belum ada; G3 tetap terbuka | Finance |
| O14 | 1–2 Agu revenue 809,0 jt dengan GP 19,8% (di luar pola) | ditandai anomali, tidak diubah | Finance |

Q1–Q78 di `docs/v4/QUESTIONS.md` tetap berlaku kecuali Q17 (O7), Q26 (diselesaikan §4.7), Q47 (§4.3), Q63 (§4.1).

---

## 12. Instruksi handoff untuk Claude Code

1. **Lingkungan**: PostgreSQL lokal dengan `supabase/tests/supabase_shim.sql` atau salinan latihan KGR-OS. Tidak ada SQL ke `pczjhmzpkknzkziipvit` production; migrasi diterapkan manusia setelah irisan diterima. Node ≥ 20, pnpm 10.28.0.
2. **Langkah pertama**: simpan dokumen ini sebagai `docs/PRD-v5.md`; tambahkan di atas `docs/PRD-v4.md`: "Digantikan oleh docs/PRD-v5.md sejak 16 Okt 2026; lihat §1.3 untuk pasal yang dicabut. Pasal lain tetap berlaku sebagai rujukan v4 §x." Ekspor 6 artboard mockup ke `reference/design/v5/` (HTML apa adanya + screenshot 1366×768 per layar). Commit sebelum menyentuh kode.
3. **Larangan**: semua larangan v4 §11.4; tambah: memakai angka bertanda *ilustrasi mockup* (Lampiran D) sebagai seed atau golden; memfinalkan O1–O14; membuat rekomendasi beli/tunda live bird di UI (K25).
4. **SheetJS**: tambahkan `xlsx` (0.18.5, build mini) sebagai dependency web; bila lockfile tidak bisa diubah di lingkungan Claude Code (seperti Q23 v4), catat di QUESTIONS dan pakai jalur tempel TSV + CSV dulu.
5. **Format PR**: judul `v5/<irisan>: <isi>`; tabel requirement (K/§/C) → bukti; screenshot banding vs mockup; `pnpm snapshot:diff`; daftar O yang disentuh dan default yang dipakai.

---

## Lampiran A — Sumber

| Sumber | Dipakai untuk |
|---|---|
| Mockup "KGR Management View v2" v21 (6 artboard) | Bab 6, Lampiran B, D |
| `fixtures/week-2026-08-24` (`gl_lines.json`, `sales_lines.json`, `item_map.json`, `batches.json`) | B.2 actual per minggu, B.3 demand per ukuran, master item 125 kode |
| `fixtures/plan-2026-08-24/inputs.json` | yield placeholder (karkas 0,714599), kelas STD 2,0 kg |
| `fixtures/month-2026-08/golden-v4.json` | actual/forecast/outlook Agustus engine |
| `fixtures/fs-2026-09/inputs.json` | gaji, penyusutan, bunga Juni–Sep (beban tetap estimasi dan FINAL) |
| `fixtures/accuracy-2026-08` | FINAL Agustus revenue 8.361,8; GP 306,7; NIBT −26,5 |
| `docs/PRD-v4.md`, `docs/v4/QUESTIONS.md`, `docs/v4/irisan-0..5.md` | basis, keputusan yang dipertahankan, Q yang diselesaikan |
| Percakapan desain 15–16 Okt 2026 | K19–K37 |

## Lampiran B — Angka acuan

### B.1 Simulasi live bird (§4.1, K25)

Basis kebutuhan PO: 18.358 kg LB; nilai jual pada harga list = 486,7 jt (karkas fresh 12.307 kg × 36.705; karkas n/a 811 × 30.000; HJA 997 × 4.515; usus 776 × 1.500; kepala 832 × 4.029; ceker 524 × 3.101). Tarif angkut+maklon 2.552/kg LB.

| Harga LB | COGS rencana | GP rencana | k (COGS ÷ nilai) | Breakeven LB |
|---|---|---|---|---|
| 22.000 | 450,7 | 36,0 | 0,926 | 23.960 |
| 23.000 | 469,1 | 17,6 | 0,964 | 23.960 |
| 24.600 | 498,5 | −11,8 | 1,024 | 23.960 |
| 25.000 | 505,8 | −19,1 | 1,039 | 23.960 |

COGS/kg karkas fresh di 24.600 = 1,0242 × 36.705 = 37.592. Basis batch rencana 27.219 kg LB (19.475 kg karkas frozen surplus × 31.658 + 17,1 jt lain = 633,6 jt): di 24.600 COGS 739,1, GP −105,4 (blok 2 v1: −105,5), breakeven 20.727.

### B.2 Laba rugi Agustus (§4.7, K29–K30)

Actual dihitung ulang dari `gl_lines.json` (cocok dengan engine: 6.385,9 / −6.038,5 / −182,2 / 165,2). Forecast 27–31 dari engine (PO 1.067,8 + run-rate 31 Agu 310,4). Beban tetap estimasi = Juli FINAL: gaji 52,2 + penyusutan 10,4 + bunga 24,4 = 87,0 jt/bulan, 2,806 jt/hari kalender.

**Actual vs run-rate (Rp jt)**

| Baris | Actual 1–26 | PO + run-rate 27–31 | Outlook |
|---|---|---|---|
| Revenue | 6.385,9 | 1.378,2 | 7.764,1 |
| COGS | −6.038,5 | −1.429,2 | −7.467,7 |
| Gross profit | 347,4 | −51,0 | 296,4 |
| Beban operasi (jurnal) | −182,2 | −35,0 | −217,2 |
| NIBT menurut jurnal | 165,3 | −86,1 | 79,2 |
| Beban tetap belum dijurnal | −73,0 | −14,0 | −87,0 |
| NIBT setelah beban tetap | 92,3 | −100,1 | −7,8 |

Pembulatan: actual NIBT 165,25 tampil 165,3 (engine 165,2); toleransi ±0,1.

**Per minggu (Rp jt)**

| Baris | 1–2 | 3–9 | 10–16 | 17–23 | 24–30 (act + PO) | 31 (run-rate) | Agustus |
|---|---|---|---|---|---|---|---|
| Revenue | 809,0 | 1.278,9 | 2.136,7 | 1.572,3 | 1.656,8 | 310,4 | 7.764,1 |
| COGS | −649,1 | −1.276,0 | −1.948,3 | −1.576,5 | −1.724,3 | −293,5 | −7.467,7 |
| GP | 159,9 | 2,9 | 188,4 | −4,2 | −67,5 | 16,9 | 296,4 |
| Beban operasi | −2,0 | −27,8 | −35,0 | −106,8 | −38,5 | −7,0 | −217,2 |
| NIBT jurnal | 157,9 | −24,9 | 153,3 | −111,0 | −106,0 | 9,9 | 79,2 |
| Beban tetap | −5,6 | −19,6 | −19,6 | −19,6 | −19,6 | −2,8 | −87,0 |
| NIBT setelah beban tetap | 152,3 | −44,6 | 133,7 | −130,6 | −125,7 | 7,1 | −7,8 |

GP per hari 27–30 Agu yang dipakai seri kumulatif (−7,6 / −0,4 / −56,1 / −3,8) adalah pembagian per hari dari proyeksi mingguan mockup, **bukan keluaran engine**; engine wajib menghasilkannya sendiri (K31) dan totalnya harus −67,9.

Pembanding FINAL Agustus: gaji 85,6, penyusutan 10,4, bunga 31,9 (total 127,9); NIBT −26,5. Estimasi dari Juli menutup 87,0 dari 127,9.

### B.3 Demand per ukuran → kelas (§4.2)

PO kirim 27–29 Agu, `RPA|Karkas|Fresh` + `RPA|Karkas|n/a`, yield karkas placeholder 71,46% semua kelas; kelas K/S/B ilustrasi.

| Ukuran | PO kg | Kelas | kg LB/ekor | kg LB | Ekor |
|---|---|---|---|---|---|
| Uk 0.9 | 58 | K | 1,33 | 81 | 61 |
| Uk 1.0 | 1.763 | K | 1,47 | 2.467 | 1.679 |
| Uk 1.2 | 1.246 | S | 1,75 | 1.744 | 997 |
| Uk 1.3 | 4.622 | S | 1,89 | 6.468 | 3.424 |
| Uk 1.4 | 3.664 | B | 2,03 | 5.128 | 2.527 |
| Uk 1.5 | 954 | B | 2,17 | 1.335 | 616 |
| tanpa ukuran | 811 | STD | 2,00 | 1.135 | 568 |
| **Total** | **13.118** | | 1,86 | **18.358** | **9.871** |

Per kelas: K 2.548 kg LB / 1.740 ekor; S 8.212 / 4.420; B 6.463 / 3.143; STD 1.135 / 568. Kekurangan by-product tidak berubah dari v4 B.3 (HJA 1.022, usus 897, kepala 842, ceker 548 kg) karena kg LB sama.

### B.4 Rencana harian per kelas

| Potong | Kirim | kg karkas | kg LB | Ekor | K / S / B (ekor) |
|---|---|---|---|---|---|
| Rab 26 | Kam 27 | 5.332 | 7.461 | 3.870 | 0 / 2.081 / 1.221 + 568 tanpa ukuran |
| Kam 27 | Jum 28 | 3.333 | 4.664 | 2.536 | 646 / 1.040 / 851 |
| Jum 28 | Sab 29 | 4.454 | 6.233 | 3.465 | 1.094 / 1.300 / 1.071 |

Kebutuhan kg LB per kelas untuk potong Jum 28: K 1.599, S 2.456, B 2.178.

### B.5 Upload contoh (§4.9)

| File | Baris | Lolos | Cek yang gagal / peringatan |
|---|---|---|---|
| PO (7 baris) | 7 | 4 | kode X-999 tidak dikenal; JLB1857 (Ayam Karkas Mix) tanpa ukuran; tanggal kirim 26 Agu lewat; harga kosong; 5 baris di bawah lantai → approval (karkas fresh 36.705 < biaya 37.400; BLP Frozen 43.086 < 47.199) |
| WP potong batch B260826 (8 baris) | 8 | 6 | X-HATI dan KPL-01 tidak dikenal; kg LB 7.512 / 3.902 ekor = 1,93 kg/ekor (kelas S); Σ SKU 6.782,8 vs 7.286,6 kg (LB − susut 3%) selisih 6,9% → perlu penjelasan; yield karkas 73,4% lolos |
| Yield per kelas (18 baris) | 18 | 0 | K, S, B belum terdaftar (C51); Σ per kelas 89,2% / 89,9% / 90,4%; yield karkas 70,2 / 71,5 / 72,4% |

Kode item contoh nyata dari `item_map.json` (JLB0829 Karkas Uk 1.3 Fresh Grade A, JLB0922 Uk 1.4 Fresh Premium, JLB0763 Uk 1.2 Fresh Grade A, TRD0010 BLP Frozen, JLB1857 Ayam Karkas Mix, JLB0078 Ceker, JLB0135 Usus Kotor). Isi kg dan harga adalah ilustrasi.

## Lampiran C — Commercial minggu contoh

Stok bebas 126.434 kg / 3.233,3 jt / 26 SKU; fresh 17.152 kg / 298,0 jt; 12 SKU di bawah biaya, rugi pada harga acuan −144,2 jt; rugi simpan 2,9 jt/hari. Karkas fresh berumur 6,9 hari (lewat 48 jam). Ceker fresh biaya 15.996 vs harga 3.101; Kepala fresh 13.368 vs 4.029 (C54).

## Lampiran D — Mockup: ilustrasi dan perbedaan yang diketahui

**Angka ilustrasi (tidak boleh jadi seed/golden)**: isi baris WP dan yield per kelas di layar Input; tarif overhead 1.850 → 2.010; kapasitas 4.200 ekor/hari; supply LB kelas S 2.400 / B 2.200; rentang kelas K/S/B; kunci default ukuran pelanggan; batas approval 5% / Rp 5 jt; tabel batch aktual vs rencana (24.301 kg LB, susut 6,3%, yield 73,8%); GP per hari 27–30 Agu di grafik kumulatif.

**Perbedaan mockup vs PRD**:
1. Cek WP di mockup memakai toleransi 3%; PRD memakai C22 2% (O6).
2. Layar Input Finance menulis "Sebelum rilis Jum 28 Agu"; PRD memakai Kamis (O10).
3. Mockup Input belum punya role Inventory Accounting, Purchasing, Kepala Sales, Direktur Operasional (§6.4 mewajibkan).
4. Mockup Manajemen "Lihat sebagai" menautkan semua layar untuk semua orang; PRD membatasi per role (K37).
5. Halaman Outlook bulan dan Kas belum punya "Lihat sebagai".
6. Tombol Simpan di Input hanya menampilkan pesan; PRD mewajibkan validasi ulang server dan fingerprint (K34).
