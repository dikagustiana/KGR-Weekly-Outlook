# F4a — M5 Biaya dengan driver (desain 1 halaman)

Acuan: PRD v3 §4.1 (`coa_map`, `cash_plan`), §4.6, §6 (`/m/[month]/biaya`), §8 M5; PLAN Fase 4 (PR 4a). M5 lebih dulu karena outlook bulanan M4 memakainya.

## Tabel / kolom — `20261016000900_m5_drivers.sql`

| Objek | Isi |
| --- | --- |
| `coa_map` + | `driver_type` (`fixed` / `variable` / `runrate` / `none`), `rp_per_kg`, `intercompany`, `driver_basis` (`kg_cut` / `kg_sold` / `kg_lb`); guard: Finance hanya boleh mengubah kolom driver |
| `cash_plan` + | `account_no`, `fixed_cost_schedule_id` (FK), `kind` (`plan` / `actual`) |
| `fixed_cost_schedule` | pos P&L, keterangan, nominal/bulan (boleh kosong), mulai/akhir, amortisasi + `prepaid_total`, afiliasi, vendor, hari bayar, aktif, `code` (seed) |
| Seed dari FS Sep 2026 | sewa RPA Rawa Terate (prepaid 1.133.790.000, amortisasi 1 Nov 2026 – 31 Okt 2027 → 94.482.500/bulan), depresiasi 10.393.461,35 (FS Jan–Agu), gaji / sewa ABF NMG / bunga **tanpa nominal** (catatan angka FS), deposit DS Solutions (nonaktif — deposit, bukan biaya bulanan) |
| Driver default (akun yang masih `none`) | COGS → variabel (kg potong); kirim, komisi, kemasan → variabel (kg jual); gaji, sewa, D&A, bunga, storage → tetap; lainnya → run-rate. Revenue / Other Income bukan pos biaya |

RLS: `fixed_cost_schedule` tulis admin/finance, baca semua peran kecuali sales (Q17); `coa_map` driver: finance (kebijakan baru + guard kolom).

## Engine — `packages/engine/src/drivers.ts`

```
monthlyAmount(row)                      nominal/bulan, atau prepaid ÷ jumlah bulan masa amortisasi
dailyFixed(schedule, date)              nominal ÷ hari kalender bulan, dalam [mulai, akhir], aktif
monthFixedOutlook(schedule, actualMtd, month) → per pos: jadwal (prorata hari berlaku), jurnal MTD,
                                          outlook = jurnal + max(0, jadwal − jurnal), baris tanpa nominal, over
variableCost(rpPerKg, kg)  workingDays(month) (Sen–Sab)  runrateDaily(bulanan, hari kerja)
costActualByLine(gl, coa, from, to)     Σ (debit − kredit) per pos P&L
driverControls → C33 (pos biaya tanpa driver: BELUM DIISI), C34 (jurnal MTD > jadwal: PERIKSA)
```

## Halaman

`/m/[month]/biaya` (admin, finance): KPI jadwal / jurnal / outlook pos tetap, C33–C34, outlook per pos, edit jadwal (tambah/ubah), driver per akun. Kontrol dan kunci snapshot `drivers` di Kontrol / rilis mingguan bila `m5_drivers` on.

## Fixture / golden — `fixtures/fs-2026-09/` (`scripts/extract_fixtures.py fs`)

Sewa RPA 1.133.790.000 ÷ 12 = **94,48 jt/bulan mulai 2026-11-01**; depresiasi 10,39 jt (Agu jurnal = jadwal, Sep jurnal 0 → outlook mengisi jadwal); gaji tanpa nominal → outlook = jurnal (Agu 85.565.549, Sep 82.677.332).

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Kolom baru `coa_map` mengubah P&L v1 | v1 hanya membaca `pl_line`, `bs_line`, `cf_category_as_counter`, `is_cash`; driver dibaca M5/M4 saja |
| Finance mengubah COA | guard `coa_driver_guard`: selain admin hanya kolom driver |
| Sewa RPA ganda (jadwal M5 + overhead M1 mode own mulai Nov) | dicatat V25: outlook P&L memakai jadwal M5; tarif overhead M1 hanya untuk COGS/kg per SKU |
