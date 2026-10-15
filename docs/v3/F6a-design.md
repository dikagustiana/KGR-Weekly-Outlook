# F6a — M7 Commercial view (desain 1 halaman)

Acuan: PRD v3 §4.8, §6 (`/komersial`), §8 M7, Q15 / Q17 / Q18 / Q19; PLAN Fase 6 (PR 6a). Approval diskon + scorecard = F6b (flag `m7_approval`).

## Tabel — `20261016001200_m7_commercial.sql` (seluruh model M7)

| Objek | Isi |
| --- | --- |
| `parameter` + | `sales_sees_cost` (true, Q17), `discount_limit_rp_per_kg` (500, Q19) |
| `sales_assignment` | sales_rep, **email** (login), customer / key (kosong = semua) |
| `sales_target` | target kg / Rp per minggu × sales × key |
| `urgency_rule` | seed Q18: fresh 0 hari aman, ≥ 1 hari jual hari ini; frozen ≤ 21 aman, 22–30 jual minggu ini, ≥ 31 di atas batas umur |
| `price_floor_rule` | markup Rp/kg + % per key / grup, berlaku mulai |
| `discount_approval` | dipakai F6b |
| `commercial_daily` | data mart per tanggal × key (termasuk SI per lot → tidak terbaca sales) |
| view `commercial_daily_sales` | daftar kolom yang sama **tanpa** `cost_per_kg_si` (tanpa perhitungan) untuk sales |
| `sales_scorecard_weekly` | data mart F6b |

## Engine — `packages/engine/src/commercial.ts`

```
urgency(rules, age, form)                     status Q18 (aturan dengan age_from terbesar yang cocok)
priceFloor({...})                             MA + markup aturan paling spesifik (key → grup → umum); default storage × 7 + blast
commercialRows({date, items, rules})          bebas kg, umur, MA/SI, lantai, daftar, margin daftar / 7 hari, rugi simpan/hari,
                                              risiko downgrade (fresh: (fresh − frozen) × kg), prioritas, ranking (urgensi → prioritas)
realizedPrice(sales) · belowFloor(...) · commercialControls → C38 (F6b) / C39 / C40 · scorecard(...) (F6b)
```

## Halaman

`/komersial` (admin, sales, commercial_lead, management, finance): ranking, status, bebas kg, umur, biaya/kg (sales: hanya bila `sales_sees_cost`), harga lantai, daftar, margin, harga 7 hari, rugi simpan, risiko frozen, order hari ini; sales melihat SKU penugasannya (`sales_assignment.email`), tanpa penugasan = semua SKU dengan catatan. `/komersial/[key]`: 14 hari + order terbuka. View model `lib/v3/commercial-view.ts` (murni, diuji: DOM sales tanpa SI / cost pool / batch_ref).

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Sales melihat biaya per lot | RLS `commercial_daily` menolak sales; sales membaca view tanpa kolom SI; view model membuang SI untuk sales |
| Ranking berbeda dengan stok v1 | sumber stok = data mart M2 (`sku_balance_daily`), bukan dihitung di halaman |
