# Irisan v5/3: demand per ukuran → kelas → kg LB

Branch `v5/3-ppic-class` dari `main` (`d27b62d`, v5/0–v5/2 sudah di-merge). Rancangan: `docs/v5/irisan-3-design.md`. Flag `v5_ppic_class` (mati): selama mati Rencana v4 dan builder demand sama dengan `ebe4ad8`. Tidak ada migrasi (tabel `size_class_map`, `plan_week_class`, `demand_class_weekly` sudah ada sejak v5/0).

## Isi

- Engine `packages/engine/src/ppic-class.ts`: ukuran dari nama item (O3), `toClassLB` (K28), `classByProducts` (C41), `dailyClassPlan` (§4.4, H−1), `weekClassPlan` (§4.3 surplus dan downgrade), C50, C51, C58. `toHeads`/`headsByPattern` tetap.
- Fixture `plan-2026-08-24`: blok `v5` di `inputs.json` (peta K/S/B ilustrasi B.3, yield placeholder, titik tengah, lead time) dan `golden.json` (B.3, B.4), `placeholder: true`. Diff golden: hanya penambahan blok `v5`; semua nilai v4 (9.179 ekor STD, 18.358 kg LB) tetap dan tes v4 tetap lulus.
- Web: `lib/v5/ppic-data.ts` (ukuran PO, peta kelas, yield per kelas, netting v4 → engine; biaya rencana `planCost` pada harga LB keputusan terakhir; C50/C51/C58; builder `demand_class_weekly`), `lib/v5/ppic.ts` (model layar sesuai mockup PPIC), `app/w/[week]/rencana/v5.tsx`, action simpan (`plan_week` + `plan_week_class`) dan salin (butuh C58), C51 di upload supply LB.

## Persyaratan → bukti

| Rujukan | Isi | Bukti |
|---|---|---|
| K28, §4.2, B.3 | ukuran → kelas → kg LB, ekor turunan | `ppic-class.test.ts` "toClassLB = Lampiran B.3" |
| §4.4, B.4 | rencana harian H−1 per kelas | "§4.4 daily plan per class" |
| K27, §4.3 | usulan vs tersimpan; surplus 6.332 kg, downgrade 32,0 jt | "§4.3 the saved plan", `ppic-screens.test.tsx` |
| C50, C51, C58 | tanpa ukuran → STD; kelas tak terdaftar; supply < kebutuhan | tes kontrol |
| §6.3 | layar PPIC v5 = mockup (tile, urutan, teks) | `ppic-screens.test.tsx` "layout = mockup grid" |
| K25 | tanpa rekomendasi beli/tunda | `ppic-screens.test.tsx` "K25" |
| aturan 2 | v4 dan v1 tidak bergerak | gate snapshot dan parity |

## Lampiran B.3 dan B.4 dari engine

`docs/v5/bukti/irisan-3-b3-b4.txt`:
```
B.3 per ukuran: ukuran | PO kg | kelas | kg LB/ekor | kg LB | ekor
Uk 0.9 | 58 | K | 1.33 | 81 | 61
Uk 1.0 | 1763 | K | 1.47 | 2467 | 1679
Uk 1.2 | 1246 | S | 1.75 | 1744 | 997
Uk 1.3 | 4622 | S | 1.89 | 6468 | 3424
Uk 1.4 | 3664 | B | 2.03 | 5128 | 2527
Uk 1.5 | 954 | B | 2.17 | 1335 | 616
tanpa | 811 | STD | 2.00 | 1135 | 568
Total | 13118 | | 1.86 | 18358 | 9871
per kelas: K 2548 kg LB / 1739.9 ekor; S 8212 kg LB / 4420.5 ekor; B 6463 kg LB / 3142.6 ekor; STD 1135 kg LB / 567.7 ekor

B.4 per tanggal potong: potong | kirim | karkas | kg LB | ekor | K/S/B | tanpa ukuran
2026-08-26 | 2026-08-27 | 5332 | 7461 | 3870 | 0 / 2081 / 1221 | 568
2026-08-27 | 2026-08-28 | 3333 | 4664 | 2536 | 646 / 1040 / 851 | 0
2026-08-28 | 2026-08-29 | 4454 | 6233 | 3465 | 1094 / 1300 / 1071 | 0
potong 28 Agu kg LB per kelas: K 1599 / S 2456 / B 2178

kekurangan by-product: Ceker 547.5; HJA (Hati/Jantung/Ampela) 1022.2; Kepala 842.5; Usus 896.5
usulan: biaya 498.5 jt; GP -11.7 jt; breakeven 23961 ; karkas fresh Rp/kg 37590
tersimpan: kg LB 27219 surplus 6331.9 kg, downgrade 32.0 jt, margin blok 2 -105.5 jt
```
Semua angka B.3/B.4 terreproduksi; selisih pembulatan ±1 ekor/kg di Q-v5-30.

## Bukti

Gate (`docs/v5/bukti/irisan-3-gates.txt`):
```
== typecheck
apps/web typecheck: Done
== test
packages/engine test:  Test Files  22 passed (22)
packages/engine test:       Tests  314 passed | 1 todo (315)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  14 passed (14)
apps/web test:       Tests  85 passed (85)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully in 24.1s
```

RLS: tidak ada tabel atau kebijakan baru; penulisan `plan_week_class` oleh PPIC dan penolakan oleh peran lain sudah diuji di blok "v5/0".

## Perintah untuk manusia (KGR-OS)

Tidak ada migrasi. Sebelum menghidupkan `v5_ppic_class`, PPIC mengisi: rentang dan rata-rata K/S/B di master kelas berat, peta ukuran → kelas (`size_class_map`), yield karkas dan by-product per kelas (upload yield); Purchasing mengisi supply LB per kelas. Lalu Admin → Modul → "Bangun ulang data mart" untuk minggu berjalan (menulis `demand_class_weekly`).

## Default dan pertanyaan

O3 (titik tengah +0,05), O4 (ukuran kolom terpisah), O5 (K/S/B tanpa rentang), O6 (yield karkas 68–76%, parameter v5/0). Pertanyaan baru Q-v5-27 sampai Q-v5-35.

## Snapshot dan parity

Tidak berubah (lihat gate).
