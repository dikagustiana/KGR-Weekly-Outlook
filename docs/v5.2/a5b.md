# Irisan A5b — celah bukti e2e R48, R69, R70 (PRD v5.2-A)

Branch `v5.2/a5b-e2e-gaps`, dasar `origin/main` 85f7684 (PR #60, A6). Tanpa PR, tanpa perubahan di `supabase/**`, tanpa koneksi ke Supabase atau Vercel mana pun, **tanpa perubahan kode aplikasi**
(`apps/**`, `packages/**`): semua yang ditambahkan ada di `tests/e2e/`, `README.md`, `.github/workflows/ci.yml` (nama langkah) dan dokumen ini. Rahasia dan data uji bersifat sintetis (repo publik).

**Lingkungan yang disebut di setiap bukti: "PG16 lokal + PostgREST 12 + mock auth"** (`pnpm e2e`: PostgreSQL 16 sendiri di port 54329 di bawah faketime, shim, semua migrasi, seed, PostgREST 12.2.3,
satu origin tiruan Supabase untuk auth dan storage, `next start`). Bukan Supabase (PRD v5.2-A §5.1); uji di Supabase sungguhan adalah T19/T20 di PRD B. Kata "lulus" di dokumen ini selalu
berarti di lingkungan itu, dengan role yang disebut. Tidak ada klaim untuk production atau KGR-OS.

Sumber celah: `docs/v5.2/status-r.md` baris R48, R69, R70 (cabang `claude/nice-gauss-tblqrt`) dan "Terbuka" di `docs/v5.2/a5.md`.

## Ringkasan

| R | Celah | Status | Bukti (log di `tests/e2e/out/`, juga di `docs/v5.2/bukti/a5b/`) |
|---|---|---|---|
| R48 | e2e T7 tidak membuka Rencana minggu komitmen | **selesai** | `T7.log` langkah 11 (58 cek lulus di T7); tangkapan layar `T7-11-ppic-rencana-minggu-komitmen.png` |
| R69 | tidak ada e2e "impor FS → C59 LULUS"; halaman belum dilihat di browser | **selesai** | `R69.log` (65 cek lulus, 5 SETUP); 6 tangkapan layar |
| R70 | `journey-{P,L,KMNO,O2,O5}` tidak ada sebagai berkas | **selesai untuk L4–L7, P8, O2, O5** (K, M, N lihat "Terbuka") | `L.log` 34 cek, `P.log` 16 cek, `O.log` 15 cek |

Hasil `pnpm e2e` penuh (mode CI: `E2E_STRICT_XFAIL=1`, `E2E_BUILD=never`, PG16 lokal + PostgREST 12 + mock auth, container ini, dua inti):

| Journey | Cek lulus | Gagal | XFAIL | XPASS | Respons app | Tak terduga | SETUP | Detik |
|---|---|---|---|---|---|---|---|---|
| prepare | 3 | 0 | 0 | 0 | 5 | 0 | 1 | 13 |
| matrix | 120 | 0 | 0 | 0 | 831 | 0 | 16 | 97 |
| **O** (baru) | 15 | 0 | 0 | 0 | 10 | 0 | 1 | 12 |
| T7 (+langkah 11) | 58 | 0 | 0 | 0 | 83 | 0 | 5 | 124 |
| A6 | 82 | 0 | 0 | 0 | 45 | 0 | 2 | 48 |
| **L** (baru) | 34 | 0 | 0 | 0 | 22 | 0 | 0 | 25 |
| **P** (baru) | 16 | 0 | 0 | 0 | 6 | 0 | 3 | 5 |
| **R69** (baru) | 65 | 0 | 0 | 0 | 65 | 0 | 5 | 43 |
| F19 | 16 | 0 | 0 | 0 | 5 | 0 | 3 | 16 |
| volume | 13 | 0 | 0 | 0 | 7 | 0 | 1 | 13 |

Seluruh langkah `pnpm e2e` (sesudah `pnpm e2e:build` 67 detik, urutan job CI): **436 detik** (7 menit 16 detik). Tambahan akibat irisan ini, dari selang waktu antar journey di `run.log` (termasuk pemulihan snapshot ±3 detik): O 15 detik,
T7 langkah 11 sekitar 15–20 detik, L 28, P 8, R69 45: **sekitar 115 detik, hampir 2 menit**; tanpa irisan ini langkah itu kira-kira 320 detik (jalan penuh kedua 450 detik, ketiga 436 detik). Di runner CI dua inti dengan batas 40 menit
dan langkah `e2e` yang di `a5.md` tercatat 3 menit 41 detik (sebelum A6), tambahan irisan ini diperkirakan 2 sampai 3 menit.

## 1. R48 — Rencana minggu komitmen (T7 langkah 11)

PRD R48: komitmen terkunci 300 kg > PO 100 kg → demand kelas berisi 200 kg tambahan, tanpa kueri `sales_line` untuk ID sintetis; "langkah e2e T7 membuka Rencana minggu komitmen".
Kode yang diuji: `apps/web/lib/v3/planning.ts:115,126` (`PoLine.synthetic`, `size_kg`; baris komitmen sintetis), `apps/web/lib/v5/ppic-data.ts:59,63` (`loadClassDemand`: hanya `!synthetic` ke kueri ukuran).

Langkah (`tests/e2e/journey-T7.cjs`: konstanta `NEXT_PO` baris 24, langkah 1c baris 109, langkah 11 baris 378; `tests/e2e/sql/next-week.sql`, `next-week-undo.sql`):

1. **SETUP** `next-week.sql`: baris minggu 2026-08-31 seperti hasil rollover Senin (`apps/web/lib/rollover.ts`: minggu, parameter, harga acuan, run-rate, TB) dan satu baris PO `KGR26.E2E06` (Selasa 1 Sep, karkas fresh 4.000 kg, salinan `KGR26.E2E01`).
   Alasan SETUP: rollover adalah langkah Admin (Admin → Minggu) dan aturan R70 melarang langkah Admin selain bangun ulang awal; tanpa baris minggu `/w/2026-08-31/rencana` adalah **404**
   (`apps/web/lib/page.ts:35–40` `weekContext`), dan PO minggu itu **ditahan** oleh unggahan Sales (`apps/web/lib/v5/input-save.ts:123`: "KGR26.E2E06: minggu 2026-09-01 belum ada"). Langkah 1c memuat PO itu dan membuktikan penahanannya (3 dari 6 baris lolos cek, 2 disimpan, 1 ditahan dengan alasan itu).
   PO tidak diunggah lewat app sesudah SETUP karena unggahan membangun ulang mart (`commercial_daily`, `pl_daily_v4`, `lot_balance_daily`, …) yang tidak bisa ditarik kembali tanpa memulihkan snapshot; percobaan itu diuji dan dibuang (lihat "Catatan jalannya").
2. Angka dari database, bukan dari halaman: komitmen terkunci `RPA|Karkas` minggu 31 Agu versi tertinggi = **15.000 kg fresh** (dikunci Kepala Sales di langkah 2); PO Confirmed karkas fresh minggu itu = **4.000 kg**;
   kg komitmen di atas PO = max(0, 15.000 − 4.000) = **11.000 kg**.
3. PPIC membuka `/w/2026-08-31/rencana`: HTTP 200 (bukan 404 atau 500). Tabel demand per ukuran: `Uk 1.4 fresh 4.000 | Tanpa ukuran 11.000 | Total 15.000` (baris komitmen tidak punya ukuran, jadi masuk "Tanpa ukuran"). Cek: kolom "PO kg" total = PO + kg di atas PO = 15.000 = angka database.
4. Selisih dengan dan tanpa komitmen: **SETUP** mematikan flag `v5_commercial` sementara (K26 menghitung komitmen hanya dengan flag itu): total demand = **4.000** (PO saja); selisih 15.000 − 4.000 = **11.000** = kg komitmen di atas PO dari database. Flag dihidupkan lagi.
5. **SETUP** `next-week-undo.sql` menghapus PO, baris minggu dan baris antrean yang ditulis pemicu. Cek: jumlah baris **92 tabel** di database (semua tabel `public` kecuali `audit_log`) sebelum dan sesudah langkah **sama**; tidak ada respons tak terduga.

Tidak ada langkah Admin. Sembilan role T7 tidak berubah; PPIC dan Sales dipakai di langkah ini.

## 2. R69 — rekonsiliasi app ↔ FS (journey `R69`)

PRD R69: loader membaca `fs_statement_line` dan `fs_line_map` (B-R86), halaman per bulan (app vs FS vs selisih + sebab), `finalizeMonthV4` menilai C59 dan GAGAL menahan FINAL kecuali override Finance, akses admin, finance, management.
Kode yang diuji: `apps/web/app/m/[month]/rekonsiliasi/page.tsx:23` (`REKONSILIASI_ROLES`), `apps/web/lib/v5/fs-recon-data.ts`, `apps/web/lib/v4/close.ts:86` (`finalC59`), `:93` (`finalMandatory`), `:105` (`loadRekonsiliasi`), `:118` (`finalizeMonthV4`), tabel kontrol FINAL di `app/m/[month]/tutup-buku/v4.tsx`.

`tests/e2e/journey-R69.cjs` (langkah 0 baris 96, R1 109, R2 132, R3 153, R4 180, R5 206, R6 228, R7 265, R8 311; `tests/e2e/sql/fs-app-lines.sql`) berjalan di database yang ditinggalkan T7 (Jum 28 Agu 16.50),
jam uji maju ke Selasa 1 Sep 2026 09.00 supaya Agustus sudah lewat (`finalizeMonthV4` menolak sebelum `today > last`).

### Fixture FS: turunan SQL, bukan angka yang diketik

`sql/fs-app-lines.sql` menurunkan angka app 15 baris pemetaan minimum langsung dari tabel (hanya baca): laba rugi = jurnal bulan per `coa_map.pl_line` (kredit − debit); neraca = `tb_opening` minggu terakhir yang mulai sebelum akhir bulan + jurnal sesudah tanggal TB sampai akhir bulan per `bs_line`;
ekuitas = Shareholder Equity + Retained earnings + laba tahun berjalan (semua akun LabaRugi). Tidak memakai kode app atau engine. Sebelum FS ada, halaman menampilkan angka app yang sama di tabel "Baris di luar pemetaan"; langkah R1 membandingkan kelimabelas angka itu dengan SQL **sampai sen**
(sama di semua baris), dan menyatakan dulu bahwa bulan itu tanpa DO unbilled dan tanpa baris v5 (halaman: "tidak ada baris Selisih costing atau Biaya kapasitas idle bulan ini"), dua hal yang dihitung app dan tidak ada di SQL.

| Baris FS | Baris app | Angka app dari SQL (Rp) |
|---|---|---:|
| PL b.12 Revenue | `revenue` | 6.385.876.039,00 |
| PL b.13 Cost of Sales | `cogs` | −6.040.472.784,16 |
| PL b.15 GROSS PROFIT | `gp` | 345.403.254,84 |
| PL b.37 TOTAL OPERATING EXPENSES | `opex` | −183.890.155,67 |
| PL b.49 TOTAL OTHER INCOME (EXPENSE) | `other` | 1.736.681,53 |
| PL b.51 INCOME (LOSS) BEFORE TAX | `nibt` | 163.249.780,70 |
| BS b.14 Cash and cash equivalents | `kas` | 1.289.251.345,68 |
| BS b.17 Trade Receivables - Third Parties | `piutang_pihak_ketiga` | 991.265.050,00 |
| BS b.18 Trade Receivables - Related Parties | `piutang_pihak_berelasi` | 0,00 |
| BS b.23 Inventory - Product | `persediaan_produk` | 1.568.104.888,56 |
| BS b.24 Inventory - Trading | `persediaan_trading` | 2.592.109.530,52 |
| BS b.47 Trade Payables - Third Parties | `utang_dagang_pihak_ketiga` | −420.329.749,60 |
| BS b.48 Trade Payables - Affiliates | `utang_dagang_afiliasi` | 0,00 |
| BS b.51 Other Payable - Related Parties | `utang_lain_afiliasi` | 5.600.000.000,00 |
| BS b.77 TOTAL EQUITY | `ekuitas` | 1.802.379.653,13 |

Angka ini milik database uji T7 (fixture jurnal 1–26 Agu + dua voucher kecil 27–28 Agu dari `week-complete.sql`); fixture FS di journey memakai **berkas dan SHA-256 sintetis** (`e2e-fs-agustus-2026-v1.xlsx`, SHA-256 dari baris-barisnya), bukan Management Report asli.
Angka itu **bukan** bukti bahwa app sama dengan FS sungguhan: tabel selisih fixture asli (data jurnal 27–31 Agu belum ada, ekuitas b.71 Rp 2,71) tetap di `docs/v5.2/fs-recon-fixture.md`, dan "LULUS pada data lengkap Agustus" di KGR-OS tetap T20.

### Langkah dan hasil (Finance kecuali dinyatakan lain)

| Langkah | Yang terjadi | Bukti |
|---|---|---|
| 0 | SETUP jam 1 Sep; login 10 role; awal: 0 baris FS, 15 baris `fs_line_map` draft (seed B5); kebijakan override C59 = `{finance}`; v4_release hidup; Agustus belum FINAL | `release_override_policy` dibaca dari database |
| R1 | tanpa FS: "C59 BELUM DIISI", "FS bulan ini belum diimpor", "C59 belum dinilai dan belum menahan FINAL"; 15 angka app di halaman = SQL sampai sen; Tutup buku: C59 tidak ada di daftar kontrol FINAL | tangkapan layar `R69-R1-tanpa-fs.png` (di `out/screens`) |
| R2 | SETUP: 15 baris FS versi 1 (terkunci) sementara pemetaan masih draft: "pemetaan belum disetujui Finance (15 baris masih draft)", C59 BELUM DIISI, tabel kosong, "FS acuan: versi 1, berkas …, SHA-256 efa2244af1a0…, 15 baris, dikunci 1 Sep"; Tutup buku tanpa C59 | |
| R3 | SETUP: `fs_line_map` 15 baris `agreed`. Halaman: **C59 LULUS · 15 sama, 0 beda, 0 belum ada angka dari 15 baris**; semua baris status "sama", selisih Rp 0,00; kolom app dan kolom FS = SQL di 15 baris; tanpa "Rincian C59". Tutup buku: C59 LULUS di kontrol FINAL, bukan penolakan | `R69-R3-c59-lulus.png`, `R69-R3-tutup-buku.png` |
| R4 | FINAL Agustus pada data T7 juga ditahan **enam kontrol di luar FS**: C22 GAGAL, C23 BELUM DIISI, C24 GAGAL (batch 125 belum dialokasikan), C35 dan C36 BELUM DIISI (kas harian tidak diunggah), C49 BELUM DIISI (tidak ada minggu dengan tanggal update 1 Sep). Itu data uji, bukan R69. Finance mencatat override **lewat layar** (panel override, alasan "R69 e2e: kontrol ini di luar cakupan rekonsiliasi FS; data uji T7 tidak memenuhinya", bukti `tests/e2e/journey-R69.cjs`) untuk keenamnya: 6 baris `release_override` oleh `finance`. Sesudahnya tidak ada penolakan dan tombol "Kunci FINAL" aktif, jadi FINAL bergantung pada C59 saja | `R69-R4-final-siap.png` |
| R5 | SETUP koreksi FS versi 2 (K70; baris baru, v1 terkunci): Revenue FS = app + **Rp 1,00** (batas toleransi O26): selisih −Rp 1,00, status "sama", C59 tetap LULUS, tombol aktif | |
| R6 | SETUP versi 3: Revenue + **Rp 2.500.000,00**, Total ekuitas + **Rp 2,71**. Halaman: **C59 GAGAL · 13 sama, 2 beda**; kedua baris "beda", sebab "selisih" (data lengkap, definisi sama), "Rincian C59" menyebut keduanya; catatan "Kunci FINAL ditahan sampai … override C59". Tutup buku: C59 GAGAL dengan rincian, **satu** penolakan "C59 GAGAL … override oleh finance", tombol nonaktif, alasan "ditolak: C59 GAGAL". Tombol dipaksa aktif lewat DOM: **aksi server menolak "FINAL ditolak: C59 GAGAL"**; database: FINAL Agustus tidak terkunci | `R69-R6-c59-gagal.png`, `R69-R6-tutup-buku-ditahan.png` |
| R7 | Finance mencatat override C59 lewat layar (alasan dan bukti; baris di database oleh `finance`, `created_role` finance). Tutup buku: C59 tetap GAGAL di tabel, tidak ada penolakan, tombol aktif. **Kunci FINAL: "FINAL dikunci (SHA …)"**; database: FINAL Agustus oleh finance, snapshot memuat C59 GAGAL. Halaman Rekonsiliasi sesudahnya: angka laba rugi dari FINAL yang sudah dikunci, C59 tetap GAGAL (13 sama, 2 beda), bagian "Override C59" menampilkan alasan, bukti, Finance. Tile akurasi Outlook bulan (SETUP satu V1 Agustus di samping FINAL supaya tile punya versi pembanding): baris "Rekonsiliasi ke FS (C59): GAGAL: 2 dari 15 baris beda" dengan tautan ke halaman | `R69-R7-final-terkunci.png`, `R69-R7-tile-akurasi.png` |
| R8 | Akses `/m/2026-08/rekonsiliasi` (10 role): admin, finance, management, operations_director **200**; sales, commercial_lead, ppic, cost_accounting, inventory_accounting, purchasing **404** (halaman tidak ada bagi role itu, K48). Database (JWT per role langsung ke PostgREST): finance, management, operations_director membaca baris FS dan 15 baris pemetaan; sales, ppic, cost_accounting 0 baris (RLS, HTTP 200). Override C59 oleh `cost_accounting` langsung ke PostgREST: **403** (RLS: hanya role di `release_override_policy`), tidak ada baris | |

Admin hanya **membuka halaman** di R8 (cek akses, seperti di matriks); tidak ada langkah alur oleh Admin.

Kebijakan override C59 (B5): `release_override_policy` C59 `allowed_roles = {finance}`, dibaca di langkah 0 dan ditegakkan di R8.

## 3. R70 — journey L, P, O

Semua tulis langsung ke tabel diberi label `setup` dan tercatat di log; tidak ada langkah Admin.

### Journey L — Commercial ↔ PPIC (L4–L7), `tests/e2e/journey-L.cjs`

Berjalan di database yang ditinggalkan T7 (komitmen 31 Agu terkunci v1 dan price list terkunci, rencana kelas minggu 24 Agu tersimpan dan disalin, minggu dirilis). **Tanpa SETUP**: semuanya lewat layar dan pembacaan database. L1–L3 = T7 langkah 1 dan 2 dan probe API Sales di matriks.

| Langkah (baris) | Role | Hasil |
|---|---|---|
| L4 (43) | commercial_lead | ubah komitmen terkunci tanpa alasan: ditolak "Tidak ada komitmen yang disimpan: Komitmen sudah dikunci: versi baru wajib alasan" (PostgREST 400 yang diharapkan, `tg_commitment_guard`), database tidak berubah. Dengan alasan "PO tambahan PT A": v2 draft 16.000 / 2.000 (v1 tetap terkunci). Kunci: v1 `superseded`, v2 `locked` oleh Kepala Sales. Price list terkunci tidak ditimpa (harga, harga frozen dari form, `locked_at` sama; Q-v5.1-8) |
| L5 (78) | sales | `fresh_0`, `frozen_0`, `price_0`, `price_frozen|RPA|Karkas` semua nonaktif berisi v2 (16.000 / 2.000 / 36.705 / 28.000), "terkunci v2", "Dikunci Kepala Sales.", tanpa tombol kunci (R15) |
| L6 (102) | commercial_lead, ppic | Kepala Sales menjawab baris surplus rencana (sebagian 300 kg @ 25.000): `surplus_response` `partial` oleh lead, `surplus_kg` = angka rencana, antrean rebuild 24/08 `done`. PPIC: "Jawaban surplus dijawab", "Komitmen minggu depan dikunci", "Price list minggu depan dikunci" |
| L7 (145) | finance | database: 31 hari Agustus di `cash_position_daily` semuanya `accounts = 0`, `total_closing = 0`, `cash_daily` 0 baris. `/m/2026-08`: "Kas belum diisi", "Bulan sampai ekuitas negatif tidak berlaku (laba)". `/kas`: "Saldo kas per 27 Agu 2026 belum diisi" (bukan Rp 0), sama untuk ekuitas (R20, R21) |

**Beda dari spesifikasi v5.1 dan sebabnya:**
- **L1/L5 "tile Dari PPIC: Tidak ditampilkan untuk Sales (data perencanaan)"** → v5.2: tile "Dari PPIC: surplus untuk SKU Anda · rencana v1" dari view `surplus_for_sales_v52` dan kalimat "Detail rencana (kelas, ekor, biaya, downgrade) tidak ditampilkan untuk Sales". Sebab: Sales tidak lagi membaca tabel rencana (A1c, B6/B7, **Q-v5.2-15**). Cek tambahan langsung ke PostgREST dengan JWT Sales: `plan_week` 0 baris, `surplus_for_sales_v52` terbaca.
- **L6 "surplus karkas ± 2.104 kg, jawaban sebagian 3.000 kg @ 31.000"** → baris yang bisa dijawab di v5.2 adalah Lemak 350,42 kg (jawaban sebagian 300 kg @ 25.000). Sebab: rencana tersimpan adalah rencana kelas dan batch hasil salin = rencana itu (R52), jadi daftar surplus rencana memuat bagian lain (Lemak 350,42 kg) dan karkas 0,09 kg; kunci jawaban datang dari baris rencana (R56). Lihat **Q-v5.2-112** untuk angka "Karkas surplus dari batch rencana ± 14.054 kg" di tile yang sama.
- **L4 pesan galat**: v5.1 "RPA|Karkas: Komitmen sudah dikunci…" → v5.2 "Tidak ada komitmen yang disimpan: Komitmen sudah dikunci…" (R55: satu permintaan, semua baris atau tidak ada). Formulir dikosongkan setelah penolakan (React): angka dan alasan diketik lagi (**Q-v5.2-114**).
- Awal L: v5.1 menghapus komitmen dan price list sebelum L; v5.2 berangkat dari keadaan akhir T7 (v1 sudah terkunci oleh langkah 2 T7), jadi L4 adalah "ubah sesudah kunci" persis.

### Journey P — `release_week` langsung ke PostgREST (P8), `tests/e2e/journey-P.cjs`

Berjalan di database yang ditinggalkan T7. Snapshot rilis T7 dikirim sebagai `p_json` (`p_sha` = SHA-256 teks yang dikirim), JWT Finance dari mock auth, flag `v4_release`, `v5_costing`, `v5_input` hidup.

| Langkah (baris) | SETUP (berlabel) | Hasil |
|---|---|---|
| P8a (64) | grid K35 minggu 24/08 dihapus seluruhnya | **400** `P0001` "Rilis ditolak: K35: grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas"; tidak ada rilis baru (1 → 1) |
| P8b (73) | grid dikembalikan persis, satu sel `plan_week` 24/08 dibuat `late` | **400** `P0001` "Rilis ditolak: K35 kelengkapan data merah: plan_week 24/08"; tidak ada rilis baru |
| P8c (84) | grid dikembalikan persis (semua sel lolos) + sel `release_week` lama `late` | **200** (id rilis baru), 1 → 2 rilis, oleh finance, SHA-256 yang dikirim, minggu tetap `released` (K44: tugas rilis bukan sel yang menahan) |
| P8d (98) | — | PPIC memanggil yang sama: **403** `42501` "Rilis mingguan hanya oleh Admin atau Finance"; tidak ada rilis baru |

Ketiganya 400/400/200 seperti spesifikasi. P1–P7 v5.1 = T7 langkah 8 dan 9 dan matriks (`a5.md`).
**Beda dari v5.1:** snapshot berasal dari rilis T7 (bukan P7); v5.2 menuntut `controls_v3` dengan C53 di snapshot saat `v5_costing` hidup (B-R84/K68), dicek di langkah 0; P8d ditambahkan. P8c menulis baris rilis kedua untuk minggu yang sudah dirilis (sama dengan v5.1 P7); lihat **Q-v5.2-113**.

### Journey O — satu jam untuk data dan aplikasi (O2, O5), `tests/e2e/journey-O.cjs`

Spesifikasi: `docs/v5.1/irisan-2.md` ("journey O"; PRD R70 menyebut `O2`, `O5`). Berjalan dari database `prepared` (sebelum T7), satu SETUP.

| Langkah (baris) | Hasil |
|---|---|
| 0 (31) | SETUP `week.update_date` minggu 24/08 = 26 Agu (keadaan sebelum WP batch 26 Agu masuk) |
| O2 (41) | Cost Accounting menempel WP batch 126 (9 baris): pesan "…tanggal update minggu 2026-08-24: 2026-08-26 → 2026-08-27. Rebuild: 2 selesai."; database: `update_date` 27 Agu; antrean sejak unggahan: 26/08 "batch update" dan 27/08 "upload v5 costing_wp", keduanya `done`, tanpa tanggal lewat 27/08 (R11/K39, R12/K40). Dengan jam dinding = tanggal data, form keputusan Direktur Operasional untuk potong 28/08 dan tanpa catatan "Data per" |
| O5 (66) | jam uji 17 Okt 2026, data 27 Agu: form `date = 2026-10-18` (jam dinding + 1), tombol "Putuskan Rp 24.600 untuk potong 18/10", catatan "Data per 27 Agu · potong Min 18/10", `update_date` tetap 27 Agu (R10/K38) |

**Beda dari v5.1 dan sebabnya:** seed e2e sudah "data 27 Agu" dan WP batch 126 adalah unggahan yang dikerjakan journey ini, jadi SETUP mengembalikan `update_date` ke 26 Agu; tanpa itu tidak ada yang maju. "Lot asal 26/08 estimasi 29 → sementara 29" dan "Karkas frozen estimasi 34.196 → 34.020" tidak direproduksi: lot batch di database e2e sudah `sementara` (WP dibackfill saat migrasi) dan biaya baru di Komersial adalah T7 langkah 5 dan 7. O0, O1, O3 dan O4 (K41: `revoke select` pada `cash_position_daily` → hanya tile kas berstatus galat) tidak dipindahkan: di luar daftar R70 ("O2, O5").

## 4. Pemasangan

- `tests/e2e/run.sh`: urutan `prepare → matrix → O → T7 → (simpan afterT7) A6 → L → P → R69 → F19 → volume`; O mulai dari `prepared`; A6, L, P, R69 masing-masing memulihkan `afterT7` sesudahnya, F19 dan volume memakai database T7 seperti sebelumnya.
  `E2E_ONLY` menerima `matrix O T7 A6 L P R69 F19 volume`; T7 ikut bila salah satu dari A6, L, P, R69, F19, volume dipilih.
- `tests/e2e/summarize.cjs`: urutan tabel dan ketergantungan T7; `.github/workflows/ci.yml`: nama langkah; `README.md`: paragraf Uji e2e. Job CI memakai `E2E_STRICT_XFAIL=1`; tidak ada XFAIL.
- Tidak ada pengurangan cek, percobaan ulang untuk membuat hijau, atau penanda XFAIL.

## 5. Catatan jalannya (agar tidak diulang)

- Langkah 1c semula dibuat mengunggah PO minggu 31 Agu lewat app setelah SETUP minggunya. Itu benar secara alur tetapi unggahan membangun ulang mart (`commercial_daily` −2, `lot_balance_daily` −86, `pl_daily_v4` +366, `demand_*`, `data_status`, …) dan penjaga "92 tabel sama" menggagalkannya; pilihan akhir: PO bagian dari SETUP, PO yang ditahan dibuktikan di 1c.
- Penjaga jumlah baris (92 tabel) menangkap pula antrean yang ditulis pemicu saat baris minggu dan salinannya dihapus ("runrate delete", …); `next-week-undo.sql` menghapusnya (`created_at >= awal langkah`).
- Dari tiga jalan penuh `pnpm e2e` (yang pertama dengan `next build` baru di dalamnya, dua lainnya hijau: 450 dan 436 detik), satu kali, di jalan pertama, proses `next start` berhenti di T7 langkah 4 tanpa jejak di log aplikasi (tanpa galat; memori 12 GB bebas);
  jalan penuh kedua dan ketiga, dua jalan T7 saja, satu jalan O+T7 dan satu jalan O+R69 tidak mengulanginya. Penyebab tidak ditemukan (kode T7 pada jalan itu masih memuat cek 1c yang salah, tidak ada hubungan yang terlihat dengan langkah 4); dicatat di sini dan diamati di setiap jalan sesudahnya.
- Tangkapan layar halaman Rekonsiliasi (LULUS, GAGAL), Tutup buku (ditahan C59, FINAL terkunci), tile akurasi dan Rencana minggu komitmen dilihat di browser (Chromium, 1366 px) dan ada di `docs/v5.2/bukti/a5b/`. Itu menutup butir "tampilan visual halaman belum dilihat di browser" (`a4.md`) untuk 1366 px; 390 px belum.

## 6. Pertanyaan baru (Q-v5.2-110 … 116)

Rekomendasi = pendapat peninjau, bukan keputusan. Tidak ada yang mengubah kode di irisan ini.

| # | Temuan dan pertanyaan | Pilihan | Rekomendasi | Pemilik |
|---|---|---|---|---|
| Q-v5.2-110 | **PO dan Rencana minggu depan butuh Admin.** Sebelum Admin menjalankan rollover Senin, unggahan PO Sales untuk tanggal minggu depan ditahan "minggu … belum ada" (`input-save.ts:123`, T7 langkah 1c) dan `/w/<minggu depan>/rencana` adalah 404. Komitmen dikunci Jumat untuk minggu itu. Bukti R48 butuh SETUP baris minggu karena R70 melarang Admin | (a) tetap (rollover Senin oleh Admin); (b) baris minggu depan dibuat otomatis (cron atau saat komitmen dikunci); (c) rollover oleh Finance atau PPIC | (b), Admin hanya untuk koreksi | Pemilik produk |
| Q-v5.2-111 | **Tile akurasi bilang "Belum ada bulan yang FINAL." padahal FINAL ada**, bila bulan itu tidak punya V1/V2 terkunci (`outlook-bulan-data.ts`: `if (vs.length)`); baris C59 baru tampil bila ada versi pembanding. Bulan yang di-FINAL-kan tanpa V1/V2 (mis. Agustus 2026 di KGR-OS) tidak menampilkan C59 di tile | (a) tetap; (b) kalimat "FINAL ada, belum ada V1/V2 untuk dibandingkan" dan baris C59 tetap tampil | (b) | Finance |
| Q-v5.2-112 | **Dua angka surplus karkas di Komersial.** Tile "Dari PPIC" menampilkan "Karkas surplus dari batch rencana ± 14.054 kg" (`wp.surplus_kg`, dihitung ulang dengan data sekarang), sedangkan daftar jawaban memuat "Karkas · 0 kg" (`plan_week.surplus_kg_by_key` pada saat rencana disimpan, 0,09 kg; R56). Yang bisa dijawab Kepala Sales adalah angka tersimpan | (a) tetap, PPIC menyimpan rencana lagi bila angka bergeser; (b) tile memberi tahu "rencana tersimpan sudah usang" bila angkanya berbeda | (b) | PPIC dan Kepala Sales |
| Q-v5.2-113 | **`release_week` untuk minggu yang sudah `released`** menulis baris `release` baru (P8c, 200; sama dengan v5.1 P7). Riwayat rilis memuat dua rilis dengan snapshot berbeda | (a) tetap (jejak rilis ulang); (b) tolak, atau catat di `release.note` bahwa ini rilis ulang | (b) catatan | Finance |
| Q-v5.2-114 | **Formulir komitmen dikosongkan setelah penolakan.** Simpan versi baru tanpa alasan ditolak dengan benar, tetapi angka yang diketik hilang bersama kolom alasan (formulir di-reset sesudah aksi); Kepala Sales mengetik ulang | (a) tetap; (b) formulir mempertahankan isian bila aksi menolak | (b) | Pemilik produk |
| Q-v5.2-115 | **FINAL Agustus pada data lengkap versi T7 masih ditahan enam kontrol di luar FS** (C22 yield batch 125 dan 126, C23 cost pool, C24 alokasi batch 125 belum diposting, C35 dan C36 kas harian, C49 tanpa minggu bertanggal update 1 Sep). e2e R69 melewatinya dengan override Finance berreason; di KGR-OS FINAL Agustus (T20) harus memenuhinya atau mengoverride dengan bukti nyata | catatan untuk T20; tidak ada pilihan kode | — | Finance |
| Q-v5.2-116 | **Cakupan "LULUS pada data lengkap".** Fixture FS di e2e sengaja = angka app (turunan SQL), jadi hanya membuktikan alur dan aturan C59, bukan kecocokan dengan Management Report asli; di fixture asli ekuitas b.71 berselisih Rp 2,71 (`fs-recon-fixture.md` §6) sehingga C59 GAGAL tiap bulan sampai b.71 dikoreksi atau di-override | koreksi b.71 di workbook, atau override C59 tiap bulan | koreksi b.71 | Finance |

## 7. Gate

Container cloud, Node 22, pnpm 10.28.0, `xlsx` 0.18.5 lewat override lokal sementara (`@kgr/parsers>xlsx`; **tidak di-commit**: `package.json` dan `pnpm-lock.yaml` dikembalikan sebelum setiap komit). Dasar `origin/main` 85f7684 digabung (tidak ada komit baru di `main`).

| Gate | Perintah | Hasil | Lingkungan |
|---|---|---|---|
| typecheck | `pnpm typecheck` | exit 0 | — |
| tes unit | `pnpm test` | engine 467 (30 berkas), parsers 31 (4), web 756 (66): 1.254 tes, 0 gagal | vitest |
| paritas | `pnpm parity` | 17161/17161 | engine, fixture |
| snapshot | `pnpm snapshot:diff` | EMPTY — byte-identical | engine |
| RLS | `DATABASE_URL="postgresql://postgres@/a5b_rls?host=/tmp" bash scripts/test-rls.sh` (database baru) | `test:rls OK`; 48 blok RLS-RESULTS, 0 `(!)`; `check-query-columns` 0 tak dikenal | PG16 lokal (bukan Supabase) |
| lint | `bash scripts/test-lint.sh`; `bash scripts/lint-k41.sh`; `bash scripts/lint-k42.sh`; `python3 -I scripts/lint.py missing` | exit 0; K41 0 hit; K42 0 hit; missing 0 hit | — |
| e2e | `E2E_STRICT_XFAIL=1 pnpm e2e` | HIJAU; prepare 3, matrix 120, O 15, T7 58, A6 82, L 34, P 16, R69 65, F19 16, volume 13; respons tak terduga 0; XFAIL 0 | PG16 lokal + PostgREST 12 + mock auth |

## Terbuka

- Journey K (Manajemen), M (keputusan harga LB, C57) dan N (PO tempel) dari v5.1 tetap tercakup oleh T7 dan matriks seperti di `a5.md`; O0, O1, O3, O4 tidak dipindahkan (O4 = K41); L1–L3 dan P1–P7 tercakup T7 dan matriks.
- Rekonsiliasi: tile akurasi dibuktikan dengan satu V1 hasil SETUP; angka FS di e2e = angka app (alur, bukan kecocokan dengan FS asli, Q-v5.2-116); FINAL Agustus asli di KGR-OS tetap T20.
- Rekonsiliasi belum di matriks 10 kombinasi flag × 10 role × 8 halaman (akses dicek di journey R69 untuk 10 role pada kombinasi semua-hidup).
- T19 (journey terhadap URL staging) tetap belum; langkah SETUP baru (T7 langkah 11, A6, L, P, O, R69) butuh `E2E_PG_URL` dan hanya untuk tumpukan lokal.
