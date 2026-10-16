# Irisan v5/1: costing sebagai tulang punggung

Branch `v5/1-costing` di atas `v5/0-foundation`. Rancangan: `docs/v5/irisan-1-design.md`. Flag `v5_costing` (mati): selama mati ledger, Commercial, P&L dan layar sama dengan `ebe4ad8`.

## Isi

- Engine `packages/engine/src/costing.ts`: `CostStatus`, `costStatusOf`, `lowestStatus`, `tariffPerKgLb`, `planCost` (rumus §4.1 di keempat mode), `needBasisOutputs`, `simulateLivebird` (K25), `revalueLots` + `finalLots` (K22, O1 `revaluation_sold_mode`), `idleCostDaily` (Q63), `costingPlRows`, `c53`, `c54`, `c57`; `allocateBatch` membawa status. `commercial.ts`: `priceFloorV5` (biaya + markup aturan, default 0), margin dari biaya costing, kolom MA tetap MA. `monthly.ts`: `Selisih costing` dan `Biaya kapasitas idle` termasuk beban pokok.
- Fixture `fixtures/costing-sim-2026-08-24/` (`inputs.json`, `golden.json`, `placeholder: true`) dari `packages/engine/scripts/costing-sim-golden.ts`.
- Migrasi `20261022000100_v5_costing.sql`: `commercial_daily.cost_per_kg / cost_status / cost_check`, view `commercial_daily_sales_v5`, `lot_revaluation.sold_by_date`, trigger `wp_received` (WP masuk → `batch.wp_received_at`, K21).
- Web: `lib/v5/costing.ts` (biaya batch estimasi/sementara dari planCost, harga LB keputusan → batch → parameter, harga acuan price list terkunci → harga minggu, kontrol C53/C54/C57); ledger (biaya spesifik lot batch yang belum diposting, `lot.cost_status`, `sku_balance_daily.cost_status` = status terendah, `lot_revaluation`); Commercial (biaya + status + C54 dari mart ledger, kolom "Biaya Rp/kg" dan "Status biaya"); P&L bulan dan minggu (baris `Selisih costing` dan `Biaya kapasitas idle`, `lib/v5/costing-pl.ts`); halaman Costing (status per batch, biaya per SKU, C53/C54/C57); K25 (`lib/v5/k25.ts`).

## Persyaratan → bukti

| Rujukan | Isi | Bukti |
|---|---|---|
| §4.1, K20, K21 | status rencana → estimasi → sementara → final per batch dan lot | `costing-v5.test.ts` "status of a batch", "allocateBatch carries a status"; ledger `cost_status` |
| §4.1 rumus | cost pool, k, cost/kg, breakeven, margin/kg LB; tanpa harga = missing | "planCost rules", "Lemak fresh is missing, never 0" |
| K23 | joint, by-product ikut | planCost atas semua output; G9 |
| K24 | harga acuan = price list terkunci minggu lalu | `loadV5BatchCosts` (Q-v5-11) |
| K25, B.1 | simulasi dua basis, tanpa rekomendasi | "simulasi live bird (Lampiran B.1)", `lib/v5/costing-screens.test.tsx` K25 |
| K22, O1 | revaluasi stok + "Selisih costing" sesuai parameter | "revaluation example (estimasi → final on 27 Aug)", "K22 revaluation" |
| Q63 | idle cost ke `pl_daily_v4` basis `fixed` | "Q63 idle capacity per day", "v5 rows of pl_daily_v4" |
| C53, C54, C57 | WP terlambat, biaya > 3 × harga, potong tanpa keputusan harga | "C53, C57", G9 C54 |
| §4.6 | Commercial membaca biaya + status dari mart | "Commercial on the costing cost", `costing-screens.test.tsx` Commercial |
| G9 | empat mode batch 126; C54 Ceker/Kepala lalu hilang setelah joint | "G9 on the example week" |
| Bab 8 | kolom biaya per SKU untuk Sales lewat view v5, bukan per lot; mart tanpa tulis klien | RLS blok "v5/1" |

## Lampiran B

B.1 (`fixtures/costing-sim-2026-08-24/golden.json`, Rp jt kecuali disebut):

| Basis | kg LB | Nilai | Pada 24.600: COGS / GP / k | Breakeven | PRD |
|---|---|---|---|---|---|
| kebutuhan | 18.357,8 | 486,7 | 498,5 / −11,7 / 1,0241 | 23.961 | 18.358; 486,7; 498,5 / −11,8 / 1,0242; 23.960 |
| batch | 27.218,6 | 633,6 | 739,0 / −105,4 | 20.726 | 27.219; 739,1 / −105,4; 20.727 |

COGS/kg karkas fresh pada 24.600: dalam ±5 Rp dari 37.592. Selisih 0,1 jt dan 1 Rp/kg dari pembulatan input PRD (Q-v5-9), dalam toleransi.

Contoh revaluasi (batch 126 estimasi → final 27 Agu, satu DO 26 Agu 500 kg dialokasikan ke lot karkas fresh batch itu karena minggu contoh menjual stok awal dulu), `docs/v5/bukti/irisan-1-revaluation-example.txt`:
```
cogs_line
  rows 28 stock revaluation 18103015 sold part 1213469
  RPA|Ceker|Fresh from 3260 to 3465 kg_rem 325.60 kg_sold 0.00 amount 66760 amount_sold 0
  RPA|HJA (Hati/Jantung/Ampela)|Fresh from 4746 to 5045 kg_rem 622.30 kg_sold 0.00 amount 185777 amount_sold 0
  RPA|Kepala|Fresh from 4235 to 4502 kg_rem 518.40 kg_sold 0.00 amount 138101 amount_sold 0
  RPA|Usus|Fresh from 1577 to 1676 kg_rem 514.90 kg_sold 0.00 amount 51068 amount_sold 0
  RPA|Karkas|Fresh from 38586 to 41013 kg_rem 1072.10 kg_sold 500.00 amount 2601919 amount_sold 1213469
  RPA|Karkas|Fresh from 38586 to 41013 kg_rem 1621.40 kg_sold 0.00 amount 3935036 amount_sold 0
  RPA|Karkas|Fresh from 38586 to 41013 kg_rem 1182.40 kg_sold 0.00 amount 2869611 amount_sold 0
  RPA|Karkas|Fresh from 38586 to 41013 kg_rem 628.80 kg_sold 0.00 amount 1526058 amount_sold 0
  PL 2026-08-27 Selisih costing -1213469
restate_sale_date
  PL 2026-08-26 Selisih costing -1213469
```

## Bukti

Gate (`docs/v5/bukti/irisan-1-gates.txt`):
```
== typecheck
apps/web typecheck: Done
== test
packages/engine test:  Test Files  20 passed (20)
packages/engine test:       Tests  296 passed | 1 todo (297)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  12 passed (12)
apps/web test:       Tests  70 passed (70)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully in 9.8s
```

RLS: `docs/v5/bukti/irisan-1-test-rls.txt`, 21 blok, tidak ada hasil (!). Blok baru "v5/1":
```
RLS-RESULTS v5/1 (rolled back): v5/1 columns=7;
  unknown cost status: rejected;
  clients execute tg_wp_received=false;
  sales view rows=1 status=estimasi;
  sales reads mart=0;
  sales uploads WP: denied;
  lead sees C54 rows=1;
  lead edits cost status rows=0;
  lead writes mart: denied;
  cost accounting uploads WP: OK;
  deleted WP row: inserted;
  B1 wp_received_at set;
  B2 wp_received_at null;
  management reads revaluation=1;
  sales reads revaluation=0;
```

Migrasi v4 + v5 (`2026101[7-9]*`, `2026102*`) diterapkan dua kali pada salinan latihan KGR-OS (`kgr_os_rehearsal` → `kgr_os_v5`), `docs/v5/bukti/irisan-1-rehearsal.txt`:
```
pass 1 done
pass 2 done
```

## Perintah untuk manusia (KGR-OS)

Sesudah migrasi v5/0, di SQL Editor atau psql (`PGCLIENTENCODING=UTF8`):
```
supabase/migrations/20261022000100_v5_costing.sql
```
Cek: `select count(*) from information_schema.columns where table_name = 'commercial_daily' and column_name in ('cost_per_kg','cost_status','cost_check');` → 3; `select count(*) from pg_views where viewname = 'commercial_daily_sales_v5';` → 1.

Menghidupkan (keputusan pemilik produk, bukan bagian PR ini): Admin → Modul → `v5_costing`, lalu Admin → Modul → "Bangun ulang data mart" untuk tanggal sejak minggu stok awal supaya ledger, Commercial dan P&L membawa status biaya. Bila revaluasi harus dihitung sejak tanggal tertentu, isi `app_setting.value.since` (`{"enabled": true, "since": "2026-10-19"}`), Q-v5-14.

## Default dan pertanyaan

O1 `cogs_line` (parameter `revaluation_sold_mode`), O11 (C54 tampil di Commercial). Pertanyaan baru: Q-v5-9 sampai Q-v5-18.

## Snapshot dan parity

Tidak berubah (lihat gate). `computeWeek` tidak disentuh; kolom dan baris v5 hanya ditulis saat flag hidup.
