# Perbaikan setelah uji pada salinan KGR-OS

Setelah migrasi v4 + v5 diterapkan di KGR-OS dan semua flag dinyalakan, layar Minggu ini berlubang (judul kosong, kartu dan grafik hilang), simulasi live bird tanpa basis, tanggal potong 17/10 untuk minggu 24–30 Agu, dan kartu dengan scroll di dalamnya. Semua angka v5 sebelumnya diuji dengan fixture tanpa database; di database sungguhan ada tiga bug yang tidak terlihat oleh mock.

## Cara uji

PostgreSQL 16 lokal berisi salinan KGR-OS (kondisi v3) + file `kgr-os-migrasi-v4-v5-sekaligus.sql` + SQL flag semua aktif; PostgREST v12.2.3 (Docker) di atasnya; `next build` + `next start` aplikasi ini dengan URL Supabase menunjuk ke PostgREST lokal (auth tiruan, kunci JWT lokal). Login Admin, Admin → Modul → Bangun ulang 1–31 Agu 2026, lalu Chromium membuka 59 halaman (semua menu, slicer, harga simulasi, bulan, filter).

## Hasil

| | Sebelum | Sesudah |
|---|---|---|
| Bangun ulang 1–31 Agu | 2 hari gagal (`sku_key.replacement_buy_price`), lalu 1 gagal (`ON CONFLICT … second time`) | 31 hari selesai, 0 gagal, cut-off 26 Agu |
| Minggu ini | judul kosong, Outlook minggu/bulan, Solvabilitas, grafik hilang; potong Sab 17/10; kas 0,0 | GP P&L −67,5 jt (−4,1%), revenue 1.656,8, Outlook Agustus 7.764,1 (GP 296,4), kas terendah 289,7 Jum 28 Agu, pendanaan −910,3; potong Jum 28/08 |
| Request ke PostgREST (59 halaman) | — | 2.706, semuanya 200 |
| Tile terpotong / scroll di dalam (lebar 2000 px) | kartu dan 7 tile | 0 |
| `check-query-columns.py` | `main`: 3 kolom tidak ada | 0 |

Bukti: `bukti/produksi-sebelum.png` (sama dengan layar di production sebelum perbaikan), `bukti/produksi-sesudah.png` (2000 px), `bukti/produksi-kas-sesudah.png`.

Yang masih beda dari mockup karena input belum diisi di KGR-OS (bukan kode): simulasi live bird (peta ukuran → kelas K/S/B dan yield per kelas dari PPIC), beban tetap belum dijurnal (jadwal beban tetap dari Finance), saldo kas per rekening (template kas harian dari Finance), Solvabilitas (neraca mingguan 26 Agu; mockup memakai laporan keuangan akhir Agustus).

## Untuk manusia di KGR-OS

Setelah PR ini di-merge dan Vercel selesai deploy: Admin → Modul → Bangun ulang data mart, Dari 2026-08-01 Sampai 2026-08-31. Tidak ada migrasi baru.
