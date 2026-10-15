# F1 — M1 Costing per batch → SKU (desain 1 halaman)

Acuan: PRD v3 §4.1–4.2, §5 (`costing_wp`, `cost_pool_pi`), §6 (`/w/[week]/input/costing`, `/w/[week]/costing`), §8 M1; PLAN Fase 1.

## Tabel / kolom — `20261016000200_m1_costing.sql`, `20261016000300_m1_backfill.sql`

| Objek | Isi |
| --- | --- |
| `batch` + | `cost_mode` (`maklon`/`own`), `head_count`, `avg_lb_kg`, `weight_class`, `cut_pattern`, `costing_status` (`none/uploaded/allocated/posted`), `cost_pool_id` — kolom `out_*` v1 tetap |
| `sku_key` + | `group_code` (KARKAS, BLD, BLP, PARTING, BYPRODUCT), `cut_component` (karkas, dada, paha, …) — diisi backfill bila kosong |
| `parameter` + | `by_product_method` (joint, Q1), `yield_gap_tolerance` (0,02, Q4), `avg_lb_kg_default` (2,0, Q5), `selling_cost_per_kg` (0) |
| `cost_pool` | periode (bulan), mode, `total_pi`, `total_gl`, `tie_out_diff` (generated), status |
| `cost_pool_line` | komponen (LB, freight, maklon, labour, overhead, blast, other), dokumen (PI), `batch_id` (biaya langsung) atau kosong (biaya periode), sumber Ops (WP) / Accurate (PI) |
| `batch_output_sku` | batch × key × item: kg, `pct_of_processed`, `price_ref` (harga daftar WP); unique `(batch_id, key, item_code)` nulls not distinct |
| `overhead_rate` | periode, `rate_per_kg_lb`, `basis_kg`, budget |
| `allocation_run` / `allocation_line` | hasil engine per batch: total biaya, teralokasi, `diff` (generated), status `draft/posted/superseded`; per baris: kg, harga, nilai jual, share, biaya, biaya/kg, NRV |

RLS: cost pool, baris, tarif, alokasi — baca semua peran **kecuali sales** (Q17), tulis admin + cost_accounting; `batch_output_sku` baca semua, tulis admin/cost_accounting/ppic; `cost_accounting` boleh insert/update `batch` (WP). Index `(batch_id)`, `(allocation_run_id, key)`, `(cost_pool_id)`.

## Engine — `packages/engine/src/costing.ts`, `controls-v3.ts`

```
allocateBatch({batch, outputs, costLines, overheadRate?, options:{byProductMethod, sellingCostPerKg}}) → AllocationResult
computeCostPool({lines, glTotal}) → {totalPi, totalGl, diff, tied, byComponent, direct, period}
groupCostPerKg(lines, groupOf) → per group_code {kg, cost, costPerKg, salesValue}
idleCapacity(rate, actualKgLb) → {idleKg, idleCost}      overheadBasisKg(batch)   yieldGap(processed, output)
costComponentOf(label)   poolsOfItemName(name)          costingControls(...) → C21–C24
```
Relative sales value = rumus kolom L WP: `L = ((K/K_total)·F_total)/(F+I)`, `K = harga × (F+I)`; pool sekunder "Biaya BL" hanya ke item bernama *Boneless* (Excel `SUMIF(H,"*Boneless*")`). Mode own: + overhead `head_count × avg_lb_kg × rate`; kapasitas idle = biaya periode.

## Parser — `packages/parsers/src/costing-wp.ts`, `v3-tables.ts`

`parseCostingWorkbook(sheets)` → per sheet `Pot_*`: header (supplier, tgl potong, kg LB, hasil potong, ayam mati, biaya A3:A5, biaya BL), baris SKU (produk, harga, kg F+I, kode, nama). Label header lewat alias (`WP_LABELS`). Issues: output kosong (D2), gap > 2% (D1), tanpa kode item. `parseV3Table("cost_pool_pi")` untuk daftar PI.

## Halaman

- Upload wizard yang ada menerima jenis v3 (registri `lib/v3/uploads.ts`) bila flag `m1_costing` on untuk peran: **WP potong per batch** dan **Daftar PI pemasok**. Commit WP: batch dicocokkan (nama sheet atau tanggal + kg LB ±0,5); batch yang cocok tidak diubah kolom v1-nya; batch baru dibuat Aktual dengan `out_*` agregat dari SKU (agar blok 2/6 v1 lengkap). PI dengan nomor sama menggantikan baris WP.
- `/w/[week]/input/costing` (admin, cost_accounting): C21–C24, batch + gap + status, Alokasikan / Posting, cost pool + tie-out GL, tarif overhead, mode batch.
- `/w/[week]/costing` (semua kecuali sales): per batch, per grup, per SKU, maklon vs own, kapasitas idle.
- Kontrol: kartu "Kontrol modul v3" (tidak memengaruhi rilis mingguan). Snapshot rilis: kunci baru `costing`, `controls_v3` (hanya bila flag on).

## Fixture — `fixtures/costing-2026-09/` (`python3 -I scripts/extract_fixtures.py costing`)

26 sheet batch (`Pot_ISA*`, `Pot_AGRO*`, tanpa `Pot_ISA (2)` yang bukan layout batch), 637 baris SKU, golden kolom L dan M per baris + total.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Upload WP mengubah batch v1 | batch yang cocok hanya diberi `costing_status` (+ `processed_kg` bila kosong); batch baru diberi `out_*` lengkap |
| Snapshot rilis berubah | kunci v3 hanya ditambahkan saat flag on, di belakang kunci v1; uji `snapshotJsonV3(r, {}) === snapshotJson(r)` |
| Kolom baru `batch`/`parameter` mengganggu loader v1 | loader v1 memilih kolom yang dipakai; kolom baru punya default |
