# F4b — M4 Outlook bulanan (desain 1 halaman)

Acuan: PRD v3 §4.1 (`week`, `parameter`), §4.5, §6 (`/m/[month]`, `/m/[month]/tutup-buku`), §8 M4; PLAN Fase 4 (PR 4b). Memakai M5 (F4a) untuk biaya.

## Tabel / kolom — `20261016001000_m4_monthly.sql`

| Objek | Isi |
| --- | --- |
| `parameter` + | `v1_lock_day` (20, Q12), `forecast_tolerance_pct` (0,10, Q13) |
| `month_outlook` | bulan (hari pertama), cut-off (kosong = kemarin), status `open → v1_locked → v2 → final`, budget revenue / GP / NIBT (Q16) |
| `week.month_outlook_id` | FK (tautan minggu → bulan) |
| `month_outlook_version` | V1 / V2 / FINAL, `snapshot` jsonb + `snapshot_sha256`, total; **immutable** (trigger) |
| `outlook_assumption` | asumsi per bulan; `source` = engine (cut-off, run-rate, GP% 4 minggu, anomali, libur) / manual / kalibrasi |
| `closing_adjustment` | DI-xx: pos P&L, jumlah (tanda P&L), jenis, voucher, `posted`; seed DI-01…DI-05 September 2026 (FS, belum diposting) |
| `pl_daily` | data mart pk `(date, pl_line, basis)`: actual (journal, do_unbilled) / forecast (po, runrate, fixed, variable), `anomaly` |
| `outlook_accuracy` | per versi × metrik (bias, abs_err, MAPE, *_pre) × lingkup |
| trigger `needs_rebuild` di `gl_line` | jurnal baru membangun ulang bulannya |

RLS: semua baca; tulis admin + finance; `pl_daily` hanya lewat `mart_replace`.

## Engine — `packages/engine/src/monthly.ts`

```
actualDaily({gl, coa, from, to, unbilled})   jurnal per hari × pos (tanda v1) + DO belum difaktur (Ops, belum di-supersede)
runrateRevenue({...})                        rata-rata 20 hari kerja terakhir (Sen–Sab, tanpa libur) tanpa anomali (0 / > μ+3σ)
gpPctWindow(daily, cutOff, 28)               GP% 4 minggu terakhir
ordersFromWeek / unbilledFromWeek            PO berbobot (Confirmed 1, Tentative 0,7, Forecast 0,5) dinilai seperti outlook mingguan
forecastDays / forecastPlRows                hari ber-PO, hari run-rate, hari libur/Minggu 0; opex per hari dari driver M5
opexRemaining                                tetap = jadwal − jurnal; variabel = Rp/kg × kg; run-rate = bulanan × sisa hari / hari bulan
monthSummary(rows) · monthOutlook            outlook = aktual + forecast, rentang ± toleransi bagian forecast, butuh/hari vs budget
nthWorkingDay · bridge(V1, V2) · accuracy · calibrate · monthlyControls (C32) · versionDays · cumulative · closingTotals
```

## Halaman

`/m/[month]` (semua peran): KPI outlook / rentang / NIBT / % ber-PO / vs budget, grafik harian SVG (aktual, PO, run-rate, anomali), kumulatif, asumsi engine, versi + kunci (admin/finance), bridge V1→V2, akurasi, budget & cut-off, C32. `/m/[month]/tutup-buku` (admin, finance): penyesuaian DI, posting, kunci FINAL (akurasi + kalibrasi bulan berikut). Kunci snapshot `monthly` di rilis mingguan saat `m4_monthly` on. Rilis bulanan = versi terkunci (snapshot + SHA); PDF bulanan di F7.

## Fixture / golden — `fixtures/month-2026-08/` (`scripts/extract_fixtures.py month`)

Aktual 1–26 Agu = `O_PnL!G9` 6.385.876.039 / `G15` 347.403.254,84 (6.385,9 / 347,4 jt); PO 27–29 Agu 457,74 / 232,08 / 378,00 jt (mockup 457,8 / 232,1 / 378,0 — dibulatkan per segmen); 30 Agu (Minggu) 0. Target run-rate 31 Agu 258,7 dan total yang bergantung padanya → §E.4 (todo).

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Kolom `week.month_outlook_id` | nullable FK, v1 tidak membaca |
| Trigger `needs_rebuild` di `gl_line` memperlambat upload GL | satu insert antrian per tanggal (dedupe); builder M4 membangun satu bulan sekali per proses antrian |
| Outlook bulanan berbeda dengan blok mingguan v1 | PO dinilai dengan HPP mingguan v1 yang sama (`ordersFromWeek`); aktual = kolom MTD O_PnL |
