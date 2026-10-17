# Irisan v5.1/2: satu jam data (K38–K40), error tidak ditelan (K41), batas baris (K42)

Branch `v5.1/2-clock-rebuild` di atas `v5.1/1-release-access` (PR #33). PRD: `docs/PRD-v5.1.md` R10, R11, R12, R25, R26,
R27. Tidak ada migrasi baru: `advance_update_date` sudah ada di `20261024000300_v51_params.sql` (irisan 1, Q-v5.1-1).
Keputusan pelaksanaan: `docs/v5/QUESTIONS.md` Q-v5.1-12 … Q-v5.1-16.

## Isi

- `apps/web/lib/clock.ts`: `clock(sb)` → `{ data, wall, now }`; `KGR_TEST_NOW` hanya saat `NODE_ENV=test`; `dataToday`
  pindah ke sini (satu-satunya fallback whitelist K41: query minggu gagal → jam dinding + `console.error`); `taskWindow`
  = jam dinding − 13 … + 7. `lib/data.ts` mengekspor ulang `dataToday` dan `inChunks`.
- Semua loader v5 dan halaman `app/**` memakai `clock()`: mart dan cut-off pada tanggal data; tenggat, terlambat,
  stempel, jendela tugas/grid Input, Status putaran, label sumber, spot hari ini pada jam dinding. Manajemen: tanggal
  potong keputusan = jam dinding + 1, dan catatan simulasi menyebut "Data per 27 Agu · potong Min 18/10" bila berbeda.
- `apps/web/lib/update-date.ts` (K39): setelah upload WP (Input v5), kartu stok dan jurnal (wizard v4) tersimpan, RPC
  `advance_update_date` untuk minggu terbuka; gagal → disebut di pesan upload, tidak dibuang.
- `queueThrough` / `throughDates` (K40, `lib/rebuild.ts`, `lib/rebuild-dates.ts`): tanggal terdampak s.d. tanggal data,
  maks 62 hari; dipakai upload v5, wizard v4 (jenis v3 dan v4), keputusan harga LB, "Perbarui status tugas".
- `apps/web/lib/loader.ts` (K41, K42): `must`, `mustRows`, `LoaderError`, `TileData` + `tileData`, `inChunks`.
  `lib/v4/tile-errors.ts`: `fail` mencatat pesan per id tile, `withFailures` menandai tile; `TileModel.error` dirender
  `TilePage` sebagai state error (`role="alert"`, `data-tile-error`). Loader Minggu ini, Manajemen v5, Commercial v5,
  PPIC v5, Input memetakan tiap bacaan ke tile yang diberinya; builder, action, Tutup buku, Outlook bulan, costing v5
  melempar `LoaderError` (rebuild/aksi gagal terlihat).
- K42: `.limit(2000/5000)` diganti `fetchAll` (stok Minggu ini, laba rugi minggu); `.in()` daftar id lewat `inChunks`
  200 (costing v5, PPIC ukuran PO, item PO tugas, COA beban tetap, antrean rebuild).

## Persyaratan → bukti

| R | Isi | Bukti (lingkungan, role) |
|---|---|---|
| R10 / K38 | satu `clock()`; Manajemen data 27 Agu, jam 17 Okt → form `date=2026-10-18`; jendela tugas sama | `clock.test.ts` (8 tes; menggantikan `data-today.test.ts`); `management-clock.test.tsx` (loader + model); PostgREST O5: opsdir@t, jam dinding 17 Okt → form `date=2026-10-18`, catatan "Data per 27 Agu · potong Min 18/10"; lint K38 = 0 |
| R11 / K39 | upload menaikkan `update_date` | `update-date.test.ts` (4 tes); RLS v5.1/1 "K39 …" (irisan 1); PostgREST O1/O2: costacc@t upload WP batch 26 Agu → `update_date` 26 → 27 Agu, pesan upload menyebutnya |
| R12 / K40 | queue s.d. tanggal data, maks 62 hari | `rebuild-through.test.ts` (26 Agu dengan data 27 Agu → 2 tanggal; 63 hari → ditolak, Q-v5.1-12); PostgREST O2: antrean 26/08 (trigger) + 27/08 (queueThrough), keduanya selesai |
| R25 / K41 | error tidak menjadi "belum diisi"; tile itu saja | `loader.test.ts`; `management-clock.test.tsx` (discount_approval ditolak → hanya tile "Perlu keputusan" state error; label sumber "gagal dimuat (…)"); PostgREST O4: `revoke select on cash_position_daily` → finance@t Minggu ini: hanya `c-kas` dan `kas` state error dengan pesan PostgREST, 22 tile lain tampil; lint K41 = 0 |
| R26 / K42 | `.in()` 200 per request | `loader.test.ts` "450 ids → 3 requests" |
| R27 / K42 | `fetchAll` bukan `.limit(≥1000)` | lint K42 = 0 |
| T10 | journey O langkah terakhir | PostgREST O0–O3: lot asal 26/08 estimasi 29 → sementara 29; Karkas frozen di Commercial (lead@t) "estimasi 34.196" → "estimasi 34.020" |

Lingkungan PostgREST: PostgreSQL 16 lokal (`kgr_os_prod`, salinan fixture) + PostgREST v12 + mock auth/storage +
`next start`; jam uji `faketime` 27 Agu 2026 09.00 WIB untuk O0–O4, jam dinding untuk O5. Log:
`docs/v5.1/bukti/irisan-2.log`, tangkapan layar `docs/v5.1/bukti/irisan-2-*.png`. Bukan KGR-OS.

## Bukti gate

`docs/v5.1/bukti/irisan-2-gates.txt`: test (engine 350, parsers 23, web 167), typecheck, parity 17161/17161,
snapshot:diff EMPTY, test:rls OK (23 blok), lint K38/K41/K42 = 0.

## Belum di irisan ini

- Halaman `app/**` lain yang membaca tanpa cek error (di luar cakupan lint K41 `lib/v5`, `lib/v4`) — tidak diubah.
- R11 jurnal lewat wizard v4 diuji di unit test (`advanceUpdateDate`) dan RLS, tidak lewat layar (journey memakai WP).
