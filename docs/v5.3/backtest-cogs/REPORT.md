# Backtest COGS live bird Agustus–September 2026

Untuk: Dika (pemilik), reviewer v5.3 · 18 Okt 2026 · cabang `v5.3/bt-cogs` dari `main` `87c8c61` · kesiapan pilot 19 Okt.

**Pertanyaan:** apakah parser upload costing dan mesin costing app menghasilkan angka yang sama dengan sheet `Pot_*` di
workbook kerja COGS LB, per batch? **Jawaban:** ya. Untuk semua 36 batch yang terlihat (13 Agustus, 23 September), angka
dari parser dan `allocateBatch` sama dengan sel sheet: biaya total, nilai jual, COGS teralokasi, GP, dan COGS/kg di setiap
baris output (1.050 baris, termasuk 6 sheet tersembunyi). Sisa selisih semuanya punya sebab tertulis. Satu cacat parser
(BT-COGS-1) yang menggandakan batch saat upload sudah diperbaiki. Satu peringatan duplikat (BT-COGS-2) sudah ditambahkan.
Tiga temuan dicatat tanpa perbaikan (BT-COGS-3 sampai 5).

## 1. Sumber

Berkas asli tidak di-commit. Skrip membacanya dari `BACKTEST_DIR` (default `/home/user/backtest-data`).

| Berkas | sha256 | Sheet | `Pot_*` |
| --- | --- | --- | --- |
| `202608_Data_COGS_LB.xlsx` | `c38448f0a434333980825cff46f133ce506023425b4feaf04a62d72f0797ac68` | 23 | 17 (13 terlihat, 4 tersembunyi) |
| `202609_Data_COGS_LB.xlsx` | `82ecefe320c92153227fe6c11026e6c39129eb1fb9addd9e70854631e15a0a5a` | 33 | 27 (23 terlihat, 4 tersembunyi) |

Salinan lama September di `reference/202609_Data_COGS_LB.xlsx` (sha `790eb20b…`, sumber `fixtures/costing-2026-09`) hanya
berbeda di `Pot_ISA01` (lihat D-6). Fixture lama itu tidak diubah; penyegarannya menunggu Dika meng-commit versi baru ke
`reference/` (PRD v5.3, Pengujian dan fixture).

## 2. Lingkungan

- Node 22.22.0, `pnpm tsx`, vitest 3.2.7. SheetJS **0.18.5** lewat override lokal (`cdn.sheetjs.com` diblokir di container;
  production memakai 0.20.3). Override tidak di-commit.
- Jalur web (W) jalan di atas pengganti PostgREST di memori (`tests/backtest/cogs-lb/fake-sb.ts`, berlabel SETUP). Pengganti
  itu tidak meniru RLS, trigger (`tg_batch_cost_mode`, `allocation_run_c48`), atau pembulatan `numeric` di luar string
  tetap yang memang dikirim app. Kolom generated `allocation_run.diff` dihitung seperti di migrasi. Tidak ada DB, KGR-OS,
  atau `supabase/**` yang dipakai.
- Waktu jalan terakhir: 18 Okt 2026 ±17.35 UTC.

## 3. Metode

`pnpm backtest:cogs` (= `tsx --conditions=react-server tests/backtest/cogs-lb/run.ts`) mengulang semuanya dari nol untuk
setiap sheet `Pot_*` di kedua berkas.

| Jalur | Yang diuji | Kode |
| --- | --- | --- |
| sheet | Angka sheet sendiri: nilai cache sel, dicari lewat label templat. Selnya dicatat: `J5` kg LB, `K5` hasil potong, `L5`/`M5` susut, `B3` LB, `B4` angkut, `B5` potong, `F6` biaya BL, `B7` atau `F`+`F6` biaya total, baris total `K` nilai jual / `M` COGS / `O` GP, sel Est. GP Margin, kolom `L` per baris output | `run.ts` `sheetRef` |
| P | Parser upload costing: `readWorkbook` + `parseCostingWorkbook` | `packages/parsers/src/costing-wp.ts` |
| A | Mesin pada input parser: `allocateBatch(wpToAllocateInput(b))` | `packages/engine/src/costing.ts` |
| W | Builder web dari ujung ke ujung: jenis upload `costing_wp` `stage` → `commit` (per berkas, Agustus lalu September) → `allocateWeek` untuk setiap minggu yang tersentuh. Yang dibandingkan adalah `allocation_run`/`allocation_line` yang tersimpan | `apps/web/lib/v3/costing.ts` |
| S | `planCost` (rumus simulator K71, k = biaya ÷ nilai jual) dengan biaya angkut + potong (+ BL) aktual. Hanya jalan bila sheet punya kg LB | `packages/engine/src/costing.ts` |
| O | `parseUpload("ops_batch", [sheet])`: apakah upload batch tabular bisa membaca sheet `Pot_*` | `packages/parsers/src/tables.ts`, `stage.ts` |

Breakeven = (nilai jual − angkut − potong) ÷ kg LB beli, dari sel sheet, dibandingkan dengan `planCost`. Harga LB sheet =
`B3 ÷ J5`. k sheet = (`F` total + `F6`) ÷ `K` total.

Toleransi: Rp 1 untuk total, 0,01 untuk per kg dan kg, 1e-6 untuk rasio (k, susut %, GP ÷ biaya).

Kelas mengikuti `docs/v5.2/BACKTEST-SEP-2026.md` §3 langkah 4: **BUG**, **PARSER**, **DEFINISI**, **DATA**.

## 4. Ringkasan

| | Agustus | September |
| --- | --- | --- |
| Sheet `Pot_*` | 17 | 27 |
| Batch terlihat (diunggah) | 13 | 23 |
| Sheet tersembunyi berbentuk batch (tidak diunggah sesudah BT-COGS-1; tetap dicek di P/A/S) | 3 | 3 |
| Sheet skenario `Pot_ISA (2)` (bukan batch, dilewati parser) | 1 | 1 |
| Cek agregat (P/A/S/W): sama / selisih / tidak bisa (sel sheet kosong) | 240 / 5 / 96 | 576 / 28 / 46 |
| Baris output, COGS/kg jalur A (semua sheet terbaca) | 413/413 sama | 637/637 sama |
| Baris output, COGS/kg jalur W (batch terlihat) | 315/343 sama | 565/567 sama |
| Baris output, COGS/kg jalur S (batch dengan kg LB) | 144/144 sama | 536/567 sama |
| Batch tanpa selisih yang tidak dijelaskan | 13/13 | 23/23 |

Rincian selisih per kelas (batch terlihat):

| Kelas | Agustus | September | Isi |
| --- | --- | --- | --- |
| BUG / PARSER app pada angka | 0 | 0 | Parser dan mesin tidak pernah salah hitung. BT-COGS-1 dan 2 menyangkut sheet mana yang diunggah, bukan rumus. |
| DEFINISI | 1 (Pot_ISA8, 2 baris) | 2 (Pot_ISA16 2 baris; Pot_AGRO22 jalur S) | BT-COGS-4, BT-COGS-5 |
| DATA | 13 | 9 | D-1 sampai D-10 |

Cek golden PRD v5.3:
- **T24** (`Pot_ISA30`): biaya 500.894.761, nilai jual 477.473.300, GP −23.421.461, COGS/kg premium 38.814,96, grade A
  35.667,80, breakeven 23.553,76 (PRD: 23.553,8). Lulus di jalur A, S, dan W. Dikunci di
  `packages/engine/test/backtest-cogs.test.ts`.
- **Lampiran B** (7 batch 24–30 Sep): breakeven dan susut sama dengan tabel PRD (ISA30 23.554 · ISA29 24.444 · ISA28
  24.466 · ISA25 24.818 · AGRO25 23.418 · ISA24 23.714 · AGRO24 23.211).
- **O43**: yield atas kg diproses 24–30 Sep ISA 90,5–92,3%, AGRO24/25 84,3–85,3%. AGRO24 dan AGRO25 tidak punya baris usus
  dan lemak; AGRO25 juga tanpa jantung.

## 5. Tabel per batch

Kolom angka adalah sel sheet. "Baris L sama A/S/W" = jumlah baris output yang COGS/kg-nya sama dengan kolom `L` di jalur
A / S / W ("—" bila jalur itu tidak berlaku). Susut % ditulis apa adanya dari `M5` (lihat D-2).

- **sama** = semua cek P, A, S, W sama dengan sel.
- **sama¹** = semua cek yang bisa dihitung sama; sheet tidak punya kg LB dan/atau hasil potong (D-1), jadi susut, harga LB,
  breakeven, dan kadang jalur S tidak bisa dicek.
- **sama²** = semua angka app sama dengan sel; satu sel di sheet sendiri tidak konsisten dengan sel lain (D-2 atau D-3).

Upload `ops_batch` (jalur O) tidak mendeteksi header di satu pun dari 44 sheet. Ini DEFINISI, bukan bug. `ops_batch` adalah
upload tabular satu baris per batch (v1). WP per batch masuk lewat `costing_wp`.

### Agustus 2026 (`202608_Data_COGS_LB.xlsx`)

| Sheet | Tgl | kg LB (J5) | kg diproses (K5) | Susut % | LB Rp/kg | Angkut | Potong | BL | Biaya total | Nilai jual | k | GP | BE Rp/kg LB | Baris L sama A/S/W | Status | Kelas | Sebab |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pot_ISA11+Blasting (tersembunyi) | 2026-11-08 | — | — | — | — | 7.000.000 | 12.315.280 | — | 187.315.280 | 160.793.600 | — | −26.521.680 | — | 26/—/— dari 26 | tidak diunggah | DATA | BT-COGS-1 tersembunyi; D-4; D-3 |
| Pot_ISA10+Blasting (tersembunyi) | 2026-08-10 | — | — | — | — | 24.000.000 | 17.239.840 | — | 285.171.710 | 261.373.100 | — | −23.798.610 | — | 22/—/— dari 22 | tidak diunggah | DATA | BT-COGS-1 tersembunyi (varian Pot_ISA10 + blasting) |
| Pot_ISA20 REV | 2026-08-20 | — | — | — | — | 9.000.000 | 12.436.160 | — | 226.693.920 | 197.533.500 | — | −29.160.420 | — | 22/—/22 dari 22 | sama¹ | DATA | D-1; D-7 duplikat Pot_ISA20 (BT-COGS-2) |
| Pot_ISA31 | 2026-08-31 | 15.748,3 | — | — | 25.200,00 | 12.000.000 | 23.720.320 | — | 432.577.480 | 387.420.700 | 1,116557 | −45.156.780 | 22.332,59 | 32/32/32 dari 32 | sama¹ | DATA | D-1 (tanpa hasil potong); D-3 sel Est. GP Margin |
| Pot_ISA28 | 2026-08-28 | 15.537,2 | — | — | 25.412,04 | 15.000.000 | 23.472.480 | — | 433.304.480 | 381.390.800 | 1,136117 | −51.913.680 | 22.070,79 | 28/28/28 dari 28 | sama¹ | DATA | D-1 (tanpa hasil potong) |
| Pot_ISA27 | 2026-08-27 | 11.681,4 | — | — | 24.600,00 | 14.400.000 | 17.489.600 | — | 319.252.040 | 283.326.700 | 1,126798 | −35.925.340 | 21.524,57 | 28/28/28 dari 28 | sama¹ | DATA | D-1 (tanpa hasil potong) |
| Pot_ISA26 | 2026-08-26 | 12.089,6 | — | — | 24.148,14 | 13.500.000 | 21.762.080 | — | 327.203.440 | 286.644.200 | 1,141497 | −40.559.240 | 20.793,25 | 29/29/29 dari 29 | sama¹ | DATA | D-1 (tanpa hasil potong) |
| Pot_ISA25 | 2026-08-25 | 12.211,6 | — | — | 23.659,91 | 25.500.000 | 18.666.880 | — | 333.092.240 | 298.052.200 | 1,117563 | −35.040.040 | 20.790,50 | 27/27/27 dari 27 | sama¹ | DATA | D-1 (tanpa hasil potong) |
| Pot_ISA21 | 2026-08-21 | — | — | — | — | 9.000.000 | 11.685.760 | — | 215.978.820 | 186.502.300 | — | −29.476.520 | — | 24/—/24 dari 24 | sama¹ | DATA | D-1 (tanpa kg LB) |
| Pot_ISA20 | 2026-08-20 | — | — | — | — | 9.000.000 | 12.436.160 | — | 226.693.920 | 145.469.400 | — | −81.224.520 | — | 21/—/21 dari 21 | sama¹ | DATA | D-1; D-7 duplikat Pot_ISA20 REV (BT-COGS-2) |
| Pot_ISA19 | 2026-08-19 | — | — | — | — | 25.000.000 | 24.929.120 | — | 461.981.210 | 403.459.000 | — | −58.522.210 | — | 31/—/31 dari 31 | sama¹ | DATA | D-1 (tanpa kg LB) |
| Pot_ISA14 | 2026-08-14 | — | — | — | — | 18.000.000 | 23.557.280 | — | 432.097.462 | 372.441.000 | — | −59.656.462 | — | 31/—/31 dari 31 | sama¹ | DATA | D-1; D-3 sel Est. GP Margin |
| Pot_ISA11 | 2026-11-08 | — | — | — | — | 7.000.000 | 10.553.120 | — | 185.553.120 | 161.417.600 | — | −24.135.520 | — | 26/—/0 dari 26 | selisih W | DATA | D-4 tanggal 2026-11-08 → tidak tersimpan; D-1; D-3 |
| Pot_ISA10 | 2026-08-10 | — | — | — | — | 24.000.000 | 16.237.920 | — | 284.169.790 | 261.373.100 | — | −22.796.690 | — | 22/—/22 dari 22 | sama¹ | DATA | D-1 (tanpa kg LB) |
| Pot_ISA8 | 2026-08-08 | — | — | — | — | 9.000.000 | 10.500.800 | — | 188.200.800 | 148.122.000 | — | −40.078.800 | — | 22/—/20 dari 22 | selisih W (2 baris L) | DEFINISI + DATA | BT-COGS-4 (JLB0658 dipakai premium dan grade A); D-1; D-8 |
| Pot_ISA (tersembunyi) | 2026-08-08 | — | — | — | — | 9.000.000 | 10.500.800 | — | 188.200.800 | 148.122.000 | — | −40.078.800 | — | 22/—/— dari 22 | tidak diunggah | DATA | BT-COGS-1 tersembunyi (templat = salinan Pot_ISA8) |
| Pot_ISA (2) (tersembunyi) | — | — | — | — | — | — | — | — | — | — | — | — | — | — | bukan batch | DATA | sheet skenario (header baris 3), dilewati parser |

### September 2026 (`202609_Data_COGS_LB.xlsx`)

| Sheet | Tgl | kg LB (J5) | kg diproses (K5) | Susut % | LB Rp/kg | Angkut | Potong | BL | Biaya total | Nilai jual | k | GP | BE Rp/kg LB | Baris L sama A/S/W | Status | Kelas | Sebab |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pot_ISA11+Blasting (tersembunyi) | 2026-11-08 | — | — | — | — | 7.000.000 | 12.315.280 | — | 187.315.280 | 176.190.200 | — | −11.125.080 | — | 26/—/— dari 26 | tidak diunggah | DATA | BT-COGS-1 salinan Agustus di berkas September; D-4; D-3 |
| Pot_ISA10+Blasting (tersembunyi) | 2026-08-10 | — | — | — | — | 24.000.000 | 17.239.840 | — | 285.171.710 | 287.167.600 | — | 1.995.890 | — | 22/—/— dari 22 | tidak diunggah | DATA | BT-COGS-1 salinan Agustus (harga lebih baru) di berkas September |
| Pot_ISA30 | 2026-09-30 | 18.793,7 | 17.568,9 | 6,52 % | 24.800,00 | 9.000.000 | 25.811.001 | — | 500.894.761 | 477.473.300 | 1,049053 | −23.421.461 | 23.553,76 | 30/30/30 dari 30 | sama | — |  |
| Pot_ISA29 | 2026-09-29 | 19.357,6 | 18.248,4 | 5,73 % | 25.000,00 | 7.500.000 | 26.303.974 | — | 517.743.974 | 506.989.900 | 1,021212 | −10.754.074 | 24.444,45 | 30/30/30 dari 30 | sama² | DATA | D-3 sel Est. GP Margin |
| Pot_AGRO30 | 2026-09-30 | 8.960,2 | 8.686,1 | 3,06 % | 24.700,00 | 4.000.000 | 13.029.090 | 4.566.065 | 242.912.095 | 0 | — | 0 | −1.900,53 | 0/0/0 dari 0 | tanpa output | DATA | D-5 K11 = 0, BL ada; tidak dialokasikan (C48) |
| Pot_AGRO29 | 2026-09-29 | 9.061,9 | 8.755,5 | 3,38 % | 25.000,00 | 4.000.000 | 13.133.175 | 4.663.246 | 248.343.921 | 0 | — | 0 | −1.890,68 | 0/0/0 dari 0 | tanpa output | DATA | D-5 |
| Pot_ISA28 | 2026-09-28 | 19.855,3 | 18.635,0 | 6,15 % | 25.000,00 | 10.500.000 | 26.861.234 | — | 533.743.734 | 523.134.700 | 1,020280 | −10.609.034 | 24.465,68 | 30/30/30 dari 30 | sama | — |  |
| Pot_AGRO28 | 2026-09-28 | 9.822,0 | 9.179,9 | 6,54 % | 25.000,00 | 4.000.000 | 13.769.775 | 4.959.822 | 268.279.597 | 0 | — | 0 | −1.809,18 | 0/0/0 dari 0 | tanpa output | DATA | D-5 |
| Pot_AGRO25 | 2026-09-25 | 3.379,1 | 3.182,7 | 5,81 % | 25.000,00 | 1.500.000 | 4.774.050 | — | 90.751.550 | 85.405.905 | 1,062591 | −5.345.645 | 23.418,03 | 19/19/19 dari 19 | sama | — |  |
| Pot_ISA25 | 2026-09-25 | 16.426,9 | 15.604,5 | 5,01 % | 25.000,00 | 7.500.000 | 22.853.310 | — | 441.025.810 | 438.029.750 | 1,006840 | −2.996.060 | 24.817,61 | 27/27/27 dari 27 | sama | — |  |
| Pot_AGRO24 | 2026-09-24 | 9.800,1 | 9.089,8 | 7,25 % | 25.500,00 | 6.000.000 | 13.634.730 | — | 269.537.280 | 247.106.180 | 1,090775 | −22.431.100 | 23.211,14 | 21/21/21 dari 21 | sama | — |  |
| Pot_ISA24 | 2026-09-24 | 19.588,3 | 18.211,4 | 7,03 % | 25.500,00 | 16.800.000 | 26.971.360 | — | 543.273.010 | 508.291.100 | 1,068823 | −34.981.910 | 23.714,14 | 32/32/32 dari 32 | sama | — |  |
| Pot_AGRO22 | 2026-09-22 | 8.025,1 | 7.668,2 | 4,45 % | 25.108,67 | 4.000.000 | 11.502.375 | 1.796.683 | 218.798.628 | 203.100.410 | 1,077293 | −15.698.218 | 23.376,41 | 31/0/31 dari 31 | selisih S | DEFINISI | BT-COGS-5 BL di luar planCost; D-3; pola boneless, yield 72,8% |
| Pot_ISA22 | 2026-09-22 | 20.073,2 | 18.697,3 | 6,85 % | 25.030,17 | 19.500.000 | 26.951.036 | — | 548.886.676 | 521.665.150 | 1,052182 | −27.221.526 | 23.674,06 | 25/25/25 dari 25 | sama | — |  |
| Pot_ISA21 | 2026-09-21 | 21.000,5 | 19.413,3 | 7,56 % | 25.500,00 | 15.600.000 | 27.983.107 | — | 579.095.857 | 524.988.940 | 1,103063 | −54.106.917 | 22.923,54 | 28/28/28 dari 28 | sama | — |  |
| Pot_ISA18 | 2026-09-18 | 13.595,5 | 12.462,4 | 8,33 % | 25.500,00 | 10.400.000 | 18.396.234 | — | 375.481.484 | 341.653.600 | 1,099012 | −33.827.884 | 23.011,83 | 33/33/33 dari 33 | sama | — |  |
| Pot_ISA17 | 2026-09-17 | 13.400,0 | 12.448,6 | 7,10 % | 25.100,00 | 13.200.000 | 17.943.910 | — | 367.483.910 | 338.216.100 | 1,086536 | −29.267.810 | 22.915,84 | 37/37/37 dari 37 | sama | — |  |
| Pot_ISA16 | 2026-09-16 | 19.419,6 | 18.320,0 | 5,66 % | 24.847,41 | 16.500.000 | 26.839.613 | — | 525.866.333 | 512.788.500 | 1,025503 | −13.077.833 | 24.173,97 | 30/30/28 dari 30 | selisih W (2 baris L) | DEFINISI + DATA | BT-COGS-4 (JLB1284 premium dan grade A) |
| Pot_ISA10 | 2026-09-10 | 12.695,6 | 12.015,8 | −5,35 % | 25.300,00 | 15.000.000 | 17.320.055 | — | 353.518.735 | 359.320.050 | 0,983855 | 5.801.315 | 25.756,95 | 37/37/37 dari 37 | sama² | DATA | D-2 rumus susut terbalik (L5 = K5−J5) |
| Pot_ISA09 (2) | 2026-09-09 | 17.658,1 | 16.440,7 | −6,89 % | 25.178,93 | 18.000.000 | 24.022.607 | — | 486.634.647 | 491.506.000 | 0,990089 | 4.871.353 | 25.454,80 | 30/30/30 dari 30 | sama² | DATA | D-2 rumus susut terbalik; D-7 batch berbeda dari Pot_ISA09 |
| Pot_ISA09 | 2026-09-09 | 3.320,0 | 3.228,2 | 2,77 % | 25.000,00 | 3.000.000 | 4.653.257 | — | 90.653.257 | 94.536.625 | 0,958922 | 3.883.368 | 26.169,69 | 23/23/23 dari 23 | sama | — | D-7 batch kecil 9 Sep (3.320 kg), bukan duplikat |
| Pot_ISA07 | 2026-09-07 | 15.345,9 | 14.332,3 | 6,61 % | 24.600,00 | 15.000.000 | 20.659.151 | — | 413.168.291 | 400.675.980 | 1,031178 | −12.492.311 | 23.785,95 | 28/28/28 dari 28 | sama | — |  |
| Pot_ISA03 | 2026-09-03 | 3.875,5 | 3.694,6 | −4,67 % | 25.200,00 | 4.500.000 | 5.757.976 | — | 107.920.576 | 101.425.350 | 1,064039 | −6.495.226 | 23.524,03 | 22/22/22 dari 22 | sama² | DATA | D-2 rumus susut terbalik |
| Pot_ISA02 | 2026-09-02 | 4.500,0 | 4.149,6 | 7,79 % | 25.200,00 | 4.500.000 | 6.413.831 | — | 124.313.831 | 116.524.650 | 1,066846 | −7.789.181 | 23.469,07 | 21/21/21 dari 21 | sama | — |  |
| Pot_ISA01 | 2026-09-01 | 15.589,6 | 14.966,7 | 4,00 % | 7.670,72 | 4.050.000 | 6.472.080 | — | 130.105.584 | 417.614.250 | 0,311545 | 287.508.666 | 26.113,06 | 33/33/33 dari 33 | sama | DATA | D-6 biaya 30% (LB, angkut, potong), kg dan output penuh |
| Pot_ISA (tersembunyi) | 2026-08-08 | — | — | — | — | 9.000.000 | 10.500.800 | — | 188.200.800 | 181.918.750 | — | −6.282.050 | — | 22/—/— dari 22 | tidak diunggah | DATA | BT-COGS-1 templat (8 Agu) di berkas September |
| Pot_ISA (2) (tersembunyi) | — | — | — | — | — | — | — | — | — | — | — | — | — | — | bukan batch | DATA | sheet skenario, dilewati parser |

## 6. Temuan BT-COGS

| ID | Kelas | Temuan | Tindakan | Angka sebelum → sesudah |
| --- | --- | --- | --- | --- |
| BT-COGS-1 | PARSER | `parseCostingWorkbook` membaca sheet tersembunyi sebagai batch. Akibatnya: (a) templat `Pot_ISA` (salinan Pot_ISA8) dan `Pot_ISA10+Blasting` (varian Pot_ISA10) di berkas Agustus menjadi batch Aktual kedua untuk 8 dan 10 Agu, dan biayanya terhitung dua kali di cost pool dan alokasi; (b) berkas September memuat salinan tersembunyi `Pot_ISA`, `Pot_ISA10+Blasting`, `Pot_ISA11+Blasting` (tanggal Agustus/November) yang menimpa output batch Agustus dengan harga lain. | **Diperbaiki.** `readWorkbook` menandai `hidden`. `parseCostingWorkbook` melewati sheet tersembunyi, mencantumkannya di `hidden`, dan menulis peringatan di staging ("Sheet tersembunyi tidak dibaca sebagai batch: … — tampilkan (unhide) sheet di file bila memang batch potong"). Tes gagal dulu: `packages/parsers/test/costing-wp-hidden.test.ts` (workbook buatan sendiri). `costing-wp.test.ts` disesuaikan: golden `fixtures/costing-2026-09` tetap mencakup sheet tersembunyi (di-parse per sheet), nilai golden tidak berubah. | Minggu 3 Agu: 2 batch, Σ biaya run 376.401.600 → 1 batch, 188.200.800. Minggu 10 Agu: 3 batch, 1.001.438.962 → 2 batch, 716.267.252. Upload September mengubah 2 batch Agustus (nilai jual Pot_ISA10+Blasting 261.373.100 → 287.167.600; Pot_ISA 148.122.000 → 181.918.750) → tidak ada. |
| BT-COGS-2 | PARSER (peringatan) | `Pot_ISA20` dan `Pot_ISA20 REV` sama-sama terlihat, dengan tanggal dan biaya sama (226.693.920) tetapi output berbeda (nilai jual 145.469.400 vs 197.533.500). Keduanya disimpan sebagai dua batch, jadi biaya 20 Agu terhitung dua kali. Parser tidak bisa tahu mana yang berlaku. | **Peringatan ditambahkan, data tidak diakali.** Dua sheet dengan tanggal potong dan baris biaya sama → issue "Kemungkinan duplikat: … sembunyikan atau hapus sheet yang tidak berlaku sebelum commit". Keduanya tetap dibaca. Tes: `costing-wp-hidden.test.ts`. Pilihan sheet = keputusan Dika (D-7). | Minggu 17 Agu tetap 4 batch (1.131.347.870) sampai salah satu sheet disembunyikan. |
| BT-COGS-3 | BUG laten (tidak diperbaiki) | `batch_ref` = nama sheet (`wpBatchRef`), yang hanya unik per berkas. `Pot_ISA10`, `Pot_ISA11`, `Pot_ISA21`, `Pot_ISA25`, `Pot_ISA28` ada di kedua bulan. Pencarian batch per `batch_ref` tanpa minggu: `cost_pool_pi` R23 (`apps/web/lib/v3/costing.ts`, `Map` `actual` per `batch_ref` mengambil yang terakhir); `input-save.ts:169` dan `input-data.ts:178,187` (`limit(1)`); `input-save.ts:243` (`supplier_invoice` mengubah `invoice_status` semua batch Aktual dengan ref itu). Upload WP sendiri aman karena mencocokkan per minggu. PI yang membawa nomor dokumen WP juga aman (dicocokkan per `document_ref`). | Tidak diperbaiki. Perbaikan butuh konvensi `batch_ref` (mis. `2026-09/Pot_ISA10`, atau ref + tanggal di file PI dan faktur), yang mengubah isi kolom yang diketik pengguna, dan mungkin indeks unik (`supabase/**`). **Butuh keputusan Dika.** | — |
| BT-COGS-4 | DEFINISI (+ DATA) | App menyimpan satu `batch_output_sku` per (batch, key, kode item); constraint DB `unique nulls not distinct`. WP punya dua baris dengan kode sama dan harga berbeda: Pot_ISA8 `JLB0658` (AU 1.0 @ 30.000 dan AU 1.0 Grade A @ 24.000), Pot_ISA16 `JLB1284` (AU 1.8 @ 36.500 dan Grade A @ 35.000). App memberi COGS/kg campuran untuk kode itu: 37.252,58 vs sheet L18 38.117,39 / L57 30.493,91; 37.354,06 vs L27 37.430,87 / L68 35.892,62. Total biaya, nilai jual, dan GP tetap sama. | Tidak diubah. Satu kode item = satu SKU persediaan = satu biaya per kg. Sebab sebenarnya ada di data: baris grade A memakai kode premium. Cost Accounting memperbaiki kode di WP. | — |
| BT-COGS-5 | DEFINISI (masukan R95) | `planCost` hanya punya satu pool. "Biaya BL" Pot_AGRO22 (1.796.683, `F6`) di sheet dan di `allocateBatch` adalah pool kedua atas baris bernama "Boneless" (`SUMIF(H:H,"*Boneless*")`). `planCost` menyebarnya ke semua baris, jadi 31 baris COGS/kg berbeda (mis. L14 39.532,52 vs 39.859,84). `planCost.breakeven` juga ikut mengurangi BL: 23.152,53 vs 23.376,41 menurut rumus PRD. Biaya total, nilai jual, dan GP sama. | Tidak diubah. `planCost` adalah rumus K71 apa adanya. `simulateCogs` (R95, agen lain) perlu memutuskan BL: pool kedua atau di luar breakeven. | — |

## 7. Catatan data (DATA)

| ID | Sheet | Isi | Yang dipakai / saran |
| --- | --- | --- | --- |
| D-1 | Agustus: semua; `Pot_ISA8`–`Pot_ISA21`, `Pot_ISA20 REV`, `+Blasting` | Templat Agustus belum punya "HASIL POTONG" (K4/K5). Batch 8–21 Agu dan `+Blasting` juga tanpa "Total KG LB" (yield kolom J dibagi konstanta `E10` = 7000). Akibatnya susut, harga LB, breakeven, dan `planCost` tidak bisa dihitung. Di app `lb_kg` dan `processed_kg` kosong, jadi C22 dan yield tidak bisa dinilai. | Biaya dan alokasi tetap sama dengan sheet. Bila breakeven Agustus perlu, kg LB dan hasil potong harus diisi di WP (atau dari faktur LB). |
| D-2 | Sep `Pot_ISA10`, `Pot_ISA09 (2)`, `Pot_ISA03` | `L5 = K5 − J5` (di sheet lain `J5 − K5`), jadi susut tampil negatif (−5,35%, −6,89%, −4,67%). Padahal kg diproses < kg LB (12.015,8 < 12.695,6; 16.440,7 < 17.658,1; 3.694,6 < 3.875,5); susut sebenarnya **+5,35%, +6,89%, +4,67%**. App menghitung kg LB − kg diproses dengan benar. | **Koreksi PRD v5.3 R96 (bukti):** ketiga batch ini *tidak* punya `processed_kg > lb_kg`, jadi loader R96 tidak akan mengeluarkannya. Di Agu–Sep tidak ada batch dengan susut negatif. Dika memutuskan: pakai ketiganya (susut positif), atau tetap keluarkan dengan alasan lain. |
| D-3 | Agu `Pot_ISA31`, `Pot_ISA14`, `Pot_ISA11`, `Pot_ISA11+Blasting` (×2); Sep `Pot_ISA29`, `Pot_AGRO22` | Sel "Est. GP Margin" (`L8`/`L9`) = `SUM(K12:K64)/M11 − 1` (atau K11:K65). Rentangnya berhenti sebelum baris output di bawah baris 64–66 (grade A, lemak trimming), jadi sel itu tidak sama dengan `O`/`M` sheet sendiri. Contoh ISA29: sel −3,10%, dari total −2,08%. | App memakai total (`K`, `M`, `O`). Rentang rumus di WP perlu diperlebar. |
| D-4 | Agu `Pot_ISA11`, `Pot_ISA11+Blasting` (juga salinannya di berkas Sep) | Tgl. Potong tersimpan **2026-11-08**; maksudnya 11 Agu (diketik `11/08` dan dibaca sebagai bulan/hari). App melewati batch ini karena belum ada minggu November ("minggu untuk tanggal 2026-11-08 belum ada"). Bila minggu November sudah dibuat, batch akan tersimpan di November, dan `tg_batch_cost_mode` akan mengubahnya menjadi mode own (≥ 1 Nov). | Perbaiki tanggal di WP menjadi 2026-08-11 sebelum upload. Biaya 185.553.120 belum masuk costing Agustus. |
| D-5 | Sep `Pot_AGRO28`, `Pot_AGRO29`, `Pot_AGRO30` | Biaya ada (LB, angkut, potong, BL 4.959.822 / 4.663.246 / 4.566.065), tetapi belum ada output SKU (`K11` = 0). App mencatat "output kosong", tidak mengalokasikan, dan C48 menahan posting. Sel sheet `O11` = 0 bukan GP; jalur S memberi GP = −biaya. | Isi output sesudah data hasil potong AGRO masuk. Biaya 3 batch (759.535.613 termasuk BL) belum menjadi lot. |
| D-6 | Sep `Pot_ISA01` (versi 18 Okt) | LB = `398.611.680 × 30%` = 119.583.504; angkut 4.050.000 dan potong 6.472.080 (juga 30% dari versi lama). kg LB (15.589,6) dan output (nilai jual 417.614.250) tetap penuh. Hasilnya k = 0,3115, GP +287.508.666, harga LB 7.670,79/kg. Versi lama (`reference/`, sha `790eb20b…`): biaya 433.685.280, GP −16.071.030. App mengikuti sheet (sama). | **Butuh keputusan Dika:** batch ini dibagi (30% ke ISA01, 70% ke tempat lain)? Bila ya, output dan kg LB juga harus dibagi. Bila tidak, pakai biaya penuh. |
| D-7 | Agu `Pot_ISA20` / `Pot_ISA20 REV`; Sep `Pot_ISA09` / `Pot_ISA09 (2)` | ISA20 dan ISA20 REV adalah batch yang sama (biaya identik); REV tampaknya revisi output (nilai jual 197.533.500 vs 145.469.400). ISA09 dan ISA09 (2) adalah **dua batch berbeda** pada 9 Sep (3.320 kg vs 17.658,1 kg, biaya berbeda); keduanya berlaku. | Saran: pakai `Pot_ISA20 REV`, sembunyikan `Pot_ISA20` sebelum upload (BT-COGS-2 memperingatkan). Keputusan Dika. |
| D-8 | Agu `Pot_ISA8` baris 43 (dan templat `Pot_ISA`) | Usus 323,8 kg tanpa kode item. Tetap dialokasikan (app = sheet), tetapi tidak bisa dipetakan ke SKU. | Isi kode item di WP. |
| D-9 | Sheet tersembunyi (lihat BT-COGS-1) | `Pot_ISA10+Blasting` (biaya potong + 1.001.920 blasting) adalah varian dari `Pot_ISA10`. Salinannya di berkas September memakai harga baru (nilai jual 287.167.600). `Pot_ISA` adalah templat yang berisi data 8 Agu. | Yang dipakai: sheet terlihat (`Pot_ISA10`, `Pot_ISA8`). Bila biaya blasting 10 Agu memang harus masuk, tampilkan `+Blasting` dan sembunyikan `Pot_ISA10`. Keputusan Dika. |
| D-10 | Sep `Pot_AGRO22`, semua batch September | Kontrol C22 (Σ output ÷ hasil potong, batas 2%) memberi peringatan di setiap batch September: ISA 85,7–92,3% (ISA09 terendah), AGRO24/25 84,3–85,3%, AGRO22 72,8% (pola boneless: krk, kulit, sayap, TLP, tungir, lemak trimming; tanpa kepala, ceker, usus, HJA). Ini sifat data, bukan selisih costing. | Sesuai O43 (rentang wajar yield, keputusan PPIC). |

## 8. Yang butuh keputusan Dika

1. **D-6 `Pot_ISA01`:** biaya 30% dengan output penuh. Dibagi atau biaya penuh?
2. **D-7 / BT-COGS-2:** `Pot_ISA20` atau `Pot_ISA20 REV`? Sembunyikan yang tidak berlaku sebelum upload Agustus.
3. **D-9:** biaya 10 Agu dengan atau tanpa blasting (`Pot_ISA10` vs `Pot_ISA10+Blasting`)?
4. **D-4:** perbaiki tanggal `Pot_ISA11` ke 2026-08-11 di WP sebelum upload.
5. **D-2 / PRD R96:** koreksi kalimat bukti R96. ISA10, ISA09 (2), dan ISA03 bersusut positif; pakai atau keluarkan?
6. **BT-COGS-3:** konvensi `batch_ref` lintas bulan, sebelum file PI/faktur pemasok Agustus dan September diunggah
   berdampingan.
7. **BT-COGS-1:** konfirmasi aturan "sheet tersembunyi bukan batch". Bila sebuah batch sengaja disembunyikan, upload
   sekarang melewatinya dengan peringatan.

## 9. Berkas di repo

| Berkas | Isi |
| --- | --- |
| `tests/backtest/cogs-lb/run.ts` | Skrip backtest (`pnpm backtest:cogs`; `--json <file>`, `--write-fixture`) |
| `tests/backtest/cogs-lb/fake-sb.ts` | SETUP: pengganti PostgREST di memori untuk jalur W |
| `fixtures/backtest-cogs-2026-08-09/expected.json` | Per sheet: input hasil parse (tanggal, kg, biaya per komponen, baris output: kode item, kg, harga, flag boneless) dan sel acuan dengan rujukan sel. Juga hasil per cek. Tanpa nama pemasok, nomor faktur/PI, nama pelanggan, atau nama item. |
| `packages/engine/test/backtest-cogs.test.ts` | Selalu jalan (vitest, tanpa berkas asli): `allocateBatch` dan `planCost` memberi vonis yang sama per cek dengan backtest, termasuk T24 |
| `packages/parsers/test/backtest-cogs.test.ts` | Hanya jalan bila berkas asli dengan sha256 fixture ada di `BACKTEST_DIR`; di CI dilewati dengan alasan. Parser membaca setiap sheet menjadi input fixture. |
| `packages/parsers/test/costing-wp-hidden.test.ts` | Tes BT-COGS-1 dan BT-COGS-2 (workbook buatan sendiri) |
| `packages/parsers/src/workbook.ts`, `costing-wp.ts` | Perbaikan BT-COGS-1 dan peringatan BT-COGS-2 |

Gate dan hasilnya ada di pesan commit dan di §10.

## 10. Gate (18 Okt 2026, worktree `v5.3/bt-cogs`, container agen; SheetJS 0.18.5 override lokal)

| Gate | Hasil |
| --- | --- |
| `pnpm typecheck` | exit 0 (engine, parsers, web) |
| `pnpm test` (vitest) | engine 511 lulus · parsers 36 lulus (termasuk 2 tes berkas asli, karena `BACKTEST_DIR` ada; di CI 34 + 2 dilewati) · web 869 lulus |
| `pnpm parity` | 17161/17161 |
| `pnpm snapshot:diff` | EMPTY, byte-identical |
| `bash scripts/test-lint.sh`, `lint-k41.sh`, `lint-k42.sh`, `python3 -I scripts/lint.py missing` | lulus · K41 0 · K42 0 · MISSING 0 |
| `test-rls.sh`, e2e | tidak dijalankan: tidak ada SQL, tidak ada kode `apps/web` yang berubah |
