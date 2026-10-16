# Irisan v5/2 — rancangan: laba rugi harian, mingguan, bulanan (K29–K31)

PRD v5 §4.7, K29, K30, K31, C55, G11. Flag `v5_pl` (mati): selama mati `pl_daily_v4`, Outlook bulan dan Minggu ini sama dengan `ebe4ad8`.

## Engine (`packages/engine/src/pl-v5.ts`)

```ts
FIXED_LINES_K29 = ["Salaries and allowance", "Depreciation & amortisation", "Interest Expense", "Rent Expenses"]
fixedNominals({ month, schedule: FixedCostRow[], lastFinal: { month, byLine } | null, defaultLines? }): FixedNominal[]
  // per baris tetap (jadwal 8.3 yang berlaku di bulan itu; tanpa jadwal = FIXED_LINES_K29):
  // nominal jadwal bila ada; baris tanpa nominal → FINAL terakhir baris itu, label "estimasi bulan lalu"; tidak ada → 0, "belum ada"
fixedEstimateRows({ month, cutOff, nominals, rows: PlRowV4[] }): PlRowV4[]       // basis 'fixed_estimate'
  // E(d) = max(0, nominal × hari_ke_d ÷ hari_kalender − Σ jurnal+forecast baris itu s.d. d); baris hari d = E(d) − E(d−1)
  // → per bulan tidak pernah negatif; outlook baris = max(nominal, jurnal + forecast) (K6); tanpa jurnal = 2,806 jt/hari
c55({ month, nominals }): ControlV3                                               // PERIKSA bila ada nominal estimasi / belum ada
plWeeks(month): { from, to }[]                                                     // Senin–Minggu dipotong batas bulan
plTable("rr" | "wk", month, { rows, cutOff, budget?, split? }): PlTable
  // baris: Revenue, COGS, Gross profit, GP %, Beban operasi (jurnal), NIBT menurut jurnal,
  //        Beban tetap belum dijurnal (estimasi), NIBT setelah beban tetap, NIBT %
  // rr: Actual s.d. cut-off · PO + run-rate · Outlook · % revenue · Budget;  wk: minggu kalender + total bulan
cumulativeSeries(metric: "revenue" | "cogs" | "gp" | "nibt" | "nibt_after", month, rows, cutOff, tolerance): CumulativeSeries
  // 31 titik; actual s.d. cut-off, outlook sesudahnya; band ± toleransi × |porsi forecast berjalan|
plTotalsV5(rows, "actual" | "forecast"): totals v4 + fixed + nibtAfter
```

`PlBasisV4` mendapat `'fixed_estimate'`. `totalsV4` dan `plRowsFromMart` (bawaan) melewati baris itu, sehingga semua angka v4 (kartu, versi, bridge, akurasi, minggu) tetap NIBT menurut jurnal. COGS/GP per hari forecast (K31) sudah keluar dari `monthPlanV4` (baris PO dan run-rate per hari); `plTable` dan `cumulativeSeries` membacanya per hari.

## Data

Tidak ada migrasi baru: `pl_daily_v4.basis` sudah menerima `fixed_estimate` (v5/0). Builder bulanan (flag hidup) menulis baris `fixed_estimate` dari jadwal `fixed_cost_schedule` (M5) dan FINAL terakhir (`month_outlook_version` FINAL → jurnal bulan itu per baris P&L). C55 masuk kontrol bulan dan pre-flight kunci V1.

## Layar

- Outlook bulan: tile "Laba rugi <bulan> (Rp jt)" baris 5–8 lebar 12, tombol Actual vs run-rate / Per minggu (default Actual vs run-rate), cara hitung, catatan temuan; grafik kumulatif dengan pilihan Revenue / COGS / Gross profit / NIBT jurnal / NIBT + beban tetap; kartu Actual / Forecast / Outlook memuat NIBT jurnal dan NIBT setelah beban tetap; headline menyebut keduanya.
- Minggu ini (Manajemen v4): tile "Laba rugi <bulan>" default Per minggu, kolom minggu terpilih disorot; tampilan "Aktual s.d. kemarin" memecah minggu berjalan.
- Pilihan tampilan lewat query string (`pl=rr|wk`, `cm=revenue|…`), tanpa state manager.

## Fixture

Tes golden dari `fixtures/month-2026-08` (jurnal + PO minggu contoh, cut-off 26 Agu), jadwal 8.3 = seed `20261016000900_m5_drivers.sql` (depresiasi 10.393.461; gaji dan bunga kosong; sewa berlaku Sep/Nov) dan FINAL Juli dari `fixtures/fs-2026-09` (gaji 52,2, bunga 24,4). Angka B.2 dicek ±0,1 jt; Σ kolom minggu = total bulan.

## Snapshot v1

`computeWeek` dan v1 tidak disentuh. Engine v4 hanya mendapat basis baru yang dilewati di agregasi lama; tes v4 tetap. Gate: snapshot EMPTY, parity 17.161/17.161.
