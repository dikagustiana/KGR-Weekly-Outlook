# Rekonsiliasi fixture app ↔ FS (R68, T15, K62)

Dihasilkan oleh `python3 -I scripts/build_fs_recon.py` dari `fixtures/fs-recon-2026-08/golden.json` dan `fixtures/fs-recon-2026-09/golden.json` (`--check` memastikan berkas di repo sama dengan hasil skrip). Tes engine `packages/engine/test/fs-recon.test.ts` menjalankan `fsRecon` pada fixture yang sama dan harus menghasilkan tabel ini baris demi baris. Angka tidak disesuaikan agar lulus: bila data fixture belum lengkap, selisih yang diharapkan ditulis di sini dengan sebabnya.

Format: `Rp 8.361,8 jt`, minus U+2212 (`Rp −26,5 jt`); selisih di bawah Rp 1 jt ditulis dalam rupiah penuh. Selisih = app − FS; |selisih| ≤ Rp 1 = `sama` (O26). Sebab: `data belum ada` (satu sisi tidak ada atau belum lengkap), `definisi` (arti baris beda, REVIEW-v5.1 §7), `selisih` (definisi sama, data lengkap: Finance harus menjelaskan).

## 1. Sumber

- FS: `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` (sha256 `7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5`), sheet `PL - Management Report` dan `BS - Management Report`; kolom Juli = J, Agustus = K, September = L. Skrip membaca ulang label dan nilai 186 baris yang dipakai langsung dari workbook; semuanya sama dengan `fixtures/fs-2026-09/inputs.json`.
- Salinan workbook acuan adalah yang ada di repo ini. Analisis lain memakai salinan berbeda (NIBT September −953,9 jt); di repo: NIBT September Rp −910.058.539,73, ekuitas September Rp 702.553.474,90.
- Sisi app: `fixtures/week-2026-08-24` (jurnal 1–26 Agu 2026 dan TB 31 Jul 2026) dan `coa_map`. Jurnal September tidak ada di fixture.
- Mode costing: produksi `costing_rows_mode='memo'` (O24 b): COGS untuk perbandingan FS tanpa baris v5 "Selisih costing" dan "Biaya kapasitas idle" (fixture Agustus tidak memuat baris itu; perilaku kedua mode diuji di `fs-recon.test.ts`).

## 2. Pemetaan minimum (15 baris)

| Baris FS | Label FS (diverifikasi) | Baris app | Tanda | Catatan |
|---|---|---|---:|---|
| PL b.12 | Revenue | `revenue` (Revenue (jurnal)) | +1 | Σ Revenue - LB Main Product, LB By Product, Trading (jurnal + penyesuaian tutup buku) |
| PL b.13 | Cost of Sales | `cogs` (COGS (jurnal)) | +1 | Σ COGS dan Other COGS; mode memo (O24 b): tanpa Selisih costing dan Biaya kapasitas idle |
| PL b.15 | GROSS PROFIT | `gp` (Gross profit (jurnal)) | +1 | Revenue + COGS (mode memo: tanpa baris v5) |
| PL b.37 | TOTAL OPERATING EXPENSES | `opex` (Beban operasi (jurnal)) | +1 | semua baris selain Revenue, COGS, dan pendapatan/beban lain (termasuk penyusutan dan pajak) |
| PL b.49 | TOTAL OTHER INCOME (EXPENSE) | `other` (Pendapatan dan beban lain (jurnal)) | +1 | Interest Expense, Other Income, Other Expense |
| PL b.51 | INCOME (LOSS) BEFORE TAX | `nibt` (NIBT (jurnal)) | +1 | NIBT jurnal; mode memo: tanpa NIBT manajemen |
| BS b.14 | Cash and cash equivalents | `kas` (Kas dan setara kas) | +1 | saldo kas dan bank akhir bulan (TB awal + jurnal) |
| BS b.17 | Trade Receivables - Third Parties | `piutang_pihak_ketiga` (Piutang usaha pihak ketiga) | +1 |  |
| BS b.18 | Trade Receivables - Related Parties | `piutang_pihak_berelasi` (Piutang usaha pihak berelasi) | +1 |  |
| BS b.23 | Inventory - Product | `persediaan_produk` (Persediaan produk) | +1 | saldo buku besar (bs_line Inventory - Product) |
| BS b.24 | Inventory - Trading | `persediaan_trading` (Persediaan trading) | +1 | saldo buku besar (bs_line Inventory - Trading) |
| BS b.47 | Trade Payables - Third Parties | `utang_dagang_pihak_ketiga` (Utang dagang pihak ketiga) | +1 |  |
| BS b.48 | Trade Payables - Affiliates | `utang_dagang_afiliasi` (Utang dagang afiliasi) | +1 |  |
| BS b.51 | Other Payable - Related Parties | `utang_lain_afiliasi` (Utang lain pihak berelasi) | +1 | pinjaman dan utang lain afiliasi |
| BS b.77 | TOTAL EQUITY | `ekuitas` (Total ekuitas) | +1 | Shareholder Equity + Retained earnings + laba tahun berjalan |

## 3. Agustus 2026: akhir bulan

Hasil: 2 sama, 13 beda, 0 tidak ada; 58 baris FS di luar pemetaan. **C59: GAGAL** (diharapkan; bukan kegagalan engine).

| Baris FS | Baris app | App | FS | Selisih (app − FS) | Status | Sebab |
|---|---|---:|---:|---:|---|---|
| PL b.12 Revenue | Revenue (jurnal) | Rp 6.385,9 jt | Rp 8.361,8 jt | Rp −1.975,9 jt (Rp −1.975.884.864,00) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| PL b.13 Cost of Sales | COGS (jurnal) | Rp −6.038,5 jt | Rp −8.055,1 jt | Rp 2.016,6 jt (Rp 2.016.578.361,81) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| PL b.15 GROSS PROFIT | Gross profit (jurnal) | Rp 347,4 jt | Rp 306,7 jt | Rp 40,7 jt (Rp 40.693.497,81) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| PL b.37 TOTAL OPERATING EXPENSES | Beban operasi (jurnal) | Rp −183,9 jt | Rp −302,9 jt | Rp 119,0 jt (Rp 119.018.646,35) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada; baris yang FS punya dan jurnal fixture belum punya sama sekali: Salaries and allowance (Rp −85,6 jt), Depreciation & amortisation (Rp −10,4 jt), Interest Expense (Rp −31,9 jt) |
| PL b.49 TOTAL OTHER INCOME (EXPENSE) | Pendapatan dan beban lain (jurnal) | Rp 1,7 jt | Rp −30,3 jt | Rp 32,1 jt (Rp 32.055.497,05) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada; Interest Expense belum dijurnal (FS Agu: Rp −31,9 jt) |
| PL b.51 INCOME (LOSS) BEFORE TAX | NIBT (jurnal) | Rp 165,2 jt | Rp −26,5 jt | Rp 191,8 jt (Rp 191.767.641,21) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| BS b.14 Cash and cash equivalents | Kas dan setara kas | Rp 1.289,3 jt | Rp 495,4 jt | Rp 793,9 jt (Rp 793.888.195,40) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| BS b.17 Trade Receivables - Third Parties | Piutang usaha pihak ketiga | Rp 991,3 jt | Rp 512,0 jt | Rp 479,3 jt (Rp 479.311.089,00) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| BS b.18 Trade Receivables - Related Parties | Piutang usaha pihak berelasi | Rp 0,0 jt | Rp 0,0 jt | Rp 0,00 | sama |  |
| BS b.23 Inventory - Product | Persediaan produk | Rp 1.568,1 jt | Rp 1.492,9 jt | Rp 75,2 jt (Rp 75.206.844,51) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| BS b.24 Inventory - Trading | Persediaan trading | Rp 2.592,1 jt | Rp 2.039,7 jt | Rp 552,4 jt (Rp 552.448.997,00) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| BS b.47 Trade Payables - Third Parties | Utang dagang pihak ketiga | Rp −420,3 jt | Rp 56,0 jt | Rp −476,4 jt (Rp −476.362.440,00) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada; saldo utang dagang app bersaldo debit (Rp −420,3 jt): pembayaran lebih besar dari tagihan yang sudah dijurnal |
| BS b.48 Trade Payables - Affiliates | Utang dagang afiliasi | Rp 0,0 jt | Rp 0,0 jt | Rp 0,00 | sama |  |
| BS b.51 Other Payable - Related Parties | Utang lain pihak berelasi | Rp 5.600,0 jt | Rp 5.627,1 jt | Rp −27,1 jt (Rp −27.124.444,35) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada |
| BS b.77 TOTAL EQUITY | Total ekuitas | Rp 1.804,4 jt | Rp 1.612,6 jt | Rp 191,8 jt (Rp 191.767.638,50) | beda | data belum ada: jurnal fixture baru sampai 26 Agu 2026; transaksi 27–31 Agu dan jurnal penutup bulan belum ada; laba tahun berjalan app memuat jurnal Agu s.d. 26 Agu saja, dan b.71 FS beda Rp 2,71 dari TB (lihat saldo awal) |

Penjelasan: jurnal fixture berhenti 26 Agu, jadi semua selisih Agustus diberi sebab `data belum ada`. Bagian selisih yang berasal dari definisi atau selisih sungguhan baru bisa dipisahkan setelah jurnal 27–31 Agu dan jurnal penutup masuk (T20 di PRD B). Angka app s.d. 26 Agu cocok dengan golden independen `fixtures/month-2026-08/golden-v4.json` (revenue 6385,9; COGS −6038,5; GP 347,4; beban operasi dan lain −182,2; NIBT 165,2 jt) dan neraca v1 (`computeWeek`) pada 26 Agu (dicek di tes).

## 4. Agustus 2026: saldo awal 31 Juli (data lengkap)

Saldo awal = TB 31 Jul (O27). Ini satu-satunya perbandingan di fixture dengan data lengkap di kedua sisi. FS Juli hanya dipakai di fixture ini; B-R91 mengimpor kolom Agustus dan September.

Hasil: 8 sama, 1 beda, 0 tidak ada. **C59: GAGAL**.

| Baris FS | Baris app | App | FS | Selisih (app − FS) | Status | Sebab |
|---|---|---:|---:|---:|---|---|
| BS b.14 Cash and cash equivalents | Kas dan setara kas | Rp 599,8 jt | Rp 599,8 jt | Rp 0,00 | sama |  |
| BS b.17 Trade Receivables - Third Parties | Piutang usaha pihak ketiga | Rp 310,7 jt | Rp 310,7 jt | Rp 0,00 | sama |  |
| BS b.18 Trade Receivables - Related Parties | Piutang usaha pihak berelasi | Rp 0,0 jt | Rp 0,0 jt | Rp 0,00 | sama |  |
| BS b.23 Inventory - Product | Persediaan produk | Rp 771,2 jt | Rp 771,2 jt | Rp 0,00 | sama |  |
| BS b.24 Inventory - Trading | Persediaan trading | Rp 2.124,6 jt | Rp 2.124,6 jt | Rp 0,00 | sama |  |
| BS b.47 Trade Payables - Third Parties | Utang dagang pihak ketiga | Rp 4,2 jt | Rp 4,2 jt | Rp 0,00 | sama |  |
| BS b.48 Trade Payables - Affiliates | Utang dagang afiliasi | Rp 0,0 jt | Rp 0,0 jt | Rp 0,00 | sama |  |
| BS b.51 Other Payable - Related Parties | Utang lain pihak berelasi | Rp 4.429,9 jt | Rp 4.429,9 jt | Rp 0,00 | sama |  |
| BS b.77 TOTAL EQUITY | Total ekuitas | Rp 1.639,1 jt | Rp 1.639,1 jt | Rp −2,71 | beda | selisih: selisih seluruhnya dari saldo laba ditahan awal: TB Accurate Rp −2.698.434.668,62, BS - Management Report b.71 Rp −2.698.434.665,91, selisih Rp −2,71; modal disetor b.68 dan laba tahun berjalan b.72 sama (selisih Rp 0,00 dan Rp 0,00). Neraca FS sendiri tidak seimbang: total aset b.41 Rp 6.584.749.133,16 lawan liabilitas + ekuitas b.79 Rp 6.584.749.138,09, selisih Rp −4,93 |

## 5. September 2026

Hasil: 0 sama, 0 beda, 15 tidak ada di app; 58 baris FS di luar pemetaan. **C59: BELUM DIISI** (bukan LULUS: baris yang tidak punya angka tidak pernah dibaca 0).

| Baris FS | Baris app | App | FS | Selisih (app − FS) | Status | Sebab |
|---|---|---:|---:|---:|---|---|
| PL b.12 Revenue | Revenue (jurnal) | belum ada | Rp 5.039,9 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| PL b.13 Cost of Sales | COGS (jurnal) | belum ada | Rp −5.515,3 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| PL b.15 GROSS PROFIT | Gross profit (jurnal) | belum ada | Rp −475,4 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| PL b.37 TOTAL OPERATING EXPENSES | Beban operasi (jurnal) | belum ada | Rp −312,2 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| PL b.49 TOTAL OTHER INCOME (EXPENSE) | Pendapatan dan beban lain (jurnal) | belum ada | Rp −122,5 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| PL b.51 INCOME (LOSS) BEFORE TAX | NIBT (jurnal) | belum ada | Rp −910,1 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.14 Cash and cash equivalents | Kas dan setara kas | belum ada | Rp 103,0 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.17 Trade Receivables - Third Parties | Piutang usaha pihak ketiga | belum ada | Rp 800,2 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.18 Trade Receivables - Related Parties | Piutang usaha pihak berelasi | belum ada | Rp 0,0 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.23 Inventory - Product | Persediaan produk | belum ada | Rp 4.724,2 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.24 Inventory - Trading | Persediaan trading | belum ada | Rp 1.928,2 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.47 Trade Payables - Third Parties | Utang dagang pihak ketiga | belum ada | Rp 139,1 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.48 Trade Payables - Affiliates | Utang dagang afiliasi | belum ada | Rp 0,0 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.51 Other Payable - Related Parties | Utang lain pihak berelasi | belum ada | Rp 9.845,9 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |
| BS b.77 TOTAL EQUITY | Total ekuitas | belum ada | Rp 702,6 jt | — | tidak ada di app | data belum ada: jurnal September tidak ada di fixture (jurnal fixture berhenti 26 Agu 2026); app belum punya angka September |

## 6. Yang masih harus diputuskan Finance

1. **Ekuitas (b.77) berselisih Rp −2,71 pada saldo awal, di atas toleransi Rp 1, walau data lengkap.** Saldo laba ditahan awal di `BS - Management Report` (b.71) sama di Juli, Agustus, dan September (−2.698.434.665,91), sedangkan TB Accurate dan sheet `BS` di workbook yang sama menunjukkan −2.698.434.668,62 pada ketiga bulan. Selama b.71 tidak dikoreksi, C59 pada b.77 GAGAL setiap bulan, juga setelah semua jurnal masuk. Pilihan Finance: koreksi b.71 di workbook, atau override C59 (policy B-R86). Engine tidak menutup selisih ini (K62).
2. Baris FS di luar pemetaan minimum (rincian beban, aset tetap, pajak dibayar di muka, akrual) berstatus `tidak ada di app` dengan sebab `definisi` sampai O27 (b) dikerjakan (per akun TB).
3. Bukti `LULUS` pada data lengkap Agustus dan September baru ada setelah jurnal lengkap dan FINAL di KGR-OS (T20 di PRD B).
