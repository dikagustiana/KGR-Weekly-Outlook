# F5 — M6 Kas, CCC, solvabilitas (desain 1 halaman)

Acuan: PRD v3 §4.7, §5 (`cash_daily`), §6 (`/kas`, `/kas/ccc`), §8 M6; PLAN Fase 5.

## Tabel — `20261016001100_m6_cash.sql`

| Objek | Isi |
| --- | --- |
| `bank_account` | no. rekening, bank, nama, mata uang, akun COA, aktif (dibuat otomatis saat upload) |
| `cash_daily` | saldo awal / akhir per tanggal × rekening (unique), upload template |
| `cash_daily_plan` | rencana masuk (+) / keluar (−) per tanggal, kategori CF, tautan `fixed_cost_schedule`, status `plan/done/cancelled`, `line_key` |
| `cash_position_daily` | data mart per tanggal: saldo, rencana masuk/keluar, proyeksi, **terendah 13 minggu** + tanggalnya |
| `ccc_daily` | data mart: DIO / DSO / DPO / CCC, HPP & penjualan per hari, jendela hari, modal kerja |
| `solvency_monthly` | data mart per bulan: ekuitas, modal disetor, hutang/piutang afiliasi, bulan sampai ekuitas negatif |

RLS: baca admin / finance / management; tulis admin / finance; mart lewat `mart_replace`. Trigger `needs_rebuild` di `cash_daily`, `cash_daily_plan`.
Template: `reference/templates/Template_Kas_Harian.xlsx` dibuat oleh `scripts/make_cash_template.py` (sheet Saldo, Rencana; dropdown kategori CF dari seed `coa_map`).

## Engine — `cash.ts`, `ccc.ts`

```
balancesOn(rows, date)                      saldo terakhir per rekening (dibawa bila tidak ada baris hari itu)
scheduledPayments(schedule, plans, cashDay) pembayaran jadwal biaya tetap (cash_day_of_month) yang belum direncanakan; prepaid amortisasi bukan kas
cashProjection({start, balances, plans})    per hari + 13 minggu (Senin), terendah
cashProjection12m({nibtOutlook, depreciation})  NIBT outlook bulan + D&A (non-kas), dipertahankan tetap
solvency({...})                             ekuitas / modal, afiliasi, bulan sampai ekuitas negatif = ekuitas / −NIBT
ccc({inventory, ar, ap, cogs, revenue, windowDays}) · simulateCcc(termin LB/trading × porsi, target hari stok)
cashControls → C35 Σ rekening = kas neraca (± Rp 1), C36 hari kerja tanpa upload kas, C37 utang bersaldo debit di proyeksi (D4)
```

## Halaman

`/kas` (admin, finance, management): saldo per rekening, terendah 13 minggu, ekuitas + afiliasi + bulan sampai ekuitas negatif, 12 bulan, 13 minggu, rencana, C35–C37. `/kas/ccc`: CCC, modal kerja, simulasi termin dan hari stok (form GET, engine). Kunci snapshot `cash`, `ccc`, `solvency` di rilis mingguan saat `m6_cash` on.

## Fixture / golden — `fixtures/fs-2026-09/`

Ekuitas Sep **702,6 jt** (L77), modal **5.000 jt** (L68), hutang afiliasi **9.845,9 jt** (L51); bulan sampai ekuitas negatif pada NIBT Sep −910,1 jt = 0,8; DI-01 48,35 · DI-02 48,08 · DI-03 12 · DI-04 62,45 + 69,66 (sama dengan seed M4); CCC Sep (Jul–Sep 92 hari): DIO 37,5 · DSO 4,5 · DPO 0,8.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Dua angka kas (blok 5 v1 vs M6) | D5: manajemen memakai posisi M6; blok 5 v1 tidak diubah |
| Ekuitas/afiliasi dihitung ulang | dibaca dari neraca mingguan v1 (kolom kemarin), tidak dihitung dari jurnal |
