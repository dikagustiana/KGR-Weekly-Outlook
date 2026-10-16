# Irisan v5/2: laba rugi harian, mingguan, bulanan

Branch `v5/2-pl` di atas `v5/1-costing`. Rancangan: `docs/v5/irisan-2-design.md`. Flag `v5_pl` (mati): selama mati `pl_daily_v4`, Outlook bulan dan Minggu ini sama dengan `ebe4ad8`. Tidak ada migrasi baru (basis `fixed_estimate` sudah diterima sejak v5/0).

## Isi

- Engine `packages/engine/src/pl-v5.ts`: `fixedNominals` + `fixedEstimateRows` (K29), `c55`, `plWeeks`, `plTable('rr' | 'wk')` (K30), `cumulativeSeries` lima ukuran (K31), `plTotalsV5`, `plBudgetOf`, `lineTotals`. `totalsV4` dan `plRowsFromMart` melewati baris `fixed_estimate`; `lockBlockers` menahan V1 pada C55. COGS/GP per hari forecast (Q26) dari baris `monthPlanV4`.
- Web: `lib/v5/pl.ts` (jadwal 8.3, FINAL terakhir dari jurnal, baris estimasi, C55) dipanggil builder bulanan saat flag hidup; catatan `month_lock` dan snapshot versi membawa sumber nominal; `lib/v5/pl-tiles.ts` (tile laba rugi, grafik kumulatif, kartu dan headline); Outlook bulan (`?pl=rr|wk`, `?cm=revenue|cogs|gp|nibt|nibt_after`) dan Minggu ini (default Per minggu, minggu halaman disorot, "Aktual s.d. kemarin" memecah minggu berjalan). Komponen: pilihan tampilan di kepala tile, kolom forecast miring, kolom sorot, merah hanya untuk negatif pada baris penentu, kartu sampai empat baris.

## Persyaratan → bukti

| Rujukan | Isi | Bukti |
|---|---|---|
| K29, C55 | beban tetap belum dijurnal; jadwal → FINAL terakhir "estimasi bulan lalu"; per hari kalender; tidak dobel | `pl-v5.test.ts` "K29 fixed costs not journaled yet" |
| K30 | dua tampilan, minggu kalender dipotong bulan, Σ minggu = bulan | "K30 plTable on August", `pl-screens.test.tsx` |
| K31, Q26 | COGS dan GP per hari forecast; grafik kumulatif lima ukuran, band hanya porsi forecast | "K31 COGS and GP per forecast day", tes grafik |
| G11 | `plTable('rr')` dan `plTable('wk')` = B.2 ±0,1 jt; C55 saat jadwal kosong | tabel di bawah |
| §6.1, §6.2 | tile laba rugi di Manajemen (Minggu ini) dan Outlook bulan; kartu dan headline NIBT jurnal + setelah beban tetap | `pl-screens.test.tsx` |
| aturan 2 | angka v4 tetap NIBT jurnal | "v4 totals stay on the journal", gate snapshot |

## Lampiran B.2 dari engine

`docs/v5/bukti/irisan-2-b2.txt` (Rp jt; fixture `month-2026-08`, jadwal seed 8.3, FINAL Juli dari `fs-2026-09`):
```
nominal: Depreciation & amortisation 10.39 (jadwal); Salaries and allowance 52.19 (estimasi bulan lalu); Interest Expense 24.44 (estimasi bulan lalu)

plTable('rr')
 | 01–26 | 27–31 | 01–31 | share | budget
Revenue | 6385.9 | 1378.2 | 7764.1 | 0.0 | —
COGS | -6038.5 | -1429.3 | -7467.7 | -0.0 | —
Gross profit | 347.4 | -51.0 | 296.4 | 0.0 | —
GP % | 5.4% | -3.7% | 3.8% | — | —
Beban operasi (jurnal) | -182.2 | -35.0 | -217.2 | -0.0 | —
NIBT menurut jurnal | 165.2 | -86.1 | 79.2 | 0.0 | —
Beban tetap belum dijurnal (estimasi) | -73.0 | -14.0 | -87.0 | -0.0 | —
NIBT setelah beban tetap | 92.3 | -100.1 | -7.8 | -0.0 | —
NIBT % | 1.4% | -7.3% | -0.1% | — | —

plTable('wk')
 | 01–02 | 03–09 | 10–16 | 17–23 | 24–30 | 31–31 | 01–31
Revenue | 809.0 | 1278.9 | 2136.7 | 1572.3 | 1656.8 | 310.4 | 7764.1
COGS | -649.1 | -1276.0 | -1948.3 | -1576.5 | -1724.3 | -293.5 | -7467.7
Gross profit | 159.9 | 2.9 | 188.4 | -4.2 | -67.5 | 16.9 | 296.4
GP % | 19.8% | 0.2% | 8.8% | -0.3% | -4.1% | 5.4% | 3.8%
Beban operasi (jurnal) | -2.0 | -27.8 | -35.0 | -106.8 | -38.5 | -7.0 | -217.2
NIBT menurut jurnal | 157.9 | -24.9 | 153.3 | -111.0 | -106.0 | 9.9 | 79.2
Beban tetap belum dijurnal (estimasi) | -5.6 | -19.7 | -19.7 | -19.7 | -19.7 | -2.8 | -87.0
NIBT setelah beban tetap | 152.3 | -44.6 | 133.7 | -130.6 | -125.6 | 7.1 | -7.8
NIBT % | 18.8% | -3.5% | 6.3% | -8.3% | -7.6% | 2.3% | -0.1%

GP per hari 27–31: -7.6 / -0.4 / -56.1 / -3.8 / 16.9 Σ27–30 -67.9
C55 PERIKSA - Salaries and allowance: estimasi bulan lalu (FINAL 2026-07) Rp 52186369; Interest Expense: estimasi bulan lalu (FINAL 2026-07) Rp 24441666; total estimasi Rp 76628035
```
Semua sel dalam ±0,1 jt dari B.2; selisih pembulatan dicatat di Q-v5-19.

## Bukti

Gate (`docs/v5/bukti/irisan-2-gates.txt`):
```
== typecheck
apps/web typecheck: Done
== test
packages/engine test:  Test Files  21 passed (21)
packages/engine test:       Tests  305 passed | 1 todo (306)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  13 passed (13)
apps/web test:       Tests  77 passed (77)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully in 9.1s
```

RLS: tidak ada tabel atau kebijakan baru di irisan ini; blok RLS tetap seperti v5/1 (21 blok lulus).

## Perintah untuk manusia (KGR-OS)

Tidak ada migrasi. Setelah `v5_pl` dihidupkan (bersama `m4_monthly`), Admin → Modul → "Bangun ulang data mart" untuk bulan berjalan supaya baris `fixed_estimate` dan C55 ditulis. Cek: `select count(*), sum(coalesce(actual,0)+coalesce(forecast,0)) from public.pl_daily_v4 where basis = 'fixed_estimate' and date between '<bulan>-01' and '<akhir bulan>';`. Finance mengisi nominal gaji dan bunga bulan berjalan di jadwal beban tetap (template 8.3) supaya C55 lulus.

## Default dan pertanyaan

O9 (grafik harian tetap revenue), O14 (1–2 Agu tidak diubah; kolom 1–2 dari jurnal). Pertanyaan baru Q-v5-19 sampai Q-v5-26.

## Snapshot dan parity

Tidak berubah (lihat gate). `computeWeek` tidak disentuh; baris `fixed_estimate` di luar semua total v4.
