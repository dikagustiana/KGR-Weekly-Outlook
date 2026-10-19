# Data keuangan September 2026 di KGR-OS (19 Okt 2026)

Permintaan Dika: "masukin sekalian semua informasi keuangan untuk september". Log langkah dan tabel cek ada di
`docs/v5.2/kgr-os-log.md` § 19 Okt. Berkas sumber tidak di-commit (repo publik); sha256-nya:

| Berkas | sha256 | Dipakai untuk |
| --- | --- | --- |
| Valuation detail.xls | `fde88d15…9345` | stok awal tiap minggu (saldo hari Minggu), kartu stok 31 Agu dan 30 Sep |
| 202609_Data_COGS_LB_1.xlsx | `1a97eb3a…0021` | upload `costing_wp`: 23 batch, 662 baris; alokasi HPP |
| 09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx | `fb2e3cf1…38f3` | GL Agu–Sep sudah dari sheet "Agt 26"/"Sep 26" (dicek: GL aktif 4.373 baris, md5 sama dengan pemuatan ulang) |
| GL_KGR_Rev_1.xls | `5b7e8fe0…e8df` | **tidak dimuat**, lihat di bawah |

## Yang sekarang ada

- 5 minggu baru: 31 Agu, 7, 14, 21 Sep (`closed`) dan 28 Sep (`open`, tanggal update 1 Okt). Minggu 24 Agu ditutup oleh
  rollover. TB awal tetap 31 Jul (rollover menyalin TB, tidak menggantinya).
- Stok awal 598 baris (89–96 barang per minggu) dari Valuation.
- COGS LB: 23 batch, 566 baris output SKU, 20 alokasi berstatus **draft**, plus 1 pool biaya September dengan 73 baris
  (Σ Rp 8.282.013.237,58). Σ biaya teralokasi Rp 7.522.477.624,64.
- Kartu stok: 31 Agu 89 barang Rp 4.339.201.189,20; 30 Sep 96 barang Rp 6.427.173.783,46.
- Parameter, run-rate, harga SKU: salinan dari minggu 24 Agu, seperti rollover.

## Yang belum, dan perlu orang

1. **Posting alokasi**: 20 alokasi masih draft. Cost Accounting/Admin memeriksa lalu memposting di layar Costing.
2. **Tiga batch tanpa output** (AGRO28, AGRO29, AGRO30): biayanya tercatat, tapi tidak bisa dialokasikan sampai output-nya diisi.
3. **Kode barang belum dipetakan** ke key SKU: PLK003, PLK004, PLK0005–7 (plastik), JLB0933, JLB0961, JLB0435, JLB0630,
   JLB0167, JLB0199. Nilainya tetap ikut total stok; tanpa key, barang ini tidak masuk tile per SKU.
4. **GL Rev 1 tidak dimuat.** Saldo enam akunnya berbeda dari FS/TB final v2. GL yang aktif sekarang = sheet "Sep 26"
   FS v2, sehingga laporan cocok dengan FS final. Kalau Rev 1 yang benar, upload GL lewat layar Upload (versi lama
   otomatis digantikan).
5. **Valuation ≠ neraca**: nilai persediaan Valuation per 30 Sep tidak sama dengan saldo persediaan di BS (cek F-2 akan
   menandainya). Ini selisih sumber, bukan kesalahan pemuatan.
6. **Angka minggu lalu (lw_\*)** di minggu baru berasal dari proyeksi, karena belum ada rilis di minggu-minggu itu.
7. **Bangun ulang**: halaman membaca hasil hitungan yang dibangun oleh antrean rebuild (30 tanggal September sudah antre).
   Cron menjalankannya, atau Admin membangun ulang di Admin → Modul.
8. Upload yang tercatat menunjuk path storage salinan lokal; berkas aslinya **tidak** ada di storage KGR-OS (unduh ulang
   dari riwayat upload tidak bisa). Baris pratinjau (`upload_row`) tidak ikut.

## Mengulang

```
python3 -I tests/backtest/sep-2026/export-delta.py snapshot      # salinan lokal, sebelum pemuatan
BACKTEST_DIR=<folder berkas> pnpm tsx --conditions=react-server tests/backtest/sep-2026/load-sep.ts mirror-gl
BACKTEST_DIR=<folder berkas> pnpm tsx --conditions=react-server tests/backtest/sep-2026/load-sep.ts
EXPORT_CHUNK=9000 python3 -I tests/backtest/sep-2026/export-delta.py export <out>
```

Stack lokal dan variabel lingkungan: lihat kepala `load-sep.ts`. Hasil ekspor hanya untuk KGR-OS dengan keadaan awal yang
sama (berkas 00-guard menolak selain itu).
