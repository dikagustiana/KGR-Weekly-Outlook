# Journey K, M, N, O dan matriks flag (irisan 4)

PRD v5.1 Bab 5.4–5.5, T7, T11. Dijalankan 17 Okt 2026 04:55–05:00 UTC pada branch `v5.1/4-flags-ui`. Log:
`docs/v5.1/bukti/journey-KMNO.log`, `docs/v5.1/bukti/irisan-4-matriks-flag.log`. Tangkapan layar 1366×768:
`docs/v5.1/bukti/journey-KMNO-*.png`.

## Lingkungan (bukan KGR-OS, bukan Supabase)

| Bagian | Isi |
|---|---|
| Database | PostgreSQL 16.15 lokal, DB `kgr_os_prod` (salinan lokal fixture minggu 24–30 Agu 2026, migrasi v1–v5 + bundel v5.1) |
| API | PostgREST v12.2.3 (Docker), JWT HS256 lokal; mock auth/storage |
| App | `next build` + `next start` dari working tree irisan ini (commit 32ba347 + label cek upload R36) |
| Jam uji | `faketime` pada PostgreSQL dan `next start`: Kamis 27 Agu 2026 10.00 WIB (berjalan) |
| Role | `mgmt@t` (management), `opsdir@t` (operations_director), `ppic@t`, `sales@t` (assignment `RPA|Karkas|Fresh` / PT A), `costacc@t` (cost_accounting), `lead@t` (commercial_lead); `admin@t` hanya untuk matriks flag dan satu "Bangun ulang" (SETUP). User `admin@t` dan `mgmt@t` ditambah di DB lokal saja |
| Flag | semua `m*`, `v4_*`, `v5_*` hidup kecuali `v4_release`; matriks mengganti flag v5 per kombinasi di DB lokal lalu mengembalikannya |

## Journey

| # | Role | Request (HTTP) | Yang terlihat / DB | Hasil |
|---|---|---|---|---|
| K | mgmt@t | GET `/minggu-ini/2026-08-24` (200) | headline "GP P&L minggu ini diproyeksikan Rp −62,0 jt (−3,7%) …"; 5 kartu (`c-outlook`, `c-stok`, `c-kas`, `c-bulan`, `c-solvabilitas`); laba rugi per minggu dengan baris "NIBT setelah beban tetap"; "Perlu keputusan" di y = 835 px (tinggi 451 px), di bawah viewport 768 px; 0 tombol tulis di halaman | dicatat tanpa klaim above-fold (O17) |
| K' | mgmt@t | SETUP `v5_commercial` mati; GET (200) | Status putaran: "Komitmen Commercial minggu depan: modul belum aktif" | R28 |
| M0 | ppic@t | GET `/w/2026-08-24/rencana` (200) | "Salin ke batch rencana" nonaktif: "C42, C46, C47, C45, C57 BELUM DIISI (C57: keputusan harga LB Direktur Operasional, tanpa pengecualian)" | R29 |
| M1 | opsdir@t | GET `/minggu-ini/2026-08-24` (200); GET `?lb=26000` (200); POST keputusan (200) | simulasi 24.600: COGS rencana 659,1 jt, GP −124,6 jt; 26.000: COGS 693,1 jt, GP −158,6 jt; "Harga LB potong 2026-08-28 diputuskan Rp 26.000/kg, volume 15.000 kg LB"; DB `lb_price_decision` 28/08 26.000 · 15.000 kg · opsdir@t | simulasi berubah per harga; keputusan tersimpan |
| M1' | costacc@t | GET `/w/2026-08-24/costing` (200) | batch 129 (potong 28/08): sumber harga LB "keputusan", 26.000; status "rencana"; "harga acuan kosong: RPA\|Lemak\|Fresh" (K50) | batch hari itu memakai harga keputusan |
| M2 | ppic@t | GET (200) | Salin tetap nonaktif, C57 masih BELUM DIISI: batch 128 (potong 27/08, hari ini) belum diputuskan (Q-v5.1-24) | C57 menahan tanpa pengecualian |
| N | sales@t | GET `/input?panel=po_lines` (200); tempel 5 baris; POST simpan (200) | cek: C56 1 baris ditahan; C50 "1 baris → STD" (catatan, O15); tanggal 26/08 ditahan; C38 1 baris → approval; K32 lolos. "3 dari 5 baris lolos cek; 2 baru … 1 baris di bawah lantai ke approval Kepala Sales". DB: KGR26.T0901 Karkas Mix `size_kg` null (STD), KGR26.T0903 Uk 1.4; `discount_approval` pending 300 kg @30.000 < lantai 39.738 | baris tanpa ukuran tersimpan STD; di bawah lantai ke approval |
| N' | ppic@t | GET Rencana (200) | "Tanpa ukuran" 811 → 1.211 kg | demand PPIC berubah |
| O | costacc@t | GET `/input?panel=costing_wp` (200); tempel WP batch 125 dengan kg LB 12.211,6 / 12.300 | "ditahan: Batch 125 … kg LB tidak konsisten (12.211,6 / 12.300,0)"; tidak ada tombol simpan (0 baris lolos) | R34 |
| O' | costacc@t | tempel WP batch 125 (7 baris: 1 kode X-998, 1 kg kosong); alasan C22; POST simpan (200) | cek: C56 1 baris ditahan; Σ SKU vs hasil potong 15,6% > 2% → alasan; "5 dari 7 baris lolos cek … Lot batch 125 → sementara … Rebuild: 3 selesai". DB: `wp_received_at` 27/08 10.07, 5 baris WP; lot batch 125 estimasi → sementara; `commercial_daily` 27/08 Karkas fresh 38.676,68 → 39.737,92 | dua baris ditahan; lot ke sementara |
| O'' | lead@t | GET `/komersial` (200) | tile spot: "Karkas fresh · RPA … 39.738 (lantai = biaya) … acuan di bawah biaya: butuh approval" | Commercial melihat biaya baru |

SETUP (postgres, DB lokal): hapus keputusan LB 28/08, PO uji `KGR26.T09xx` beserta approval-nya, dan WP batch 125 dari
putaran sebelumnya; antrean rebuild kosong. Untuk O, `admin@t` menjalankan Admin → Modul → Bangun ulang 25–27/08
(supaya status lot batch 125 tanpa WP terbaca "estimasi").

Log app: 0 respons 4xx/5xx.

## Matriks flag (T11, Bab 5.4)

8 kombinasi × `admin@t`, `sales@t`, `mgmt@t` × 8 halaman (Minggu ini, Komersial, Rencana, Input, Outlook bulan, Kas,
Outlook preparer, print) = 192 halaman dibuka lewat app. Hasilnya:
- error (5xx atau "Gagal memuat data tile ini"): **0**;
- rekomendasi live bird (TUNDA/NEGOSIASI/REKOMENDASI RPA) saat K25 berlaku untuk role itu: **0**;
- biaya v5 di Komersial untuk Sales tanpa `v5_costing`: **0**.

Rincian status per halaman ada di log. 404 di log adalah halaman yang memang tidak dibuka role itu, misalnya Minggu ini
untuk Sales (K48) atau Input saat `v5_input` mati.

| Kombinasi | K25 admin / sales / management | biaya v5 di Komersial untuk Sales |
|---|---|---|
| (1) v5 semua mati | 0 / 0 / 0 | tidak |
| (2)–(7) | 1 / 1 / 1 | ya (view `commercial_daily_sales_v5`, `sales_sees_cost`) |
| (8) semua hidup, `roles: ["admin"]` | 1 / 0 / 0 | tidak (view `commercial_daily_sales`), tangkapan layar `journey-KMNO-matrix-8-sales-komersial.png` |

## Batasan

- T7 belum berupa satu putaran utuh berurutan, dari kunci komitmen sampai rilis. Langkah putaran dijalankan per journey
  dengan role sebenarnya: L (irisan 3: lead, sales, ppic, finance), M/N/O (irisan ini: opsdir, sales, costacc, lead),
  P (irisan 1: finance, ppic). Salin batch rencana tetap ditahan C42/C45/C46/C47 dari data fixture dan C57 (27/08).
- Posisi "Perlu keputusan" hanya dicatat dalam px (O17 belum diputuskan).
