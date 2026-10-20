# PRD v6 irisan 1 — snapshot (tulis saja)

Isi: B-R119–B-R121, R119, R122, R123, R124. Halaman belum membaca snapshot (irisan 2, flag `v6_snapshot_read`).

| Butir | File |
| --- | --- |
| Codec `WeekResult` ↔ JSON tanpa kehilangan digit (Decimal, Map, metode `get` laporan) | `packages/engine/src/result-codec.ts`, tes `packages/engine/test/result-codec.test.ts` (T29: `snapshotJson` hasil decode identik byte-per-byte; minggu contoh ≈ 1,4 MB) |
| `readSnapshot`, `writeSnapshot` (hash sama → tidak ditulis), `buildSnapshot`, `backfillSnapshots` | `apps/web/lib/snapshot.ts` |
| Builder `week_snapshot` di rebuild worker, jalan tanpa melihat flag (`always`), minggu `released`/`closed` tidak dihitung ulang | `apps/web/lib/snapshot-builder.ts`, `lib/rebuild-registry.ts` (`builderOn`) |
| Paginasi worker: halaman 5000, empat paralel; batas server di bawah 5000 dikenali dari panjang halaman pertama | `apps/web/lib/data.ts` (`fetchAll` opsi `WORKER_PAGES`), tes `lib/fetch-all.test.ts` |
| Rilis menautkan snapshot (`release.snapshot_id`) | `apps/web/lib/release.ts` (`freezeSnapshot`) |
| Cron 05.00 WIB memeriksa hash semua minggu `open` (mitigasi "snapshot basi") | `app/api/cron/rebuild/route.ts` |
| Tombol Admin → Modul "Hitung semua minggu" (B-R120, sekali sesudah bundel) | `app/admin/modul/actions.ts` `snapshotAll` |
| Migrasi + rollback | `supabase/migrations/20261026000100_v6_snapshot.sql` (6.0.0), `supabase/rollback/…down.sql`; tes RLS blok "v6 B-R119" |

## Langkah ke KGR-OS (belum dijalankan; perlu persetujuan Dika)

1. Backup (`docs/v5.2/kgr-os-backup.sql`), catat di `docs/v5.2/kgr-os-log.md`.
2. Terapkan `20261026000100_v6_snapshot.sql` (aditif: tabel baru, satu kolom nullable, tiga flag `v6_*` mati).
3. B-R121: Dashboard → Settings → API → Max rows 1000 → 5000. Kode tidak bergantung pada nilai ini (benar di 1000 maupun 5000), hanya lebih sedikit putaran.
4. Merge kode; sesudah deploy, Admin → Modul → "Hitung semua minggu". Gate: semua minggu `released` punya `release.snapshot_id`.

`EXPECTED_SCHEMA` tetap 5.2.6: kode irisan 1 bekerja di DB tanpa `week_snapshot` (dibaca sebagai "belum ada", dicatat di log), jadi deploy tidak memunculkan banner skema sebelum bundel diterapkan. Dinaikkan ke 6.0.0 di PR sesudah bundel ada di KGR-OS.

Catatan Q-v6-4 (Sales dan biaya batch): default PRD = subset lewat RPC `snapshot_for_role` (B-R123) bila jawabannya "tidak boleh". Sekarang Sales sudah membaca `batch` lewat PostgREST (b7.md bagian 5), jadi snapshot penuh untuk semua role tidak membuka data baru; B-R123 belum dibangun.
