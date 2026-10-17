# Backtest September 2026 — inventaris & kebenaran FS (Langkah 1)

## Lingkungan

- Branch `v5.2/bt-sep` (dari A1 `v5.2/a1-fail-closed`).
- FS: `09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx` (36 sheet, dibaca openpyxl `data_only`).
- **Blokir lingkungan (Langkah 2–4):** tidak ada PostgreSQL 16 / Docker / psql di mesin ini. Langkah muat-ke-mesin, rebuild, finalisasi, dan bandingkan belum bisa dijalankan sampai DB lokal tersedia (sama dengan `test:rls`).

## Sheet FS (36)

`BS - Management Report`, `PL - Management Report`, `PL - Performance`, `DI - Note`, `DI - Sep wp`, `GL Aug Sep`, `GL SUMM`, `TB Accurate`, `PL`, `BS`, `Stock`, `INVENTORY`, `AR`, `AP`, `AP 26`, `FA`, `PREPAID RENT`, `PREPAID OTHER`, `UNEARNED INCOME`, `RETAL DEPOSIT AR`, `RENTAL DEPOSIT AP`, `MANUAL DISPOS`, `Sep 26`, bulan `Jan 26`…`Agt 26`, `Okt 24`…`Des 24`, `Sheet1`, `Slide`.

- `DI - Note` 102×9; `DI - Sep wp` 6326×70; `TB Accurate` 223×40; `Stock` 96×4; `INVENTORY` 3×1.

## Kolom September

`PL/BS - Management Report` kolom **L** = September 2026 (baris 10 tanggal `2026-09-30`).

## Angka cek FS (kolom L) vs `fixtures/fs-2026-09/inputs.json`

| Pos | FS v2 (L) | fixtures | Selisih |
|---|---|---|---|
| Revenue | 5.039,9 jt | 5.039,9 jt | ✓ |
| GP | −475,4 jt | −475,4 jt | ✓ |
| NIBT | **−953,9 jt** | −910,1 jt | −43,8 jt ⚠️ |
| Kas | 103,0 jt | 103,0 jt | ✓ |
| Ekuitas | **658,7 jt** | 702,6 jt | −43,9 jt ⚠️ |

**Selisih sumber** (bukan bug app): NIBT dan Ekuitas FS v2 berbeda ~43,8 jt dari angka fixtures (yang "perlu dicocokkan ulang ke workbook asli" per REVIEW §7). Kemungkinan fixtures memakai versi FS/DI berbeda. Dicatat, **tidak diakali**. `expected.json` dibangun dari FS v2 (acuan kebenaran), dengan rujukan sel `PL!B12`…`BS!B77`.

## Berkas `.xls` (4)

`GL KGR Rev 1.xls` (input jurnal), `GL KGR.xls` (lama, diff), `Detail Sales September.xls`, `Valuation detail.xls`. Dibaca SheetJS (`.xls` BIFF; openpyxl tidak baca `.xls`). Inventaris sheet per berkas menyusul di `pnpm backtest:sep`.

## Status

- [x] Branch + doc + `expected.json` (PL/BS September).
- [x] Inventaris header 4 berkas `.xls` (SheetJS).
- [x] Parser `accurate_journal` membaca `GL KGR Rev 1.xls` utuh (lihat bawah).
- [ ] Cek Σ GL = mutasi TB; revenue Detail Sales = akun revenue GL; Valuation = persediaan BS.
- [ ] Langkah 2–4 (muat → banding → perbaiki) — **menunggu PostgreSQL 16 + Docker lokal**.

## Parser check (tanpa DB)

- **BT-1 (bug parser, diperbaiki)** — header Accurate `Nilai Debit` / `Nilai Kredit` tidak cocok alias `debit`/`kredit` → debit/kredit jadi null. Tambah alias `nilai debit`/`nilai kredit` (+ `nilai debet`/`nilai credit`). Tes: `parsers.test.ts` "Daftar Histori GL". Commit `2ca9292`.
- **GL KGR Rev 1.xls** (setelah BT-1): header terdeteksi di baris 5; **1.942 baris**, tanggal `2026-09-01`→`2026-09-30`; Σ debit `81.300.134.506,31` vs Σ kredit `81.300.134.506,27` (**selisih 0,04** — rounding sumber); 52 baris tanpa tanggal (penyesuaian akhir bulan) diabaikan; 0 baris tanpa debit+credit atau tanpa akun.

## Format sumber lain (catatan definisi, bukan bug)

- **Detail Sales September.xls** — "Rincian Penjualan" per faktur: header baris 5 = `No. Faktur`(2) `Tgl Faktur`(4) `Keterangan`(7) `Kuantitas`(9) `Unit`(11) `Jumlah`(13); nama barang (mis. "Ayam Karkas Mix") di baris 6. **Tanpa kolom kode item / pelanggan** — ini sumber **cek revenue** (bukan upload `sales_line`). Parser `accurate_sales` butuh kode item + pelanggan; pemetaan/cocok-cocok perlu disepakati (Q-v5.2 bila jadi input).
- **Valuation detail.xls** — kartu stok **per item** (bukan flat): `No. Barang`/`Deskripsi Barang` di baris 4–5, lalu header ledger di baris 7 = `Tanggal`(0) `Tipe`(2) `No. Faktur`(6) `Kts. Masuk`(8) `Nilai masuk`(12) `Kts. Keluar`(15) `Nilai keluar`(21) `Kuantitas`(23) `Nilai Akhir`(25). Beda struktur dari parser `accurate_inventory` (yang flat "Kode Barang" per baris). Dipakai untuk **cek nilai stok & HPP**, bukan upload langsung.
