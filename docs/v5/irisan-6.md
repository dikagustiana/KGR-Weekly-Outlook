# Irisan v5/6: Manajemen v5, label sumber (K36), "Lihat sebagai" (K37)

Branch `v5/6-management` di atas `v5/5-input`. Rancangan: `docs/v5/irisan-6-design.md`. Flag `v5_management` (mati): selama mati Minggu ini sama dengan v4 / v5_pl, header tanpa "Lihat sebagai", layar PPIC hanya admin / PPIC / Finance. Tidak ada migrasi.

## Isi

- Engine: `batchBasisInputs` (basis batch simulasi LB; skrip fixture memakai fungsi yang sama, fixture tidak berubah).
- Manajemen · Minggu ini: tile **Simulasi harga live bird · untuk Direktur Operasional** (basis kebutuhan PO / batch rencana; harga 20.000–26.000 + harga hari ini; COGS rencana, GP rencana, breakeven LB, margin/kg LB; COGS/kg per SKU vs harga list; kalimat K25 "diputuskan Direktur Operasional, simulasi bukan rekomendasi") dan tile **Perlu keputusan minggu ini** + **Status putaran**; label sumber K36 di kartu utama dan simulasi; form keputusan harga LB untuk Direktur Operasional (journey M).
- Header: "Lihat sebagai" (Manajemen · Commercial · PPIC · Input) hanya item yang boleh dibaca role (K37); layar PPIC baca-saja untuk management dan Direktur Operasional.
- Commercial v5 dan PPIC v5: label sumber K36 di tile angka utama.

## Persyaratan → bukti

| Rujukan | Isi | Bukti |
|---|---|---|
| §6.1 simulasi (K25) | dua basis, delapan harga, empat angka, tabel SKU; tanpa label beli/tunda/negosiasi | `management-screens.test.tsx` "simulasi harga live bird" (Lampiran B.1 lewat engine) |
| §6.1 keputusan + status putaran | pemilik per keputusan; status komitmen, rencana PPIC, harga LB, costing, stok bebas | "perlu keputusan dan status putaran" |
| G13 / journey L | tugas berpindah belum → terlambat → lolos; status putaran berubah setelah kunci komitmen, rencana, harga LB, WP | "G13 — journey L" |
| journey K | headline, 5 kartu, laba rugi per minggu dengan NIBT setelah beban tetap, keputusan + pemilik terbaca tanpa scroll; tidak ada tombol tulis untuk management | tangkapan layar `docs/v5/bukti/irisan-6-minggu-ini.png`; form keputusan hanya admin / Direktur Operasional |
| journey M | simulasi berubah per harga (tautan `?lb=`); keputusan tersimpan (`lb_price_decision`, stamp pemutus); batch hari itu memakai harga itu sebagai biaya sementara (v5/1) | tes "another price changes the simulation"; `decideLbPriceV5Action`; RLS v5/0 (Direktur Operasional memutuskan, tidak diubah) |
| K36 | label sumber singkat, merah bila input lewat tenggat | "K36 source labels" |
| K37 | "Lihat sebagai" per role; flag mati = tidak ada | "K37 Lihat sebagai" |
| tata letak | simulasi dan keputusan mulai baris 9 mockup; tanpa tumpang tindih | "Manajemen v5 layout" |

## Bukti

Gate (`docs/v5/bukti/irisan-6-gates.txt`):
```
== typecheck
packages/engine typecheck: Done
packages/parsers typecheck: Done
apps/web typecheck: Done
== test
packages/engine test:  Test Files  25 passed (25)
packages/engine test:       Tests  346 passed | 1 todo (347)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  18 passed (18)
apps/web test:       Tests  124 passed (124)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully
├ ƒ /minggu-ini/[week]                   2.03 kB         108 kB
```

Tangkapan layar banding mockup: `docs/v5/bukti/irisan-6-minggu-ini.png` (1366 px; tile dirender dari fixture minggu contoh, CSS app). Mockup `Main.dc.html` tidak bisa dibuka di browser (runtime Claude Design tidak ikut, `reference/design/v5/README.md`), jadi banding dilakukan terhadap koordinat tile dan teks spec.

## Perintah untuk manusia (KGR-OS)

Tidak ada migrasi. Menghidupkan (keputusan pemilik produk): Admin → Modul → `v5_management` (sesudah `v4_design`, `m3_planning`, `m7_commercial`, `v5_costing`, `v5_input`). User Direktur Operasional dibuat Admin (Admin → Pengguna).

## Default dan pertanyaan

O2 (satu harga LB untuk semua kelas; keputusan dari Manajemen tanpa kelas), O7 (kartu stok di atas umur per lot, tetap v4). Pertanyaan baru: Q-v5-49 sampai Q-v5-53.

## Snapshot dan parity

Tidak berubah (lihat gate).
