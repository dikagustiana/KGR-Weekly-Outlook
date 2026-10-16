# Irisan v5/4: putaran Commercial ↔ PPIC

Branch `v5/4-commercial-loop` di atas `v5/3-ppic-class`. Rancangan: `docs/v5/irisan-4-design.md`. Flag `v5_commercial` (mati): selama mati layar Komersial v4 dan demand PPIC sama dengan `ebe4ad8`. Tidak ada migrasi (tabel komitmen, price list, jawaban surplus dan trigger kuncinya sudah ada sejak v5/0).

## Isi

- Engine `packages/engine/src/commercial-v5.ts`: tarif simpan harian, ranking stok (nilai, margin, rugi simpan, di bawah biaya, rugi di acuan), ringkasan lima kartu, filter, komitmen → demand Confirmed (K26), tenggat Jumat 17.00, C52, spot.
- Web: `lib/v5/komersial-data.ts`, `lib/v5/komersial.ts` (model layar sesuai mockup Commercial), `app/komersial/v5.tsx`, `app/komersial/actions-v5.ts` (simpan draft komitmen, kunci komitmen + price list oleh Kepala Sales, jawaban surplus), demand PPIC memuat komitmen terkunci (`lib/v3/planning.ts`, flag hidup).

## Persyaratan → bukti

| Rujukan | Isi | Bukti |
|---|---|---|
| §4.6 | stok bebas, lantai = biaya + status, rugi simpan 0,089%/hari, urgensi dan filter | `commercial-v5.test.ts`, `komersial-screens.test.tsx` |
| K26, C52 | komitmen draft → terkunci Jumat 17.00; versi baru wajib alasan; demand Confirmed | tes "K26 commitments"; trigger v5/0 diuji di blok RLS "v5/0" |
| K24 | price list minggu depan dikunci bersama komitmen; dipakai costing minggu depan | action kunci; v5/1 `priceListToKeys` |
| §4.6 surplus | jawaban serap semua / sebagian / kurangi potong → PPIC | action jawaban; tile "Dari Commercial" PPIC v5 |
| K32 | Sales: SKU yang ditugaskan, tanpa SI per lot dan detail rencana | view `commercial_daily_sales_v5` (v5/1), tes "sales" |
| §6.2 | layar Commercial v5 = mockup | "layout = mockup grid" |
| journey L | Commercial ↔ PPIC: surplus, jawaban, komitmen, kekurangan by-product | tile t-ppic dan "Dari Commercial" |

## Bukti

Gate (`docs/v5/bukti/irisan-4-gates.txt`):
```
== typecheck
apps/web typecheck: Done
== test
packages/engine test:  Test Files  23 passed (23)
packages/engine test:       Tests  322 passed | 1 todo (323)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  15 passed (15)
apps/web test:       Tests  93 passed (93)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully in 7.6s
```

RLS: tidak ada tabel atau kebijakan baru; aturan komitmen (Sales hanya SKU tugas, Kepala Sales mengunci, versi baru wajib alasan, versi lama superseded), price list (Kepala Sales menulis dan mengunci, terkunci tidak berubah) dan jawaban surplus (Sales untuk SKU tugas) sudah diuji di blok "v5/0".

## Perintah untuk manusia (KGR-OS)

Tidak ada migrasi. Setelah `v5_commercial` dihidupkan: Admin memastikan `sales_assignment` per Sales terisi (SKU dan pelanggan); Kepala Sales mengunci komitmen dan price list tiap Jumat 17.00.

## Default dan pertanyaan

O11 (lantai by-product fresh tampil dengan C54). Pertanyaan baru Q-v5-36 sampai Q-v5-40.

## Snapshot dan parity

Tidak berubah (lihat gate).
