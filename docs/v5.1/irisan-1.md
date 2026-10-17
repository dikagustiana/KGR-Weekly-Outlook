# Irisan v5.1/1: K35 tanpa sel rilis, C53 memblokir rilis, akses Manajemen, assignment base_key, K32 di RLS

Branch `v5.1/1-release-access` di atas `v5.1/0-docs` (PR #32). PRD: `docs/PRD-v5.1.md` Bab 3.1–3.3 (R1–R9, R13) dan skema
K39, K46, O15 untuk irisan 2–4. Keputusan pelaksanaan: `docs/v5/QUESTIONS.md` Q-v5.1-1 … Q-v5.1-11. Tidak di-merge;
migrasi ke KGR-OS dijalankan manusia setelah sign-off (`docs/v5.1/kgr-os-migrasi-v51.sql`).

## Isi

- Migrasi (baru, additive, bisa dijalankan ulang; tidak ada drop/rename):
  - `20261024000100_v51_release.sql`: `base_key()`; `release_week()` dengan K44 (sel `release_week` tidak dihitung),
    K45 (tanpa grid → ditolak), K47 (C53 dari `controls_v3`); trigger `needs_rebuild` di `sales_commitment`,
    `price_list_week`, `size_class_map`, `plan_week_class`, `surplus_response` (R13).
  - `20261024000200_v51_security.sql`: guard komitmen dan jawaban surplus memakai `base_key` (K43); dua policy baca
    Sales memakai `base_key` (Q-v5.1-3); `tg_sales_line_scope` (K49); view `commercial_daily_sales_v5` dengan kolom yang
    sama, biaya v5 kosong untuk Sales bila `sales_sees_cost = false` (K53); `price_list_week.deleted_at/deleted_by` dan
    arsip baris terkunci oleh Admin (R40); email assignment huruf kecil (R9, Q-v5.1-6).
  - `20261024000300_v51_params.sql`: `advance_update_date` (K39), `lock_commitments` + `price_frozen_source` (K46),
    `parameter.po_unsized_mode` default `warn` (O15). Belum dipanggil / dibaca app sampai irisan 2–4 (Q-v5.1-1).
- Engine: `c53` membandingkan waktu sebagai instan (`Date.parse`, R4); `completenessCells` tanpa `release_week`,
  `k35()` mengabaikan sel `release_week` lama dan mengembalikan `built` (K44, K45).
- App: `releaseWeek` memeriksa v1 + C53 dalam satu verdict, lalu K45/K35, sebelum file disimpan; halaman Kontrol
  memakai pemeriksaan yang sama (override C53 lewat panel override; pesan K35/K45; tombol nonaktif); Minggu ini hanya
  admin, management, operations_director, finance (R6, juga redirect Outlook); upload PO hanya mengganti baris PO ×
  pelanggan di file dan pelanggan Sales sendiri (R7, `lib/v5/po-lines.ts`); assignment dibaca dengan `eq` huruf kecil
  (R9); loader Commercial v5 mencocokkan key dasar (K43).

## Persyaratan → bukti

| R | Isi | Bukti (lingkungan, role) |
|---|---|---|
| R1 / K44 | sel `release_week` bukan sel grid | `rls_roles.sql` blok v5.1 "K44 only release task red: released" (PG16 lokal, finance); `input-tasks.test.ts` "K44"; journey P8 HTTP 200 (PostgREST, finance@t) |
| R2 / K45 | tanpa grid → ditolak; pre-check app | RLS "K45 no grid: rejected (grid belum dibangun)"; `input-tasks.test.ts` grid tidak dibangun; journey P1 (layar, finance@t) dan P8 HTTP 400 (PostgREST, finance@t) |
| R3 / K47 | C53 BELUM DIISI menahan rilis; override Finance; Admin tidak bisa override | RLS "K47 C53 BELUM DIISI: rejected (C53 only)", "admin C53 override: denied", "K47 with C53 override: released" (finance) |
| R4 | waktu sebagai instan | `costing-v5.test.ts` "C53 compares instants": 13.30 WIB → BELUM DIISI, 11.59 WIB → LULUS (juga dalam UTC) |
| R5 / K43 | assignment `RPA\|Karkas\|Fresh`, komitmen `RPA\|Karkas` diterima, key lain ditolak | RLS "R5 base-key commitment: OK", "sales reads it back=1", "R5 other key: denied" (sales) |
| R6 / K48 | Minggu ini hanya 4 role | `minggu-ini-guard.test.tsx` (halaman: sales, lead, ppic, purchasing, IA, CA → 404 tanpa memuat data; finance, management, opsdir, admin → render); `nav.test.ts` |
| R7 / K49 | Sales menulis PO hanya untuk pelanggan dan SKU ter-assign; file parsial tidak menghapus pelanggan lain | RLS "K49 other customer: denied", "other key: denied", "move line to other customer: rejected", "sales without assignment: denied"; `input-save.test.ts` |
| R8 / K53 | biaya v5 kosong untuk Sales bila `sales_sees_cost=false`; admin tetap melihat | RLS "K53 sales rows=1 cost=null status=null", "K53 admin cost=30000" |
| R9 | `eq` email huruf kecil | `input-data.ts:74`, `komersial-data.ts:50`; migrasi menormalkan email (bukti rerun: `'  Sales@T '` → `'sales@t'`) |
| R13 | komitmen → baris `rebuild_queue` | RLS "R13 commitment queues rebuild=1" |
| K46 (skema) | `lock_commitments` satu transaksi; v2 tanpa alasan → semua batal | RLS "v2 without reason: rejected (key named)", "drafts left=2", "price list untouched", "versions 1:superseded,2:locked", "frozen price from form" / "from sku_price" (lead) |
| R40 (skema) | Admin mengarsip baris terkunci; selain itu tetap terkunci | RLS "admin retires locked commitment rows=1", "admin retires locked price rows=1", "lead retires locked price list: rejected" |
| K39 (skema) | `advance_update_date`: maju, tidak mundur, tidak keluar minggu; Sales ditolak | RLS "K39 ia upload 11/03 → 12/03", "earlier date keeps", "outside week keeps", "Sunday → 15/03", "K39 sales: denied" |
| T8 | rilis tanpa override; satu sel merah ditolak dengan namanya; grid kosong ditolak K45 | `docs/v5.1/journey-P.md` (PostgREST v12 + PG16 lokal, finance@t dan ppic@t; batasan C8/C9 fixture: Q-v5.1-11) |

## Bukti

- Migrasi dua kali: `docs/v5.1/bukti/irisan-1-migrasi-rerun.txt` (A: tiap file dua kali; B: bundel dua kali pada DB baru).
- `pnpm test:rls`: `docs/v5.1/bukti/irisan-1-test-rls.txt` (23 blok, blok v5.1/1 di akhir).
- Gate: `docs/v5.1/bukti/irisan-1-gates.txt`.
- Journey P: `docs/v5.1/journey-P.md`, tangkapan layar `docs/v5.1/bukti/journey-P-*.png`.

## Belum di irisan ini

- `clock()`, `advance_update_date` dipanggil setelah upload, `queueThrough` — irisan 2 (R10–R12).
- Action Commercial memanggil `lock_commitments`; form harga frozen; `commitmentDemand` versi tertinggi — irisan 3 (R14).
- Pembaca `price_list_week` menyaring `deleted_at`; `po_unsized_mode` dibaca upload PO — irisan 4 (R33, R40).
- View `commercial_daily_sales` (v1/v4) tetap key persis (Q-v5.1-3).
