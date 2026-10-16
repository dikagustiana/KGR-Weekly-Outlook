# Irisan v5/4 — rancangan: putaran Commercial ↔ PPIC (K24, K26, K32)

PRD v5 §4.6, §6.2, C52, journey L langkah Commercial ↔ PPIC. Flag `v5_commercial` (mati): selama mati layar Komersial v4 dan demand PPIC sama dengan `ebe4ad8`.

## Engine (`packages/engine/src/commercial-v5.ts`)

```ts
holdingRate({ storageExpense, inventoryEnd, days }): Decimal | null      // 97,5 ÷ 3.532,6 ÷ 31 = 0,089 %/hari
stockSellRows(items, rate): StockSellRow[]                               // nilai = kg × biaya; rugi simpan = nilai × tarif;
                                                                         // di bawah biaya = acuan < biaya; rugi di acuan = (biaya − acuan) × kg
stockSummary(rows): { value, kg, skus, fresh, below, holdingPerDay }     // 5 kartu
filterRows(rows, "all" | "hari" | "batas" | "below")
commitmentDemand({ commitments (locked), orders, weekStart }): OrderLine[] // K26: Confirmed = max(0, komitmen − PO minggu itu) per key, hari Senin
commitmentDeadline(weekStart, dow, time): string                         // Jumat 17.00 minggu sebelumnya
c52({ now, deadline, commitments }): ControlV3                           // BELUM DIISI setelah tenggat bila ada draft / tidak ada yang terkunci
spotRows(rows, frozenPrice): sisa fresh sebelum cut-off, turun harga bila diblast
```

## Data

- Komitmen (`sales_commitment`, v5/0): Sales menulis draft untuk SKU yang ditugaskan; Kepala Sales mengunci; versi baru setelah kunci wajib alasan (trigger v5/0). Key komitmen = SKU dasar (`RPA|Karkas`); fresh kg → `|Fresh`, frozen kg → `|Frozen`.
- Price list minggu depan (`price_list_week`, K24): harga list dari form komitmen Kepala Sales, dikunci bersama komitmen; costing minggu depan membacanya (v5/1).
- Jawaban surplus (`surplus_response`): serap semua / serap sebagian (kg, harga) / kurangi potong, untuk rencana PPIC terakhir.
- PPIC (flag `v5_commercial` hidup): komitmen terkunci minggu itu masuk demand sebagai `Confirmed`.
- Tidak ada migrasi baru.

## Layar (mockup `Commercial.dc.html`)

Filter (semua / jual hari ini / lewat batas umur / di bawah biaya, `?filter=`); konteks (tanggal, peran, cut-off, tenggat kunci); headline temuan; 5 kartu (stok bebas, jual hari ini, di bawah biaya, rugi simpan per hari, approval menunggu); ranking stok (status biaya, lantai = biaya, acuan, margin, rugi simpan, rugi di acuan); komitmen minggu depan (form, Kunci oleh Kepala Sales, status dan tenggat); Dari PPIC (surplus + jawaban, kekurangan by-product); spot hari ini. Sales: hanya SKU yang ditugaskan, tanpa SI per lot (K32, v4 S2).

## Kontrol

C52 (BELUM DIISI), C38–C40 (v4), C54 (v5/1).

## Snapshot v1

`computeWeek` tidak disentuh; komitmen hanya masuk demand saat flag hidup. Gate: snapshot EMPTY, parity 17.161/17.161.
