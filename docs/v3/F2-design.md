# F2 — M2 Lot ledger + stok per SKU near-live (desain 1 halaman)

Acuan: PRD v3 §4.3, §6 (`/sku`, `/sku/[key]`), §8 M2; PLAN Fase 2.

## Tabel / kolom — `20261016000400_m2_ledger.sql`, `20261016000500_m2_backfill.sql`

| Objek | Isi |
| --- | --- |
| `sku_key` + | `storage_cost_per_kg_day`, `fresh_window_hours`, `frozen_age_limit_days` (kosong = default parameter) |
| `parameter` + | `blast_cost_per_kg` (0), `cut_off_time` (14:00, Q8), `fresh_window_hours_default` (48, Q8), `frozen_age_limit_days_default` (30, Q18) |
| `lot` | `lot_ref` (referensi engine), key, item, form, origin (`batch/trading/opening/conversion`), `origin_date`, `ledger_date` (scope mart), parent, kg/biaya masuk, `cost_per_kg_si`, `cost_per_kg_book`, `assumed` |
| `lot_movement` | `movement_ref` stabil, lot, tanggal, jenis, kg, biaya SI, biaya MA, sumber; `ref_table='manual'` = opname/koreksi (input) |
| `lot_balance_daily`, `sku_balance_daily` | data mart per hari (pk `(date, lot_ref)` / `(date, key)`), `projected` = termasuk rencana/order |
| `stock_card_snapshot` | kartu stok Accurate per tanggal × item (C26), upload kind `stock_card` |
| `blast_event` | blast fresh → frozen (PPIC; dipakai M3 cut-off) |
| `mart_table` + `keep_col/keep_values`, `mart_replace()` diganti | baris input di tabel mart (lot_movement manual) tidak pernah dihapus rebuild |
| trigger `needs_rebuild` | `sales_line`, `receipt_line`, `batch`, `blast_event`, `stock_card_snapshot`, `lot_movement` (manual saja) |

RLS: `lot`, `lot_movement`, `lot_balance_daily` tidak terbaca sales (SI per lot = detail finance); `sku_balance_daily` terbaca semua; tulis mart lewat `mart_replace` (peran penulis); opname = admin/inventory_accounting; blast = admin/ppic.
Backfill: tidak menghitung di SQL — mengantrikan setiap tanggal dari minggu pertama ber-stok-awal s.d. akhir minggu terakhir; engine membangun lot/mutasi/saldo saat antrian diproses.

## Engine — `packages/engine/src/ledger.ts`, `controls-v3.ts`

```
computeLedger(LedgerInputs) → {lots, movements, saleCosts, issues}      // lot per GRN / stok awal / blast; FIFO per item (Q6, Q11)
balanceAt(ledger, date, keys, params) → {perLot, perKey, totals}         // kg, bebas, terikat order, MA, SI, umur, jam ke cut-off, di atas umur
reconcile({ledger, balance, stockCard, bsInventory, reconcilingItems}) → C25 % assumed, C26 selisih per key, C27 selisih nilai
ledgerInputsFromWeek(WeekInputs)  keyResolver(itemMap)  frozenKeyOf(key)  ledgerControls(...) → C25–C27
```
MA per item code (cara Accurate) dengan biaya buku (GRN); SI per lot dengan biaya M1 (alokasi posted) bila ada. Hari < tanggal update = aktual saja; ≥ tanggal update = + rencana terima + order (sama dengan O_Stok).

## Halaman

`/sku` (saldo per SKU/grup, bebas/terikat, MA/SI, umur, di atas umur), `/sku/[key]` (lot → mutasi, form opname dan blast), kartu "Ledger lot (M2)" di `/w/[week]/stok` (penyusun) dengan C25–C27; kontrol dan kunci snapshot `ledger` di Kontrol/rilis saat flag on. Engine v1 tetap memakai `opening_stock`/`receipt_line`.

## Fixture / golden

Minggu contoh (`fixtures/week-2026-08-24`, tidak diubah): saldo awal per key = stok awal; roll-forward 162.687,92 → 156.956,05 kg dan **setiap hari × key = O_Stok** ± 0,01 kg; MA vs `hpp_actual`.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Ledger menggantikan stok v1 | tidak — paralel; v1 tidak membaca tabel ledger (Fase 8 baru memindahkan sumber stok) |
| Trigger `needs_rebuild` memperlambat upload v1 | satu insert antrian per tanggal (dedupe), security definer |
| Rebuild menghapus input | `keep_col` di `mart_table`; uji RLS + uji idempoten `mart_replace` |
