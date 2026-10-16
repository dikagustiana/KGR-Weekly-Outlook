# Irisan v5/3 — rancangan: demand per ukuran → kelas → kg LB (K27, K28)

PRD v5 §4.2–4.4, C50, C51, C58. Flag `v5_ppic_class` (mati): selama mati layar Rencana v4 dan builder demand sama dengan `ebe4ad8`.

## Engine (`packages/engine/src/ppic-class.ts`)

```ts
sizeKgOf(name): Decimal | null                       // "Karkas Uk 1.3 Fresh" → 1,30 ("Uk x.x", O3)
sizeCode(size | null): "Uk 1.3" | "tanpa"
toClassLB({ lines: { ship_date, key, size_kg, kg }[], netShare?, setup }): ClassDemand
  // net_kg = PO kg × porsi net key (netting v4 per key; stok tidak punya ukuran)
  // kelas = size_class_map(ukuran); tanpa ukuran / ukuran belum dipetakan → STD (C50)
  // kg_LB = net_kg ÷ yield_karkas[kelas] (tanpa yield kelas → yield STD, C42)
  // ekor  = net_kg ÷ (ukuran + 0,05) (titik tengah, O3); tanpa ukuran = kg_LB ÷ rata-rata STD
  // → baris per tanggal kirim × ukuran, total per kelas (kg LB, ekor), total minggu
classByProducts({ kgLbByClass, yields, net }): output dan kekurangan by-product (tidak menambah kg LB, C41)
dailyClassPlan({ demand, leadTimeDays: 1 }): per tanggal potong: kg karkas, kg LB, ekor per kelas + tanpa ukuran
weekClassPlan({ kgLb, demandKarkasKg, yieldKarkas, priceFresh, priceFrozen }): output, surplus, frozen, downgrade
c50(lines), c51({ registered, used }), c58({ need per kelas × tanggal, supply }): ControlV3
```

`toHeads` dan `headsByPattern` tetap untuk fungsi lama (golden workbook dan v4 tetap).

## Data dan mart

- Ukuran = `sales_line.size_kg` → `item_map.size_kg` → dibaca dari nama item (O4: kolom terpisah; dua kolom pertama adalah koreksi manual, tidak wajib diisi). Tidak ada penulisan kolom baru selama flag mati.
- Builder planning (flag hidup) menulis `demand_class_weekly` (minggu, tanggal kirim, ukuran, kelas, net kg, kg LB, ekor).
- Simpan rencana (PPIC) menulis `plan_week` (v4) + `plan_week_class` per kelas; salin ke batch butuh C42, C47, C58 LULUS (Q47 v4).
- Upload yield dan supply LB menolak baris kelas yang belum terdaftar (C51).

## Layar (mockup `reference/design/v5/PPIC.dc.html`)

Rencana v5 (flag hidup): stepper 1–4; headline temuan; lima kartu (PO kirim, kebutuhan karkas, rencana kebutuhan, batch rencana di input, biaya rencana karkas fresh); 1 · demand per ukuran → kelas → kg LB; Dari Commercial (komitmen, price list, jawaban surplus, spot); 2 · rencana mingguan dengan versi Usulan / Tersimpan (`?versi=need|batch`); Ke Commercial dan Direktur Operasional (surplus, kekurangan by-product, karkas tanpa ukuran); 3 · rencana harian H−1 per kelas; 4 · hari ini; batch aktual vs rencana. Tanpa rekomendasi beli/tunda (K25).

## Fixture

`fixtures/plan-2026-08-24`: `inputs.json` mendapat `v5` (peta ukuran → kelas K/S/B ilustrasi Lampiran B.3, yield 71,46% semua kelas, titik tengah +0,05, lead time 1), `golden.json` mendapat `v5` (B.3: 18.358 kg LB, 9.871 ekor, per kelas; B.4 per tanggal potong), `placeholder: true`. Nilai v4 di golden tidak diubah; diff dicatat di `docs/v5/irisan-3.md`. Peta K/S/B tetap input tes berlabel, tidak masuk seed atau default (aturan 8).

## Snapshot v1

`computeWeek` tidak disentuh; fungsi v4 (`weekDemand`, `toHeads`, `headsByPattern`) tidak berubah. Gate: snapshot EMPTY, parity 17.161/17.161.
