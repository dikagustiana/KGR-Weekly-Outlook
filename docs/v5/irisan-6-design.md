# Irisan v5/6 — rancangan: Manajemen v5, label sumber, "Lihat sebagai"

PRD v5 §6.1, §6 (header), K25, K36, K37, Bab 8, G13, journey K dan M. Flag `v5_management` (mati): selama mati Minggu ini sama dengan v4 / v5_pl, tidak ada "Lihat sebagai", layar PPIC hanya untuk admin / PPIC / Finance.

## Engine

- `batchBasisInputs({ kgLb, karkasAtRisk, frozenPrice, valuePerKgLb })` di `costing.ts`: basis batch simulasi LB dari blok 2 v1 (rumus yang sama dengan skrip fixture `costing-sim-2026-08-24`, fixture tidak berubah).
- Simulasi tetap `simulateLivebird` (v5/1); tugas dan status tetap `input-tasks.ts` (v5/5).

## Web

- `lib/v5/management.ts` (murni): `simPrices`, `decisionLines` (harga LB → Direktur Operasional; batch vs kebutuhan + downgrade → Direktur Operasional + PPIC; order di bawah lantai → Kepala Sales; kas terendah minggu ini → Direksi), `loopLines` (komitmen, rencana minggu depan, harga LB besok, costing sementara/final + WP terlambat, stok bebas), `sourceLabel` (K36), `withSources`, `managementV5` (tile `sim-lb` 7 kolom dan `keputusan` 5 kolom setelah tile laba rugi; tile v4 di bawahnya turun).
- `lib/v5/management-data.ts`: dua basis simulasi dari loader PPIC v5 (satu angka dengan layar PPIC: kebutuhan per kelas K28 dan batch rencana), keputusan LB besok, permintaan diskon pending, kas terendah, komitmen dan rencana minggu depan, batch minggu ini, stok bebas (mart Commercial), label sumber per layar (`loadSources`, `sourcesFor`).
- Konten tile baru `kpis` (pilihan basis dan harga sebagai tautan, empat angka, tabel SKU, kalimat penutup); label sumber dirender sebagai span sendiri (merah hanya labelnya bila input lewat tenggat).
- Journey M: Direktur Operasional (dan admin) memutuskan harga yang sedang dicoba dari tile simulasi (`decideLbPriceV5Action`, logika bersama `lib/v5/lb-decision.ts` dengan layar Input).
- K37: `lib/v5/view-as.ts` — item "Lihat sebagai" per role (Bab 8) di header V4; layar PPIC dibuka baca-saja untuk management dan operations_director.
- K36 juga di Commercial v5 (stok bebas ← WP, komitmen ← PO) dan PPIC v5 (PO, biaya ← harga LB, batch ← supply).

## Data

Tidak ada migrasi.

## Snapshot v1

`computeWeek` tidak disentuh. Gate: snapshot EMPTY, parity 17.161/17.161.
