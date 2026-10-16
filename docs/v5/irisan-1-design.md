# Irisan v5/1 — rancangan: costing sebagai tulang punggung

PRD v5 §4.1, K20–K25, C53, C54, C57, G9. Flag `v5_costing` (mati): selama mati, ledger, Commercial dan P&L berjalan persis seperti `ebe4ad8`.

## Engine (`packages/engine/src/costing.ts`)

```ts
type CostStatus = "rencana" | "estimasi" | "sementara" | "final"
tariffPerKgLb({ freightPerKgLb, maklonPerKgProcessed, shrink }): Decimal          // 1.000 + 1.600 × 0,97 = 2.552
planCost({ status, kgLb, lbPrice, tariffPerKgLb?, directCost?, overhead?, outputs: { key, kg, priceRef }[], extraValue? }): PlanCostResult
  // cost_pool = kg_LB × harga_LB + (directCost ?? kg_LB × tarif) + overhead; k = cost_pool ÷ Σ nilai; cost/kg = k × harga acuan
  // breakeven = Σ nilai ÷ kg_LB − tarif − overhead/kg_LB; margin/kg LB = (Σ nilai − cost_pool) ÷ kg_LB; tanpa harga → missing
simulateLivebird({ basis: "need" | "batch", kgLb, outputs, extraValue?, tariffPerKgLb, overhead?, prices: Num[] }): LivebirdSimulation
needBasisOutputs({ kgLb, demand: { key, kg, priceRef }[], byProducts: { key, yield, priceRef }[] }): PlanOutput[]
costStatusOf({ date, wpReceivedAt, allocationPosted, invoiceStatus }, today): CostStatus
revalueLots({ date, mode: "cogs_line" | "restate_sale_date", lots: RevalueLot[] }): { rows, plRows }   // K22, O1
idleCostDaily({ rate: { period_start, period_end, basis_kg, rate_per_kg_lb }, actualKgLbByDate, dates }): { date, amount }[]  // Q63
c53(...), c54(...), c57(...): ControlV3
```

`allocateBatch` menerima `status` dan meneruskannya ke hasil. `commercialRows` menerima `cost_per_kg` + `cost_status` per SKU (opsional): bila ada, harga lantai = biaya + markup aturan (default 0, §4.6) dan margin dihitung dari biaya itu; baris membawa status dan tanda C54. Tanpa kolom itu (flag mati) hasilnya sama dengan sekarang.

## Data dan mart

- Migrasi `20261022000100_v5_costing.sql`: `commercial_daily.cost_per_kg`, `cost_status`, `cost_check`; view baru `commercial_daily_sales_v5` membawa ketiganya (biaya per SKU, bukan per lot; view lama tidak diubah supaya migrasi sebelumnya tetap bisa dijalankan ulang); `isCogsLine` mengenali `Selisih costing` dan `Biaya kapasitas idle`.
- Builder ledger (flag hidup): lot dari batch RPA tanpa alokasi terposting memakai biaya `planCost` batchnya (estimasi: kg LB × yield standar; sementara: output WP / penerimaan batch) sebagai biaya spesifik, `lot.cost_status` = status batch; lot trading dan stok awal `final`. `sku_balance_daily.cost_status` = status terendah lot yang masih ada.
- Builder commercial (flag hidup): biaya/kg dan status dari `sku_balance_daily`; C54 pada baris.
- `lot_revaluation` (mart) dan baris `pl_daily_v4` `Selisih costing` saat batch menjadi `final` (alokasi M1 diposting): Δ = final − sementara per kg; parameter `revaluation_sold_mode`.
- `pl_daily_v4` `Biaya kapasitas idle` basis `fixed` untuk mode RPA sendiri dengan tarif overhead ber-basis (Q63).
- Upload `costing_wp` mengisi `batch.wp_received_at`; `wp_due_at` dihitung dari tanggal batch + `wp_due_hours`/`wp_due_time`.

## Layar

- Costing minggu: tabel status biaya per batch (estimasi / sementara / final), cost pool, nilai, k, breakeven, margin per kg LB, biaya per SKU, C53 / C54 / C57.
- Komersial v4: kolom "Biaya Rp/kg" dan "Status biaya" (teks), "periksa biaya" untuk C54.
- K25 (flag hidup): headline, blok 2 (manajemen, preparer, cetak, PDF) dan "Ekonomi rencana" tanpa label TUNDA/BELI/NEGOSIASI; angka simulasi + "diputuskan Direktur Operasional".

## Kontrol

C53 (BELUM DIISI: batch lewat tenggat WP tanpa WP), C54 (PERIKSA: biaya/kg > `cost_anomaly_ratio` × harga acuan), C57 (BELUM DIISI: tanggal potong tanpa keputusan harga LB). C53 dan C57 tampil di kontrol costing; C54 di Commercial dan kontrol costing.

## Fixture

`fixtures/costing-sim-2026-08-24/` (`inputs.json` + `golden.json`): simulasi dua basis × delapan harga dari minggu contoh (Lampiran B.1). Basis kebutuhan dari PO 27–29 Agu (karkas fresh dan n/a) dan yield placeholder; basis batch dari blok 2 v1 (kg LB rencana, karkas berisiko frozen, nilai per kg LB).

## Snapshot v1

Tidak ada kode `computeWeek` yang disentuh. `commercialRows` dan `allocateBatch` hanya menerima kolom opsional; tes lama tetap. Gate: snapshot EMPTY, parity 17.161/17.161.
