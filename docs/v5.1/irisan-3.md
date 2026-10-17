# Irisan v5.1/3: missing ≠ 0 di costing dan P&L (K50–K52), kunci komitmen satu transaksi (K46)

Branch `v5.1/3-costing-pl` di atas `v5.1/2-clock-rebuild` (PR #34). PRD: `docs/PRD-v5.1.md` R14–R24. Tidak ada migrasi
baru: `lock_commitments` dan `price_list_week.price_frozen_source` sudah ada di `20261024000300_v51_params.sql`
(irisan 1, Q-v5.1-1). Keputusan pelaksanaan: `docs/v5/QUESTIONS.md` Q-v5.1-17 … Q-v5.1-22.

## Isi

- Engine `costing.ts` (K50): `AllocationOptions.nullMissing` (default false = jalur M1 / v1 seperti sebelumnya);
  `AllocationLine.costPerKg: Decimal | null`; `AllocationResult.canBeFinal`; C54 menyebut SKU tanpa biaya dan tanpa
  harga acuan; C57 menyebut batch tanpa harga LB.
- `lib/v5/costing.ts` (R17, R18): tanpa harga LB → `result: null`, sumber "belum ada", tanpa fallback `"0"`; batch final
  dengan SKU tanpa harga acuan tetap `sementara` (lot-nya juga) dengan `costCheck` "harga acuan kosong: …"; layar
  Costing menulis "belum diisi" dan "harga LB belum ada (C57)".
- Engine `pl-v5.ts` (K51, K52): nominal beban tetap per baris (`null` = "belum ada", bukan 0), `fixedAllMissing`,
  `plTable.fixedMissing`, `solvencyNibtV5`. Tile P&L v5 menulis "belum ada" untuk sel itu.
- `lib/v3/cash.ts` (R20): saat `v5_pl` hidup solvabilitas memakai NIBT setelah beban tetap (baris `fixed_estimate`
  termasuk); tidak diketahui → `basis_nibt` null → kartu "belum ada (NIBT bulan ini belum bisa dihitung)" di Minggu ini,
  Kas, Outlook bulan (`monthsToNegative`).
- `lib/v4/outlook-bulan-data.ts` (R21): kas dari hari dengan saldo bank (`accounts > 0`).
- `lib/v3/commercial.ts`, `lib/v3/ledger.ts` (R22, K55): kolom v5 selalu ada di payload, null saat `v5_costing` mati.
- `lib/v3/costing.ts` (R23): PI hanya ke batch `Aktual`; ref tanpa batch aktual menolak upload sebelum menulis.
- R14 (K46): `lockCommitmentsAction` hanya memanggil RPC `lock_commitments` dengan harga frozen form; kolom
  "harga frozen" di form komitmen (`components/v5/CommitmentForm.tsx`) dan di tabel (label "acuan" bila dari
  `sku_price`); engine `commitmentDemand` memakai versi `locked` tertinggi per key (dan ukuran). R15: satu aturan
  `disabled` untuk keempat input. R16: "Tidak ditampilkan untuk Sales (data perencanaan)". R24 digantikan R14.

## Persyaratan → bukti

| R | Isi | Bukti (lingkungan, role) |
|---|---|---|
| R17 / K50 | null bila harga acuan kosong; `canBeFinal`; lot tidak final | engine `costing.test.ts` "nullMissing … Ceker … null"; `costing-v5.test.ts` C54 K50; web `costing-missing.test.tsx` (R17: WP batch `sementara` dengan Lemak null, batch M1 tidak final, semua berharga → final); `snapshot:diff` EMPTY |
| R18 / K50 | tanpa harga LB → tanpa biaya, C57 | `costing-missing.test.tsx` "no LB price anywhere"; `costing-v5.test.ts` C57 K50 |
| R19 / K51 | per baris; tanpa FINAL → null | `pl-v5.test.ts` "PRD v5.1 K51" (3 tes: hanya jadwal depresiasi → gaji/bunga/sewa dari FINAL Juli; tanpa FINAL → null + C55; semua null → tabel null); golden `pl-2026-08` dan B.2 tetap |
| R20 / K52 | NIBT setelah beban tetap | `pl-v5.test.ts` "PRD v5.1 K52": Agustus −7,8 jt (−7.837.813), ekuitas 702,6 jt → 89,6 bulan; v4 79,2 jt = laba; `lib/v4/solvency-v51.test.tsx`: kartu Kas 205,8 bulan dari ekuitas fixture Agustus 1.612,6 jt, basis null → "belum ada"; PostgREST L7 finance@t (basis 55,9 jt di DB lokal → "tidak berlaku (laba)") |
| R21 | `accounts > 0` | `solvency-v51.test.tsx` (loader + tile: "Kas belum diisi"); PostgREST L7 finance@t: 31 hari `accounts = 0` → Outlook bulan "Kas belum diisi" |
| R22 / K55 | kunci kolom v5 selalu ada | `lib/v3/mart-v5-cols.test.ts`; PostgreSQL lokal: `v5_costing` mati → bangun ulang 26/08 → 0 nilai v5 di `commercial_daily`, `sku_balance_daily`, `lot`; hidup lagi → kembali (`bukti/irisan-3-k55.txt`) |
| R23 | PI ke batch Aktual | `lib/v3/cost-pool-pi.test.ts` (tanpa batch aktual → ditolak, tanpa tulis; batch aktual → id-nya) |
| R14 / K46 | satu RPC; harga frozen; versi tertinggi | RLS v5.1/1 (irisan 1: v2 tanpa alasan → tidak ada baris berubah); `lib/v5/commitment-lock.test.tsx` (action hanya `rpc`, tanpa tulis tabel; error RPC diteruskan); engine `commercial-v5.test.ts` "two locked versions … highest counts, once"; PostgREST L1–L4 sales@t, lead@t |
| R15 | satu aturan disabled | `commitment-lock.test.tsx` (Sales: baris terkunci semua nonaktif; Kepala Sales: aktif kecuali harga frozen baris price list terkunci); PostgREST L5 sales@t |
| R16 | teks Sales | `commitment-lock.test.tsx`; PostgREST L1 sales@t |
| T9 | tidak ada 0 untuk missing | tes di atas (allocateBatch, plTable, kartu Kas, kartu Outlook bulan) |
| T12 | engine dan snapshot tetap | parity 17161/17161, snapshot:diff EMPTY, golden v1 dan v5 (B.1–B.5) di tes engine |

Journey: `docs/v5.1/journey-L.md` (PostgreSQL 16 lokal + PostgREST v12 + mock auth + `next start`, jam uji 27 Agu
2026 10.00 WIB; sales@t, lead@t, ppic@t, finance@t; bukan KGR-OS).

## Bukti gate

`docs/v5.1/bukti/irisan-3-gates.txt`: test (engine, parsers, web), typecheck, parity 17161/17161, snapshot:diff EMPTY,
test:rls OK, lint K38/K41/K42 = 0.

## Belum di irisan ini

- Putaran penuh T7 dengan 6 user (irisan 4).
- `lot_revaluation` dan baris `pl_daily_v4` tidak diubah oleh K55 (Q-v5.1-22).
- Pembaca `price_list_week` selain Commercial v5 menyaring `deleted_at` di irisan 4 (R40).
