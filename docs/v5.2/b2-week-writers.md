# B2 — Penulis tabel `week` (sebelum A-REL-1 ditulis)

Basis: `main` `0055cb7`. Dicari 17 Okt 2026 dengan:

```
grep -rnE 'from\("week"\)\s*\.(update|upsert|insert)' apps/web --include=*.ts --include=*.tsx   # (tanpa *.test.*)
grep -rn 'update public.week' supabase/migrations
```

Tidak ada `upsert` ke `week`. `apply_changes` tidak mengizinkan tabel `week` (daftar `allowed` di `20261014000200_security.sql`).

## Policy dan guard yang berlaku di `main`

| Objek | Isi |
|---|---|
| `week_ins` | INSERT hanya admin |
| `week_upd` | UPDATE: admin, inventory_accounting, finance, ppic, sales, purchasing (tanpa filter baris) |
| `week_upd_v3` | UPDATE: commercial_lead, cost_accounting (tanpa filter baris) |
| `tg_week_guard` (`20261019000100`) | admin dan service role (role null) lolos semua. Role lain: kolom `update_date` **selalu lolos** (celah A-REL-1); `status` open↔released hanya finance; kolom lain ditolak `42501` |

## Penulis di aplikasi

| # | Lokasi | Role pemanggil (cek di app) | Kolom yang ditulis | Jalur |
|---|---|---|---|---|
| 1 | `apps/web/app/admin/minggu/actions.ts:39` `createEmptyWeek` | admin | INSERT `week_start`, `update_date`, `tb_opening_date` | langsung |
| 2 | `apps/web/app/admin/minggu/actions.ts:73` `setWeekStatus` | admin | `status` (open/released/closed) | langsung |
| 3 | `apps/web/lib/rollover.ts:37` `rolloverWeek` (dipanggil `admin/minggu/actions.ts:59`) | admin | INSERT minggu baru (`week_start`, `update_date`, `tb_opening_date`, `lw_*`, `lw_source`, `opening_stock_flag`) | langsung |
| 4 | `apps/web/lib/rollover.ts:92` | admin | `status = 'closed'` minggu lalu | langsung |
| 5 | `apps/web/lib/write.ts:97,99` `loadWeekInputs` (dipanggil `admin/minggu/actions.ts:24` contoh minggu dan `lib/upload.ts:457` upload `workbook`, keduanya admin saja) | admin | `week_start`, `update_date`, `tb_opening_date`, `lw_*`, `lw_source`, `note`, `opening_stock_flag` | langsung |
| 6 | `apps/web/app/w/[week]/input/parameter/actions.ts:51` `saveParameters` | `update_date`: role di `roles.ts:61` area `update_date` = admin, inventory_accounting, finance, ppic, sales, purchasing, commercial_lead, cost_accounting. `tb_opening_date`, `lw_*`, `lw_source`: area `parameter_all` = admin | `update_date` (8 role), `tb_opening_date` + `lw_*` + `lw_source` (admin) | **langsung, tanpa RPC** |
| 7 | `apps/web/lib/upload.ts:479` (upload `accurate_stock_balance` / `ops_stock_count`, `packages/parsers/src/tables.ts:84,145`) | admin, inventory_accounting | `opening_stock_flag` | langsung |
| 8 | RPC `advance_update_date` (`20261024000300`), dipanggil `apps/web/lib/update-date.ts:17` sesudah upload jurnal/stok/WP | admin, finance, inventory_accounting, cost_accounting (cek di fungsi) | `update_date` (maju, maks Senin berikutnya, hanya minggu `open`) | SECURITY DEFINER |
| 9 | RPC `release_week` (`apps/web/lib/release.ts:95`) | admin, finance | `status = 'released'` (dari `open`) | SECURITY DEFINER; trigger tetap melihat role pemanggil |

## Kesimpulan untuk A-REL-1 (dipakai di `20261025000200_v52_security.sql`)

- Policy `week_upd` / `week_upd_v3` **tidak diubah** (sesuai B-R83): kolom `opening_stock_flag` (inventory_accounting) dan `status` (finance lewat `release_week`) tetap ditulis role non-admin, jadi policy tetap perlu membuka UPDATE untuk role itu. Penjaga kolom ada di `tg_week_guard`.
- `update_date` sesudah B2 (K69): berubah hanya bila `old.status = 'open'` **dan** (admin/finance, boleh maju atau mundur; **atau** GUC lokal `kgr.advance = 'on'` yang dipasang `advance_update_date` tepat sebelum UPDATE-nya, untuk inventory_accounting/cost_accounting, hanya maju dan paling jauh `week_start + 7`). Role lain ditolak `42501`. Service role (role null) tetap lolos seperti sebelumnya.
- Akibat ke kode (PRD A, bukan B2): penulis #6 untuk role ppic, sales, purchasing, commercial_lead, inventory_accounting, cost_accounting sekarang ditolak DB. Area `update_date` di `roles.ts:61` perlu dipersempit ke admin, finance (Q-v5.2-12 di `b2.md`). Penulis #5 (admin) ditolak bila minggu sudah `released`/`closed` dan `update_date` berubah: buka dulu (`status = 'open'`).
- Temuan tambahan (tidak diubah di B2): penulis #7 menulis `opening_stock_flag` sebagai inventory_accounting, padahal `tg_week_guard` sejak `20261014000200` menolak kolom itu untuk role non-admin (`42501`). Upload stok awal oleh inventory_accounting gagal di langkah `week opening_stock_flag` bila nilai flag berubah. Dicatat sebagai Q-v5.2-13; perbaikannya (izinkan `opening_stock_flag` untuk inventory_accounting di guard) butuh keputusan pemilik karena memperluas hak tulis.
