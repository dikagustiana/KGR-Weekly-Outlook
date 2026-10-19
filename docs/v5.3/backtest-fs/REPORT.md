# Backtest FS Agustus–September 2026: GL, TB, Detail Sales, Valuation, FS v2

Untuk: Dika (pemilik), Finance, reviewer v5.3. Tanggal 18 Okt 2026. Cabang `v5.3/bt-fs` dari `main` `87c8c61`, untuk kesiapan pilot 19 Okt.

**Pertanyaan:** kalau jurnal Accurate Agustus dan September diunggah lewat app, apakah angka app sama dengan TB Accurate dan FS
(Management Report v2)? Dan apakah Finance bisa menutup buku sampai FINAL?

**Jawaban:** ya.
- Jurnal yang diunggah lewat wizard sama dengan TB Accurate per akun sampai Rp 1, di kedua bulan.
- Laba rugi FINAL Agustus dan September (jurnal ditambah penyesuaian DI yang diposting) sama dengan FS di semua baris C59: Revenue, COGS, GP, beban operasi, lain-lain, NIBT.
- Selisih neraca yang tersisa semuanya punya sebab tertulis (§5): jurnal DI yang belum dijurnal di Accurate, akun 1102008, dan D9 Rp 2,71. Untuk itu C59 di-override dengan alasan.

Ada satu hal yang harus diketahui Finance sebelum menutup September: penyesuaian DI yang ditanam migrasi M4 tidak boleh diposting semuanya (§6, BT-FS-1).

## 1. Sumber

Berkas asli tidak di-commit. Skrip membacanya dari `BACKTEST_DIR` (default `/home/user/backtest-data`).

| Berkas | sha256 | Dipakai untuk |
| --- | --- | --- |
| `09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx` (salinan 18 Okt) | `fb2e3cf19025c6145a973148907f1112bdafa8be82174d2b7f445faaaeb938f3` | FS acuan (MR PL/BS), TB Accurate, sheet GL `Agt 26` / `Sep 26`, nota DI |
| `GL KGR Rev 1.xls` | `5b7e8fe0155563a964f7b1de0014e754b84dba507899d3bda7f6638907aee8df` | GL September alternatif (L1c) |
| `Detail Sales September.xls` | `df55c2641314d465be35da38d4dbf8dd8b4b68c249a97c75a7db9d61c72e1bce` | L6 penjualan |
| `Valuation detail.xls` | `fde88d15913d258320d07278e42f6d7ba1457fede2085c9ca354499e9d0f9345` | L5 persediaan |
| `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` (di repo, lama) | `7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5` | FS versi 1 yang sudah ada di KGR-OS |

Nilai FS yang dipakai tes ada di `docs/v5.3/backtest-fs/expected.json`. Isinya angka MR per sel dan sha berkas, dibangkitkan
oleh `tests/backtest/sep-2026/expected.py` dengan `BACKTEST_FS=… BACKTEST_OUT=…`.

Berkas GL untuk diunggah dibangkitkan oleh `tests/backtest/fs-2026/make-gl-files.ts` dari sheet `Agt 26` / `Sep 26`. Hasilnya:
`GL-Accurate-Agustus-2026.xlsx` (sha `2921019412a0…`, 2.431 baris) dan `GL-Accurate-September-2026.xlsx` (sha `0a3421c9d1ff…`,
1.942 baris). Keduanya dicek ulang lewat parser app.

## 2. Lingkungan dan cara mengulang

- Cek sumber: `pnpm tsx tests/backtest/fs-2026/sources.ts --md out.md`. Memakai parser app (`@kgr/parsers`) dan pembaca SETUP
  untuk laporan Accurate berkelompok, yaitu Rincian Penjualan per Barang dan Rincian Valuasi Persediaan. Parser upload tidak
  mengenali kedua format itu.
- Gladi app: stack e2e lokal (PG16 + PostgREST 12 + mock auth + jam uji). Ini **bukan KGR-OS**.
  `E2E_ONLY=none E2E_KEEP=1 bash tests/e2e/run.sh; source tests/e2e/stack/env.sh; node tests/backtest/fs-2026/rehearsal.cjs`.
  Log ada di `tests/e2e/out/BT-FS.log`.
- SETUP gladi, yaitu yang tidak lewat UI:
  - FS v1 (`docs/v5.2/kgr-os-data-fs.sql`) ditambah koreksi v2 (`docs/v5.3/kgr-os-data-fs-v2.sql`).
  - `fs_line_map` disetujui lewat SQL, karena app tidak punya layarnya (BT-FS-2).
  - coa_map B-R89 (`docs/v5.2/kgr-os-coa-fix.sql`, sama dengan KGR-OS: 213 akun).
  - Jam uji Sen 19 Okt 2026 08.00 WIB.

  Semua langkah lain dijalankan lewat UI oleh peran Admin dan Finance.

## 3. L1: GL lawan TB Accurate

| Sumber | Baris | Σ debit | Akun ≠ mutasi TB (± Rp 1) |
| --- | ---: | ---: | --- |
| FS v2 sheet `Agt 26` | 2.431 | Rp 83.091,3 jt | 0 dari 189 |
| FS v2 sheet `Sep 26` | 1.942 | Rp 81.056,6 jt | 0 dari 189 |
| `GL KGR Rev 1.xls` | 1.942 | Rp 81.300,1 jt | **6 dari 189** |

`GL KGR Rev 1.xls` tidak sama dengan TB. Ada 2 faktur penjualan yang bernilai di Rev 1 tetapi nol di `Sep 26` dan di TB
(Σ |selisih| 6 akun Rp 487,0 jt). Jadi Rev 1 bukan GL yang membentuk TB/FS v2. Gladi memakai `Sep 26`. Bila Rev 1 adalah koreksi yang
diinginkan, TB dan FS harus diperbarui dulu (pertanyaan F-1).

Upload lewat wizard (`Accurate — General Ledger / Journal`):
- Agustus: 2.431 baris, Σ debit = Σ berkas.
- September: 1.942 baris.
- Upload Agustus mengganti rentang tanggal berkas: 1.838 baris lama di stack di-soft-delete.
- Bangun ulang lewat cron sampai antrean habis, tanpa tanggal yang gagal.

## 4. L6 dan L5: subledger

**L6 Detail Sales September lawan revenue.** Σ baris faktur Rp 5.981,5 jt (99 faktur, 233 baris; subtotal per barang cocok).
Revenue FS = TB akun 4xxx = GL = Rp 5.039,9 jt. Selisih Rp 941,6 jt terjelaskan sampai rupiah:

| Komponen | Rp |
| --- | ---: |
| Pembalikan Unbilled Revenue (TB 4101013) | 828.279.239 |
| Faktur bernomor sama dengan nilai berbeda di GL (3 faktur) | 112.191.676 |
| Faktur yang hanya ada di Detail Sales (2) | 1.171.172 |
| **Jumlah** | **941.642.087** |

**L5 Valuation detail lawan persediaan neraca.** Saldo berjalan per barang konsisten (99 barang, 1.606 mutasi, 0 baris
dengan saldo awal + masuk − keluar ≠ nilai akhir). Tetapi totalnya tidak sama dengan neraca:

| | Valuation | Neraca FS | Selisih |
| --- | ---: | ---: | ---: |
| Produk 31 Agu | 2.318,0 jt | 1.492,9 jt | +825,1 jt |
| Trading 31 Agu | 2.021,2 jt | 2.039,7 jt | −18,5 jt |
| Produk 30 Sep | 4.518,2 jt | 4.724,2 jt | −206,0 jt |
| Trading 30 Sep | 1.908,9 jt | 1.928,2 jt | −19,3 jt |

App tidak membaca Valuation, karena persediaan neraca di app berasal dari GL. Jadi ini pertanyaan rekonsiliasi subledger untuk
Finance (F-2), bukan cacat app.

## 5. L2/L3: C59 Rekonsiliasi app lawan FS (15 baris dipetakan)

**Sebelum penyesuaian** (jurnal saja, app − FS):

| Baris | Agustus | September | Sebab |
| --- | ---: | ---: | --- |
| PL Revenue | −112.125.600 | 0 | DI-05, DI-06 Agu |
| PL Cost of Sales | +117.513.717,18 | −60.354.462 | DI-05 Agu; DI-01, DI-03 Sep |
| PL Beban operasi | −513.119 | −43.977.623,33 | PPh 22 Agu (lihat F-3); DI-02 Sep |
| PL Lain-lain | +1.185 | −100.000 | DI-06 Agu; DI-02 Sep |
| PL NIBT | +4.876.183,18 | −104.432.085,33 | jumlah di atas |

**Penyesuaian tutup buku (Finance, layar Tutup buku → Tambah penyesuaian → Tandai diposting).** Tanda P&L: + menambah laba.

| Bulan | Kode | Pos P&L | Jumlah |
| --- | --- | --- | ---: |
| Agu | DI-05 | Revenue - LB Main Product | +111.496.000 |
| Agu | DI-06 | Revenue - LB By Product | +629.600 |
| Agu | DI-05 | COGS - Live Bird | −117.513.717,18 |
| Agu | DI-06 | Other Expense | −1.185 |
| Agu | PPh22 | Tax expenses | +513.119 |
| Sep | DI-01 | COGS - Live Bird | +48.354.462 (baris migrasi M4, cukup diposting) |
| Sep | DI-03 | Other COGS - Expedition | +12.000.000 |
| Sep | DI-02 | Maintenance Expenses | +43.977.623,33 |
| Sep | DI-02 | Other Expense | +100.000 |

**Sesudah FINAL:** laba rugi C59 sama dengan FS di semua 6 baris, Agustus dan September. Neraca:

| Baris | Agustus | September | Sebab |
| --- | ---: | ---: | --- |
| Kas | −0,60 (dalam toleransi) | +157.999.999,40 | Sep: FS memasukkan 1102008 Temporary Account (−158,0 jt) ke kas; coa_map app tidak (F-4) |
| Piutang usaha pihak ketiga | +858.251.383 | 0 | DI-06 Agu (uang muka diselesaikan ke Unbilled AR, 825,9 jt) + pelunasan yang tercatat sebagai uang muka (32,3 jt) |
| Persediaan produk | +117.513.717,18 | −48.354.462 | DI-05 Agu, DI-01 Sep: sisi neraca jurnal DI |
| Persediaan trading | 0 | +4.876.178 | Hanya di MR Sep: tidak ada di sheet BS/TB. Tampaknya penyeimbang DI Agustus (Rp 4.876.183,18, selisih Rp 5,18) (F-5) |
| Total ekuitas | +4.876.180,47 | −99.555.904,86 | NIBT DI Agu; Sep = DI Sep − DI Agu; sisa Rp 2,71 = D9 |

`closing_adjustment` hanya untuk laba rugi, jadi sisi neraca DI baru hilang setelah Finance menjurnal DI di Accurate dan GL
diunggah ulang (BT-FS-3). Sampai saat itu C59 di-override per bulan dengan alasan di atas. Gladi menjalankan ini lewat UI.

## 6. Temuan

| ID | Kelas | Temuan | Tindakan |
| --- | --- | --- | --- |
| BT-FS-1 | DATA (production) | Migrasi M4 (`20261016001000_m4_monthly.sql`) menanam 6 penyesuaian DI September, semuanya belum diposting (dicek di KGR-OS 18 Okt, hanya baca). Isinya mengikuti FS lama. Hanya DI-01 yang sama dengan FS v2. DI-02 dan DI-03 bertanda terbalik (FS v2 memindahkan biaya ke uang muka). DI-04 (2 baris) sudah ada di jurnal. DI-05 Rp 20,99 jt milik Agustus. Bila keenamnya diposting, NIBT FINAL September = Rp −1.181,2 jt, padahal FS Rp −953,9 jt (gladi pertama). | Finance: posting **DI-01 saja**, tambah DI-02/DI-03 versi FS v2 (§5), biarkan sisanya tidak diposting. App belum punya tombol hapus penyesuaian. |
| BT-FS-2 | GAP UI | `fs_line_map` tidak punya layar persetujuan. Di KGR-OS 15 baris masih `draft`, jadi C59 tidak dinilai sama sekali. | Butuh persetujuan Dika: `update fs_line_map set status='agreed'` di KGR-OS (dengan backup) atau layar baru (v5.3). |
| BT-FS-3 | DEFINISI | Penyesuaian tutup buku hanya laba rugi; baris neraca C59 tetap beda sampai DI dijurnal di Accurate. | Override C59 dengan alasan; atau Finance menjurnal DI di Accurate sebelum FINAL. |
| BT-FS-4 | DATA | FS v2 18 Okt mengubah 12 baris September (akrual Commission + Storage Rp 43.845.013; NIBT −910,1 → −953,9 jt). KGR-OS masih memuat versi 1. | `docs/v5.3/kgr-os-data-fs-v2.sql` (dibangkitkan `scripts/fs_correction.py`, versi 2 terkunci). Diterapkan di KGR-OS hanya dengan persetujuan Dika, setelah backup. |
| BT-FS-5 | DATA | `GL KGR Rev 1.xls` ≠ TB (2 faktur). | F-1. |
| D9 | DATA | Rp 2,71 di ekuitas (pembulatan FS). | Dalam batas; tercatat. |

Kelas BUG/PARSER pada angka: 0. Parser GL, bangun ulang, mart, C59, dan FINAL menghasilkan angka FS setelah DI.

## 7. Pertanyaan untuk Finance

- **F-1.** Rev 1 atau `Sep 26`? Gladi memakai `Sep 26`, karena itulah yang membentuk TB/FS v2.
- **F-2.** Selisih Valuation detail lawan persediaan GL (§4 L5).
- **F-3.** Agustus beban pajak Rp 513.119 (PPh 22): FS lebih kecil dari TB, tanpa nota DI. Jurnal apa?
- **F-4.** 1102008 Temporary Account (Sep −158,0 jt): masuk kas (seperti FS) atau tidak (seperti coa_map app)? Bila masuk kas, coa_map
  diubah (persetujuan Dika). **Jawaban Dika 19 Okt:** isinya dana pinjaman ke pihak berelasi. Pemetaan (kas, piutang/pinjaman ke pihak
  berelasi, atau tetap uang muka) belum diputuskan, jadi `coa_map` tidak diubah. Selisih kas Rp 158,0 jt tetap menjadi alasan
  override C59 September.
- **F-5.** Persediaan trading MR September Rp 4.876.178 di bawah sheet BS/TB tanpa jurnal: konfirmasi bahwa ini penyeimbang DI Agustus.
- DI-01…06 akan dijurnal di Accurate kapan? Setelah itu GL diunggah ulang dan override C59 tidak perlu lagi.

## 8. Keadaan KGR-OS (hanya baca, 18 Okt sore)

- `gl_line` Agustus 1.840 baris (unggahan lama, sebagian bulan); September 0.
- `rebuild_queue` 7 tanggal `queued` (24–30 Agu): D2/cron belum jalan.
- `fs_statement_line` hanya versi 1 (sha `7e68aa89`).
- `fs_line_map` 15 `draft`.
- `coa_map` 213.
- `closing_adjustment` 6 baris September belum diposting (BT-FS-1).

## 9. Keadaan KGR-OS sesudah pemuatan (19 Okt, atas permintaan Dika)

Data dimuat lewat SQL dengan logika yang sama dengan `commitUpload` (`apps/web/lib/upload.ts`): rentang tanggal berkas diganti,
baris dicocokkan per `line_key`, dan baris yang tidak ada di berkas dihapus secara soft. Hasilnya diuji dulu di salinan lokal
KGR-OS dan identik dengan unggahan lewat app, termasuk `seq`. Staging dikirim per potongan dan tiap potongan dicek md5-nya.
Backup diambil sebelum perubahan, di skema `backup_20261018`.

| Objek | Sesudah | Cek |
| --- | --- | --- |
| Jurnal Agustus | upload `committed`: 2.429 baris baru, 2 diubah, 1.838 lama dihapus (soft) | 2.431 baris aktif; Σ debit/kredit = berkas (Rp 83.091,3 jt) |
| Jurnal September | upload `committed`: 1.942 baris baru | 1.942 baris aktif; Σ debit/kredit = berkas (Rp 81.056,6 jt) |
| Tanggal update minggu 24 Agu | 27 Agu menjadi 31 Agu (`advance_update_date`) | sama dengan app |
| FS acuan versi 2 | 12 baris September, terkunci | 13/13 cek `kgr-os-data-fs-v2.sql` benar |
| `fs_line_map` | 15 baris `agreed` (atas nama Dika) | menjawab BT-FS-2 untuk data ini |
| DI Agustus | 5 penyesuaian diposting, `gl_voucher` "DI (belum dijurnal)" | Σ Rp −4,9 jt (−4.876.183,18) |
| DI September | DI-01 migrasi diposting; DI-03 Expedition, DI-02 Maintenance, DI-02 Other Expense ditambah dan diposting | Σ diposting Rp 104,4 jt; 5 DI migrasi lain tetap tidak diposting (BT-FS-1) |
| `rebuild_queue` | 59 tanggal 1 Agu–30 Sep `queued` (dari pemicu) | menunggu "Bangun ulang" |

Belum dikerjakan, karena butuh orang atau keputusan:

- **Bangun ulang**: Admin → Modul → "Bangun ulang" sampai antrean habis. Sebelum itu, mart dan C59 belum memakai jurnal baru.
- **Override kontrol FINAL dan Kunci FINAL** Agustus dan September: hanya peran Finance yang bisa, dan KGR-OS baru punya 1 akun
  (Admin). Bukan hanya C59: pada data ini gladi juga harus meng-override C35, C36, C49 (kedua bulan) dan C21–C24 (Agustus, COGS
  LB belum ada) sebelum tombol aktif (§5, `rehearsal.log` langkah 5). Alasan C59: sisi neraca DI belum dijurnal (BT-FS-3), 1102008
  (F-4), dan D9.
- **F-1, F-2, F-3, F-5** tetap pertanyaan Finance.
- **COGS LB** (Pot_*) belum dimuat: menunggu keputusan di `docs/v5.3/backtest-cogs`.
