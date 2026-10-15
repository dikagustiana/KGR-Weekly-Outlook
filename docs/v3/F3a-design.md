# F3a — M3 Demand → rencana mingguan/harian (desain 1 halaman)

Acuan: PRD v3 §4.1 (`sales_line`), §4.4 langkah 1–5, §5 (`po_lines`, `forecast_sales`, `yield_matrix`, `lb_supply`), §8 M3; PLAN Fase 3 (PR 3a). Alokasi FEFO + cut-off = F3b.

## Tabel / kolom — `20261016000600_m3_planning.sql`, `20261016000700_m3_backfill.sql`

| Objek | Isi |
| --- | --- |
| `sales_line` + | `delivery_date`, `demand_status` (Confirmed/Tentative/Forecast), `sales_rep`, `po_ref`, `po_date`, `fulfilled_kg` (0), `price_floor_at_sale`, `discount_approval_id` |
| `parameter` + | `tentative_weight` 0,70, `forecast_weight` 0,50 (Q20), `downgrade_approval_threshold` 25 jt (Q10), `lead_time_days` 1 |
| `weight_class` | `code` pk, `min_kg`, `max_kg`, `avg_kg`, `sort_order` (seed `STD` 1,8–2,2 kg, rata-rata 2,0 — Q5) |
| `yield_matrix` | `weight_class × cut_pattern × key → yield_pct` (kg per kg LB), `effective_from/to`; `key` = key SKU, nama SKU (`sku_key.sku`, berlaku fresh+frozen) atau `cut_component` |
| `substitution` | `key_demand → key_substitute`, `priority`, `max_pct` (kosong, Q7) |
| `forecast_line` | rencana jual sales per minggu × key (upload `forecast_sales`) |
| `demand_weekly` | data mart, pk `(week_start, key)`: confirmed/tentative/forecast/berbobot, stok bebas layak, net, karkas setara, ekor, binding |
| `capacity` | per tanggal: `cut_capacity_head`, `chiller_kg`, `abf_kg` |
| `lb_supply` | tawaran/konfirmasi LB per tanggal × pemasok (upload `lb_supply`) |
| `plan_week`, `plan_day` | rencana PPIC (versi per minggu; surplus → frozen, Rp downgrade, approval > threshold); `plan_day` = pecahan harian |
| `allocation` | dibuat sekarang (dipakai F3b), unique `(sales_line_id, lot_ref)` |

Backfill: baris Order lama → `demand_status='Confirmed'`, `delivery_date = date` (v1: `date` baris Order = rencana kirim). Seed `weight_class` STD dan `yield_matrix` pola `karkas` (yield v1 × (1 − susut 3%)) dan `boneless` (I_Yield `KGR_Demand_Forecast.xlsx`), ditandai placeholder sampai PPIC mengisi.

RLS (PRD §2): PO line admin/sales (kebijakan `sales_line` v1 tetap); `forecast_line` admin/sales/commercial_lead; `weight_class`, `yield_matrix`, `capacity`, `plan_week`, `plan_day` admin/ppic; `lb_supply` admin/ppic/purchasing (upload Purchasing, PRD §5); `substitution` admin/ppic; `demand_weekly` tulis lewat `mart_replace`; `allocation` admin/sales/inventory_accounting (F3b). Semua terbaca peran aplikasi.

## Engine — `demand.ts`, `plan.ts`, `controls-v3.ts`

```
demandRate / forecastDaily               reproduksi I_Sales_History → O_Forecast (golden)
weeklyDemand({orders, forecasts, weights, weekStart})   Confirmed 100%, Tentative 70%, Forecast 50%
eligibleFree(lots, daysAhead, windows)   stok bebas yang masih layak pada tanggal kirim
netDemand({demand, free, substitutions}) stok sendiri → substitusi (prioritas, max_pct)
toHeads({net, yieldPct, avgLbKg})        ekor = ceil(max net/(avg LB × yield)); binding = SKU penentu
headsByPattern({net, yields, avgLbKg})   per pola potong: SKU eksklusif menentukan ekor pola; SKU bersama ditutup dari semua pola
jointEconomics(...)                      O_Optimizer: surplus frozen/salvage, profit bear/base/bull (golden)
weeklyPlan / dailyPlan                   plan_week (surplus, Rp downgrade, perlu approval) / plan_day (lead time, kapasitas, LB)
planningControls → C28 (PO lewat tgl kirim belum terpenuhi), C30 (ekor > kapasitas); C29/C31 di F3b
```

## Halaman

`/w/[week]/demand` (PO berbobot vs forecast vs stok bebas → net → ekor, SKU binding; semua peran yang memegang modul). `/w/[week]/rencana` (PPIC: simpan versi rencana, approval downgrade oleh admin/finance bila > threshold, kapasitas harian, tombol "Salin ke batch rencana" — tidak otomatis, supaya blok 2 paritas Excel tidak bergeser diam-diam). Upload: `po_lines`, `forecast_sales`, `yield_matrix`, `lb_supply` lewat wizard (flag `m3_planning`).

## Fixture / golden — `fixtures/demand-2026-09/` (`scripts/extract_fixtures.py demand`)

Forecast D7:K30 per SKU × skenario, ekor G6:I13, binding **BLD**, N = **7.051**, ekonomi C24:M31, profit B34:B40 (Base **70,8 jt**), freezer. B_Alokasi_Stok (2.000 kg dari 100 t) = F3b.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Kolom baru `sales_line` mengubah `computeWeek` | engine v1 tidak membaca kolom baru; `date` baris Order tetap tanggal rencana kirim (V13) |
| Upload `po_lines` mengganti Order v1 | `line_key = no_po|kode_item|n`, hanya baris `upload_id` kind ini yang diganti |
| Rencana menimpa `batch Rencana` | hanya lewat tombol "Salin ke batch rencana" (PPIC), bukan otomatis |
