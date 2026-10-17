# Backtest September 2026: mesin KGR vs laporan keuangan final

Untuk: agen coding yang sedang mengerjakan PRD v5.2-A di repo lokal `KGR-Weekly-Outlook`.
Owner: Dika · 17 Okt 2026 · Status: instruksi kerja, berlaku bersama PRD v5.2-A (larangan Bab 7 tetap berlaku).

## 0. Tujuan

Jalankan mesin aplikasi dengan data September 2026 yang sudah final. Bandingkan setiap angka hasil mesin dengan laporan keuangan (FS) September dan rinciannya, lalu tangani setiap selisih menurut jenisnya:
- **bug** → perbaiki langsung, dengan tes;
- **definisi** atau **data** → catat dan jangan diakali.

Hasil akhir: mesin, bila diberi data September, menghasilkan angka FINAL September yang sama dengan FS (toleransi ±Rp 1), atau setiap selisih yang tersisa punya sebab tertulis.

## 1. Sumber data

Folder: `C:\Users\USER\Downloads\Back test\`

| Berkas | Dugaan isi (verifikasi di langkah 1) | Peran |
|---|---|---|
| `09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx` | FS final: `PL - Management Report`, `BS - Management Report`, `PL`, `BS`, `TB Accurate`, `GL SUMM`, `GL Aug Sep`, `DI - Note`, `DI - Sep wp`, `Stock`, `INVENTORY`, `AR`, `AP`, `FA`, prepaid, dll. | **acuan kebenaran** |
| `GL KGR Rev 1.xls` (17 Okt) | GL Accurate September, versi revisi | input jurnal (**pakai ini**) |
| `GL KGR.xls` (13 Okt) | GL versi lama | hanya untuk diff dengan Rev 1; catat perbedaannya |
| `Detail Sales September.xls` | rincian penjualan per faktur/pelanggan/SKU | input penjualan + cek revenue |
| `Valuation detail.xls` | valuasi persediaan per SKU/lot | cek nilai stok dan HPP |

**Aturan berkas:**
- Berkas asli **tidak boleh di-commit** ke repo.
- Baca berkas dari env `BACKTEST_DIR`. Folder kerja `backtest-data/` dimasukkan ke `.gitignore`.
- Yang boleh di-commit hanya angka agregat yang sudah ada di FS, laporan, dan kode/tes.
- Fixture tes untuk bug memakai data **minimal yang dibuat sendiri**, bukan salinan baris asli.
- Berkas `.xls` (format 97-2003) ditolak `UploadPanel` (R78). Untuk backtest, baca lewat SheetJS di skrip. Bila jalur upload app memang harus dipakai, kerjakan R78 lebih awal dan catat.

## 2. Lingkungan

- **Hanya DB lokal:** PostgreSQL 16 + `supabase/tests/supabase_shim.sql` + semua migrasi + seed, sama seperti `scripts/test-rls.sh` atau stack `tests/e2e`.
- **Dilarang** memakai KGR-OS (`pczjhmzpkknzkziipvit`) atau project pilot (`uxqbtverhnpiryhzbenr`).
- **Dilarang** mengubah `supabase/**`. Bila backtest butuh kolom atau tabel baru, catat sebagai Q-v5.2-n dengan rujukan PRD B, lalu lanjutkan bagian lain.
- Semua perintah dijalankan lewat satu skrip yang bisa diulang: `pnpm backtest:sep`, di `tests/backtest/sep-2026/`. Satu kali jalan: DB bersih → muat data → rebuild → finalisasi → bandingkan → tulis laporan.

## 3. Langkah

### Langkah 1 — Inventaris dan kebenaran FS

1. Daftar semua sheet di kelima berkas: nama, baris header, jumlah baris, dan total kolom angka utama. Simpan ke `docs/v5.2/backtest-sep/inventory.md`.
2. Bangun `expected.json` dari FS, dengan rujukan sel (sheet!sel) untuk setiap angka:
   - **PL Management Report, kolom September:**
     - Revenue b.12
     - COGS b.13
     - GP b.15
     - b.37
     - b.49
     - NIBT b.51
     - semua baris beban yang ada
   - **BS Management Report, 30 Sep:**
     - Kas b.14
     - b.17–18
     - Persediaan b.23–24
     - b.47–48
     - b.51
     - Ekuitas b.77
   - DI September (`DI - Note`, `DI - Sep wp`): kode, akun, nominal.
   - `TB Accurate` 31 Agu dan 30 Sep per akun.
3. Cek kewajaran sumber **sebelum** menyentuh app:
   - Σ GL Rev 1 per akun September = mutasi `TB Accurate` 31 Agu → 30 Sep, per akun.
   - Σ debit = Σ kredit.
   - Revenue di `Detail Sales September` = akun revenue di GL.
   - Total `Valuation detail` = persediaan BS 30 Sep.
   - Angka cek dari `fixtures/fs-2026-09/inputs.json`: revenue 5.039,9 jt, GP −475,4 jt, NIBT −910,1 jt, Kas 103,0 jt, Ekuitas 702,6 jt.

   Selisih di tahap ini adalah **selisih sumber**, bukan bug app. Catat dan laporkan; jangan lanjut ke langkah 2 bila ada selisih sumber di luar DI yang tercatat.

### Langkah 2 — Muat ke mesin

Urutan:
1. Saldo awal 31 Agu dari `TB Accurate` ke `tb_opening`. C12 harus seimbang.
2. Minggu September dibuat (`week`), yaitu minggu yang mencakup 1–30 Sep.
3. Jurnal GL Rev 1 lewat **parser jurnal Accurate yang dipakai app** (jalur `accurate_journal`).
4. Penjualan dari `Detail Sales September` lewat jalur upload penjualan/PO yang ada.
5. Stok dari `Valuation detail` lewat jalur stok yang ada.
6. DI September sebagai `closing_adjustment` posted.

Aturan pemuatan:
- Setiap jenis data **harus** lewat fungsi parser/commit yang dipakai app (`packages/parsers`, `apps/web/lib/upload.ts`, `lib/v5/input-save.ts`), dipanggil dari skrip.
- Bila suatu jenis tidak punya jalur, tulis loader minimal di `tests/backtest/` berlabel `SETUP`, dengan alasannya di laporan. Insert langsung ke tabel hanya untuk `SETUP`.
- Lalu rebuild semua tanggal 1–30 Sep, dan finalisasi bulan September (`finalizeMonthV4`).

### Langkah 3 — Bandingkan

Bandingkan dengan toleransi ±Rp 1 (default O26). Laporannya satu tabel per lapis:

| Lapis | Angka app | Acuan |
|---|---|---|
| L1 Buku besar | `gl_line` September per akun | GL Rev 1 dan mutasi TB |
| L2 Laba rugi FINAL | P&L FINAL September per baris (kolom jurnal) + NIBT | PL Management Report |
| L3 Neraca | neraca app 30 Sep | BS Management Report |
| L4 Kas | saldo bank 30 Sep | BS b.14 |
| L5 Persediaan | nilai stok app per SKU dan total | `Valuation detail`, sheet `INVENTORY`/`Stock` |
| L6 Penjualan | revenue per pelanggan/SKU | `Detail Sales September` |
| L7 HPP | COGS per grup, HPP per SKU (MA) | FS b.13 dan `Valuation detail` |

Untuk setiap baris tabel, isi kolom: angka FS (dengan sel), angka app (dengan sumber kode/tabel), selisih, **kelas**, sebab, status.

### Langkah 4 — Klasifikasi dan tindakan

| Kelas | Arti | Tindakan |
|---|---|---|
| **BUG** | rumus, parser, builder, atau loader app salah; dengan data yang benar hasilnya salah | **Perbaiki sekarang** (§4) |
| **PARSER** | berkas asli tidak terbaca, atau terbaca salah (format, desimal, tanggal, kode akun) | perbaiki parser, kecuali tebakan format membuatnya ambigu: tanya |
| **DEFINISI** | app memang menghitung berbeda dari FS. Contoh: "Selisih costing" dan biaya idle di COGS (A-CST-4/O24); `fs_mapping_reference` bergeser (A-LIVE-9); struktur baris beda | **jangan diubah diam-diam**. Catat dan rujuk nomor O. Boleh hitung versi pembanding di laporan. Kode mode `memo` (R66) hanya bila irisan A3 sudah sampai |
| **DATA** | input kurang atau salah di sumber, atau jenis data tidak bisa dimuat | catat; tidak ada perubahan kode |

### §4 Aturan perbaikan (BUG/PARSER)

1. Tulis dulu tes yang **gagal** dengan fixture minimal buatan sendiri.
2. Perbaiki, lalu tes lulus.
3. Jalankan semua gate: `pnpm test`, `pnpm typecheck`, `pnpm parity` (17.161/17.161), `pnpm snapshot:diff` (kosong), `pnpm test:rls`, lint K41/K42.
4. Jalankan ulang `pnpm backtest:sep`, lalu catat angka sebelum dan sesudah.
5. Satu commit per perbaikan di branch `v5.2/bt-sep`, dengan pesan `bt-sep: <ID> <ringkasan>`. ID temuan: `BT-n`, ditambah nomor R/temuan review bila sama (mis. `BT-3 = A-CST-1/R59`).
6. Bila perbaikannya sudah dijadwalkan di irisan lain PRD v5.2-A, boleh dikerjakan lebih awal. Tulis "R-n ditarik ke bt-sep" di laporan dan di deskripsi PR irisan itu nanti.

**BERHENTI dan tanya** (jangan perbaiki) bila:
- perbaikan mengubah golden v1, paritas, atau snapshot;
- perbaikan butuh `supabase/**` (migrasi, policy, RPC);
- perbaikan butuh keputusan pemilik (O15–O39) atau mengubah definisi angka;
- tiga kali mencoba masalah yang sama dan masih gagal;
- selisih tidak bisa dijelaskan setelah ditelusuri sampai baris jurnal.

Bila salah satu terjadi: tulis di laporan, lalu lanjut ke selisih berikutnya.

**Dilarang:**
- menambah baris penyesuaian, konstanta, atau `if bulan === '2026-09'` supaya angka cocok;
- mengubah `expected.json` supaya cocok dengan app;
- menulis "lulus" untuk lapis yang masih punya selisih tanpa sebab.

## 4. Keluaran

1. `docs/v5.2/backtest-sep/REPORT.md`, berisi:
   - ringkasan per lapis (jumlah baris, sama, selisih per kelas);
   - tabel L1–L7;
   - daftar BT-n (kelas, sebab, commit, angka sebelum/sesudah);
   - daftar yang menunggu keputusan pemilik dan PRD B;
   - lingkungan: DB lokal, commit, waktu.
2. `docs/v5.2/backtest-sep/inventory.md` dan `expected.json` (angka agregat FS + rujukan sel; tanpa baris transaksi).
3. `tests/backtest/sep-2026/`: skrip `pnpm backtest:sep`, bisa diulang dari nol.
4. Bila L2 dan L3 bersih, angka agregatnya dijadikan bahan `fixtures/fs-recon-2026-09` untuk R68.
5. PR `v5.2/bt-sep: backtest September 2026` ke `main`. Jangan merge sendiri. **BERHENTI — sign-off.**

## 5. Urutan dengan pekerjaan yang sedang berjalan

1. Selesaikan irisan yang sedang dikerjakan (A1) sampai titik BERHENTI-nya, lalu buat PR.
2. Buat branch `v5.2/bt-sep` dari branch A1, karena backtest butuh loader yang gagal-tertutup.
3. Kerjakan backtest. Irisan A2 dan seterusnya dilanjutkan sesudah backtest di-sign-off, kecuali pemilik bilang lain.
