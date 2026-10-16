# Irisan 3: PPIC — demand, rencana, alokasi

Branch `v4/3-ppic`, bertumpuk di atas `v4/2-monthly-cash`. Halaman baru tampil hanya bila flag `v4_design` hidup; aturan M3 v4 berjalan saat `m3_planning` hidup. Migrasi baru `20261018000100_v4_ppic.sql` (kolom `demand_weekly`, label yield sementara di `plan_week`, tabel `plan_check_reason`, index unik DO per baris PO, seed kapasitas kosong) menunggu diterapkan manusia ke KGR-OS bersama migrasi irisan 0–2.

## Requirement dan bukti

| Requirement | Bukti |
|---|---|
| K1 ekor dari produk utama | `demand.ts`: `headsByPattern` dan `weekDemand` menerima `isMain`; by-product tidak menentukan ekor, output dan kekurangannya dihitung pada ekor rencana. Tanpa `isMain` perilakunya sama seperti sebelumnya (golden workbook 7.051 ekor, BLD binding tetap lulus) |
| Golden `plan-2026-08-24` | `fixtures/plan-2026-08-24/{inputs,golden}.json`, `packages/engine/test/plan-fixture.ts`, tes `ppic-v4.test.ts`: Karkas net 13.118 kg → 9.179 ekor (binding), 18.358 kg LB; kekurangan HJA 1.022, Usus 897, Kepala 842, Ceker 548 (± 1 kg, Q51); tanpa K1 19.778 ekor / 39.556 kg LB. `placeholder: true` |
| P3.3 netting | kelayakan stok dinilai pada tanggal kirim pertama (`firstDelivery`, `daysAheadOf`); Karkas Frozen 4.228 kg tertutup stok frozen, stok fresh awal sudah lewat 48 jam (Q45) |
| K2 forecast | `weeklyDemand`: forecast Sales menggantikan forecast statistik per key per minggu; `statForecastWeek` (hari stockout dikeluarkan, dikurangi PO terbuka, minimal 20 hari kerja histori). `demand_weekly.source_forecast` (Q46) |
| C41, C42, C44, C46, C47 | `ppic-v4.ts` `ppicControls`; `ppicBlockers` (simpan: C45; setujui: C46; salin: C42, C45, C46, C47) dan `stepGates` (Q47, Q48). Server menegakkannya di `savePlan`, `approvePlan`, `copyPlanToBatches` |
| Mart `demand_shortfall`, `plan_variance_daily` | builder demand M3 menulis keduanya (service role); saran beli trading bila `replacement_buy_price` ada, selain itu kurangi order. Varian per unit per hari dari batch Aktual dan `batch_output_sku` (Q50, Q52) |
| Kapasitas | seed 19 Okt–29 Nov 2026 tanpa angka, dua periode (maklon, Rawa Terate); form kapasitas di halaman Rencana untuk PPIC (Q56) |
| §6.4 Rencana | `/w/[week]/rencana` dengan flag aktif: model `lib/v4/rencana.ts`, stepper 4 langkah, `t-demand` per unit (binding, kg/ekor, ekor, kurang, saran), `ch-ekor` (by-product abu-abu), `t-rencana` dengan Simpan / Setujui, `ekonomi` (blok 2, aksi kalimat biasa), `t-harian` dengan Salin ke batch, `t-varian`, tautan ke Alokasi. Alasan PERIKSA disimpan di `plan_check_reason`. Tes `rencana.test.tsx` (7) |
| §6.5 Alokasi | `/hari/[date]/alokasi` dengan flag aktif: PO kirim hari ini, Alokasikan, Terkirim (kg, nomor DO; sisa tetap terbuka), sisa fresh sebagai calon spot dengan tautan Komersial, rekap stok bebas lawan teralokasi per SKU, Cut-off |
| K7 | upload `delivery` (CSV `no_po, kode_item, tgl, kg, no_dokumen`), idempoten per nomor DO; ledger M2 membaca pengiriman pada baris Order (Q53, Q54). Tes `delivery-ledger.test.ts` (4): PO 1.800 kg dikirim 600 kg menyisakan 1.200 kg rencana, stok keluar sekali, alokasi lot dipakai sekali |
| K8 | cut-off ditolak server sebelum `cut_off_time` hari itu; sebelum itu sisa fresh tampil sebagai calon spot (Q55) |
| Minggu ini | tile demand kini membawa ekor binding dari `demand_weekly` |
| §9.4 banding | `docs/v4/bukti/ppic-rencana-banding.md`: 4 selisih (lihat di bawah), above-fold lulus (591 px), grep DOM 0, kontras lulus |
| G2 RLS | `docs/v4/bukti/irisan-3-test-rls.txt`: 16 blok, tidak ada hasil (!). Blok baru: alasan PERIKSA hanya PPIC/Admin (satu aktif per kontrol, minimal 5 huruf), mart M3 tidak bisa ditulis klien, satu DO per baris PO, seed kapasitas, kolom dan cek `demand_weekly` |
| Gate | `docs/v4/bukti/irisan-3-gates.txt`: typecheck lulus; tes engine 256 + 1 todo, parser 23, web 59; parity 17.161/17.161; snapshot EMPTY; build lulus |

## Selisih mockup lawan halaman

`ppic-rencana-banding.md`, 4 selisih, semuanya terjelaskan, status diusulkan:

| Tile | Selisih | Sebab |
|---|---|---|
| `t-demand` | catatan "1 SKU trading dibeli … tulis alasan untuk membuka langkah 2" | aturan §6.4 (Q49) |
| `t-harian` | judul memakai "(usulan)" | belum ada rencana tersimpan di fixture |
| `t-varian` | tile tambahan | §6.4 meminta tabel aktual lawan rencana; mockup belum memuatnya |
| `link-alokasi` | tile tambahan | §6.4 langkah 4 |

Stepper menampilkan langkah 2–4 terkunci; mockup menampilkan langkah 2 terbuka (Q49).

## Yang belum

- Penjualan spot (`channel = 'spot'`) dicatat di irisan 5 (M7).
- Halaman Stok (§6.5 bagian kedua) memakai halaman `/sku` yang ada; belum diubah ke grammar v4.
- Paralel 2–4 minggu dengan rencana PPIC sebelum flag dinyalakan (Q57).
- Builder belum dijalankan terhadap Supabase (tanpa PostgREST dan service key di lingkungan ini).
