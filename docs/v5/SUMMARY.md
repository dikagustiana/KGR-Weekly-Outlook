# PRD v5 — ringkasan pengiriman (irisan v5/0 sampai v5/6)

Semua irisan Bab 10 sudah dibangun, satu PR per irisan. Semua flag `v5_*` mati secara default; selama mati layar v4 tetap bekerja, `computeWeek` tidak disentuh, parity 17.161/17.161 dan snapshot v1 byte-identik di setiap commit. Tidak ada SQL yang dijalankan ke KGR-OS (`pczjhmzpkknzkziipvit`); perintah di bawah dijalankan manusia.

**Diamendemen oleh `docs/PRD-v5.1.md` (17 Okt 2026).** Review kode v5 menemukan bahwa putaran mingguan belum berjalan di database sungguhan dengan role selain Admin. Klaim gate dan journey di bawah sudah diturunkan (bagian "Status gate dan journey"); yang belum terpenuhi tercatat di bagian "Belum terpenuhi".

## PR

| Irisan | PR | Status | Isi |
|---|---|---|---|
| v5/0 foundation | [#24](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/24) | di-merge ke `main` | PRD v5, mockup ke `reference/design/v5/`, migrasi §5 (tabel/kolom kosong, kelas K/S/B tanpa angka, role `operations_director`, registry tugas, flag mati) |
| v5/1 costing | [#25](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/25) | di-merge ke `main` | biaya rencana/estimasi/sementara/final, `simulateLivebird`, revaluasi K22, biaya idle, C53/C54/C57, Commercial membaca biaya + status, label K25 |
| v5/2 pl | [#26](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/26) | di-merge ke `main` | beban tetap K29, laba rugi dua tampilan K30, kumulatif lima ukuran K31, C55 |
| v5/3 ppic-class | [#27](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/27) | di-merge ke `main` | ukuran PO → kelas → kg LB (K28), rencana harian per kelas, layar PPIC v5, C50/C51/C58 |
| v5/4 commercial-loop | [#28](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/28) | di-merge ke `main` | komitmen + kunci Jumat (K26), price list mingguan (K24), jawaban surplus, layar Commercial v5, C52 |
| v5/5 input | [#29](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/29) | di-merge ke `main` | `upload-validate.ts` bersama browser/server, layar Input semua role, template/tempel/simpan sebagian/fingerprint, grid kelengkapan, K35 di `release_week` |
| v5/6 management | [#30](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/30) | di-merge ke `main` | Manajemen v5: simulasi LB untuk Direktur Operasional + keputusan, perlu keputusan + status putaran, label sumber K36, "Lihat sebagai" K37 |

PR #27–#30 bertumpuk dan sudah di-merge berurutan #27 → #28 → #29 → #30.

## Migrasi untuk KGR-OS (urutan)

Status KGR-OS: diterapkan 16/10/2026 oleh pemilik dengan file sekaligus di SQL Editor; tabel cek akhir 11 baris `true` (sebelumnya: v3 lengkap, ke-10 migrasi v4 + v5 belum ada). Untuk database lain, dua cara dengan hasil yang sama:

- **Sekaligus**: `docs/v5/kgr-os-migrasi-v4-v5-sekaligus.sql` di SQL Editor, satu kali Run. Isinya 10 file `20261017000100` sampai `20261023000100` disambung urut nama tanpa diubah (sha256 tiap file di kepala), ditambah cek prasyarat v3 di awal dan tabel cek 11 baris di akhir (semua `true`). Satu Run = satu transaksi: error di mana pun membatalkan semuanya. Diuji di salinan latihan KGR-OS sebagai satu query: skema identik dengan penerapan per file (`pg_dump -s`), isi seed sama (tanpa id/cap waktu), Run kedua tetap lolos, error yang disisipkan di file ke-8 membatalkan semuanya, database tanpa v3 ditolak sebelum apa pun berubah.
- **Satu per satu**: migrasi v4 (`20261017*` sampai `20261020*`) urut nama, lalu file v5 di bawah, di SQL Editor atau psql (`PGCLIENTENCODING=UTF8`):

| Urutan | File | Irisan | Cek |
|---|---|---|---|
| 1 | `supabase/migrations/20261021000100_v5_foundation.sql` | v5/0 | `select count(*) from public.app_setting where key like 'v5\_%';` → 6 |
| 2 | `supabase/migrations/20261022000100_v5_costing.sql` | v5/1 | `select count(*) from pg_views where viewname = 'commercial_daily_sales_v5';` → 1 |
| 3 | `supabase/migrations/20261023000100_v5_input.sql` | v5/5 | `select count(*) from public.input_task_rule;` → 14; `select allowed_roles from public.release_override_policy where code = 'K35';` → `{finance}` |

v5/2, v5/3, v5/4 dan v5/6 tanpa migrasi. Semua migrasi hanya menambah dan bisa dijalankan ulang; sudah diterapkan dua kali pada salinan latihan KGR-OS dan diuji `test:rls` (22 blok) di PostgreSQL lokal.

### v5.1 dan v5.2 (diterapkan 18 Okt 2026)

Diterapkan agen atas delegasi Dika lewat connector Supabase, tanpa staging (keputusan Dika 18 Okt), masing-masing sesudah backup
dalam DB (`bak_<UTC>`), satu panggilan atomik, tabel cek semua `true`, lalu sidik skema dibandingkan dengan PG16 lokal yang memuat
migrasi yang sama (9/9 identik). Log: `docs/v5.2/kgr-os-log.md`.

| Urutan | Bundel | Migrasi | `schema_version()` | Cek |
|---|---|---|---|---|
| 1 | `docs/v5.1/kgr-os-migrasi-v51.sql` | v5.1 | — | 12/12 |
| 2 | `docs/v5.2/kgr-os-migrasi-v52-b2.sql` | `20261025000100`…`0300` | 5.2.2 | 24/24 |
| 3 | `docs/v5.2/kgr-os-migrasi-v52-b5.sql` | `20261025000400`, `0500` | 5.2.4 | 26/26 |
| 4 | `docs/v5.2/kgr-os-migrasi-v52-b6.sql` | `20261025000600` (sesudah kode A1c di production) | 5.2.5 | 15/15 |
| 5 | `docs/v5.2/kgr-os-migrasi-v52-b7.sql` | `20261025000700` | 5.2.6 | 16/16 |

Kirim lewat connector Supabase: jangan ada escape `\uXXXX` di teks (transport mengubahnya menjadi karakter asli; bangun backslash
dengan `chr(92)`). Lewat `psql` (workflow `db-ops`) masalah ini tidak ada.

## Flag (urutan menghidupkan)

Prasyarat v4: `v4_design`, `m1_costing`, `m2_ledger`, `m3_planning`, `m4_monthly`, `m6_cash`, `m7_commercial` (dan `m7_approval` untuk C38). Lalu, satu per satu, masing-masing diikuti Admin → Modul → "Bangun ulang data mart" untuk periode berjalan:

1. `v5_costing` — biaya + status di ledger, Commercial, P&L. Sejak PRD v5.1 R40, tanggal mulai **wajib** diisi di Admin → Modul (kolom "mulai", `{"enabled": true, "since": "YYYY-MM-DD"}`). Tanpa tanggal itu revaluasi lot K22 tidak berjalan, dan halaman Costing menyebutnya.
2. `v5_pl` — beban tetap dan laba rugi dua tampilan (Finance mengisi jadwal beban tetap bulan berjalan dulu).
3. `v5_ppic_class` — setelah PPIC mengisi rentang/rata-rata K/S/B, peta ukuran → kelas, yield per kelas; Purchasing supply per kelas.
4. `v5_commercial` — setelah `sales_assignment` lengkap.
5. `v5_input` — lalu "Perbarui status tugas" atau rebuild 7 hari terakhir supaya tugas dan grid terisi.
6. `v5_management` — terakhir (membaca semua di atas).

Flag bisa dihidupkan per role lebih dulu (`{"enabled": true, "roles": ["admin"]}`) untuk uji di production.

**K53 (PRD v5.1): `roles` membatasi layar, bukan mart.** Builder menulis kolom v5 bila flag `enabled` secara global. Pembaca mart (Commercial, Manajemen, P&L) memakai kolom v5 hanya bila flag aktif untuk role yang membuka layar (`isModuleOn(flag, viewer.role)`). View `commercial_daily_sales_v5` menyembunyikan `cost_per_kg` bila `parameter.sales_sees_cost = false`. Di `67c7f03` aturan ini belum ditegakkan seluruhnya; view dibenahi di v5.1 irisan 1 (R8), pembaca di irisan 4 (R28: `commercialMart(…, v5)` per role, K25 dari `k25On`). Baris v5 di `pl_daily_v4` adalah baris laba rugi perusahaan, bukan kolom, dan tidak disaring per role (Q-v5.1-23).

## Lampiran B dan C

| Acuan | Hasil | Tempat |
|---|---|---|
| B.1 simulasi live bird | direproduksi (±0,1 jt, ±2 Rp/kg; breakeven 23.961 vs 23.960, GP −11,7 vs −11,8, batch COGS 739,0 vs 739,1 — Q-v5-9) | `packages/engine/test/costing-v5.test.ts`, `fixtures/costing-sim-2026-08-24`, tile Manajemen |
| B.2 laba rugi Agustus | direproduksi (±0,1 jt; mingguan 19,7 vs 19,6 dan −125,6 vs −125,7 dari pembulatan, Q-v5-19); total outlook revenue 7.764,1, GP 296,4, NIBT 79,2, NIBT setelah beban tetap −7,8 | `packages/engine/test/pl-v5.test.ts`, `fixtures/pl-2026-08` (golden §9.2, ditambahkan di v5/6) |
| B.3 demand per ukuran → kelas | direproduksi dengan peta ukuran ilustrasi sebagai input tes berlabel (`placeholder: true`, Q-v5-29) | `packages/engine/test/ppic-class.test.ts`, `fixtures/plan-2026-08-24` blok `v5` |
| B.4 rencana harian per kelas | direproduksi (S 4.421 vs 4.420 ekor dari pembulatan, Q-v5-30) | idem |
| B.5 upload contoh | direproduksi: PO 7 → 4, WP 8 → 6 (Σ 6.782,8 vs 7.286,6, 6,9%, yield 73,4%), yield 18 → 0; "kelas S" hanya dengan rentang ilustrasi (golden: STD, Q-v5-41) | `fixtures/upload-samples`, `apps/web/lib/v5/upload-samples.test.ts` |
| C Commercial minggu contoh | tidak direproduksi dari fixture: angkanya dari mart KGR-OS `ebe4ad8`, bukan dari fixture minggu contoh (Q-v5-39); rumus diuji dengan baris Lampiran C | `packages/engine/test/commercial-v5.test.ts` |

Tidak ada tes v5 yang ditandai `todo` karena angka gagal direproduksi. Satu `todo` engine berasal dari v3: MA vs HPP ≥ 95% baris (fixture 88,2%), menunggu pengecualian tertulis Finance (O13, Q69 v4).

Golden §9.2: `plan-2026-08-24` blok v5 (v5/3), `pl-2026-08` (v5/6), `costing-sim-2026-08-24` (v5/1), `upload-samples` (v5/5).

## Default O1–O14 yang dipakai

| # | Default | Di mana |
|---|---|---|
| O1 | `cogs_line` | `parameter.revaluation_sold_mode` |
| O2 | satu harga LB semua kelas | `lb_price_decision.weight_class` null; keputusan dari Manajemen tanpa kelas |
| O3 | Uk 1.3 = 1,30–1,39 kg/ekor, titik tengah +0,05 | `SIZE_MID_OFFSET` |
| O4 | ukuran kolom terpisah `size_kg` | `item_map`, `sales_line`; kolom `ukuran` di template PO |
| O5 | K/S/B tanpa angka sampai diisi PPIC | seed `weight_class`; "terdaftar" = punya angka |
| O6 | C22 2%, susut 3%, yield karkas 68–76% | cek WP dan yield (`parameter`) |
| O7 | stok di atas umur per lot | kartu Manajemen (v4) |
| O8 | persetujuan parameter > 5% atau > Rp 5 jt per minggu | ditampilkan di Input; alur usulan belum dibangun (Q-v5-45) |
| O9 | grafik harian tanpa pilihan ukuran | Outlook bulan |
| O10 | rilis Kamis | `input_task_rule.release_week` |
| O11 | lantai by-product fresh tampil dengan C54 | Commercial |
| O12 | kunci service role di env server Vercel (manusia) | rebuild mart |
| O13 | belum ada pengecualian MA vs HPP; G3 terbuka | — |
| O14 | 1–2 Agu ditandai anomali | P&L per minggu |

Detail dan pertanyaan implementasi Q-v5-1 sampai Q-v5-53: `docs/v5/QUESTIONS.md`.

## Yang harus diisi atau diputuskan manusia

| Siapa | Apa |
|---|---|
| PPIC | rentang dan rata-rata kg LB kelas K/S/B; yield karkas dan by-product per kelas (upload yield di Input); peta ukuran → kelas (`size_class_map`); kapasitas harian |
| PPIC + Sales | arti "Uk x.x" (O3: 1,30–1,39 dengan titik tengah 1,35?) |
| Finance | jadwal beban tetap Agustus–Desember (gaji, penyusutan, bunga; template 8.3 atau upload `fixed_cost` di Input); budget; register asumsi |
| Direktur Operasional | harga LB per kelas atau satu harga (O2); keputusan harian di Manajemen atau Input |
| Kepala Sales / Admin | assignment pelanggan dan SKU per Sales (`sales_assignment`) |
| Pemilik produk | kunci service role untuk rebuild di env server Vercel (Q2 v4, O12); jadwal harian (cron) untuk memperbarui tugas (Q-v5-46); menaikkan `xlsx` web ke 0.20.3 saat cdn.sheetjs.com terjangkau (Q-v5-42) |
| Finance | pengecualian tertulis MA vs HPP 88,2% (Q69 v4, O13) |
| Admin | user dan password untuk role baru: Direktur Operasional (`operations_director`), Kepala Sales (`commercial_lead`) dan Cost Accounting bila belum ada — dibuat di Admin → Pengguna, tidak di repo |
| Pemilik produk | merge PR #27–#30, menerapkan migrasi di KGR-OS, menghidupkan flag |
| Pemilik produk (v5.1) | sign-off dan merge PR v5.1 berurutan (#33 → #34 → #35 → irisan 4); menjalankan `docs/v5.1/kgr-os-migrasi-v51.sql` di KGR-OS sesudah sign-off irisan 1 |
| Pemilik produk (v5.1 R40) | Vercel Production berisi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` sebelum irisan 4 di-merge (fail-fast) |
| Admin (v5.1 R40) | Admin → Modul → `v5_costing` → "mulai" = tanggal pertama v5 costing berjalan |
| Pemilik produk (v5.1) | navigasi Finance 8 item (Input dan Upload) vs batas 7 v4 §5.4 (Q-v5.1-25); O15–O20 |

## Status gate dan journey (koreksi PRD v5.1)

Klaim di `docs/v5/irisan-<n>.md` tidak diubah (riwayat), tetapi statusnya diturunkan sebagai berikut. Statusnya baru naik bila sudah diuji di PostgREST sungguhan dengan role sebenarnya (PRD v5.1 Bab 5).

| Gate / journey | Klaim di dokumen irisan | Status |
|---|---|---|
| G13 / journey L (putaran satu minggu) | irisan-4, irisan-6 | v5.1 irisan 3: langkah Commercial ↔ PPIC lulus di PostgREST lokal dengan lead@t, sales@t, ppic@t, finance@t (`docs/v5.1/journey-L.md`); satu putaran utuh berurutan belum dijalankan (T7 sebagian) |
| journey K (Manajemen) | irisan-6, termasuk "terbaca tanpa scroll" | v5.1 irisan 4: PostgREST lokal, mgmt@t: headline, 5 kartu, laba rugi dengan NIBT setelah beban tetap, 0 tombol tulis; "Perlu keputusan" di y = 835 px pada 768 px (dicatat, tanpa klaim, O17) |
| journey M (Direktur Operasional, harga LB) | irisan-6 | v5.1 irisan 4: PostgREST lokal, opsdir@t: simulasi berubah per harga, keputusan tersimpan, batch 28/08 memakai harga keputusan (costacc@t); C57 tetap menahan salin batch karena 27/08 belum diputuskan |
| journey N (Sales, PO) | irisan-5 | v5.1 irisan 4: PostgREST lokal, sales@t: tanpa ukuran → STD (O15 warn), di bawah lantai → approval, baris lolos tersimpan, demand PPIC berubah (ppic@t) |
| journey O (Cost Accounting, WP) | irisan-5 | v5.1 irisan 2 dan 4: PostgREST lokal, costacc@t: kg LB tidak konsisten ditahan (R34); kode tak dikenal + selisih hasil potong → dua baris ditahan, alasan, lot estimasi → sementara, Commercial (lead@t) biaya baru |
| journey P (Finance, kelengkapan dan rilis) | irisan-5 | v5.1 irisan 1: PostgREST lokal, finance@t + ppic@t (T8, `docs/v5.1/journey-P.md`) |

### PRD v5.1 T7–T12

| T | Status (lingkungan, role) |
|---|---|
| T7 putaran dengan role sebenarnya | diturunkan (PRD v5.2-A §1.3): lulus per langkah di PostgreSQL lokal + shim; belum satu putaran; belum Supabase |
| T8 rilis K35/K45 | diturunkan (PRD v5.2-A §1.3): lulus per langkah di PostgreSQL lokal + shim; belum satu putaran; belum Supabase |
| T9 tidak ada 0 untuk missing | lulus: tes unit per kasus (allocateBatch, plTable, kartu Kas, Outlook bulan); PostgREST lokal finance@t (Outlook bulan "Kas belum diisi") |
| T10 error tidak ditelan | lulus: lint K41 = 0; PostgREST lokal finance@t (tile kas state error saat select dicabut, irisan 2) |
| T11 kombinasi flag | diturunkan (PRD v5.2-A §1.3): lulus per langkah di PostgreSQL lokal + shim; belum satu putaran; belum Supabase (matriks hanya 3 role, A-UI-18) |
| T12 engine dan snapshot | lulus: parity 17161/17161, snapshot:diff EMPTY, golden v1 dan B.1–B.5 tetap; golden yang berubah hanya `upload-samples` PO (O15, CHANGELOG [v5.1-4]) |

Uji PR #31 (`docs/v5/perbaikan-produksi.md`) memakai PostgREST lokal, tetapi hanya dengan role Admin dan hanya membuka halaman; journey di atas tidak dijalankan.

## Default O15–O20 yang dipakai (PRD v5.1 Bab 6, belum difinalkan)

| # | Default yang berjalan |
|---|---|
| O15 | `parameter.po_unsized_mode = 'warn'`: karkas tanpa ukuran tersimpan STD dengan catatan C50; `'fail'` menahan baris |
| O16 | stok bebas Commercial tidak dikurangi komitmen terkunci (menyimpang dari §4.6) |
| O17 | tata letak Manajemen tidak diubah; posisi "Perlu keputusan" hanya dicatat |
| O18 | grid tetap `minmax(76px, auto)`; grafik mengisi tinggi tile (R40) |
| O19 | "Beban tetap belum dijurnal" tetap kumulatif per bulan |
| O20 | supply tanpa kelas diabaikan C58 (belum disebut "n kg tanpa kelas" di detail C58; §3.11) |

## Belum terpenuhi (PRD v5.1 §3.11)

Menunggu keputusan pemilik (PRD v5.1 Bab 6). Statusnya **belum terpenuhi**, bukan default:

- tata letak journey K, "Perlu keputusan" di bawah fold 1366×768 (O17);
- grid `minmax(76px, auto)` vs v4 §5.3 "baris 76px" (O18);
- stok bebas Commercial dikurangi komitmen terkunci minggu depan, §4.6 (O16);
- "Beban tetap belum dijurnal" positif di minggu posting (O19);
- C58 untuk supply tanpa kelas (O20);
- K27 pola potong dan fresh/frozen per SKU;
- tile §6.1 baris 16–18 dan 30–33 (tren revenue/GP per minggu, demand per kelas);
- form parameter O8;
- bacaan parsial §8 (Q-v5-49);
- cron harian (Q-v5-46);
- COGS forecast dari `planCost` (Q-v5-25).

## Belum terpenuhi v5.2 (PRD v5.2-A §3.7)

Dicatat sebagai "belum terpenuhi" untuk v5.2-A; tidak dikerjakan di irisan A0–A6:

- K27 pola potong dan fresh/frozen per SKU (tahap 2; O33, ⛓ B-R85);
- tren revenue/GP per minggu dan tile demand per kelas §6.1;
- form parameter O8;
- bacaan parsial §8 (Q-v5-49);
- editor `size_class_map`;
- grafik utang afiliasi vs ekuitas dan neraca ringkas §4.8;
- tugas jawab surplus dan konsumsinya;
- O17 (tata letak K) dan O18 (grid).

## Bukti per irisan

`docs/v5/irisan-<n>.md` (requirement → bukti, gate, RLS, latihan migrasi, perintah manusia) dan `docs/v5/bukti/`.

### PRD v5.2-A T13–T18 (irisan A5: bukti dari repo dan CI, K64)

Lingkungan semua bukti di bawah: **PG16 lokal + PostgREST 12 + mock auth** (bukan Supabase), `next start` dan PostgreSQL di bawah faketime; job CI `e2e` (run 39105349767) dan `pnpm e2e` lokal. Rincian: `docs/v5.2/a5.md`.

| T | Status (lingkungan, role) |
|---|---|
| T13 gagal-tertutup | lulus di dasar main: lint K41/K42/missing = 0 dijalankan CI (job `lint`); tes injeksi error per modul ada di tes unit A1 |
| T14 T7 utuh di CI | lulus: `journey-T7` 49 cek, 0 respons 4xx/5xx tak terduga, rilis Finance tanpa override dengan `v4_release` hidup, angka batch hasil salin = rencana kelas tersimpan; PG16 lokal + shim + PostgREST 12 + mock auth + faketime; role sales, commercial_lead, ppic, operations_director, cost_accounting, inventory_accounting, purchasing, finance, management (Admin hanya untuk bangun ulang awal); belum Supabase (T19) |
| T15 dashboard = FS | belum di irisan A5 (A4: fixture dan halaman Rekonsiliasi); halaman Rekonsiliasi belum dibuka di matriks atau T7 |
| T16 putaran tanpa jalan buntu | sebagian: T7 mencakup kunci → tugas K35 hijau tanpa rebuild manual (R54), salin ditahan C57 lalu lulus, PO/WP/faktur/posting; belum: komitmen > PO, approval downgrade, C58 alasan sebagai langkah e2e; temuan Q-v5.2-50/52/53 di `docs/v5.2/a5.md` |
| T17 biaya jujur | lulus di A3 (tes unit); e2e: faktur tie tetap sementara sampai posting, lalu final (R60) |
| T18 engine dan snapshot tetap | lulus: parity 17161/17161, `snapshot:diff` EMPTY (di dasar main b408a9a + A5) |
| T11 (v5.1) kombinasi flag | 10 kombinasi × 10 role × 8 halaman, tabel tertulis, kolom biaya, API Sales: lulus di PG16 lokal + mock auth (120 cek); belum Supabase |
| F19 | rebuild cron dua kali identik (lulus); cron berbeda dari rebuild sesi (temuan Q-v5.2-51, XFAIL di F19 saat A5); ditutup di A1d: builder dan cron memakai klien dari pemanggil, F19 16 cek lulus tanpa XFAIL (`docs/v5.2/a1d.md`) |
