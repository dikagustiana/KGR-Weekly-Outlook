# Backtest September 2026 — langkah 1: inventaris dan kebenaran FS

Diperbarui agen Claude, 17 Okt 2026 (container cloud, Node 22, `@kgr/parsers` dengan xlsx 0.18.5 lokal; CI memakai
0.20.3). Menggantikan versi DeepSeek; koreksinya di `docs/v5.2/audit-handover.md` § Backtest.

## Sumber

| Sumber | Lokasi | sha256 | Status |
|---|---|---|---|
| FS v2 (acuan kebenaran) | `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` | `7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5` | di repo; sama dengan `fixtures/fs-2026-09/source.json` |
| GL Agustus | sheet `Agt 26` berkas FS v2 (ekspor Accurate "Kode Perkiraan / Debet / Kredit") | idem | di repo |
| GL September | sheet `Sep 26` berkas FS v2 (ekspor Accurate "Daftar Histori GL") | idem | di repo |
| `GL KGR Rev 1.xls`, `GL KGR.xls`, `Detail Sales September.xls`, `Valuation detail.xls`, salinan FS v2 di `Downloads` | mesin Windows DeepSeek | — | **tidak ada** di repo (BUTUH-DIKA D6) |

## Angka acuan (`expected.json`, dibangkitkan `tests/backtest/sep-2026/expected.py`)

Kunci = sel sebenarnya (`'PL - Management Report'!L51` dst.; Agustus kolom K, September kolom L).

| Pos | Agustus | September | Sel (Sep) |
|---|---|---|---|
| Revenue | 8.361.760.903,00 | 5.039.854.191,00 | `'PL - Management Report'!L12` |
| GP | 306.709.757,03 | −475.432.415,26 | L15 |
| NIBT | −26.517.860,51 | −910.058.539,73 | L51 |
| Kas | 495.363.150,28 | 102.996.959,86 | `'BS - Management Report'!L14` |
| Ekuitas | 1.612.612.014,63 | 702.553.474,90 | `'BS - Management Report'!L77` |

Angka DeepSeek (NIBT Sep −953,9 jt, ekuitas 658,7 jt) berasal dari salinan lain bernama sama di `Downloads` yang memuat
tambahan Commission 5.972.329 dan Storage 37.872.684 (lawan Accrued Expenses); total 43.845.013. Acuan v5.2 = berkas
di repo. Angka tidak diubah.

## GL lewat parser upload app (`tests/backtest/sep-2026/check-gl.ts`)

| Sheet | Baris `gl_line` | Rentang | Σ debit | Σ kredit | Selisih | Tanpa tanggal |
|---|---|---|---|---|---|---|
| `Agt 26` | 2.431 | 2026-08-01 → 2026-08-31 | 83.091.306.014,63 | 83.091.306.014,61 | 0,02 | 0 |
| `Sep 26` | 1.930 | 2026-09-01 → 2026-09-30 | 81.012.804.000,29 | 81.012.804.000,25 | 0,04 | 0 |

- Σ `Agt 26` sama dengan total yang tertulis di baris 2 sheet itu (F2/G2).
- Tipe `Agt 26`: Journal Voucher 379, Delivery Order 326, Sales Invoice 653, Purchase Payment 269, Sales Receipt 255,
  Purchase Invoice 393, Receive Items 56, Inventory Adjustment 12, Period End (Depreciation) 88.
- Tipe `Sep 26`: Bukti Jurnal 331, Faktur Pembelian 488, Pengiriman Pesanan 198, Faktur Penjualan 421, Penerimaan
  Penjualan 201, Pembayaran Pembelian 218, Penyesuaian Persediaan 2, Penerimaan Barang 69, FA Akuisisi 2.
- **52 baris tanpa tanggal** yang dilaporkan DeepSeek ada di `GL KGR Rev 1.xls` (1.942 baris, Σ debit
  81.300.134.506,31), bukan di sheet `Sep 26` (0 baris tanpa tanggal). Selisih kedua sumber: 12 baris dan Σ debit
  287.330.506,02. Parser kini melaporkan Σ debit/kredit dan tipe baris tanpa tanggal setiap kali ada (BT-1); untuk
  `GL KGR Rev 1.xls` angka itu menunggu berkasnya (D6).

## BT-1 (bug parser, diperbaiki)

1. Header `Nilai Debit`/`Nilai Kredit` tidak dikenali → debit/kredit null (perbaikan alias DeepSeek, dipertahankan).
2. **Kolom wajib GL**: tanggal, akun, debit, kredit tidak terpetakan → `ParseError` "Kolom wajib jurnal tidak
   terpetakan: …" (sebelumnya debit/kredit null tanpa issue). Baris tanpa debit dan kredit ditahan.
3. Alias Accurate `Kode Perkiraan` (akun) — tanpa itu sheet `Agt 26` ditolak (gagal-tertutup yang benar).
Tes (`packages/parsers/test/parsers.test.ts`, "BT-1 …") ditulis lebih dulu dan gagal pada kode lama: "expected
[Function] to throw an error", "expected ['MJ1','MJ1','MJ2'] to deeply equal ['MJ1','MJ1']"; lulus sesudah perbaikan.

## Langkah 2–4

Muat → rebuild → FINAL → bandingkan: bagian dari B6 (PROGRESS). Sumber GL Agustus–September di atas cukup; TB 31 Jul
dan DI dibaca dari sheet `TB Accurate` dan `DI - Note` berkas yang sama.
