# F3b — M3 Alokasi FEFO + cut-off (desain 1 halaman)

Acuan: PRD v3 §4.4 langkah 6–7, §6 (`/hari/[date]/alokasi`), §8 M3; PLAN Fase 3 (PR 3b). Di atas F3a.

## Tabel / kolom — `20261016000800_m3_allocation.sql`

| Objek | Isi |
| --- | --- |
| `allocation` (sudah dibuat F3a) | kebijakan tulis tambahan untuk `ppic` dan `commercial_lead` (peran halaman Alokasi hari ini); trigger `needs_rebuild` (tanggal alokasi → ledger dibangun ulang) |
| `blast_event` (F2) | baris `reason='cutoff'` dari tombol Cut-off, `rp_downgrade` terisi |

Tidak ada kolom baru di `sales_line`: tombol **Terkirim** v1 (Order → Aktual, baris yang sama) tetap; bila `m3_planning` on, `fulfilled_kg = kg` ikut diisi. Karena id baris tidak berubah, alokasi (`allocation.sales_line_id`) langsung menjadi `out_sale` per lot di ledger M2 (menggantikan FIFO assumed). Bila Accurate kemudian memosting dokumen yang sama dan baris lama di-supersede/hapus, alokasinya dipindah ke baris Accurate dengan nomor dokumen + key yang sama.

## Engine — `packages/engine/src/allocation.ts`

```
allocateFEFO({date, orders, lots, existing, windows})  → allocations + unallocated + lotsLeft
    urutan PO: Confirmed → Tentative → Forecast, lalu tgl kirim, lalu nilai (kg × harga) terbesar
    lot: key sama, masih layak pada tanggal kirim (fresh ≤ jam window, frozen ≤ batas umur), origin_date tertua dulu
cutoffBlasts({date, lotsLeft, futureOrders, windows, frozenKeyOf, price, blastCostPerKg})
    sisa fresh − kebutuhan PO hari berikut yang masih bisa dilayani lot itu selagi fresh → blast ke key frozen,
    rp_downgrade = (harga fresh − frozen) × kg, biaya blast = kg × blast_cost_per_kg
lotsForAllocation(ledger, date, allocatedSales)        → kg lot tersedia (mutasi aktual < tanggal + masuk hari ini)
stockAllocationRecon({stock, allocations, customers})  → B_Alokasi_Stok (rekon per SKU + rekap per customer)
ledger.ts: alokasi eksplisit tidak pernah mengambil lebih dari kg baris jual
controls-v3: C29 (Σ alokasi per baris ≤ kg), C31 (blast tanpa lot tujuan)
```

## Halaman

`/hari/[date]/alokasi` (admin, ppic, sales, commercial_lead): PO kirim hari itu → lot teralokasi / belum; **Alokasikan hari ini** (ganti alokasi FEFO baris yang belum terkirim; alokasi manual tetap); **Cut-off** (PPIC/admin, setelah `cut_off_time`: tulis `blast_event` cutoff); **Terkirim** per PO (sales); rekap stok bebas vs teralokasi per SKU (pola B_Alokasi_Stok); kontrol C29/C31. `Input → Penjualan` menampilkan tgl kirim, status demand, sales bila `m3_planning` on.

## Fixture / golden

`fixtures/demand-2026-09` (extractor `demand`, tambahan daftar customer D66:D85): stok 100.000 kg, teralokasi **2.000 kg**, sisa 98.000; E/F/G/H 53:60 dan rekap customer E66:F86.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Terkirim mengubah perilaku v1 | status Order → Aktual tetap sama; `fulfilled_kg` hanya ditulis bila flag on (kolom ada setelah migrasi F3a) |
| Alokasi menggeser HPP v1 | v1 tidak membaca ledger; ledger berjalan paralel (PRD §10 risiko 1) |
| Cut-off memblast stok yang masih dibutuhkan | PO hari berikut yang masih bisa dilayani selagi fresh dikurangkan dulu; hanya PPIC/admin, dengan konfirmasi |
