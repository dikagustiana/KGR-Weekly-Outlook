# F6b — M7 Approval diskon + scorecard (desain 1 halaman)

Acuan: PRD v3 §4.8 (harga lantai, approval, scorecard), §6 (`/komersial/approval`, `/komersial/scorecard`), §8 M7, Q19; PLAN Fase 6 (PR 6b). Flag terpisah `m7_approval` (PRD §10 risiko sales).

## Migrasi — `20261016001300_m7_approval.sql`

| Objek | Isi |
| --- | --- |
| `discount_limit()` | batas commercial lead = `parameter.discount_limit_rp_per_kg` minggu terbuka terakhir (default 500, Q19) |
| trigger `discount_guard` (`discount_approval`) | dibuat hanya `pending` (requested_by = login); keputusan: admin, finance (semua), commercial_lead (≤ batas); keputusan final; isi permintaan tidak bisa diubah |
| trigger `needs_rebuild` (`sales_target`) | scorecard minggu itu dibangun ulang |

## Engine — `commercial.ts`

```
belowFloor({price, floor, kg, limit})        Rp/kg di bawah lantai, total, approver (commercial_lead ≤ limit, finance di atas)
guardOrders({lines, floors, requests, limit}) baris di bawah lantai lolos hanya bila ada approval disetujui yang belum dipakai
                                              (key + pelanggan sama, harga ≥ diminta, kg ≤ disetujui); selain itu ditolak + permintaan pending baru
commercialControls → C38 (baris Order di bawah lantai tanpa approval: GAGAL)
scorecard({targets, actuals, forecasts, blasts, discounts})  target vs aktual kg/Rp, kg frozen tak terjual + downgrade, error forecast, diskon
```

## Web

Guard (flag `m7_approval`): `Input → Penjualan` (simpan baris Order, tempel CSV) dan upload `po_lines` memanggil `floorGuard` → ditolak dengan pesan + permintaan approval otomatis; approval yang dipakai ditautkan ke baris (`sales_line_id`). `/komersial/approval` (admin, commercial_lead, finance): antrian + riwayat + C38. `/komersial/scorecard` (admin, commercial_lead, management): minggu lalu (dibangun Senin oleh rebuild; tombol hitung ulang). Sales per baris: `sales_rep` baris, else penugasan per pelanggan, else per key. C38 di Kontrol mingguan.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Input order v1 tertolak | guard hanya bila `m7_approval` on **dan** ada harga lantai (data mart M7); tanpa lantai tidak ada guard |
| Upload order v1 (`orders`) | tidak dijaga (V43) — jalur v3 adalah `po_lines` |
