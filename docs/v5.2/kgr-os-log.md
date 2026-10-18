# Log perubahan KGR-OS (`pczjhmzpkknzkziipvit`) — v5.2

K66: setiap ✎ ke KGR-OS dicatat di sini (waktu WIB, siapa, perintah, hasil). Pelaksana: agen Claude Code atas delegasi
Dika (brief 17 Okt 2026), lewat connector Supabase (`execute_sql`, role `postgres`). Backup: Q-v5.2-1
(`docs/v5/QUESTIONS.md`) — snapshot di dalam DB, bukan `pg_dump`.

## Cara memulihkan dari snapshot `bak_<UTC>`

Satu tabel (kolom sama dengan saat snapshot):
```sql
begin;
alter table public.<t> disable trigger user;          -- audit/needs_rebuild tidak ikut menulis
delete from public.<t>;
insert into public.<t> select * from bak_<UTC>.<t>;
alter table public.<t> enable trigger user;
select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.<t> x;  -- = _manifest
commit;
```
Bila sesudah snapshot ada kolom baru (bundel), sebutkan daftar kolom di `insert` dan `select`. Definisi fungsi, view,
policy, trigger, indeks, constraint dan grant saat snapshot ada di `bak_<UTC>._ddl` (`kind`, `name`, `def`).

## 17 Okt 2026

| Waktu (WIB) | Langkah | Perintah | Hasil |
|---|---|---|---|
| 22.35 | B0-4 (baca) | kueri B0-4 PRD B §7 + antrean + user | `base_key`, `lock_commitments`, `advance_update_date`, `price_list_week.deleted_at`, `sales_line_scope` = **false** (v5.1 belum ada). 16 flag `{"enabled":true}` tanpa `roles`/`since`. `rebuild_queue`: 49 `queued` 24 Agu–29 Nov. `max(week.update_date)` = 2026-08-27. `app_user`: 1 admin |
| 22.39 | ✎ B0-1 backup | `docs/v5.2/kgr-os-backup.sql` (sha256 `f88935613985ed73d678f4531ea4183e1eb71ec7419c19f1698fb1d84ead0461`) | skema **`bak_20261017t1539`**: 93 tabel (91 `public` + `auth_users` + `_manifest`), `_ddl` (53 fungsi, 2 view, 295 policy, 218 trigger, 200 indeks, 312 constraint, 1.427 kolom, 2.562 grant); **3.280 kB**; 6.475 baris. `has_schema_privilege(anon/authenticated, usage)` = false. Manifest md5: `gl_line` 1.840 `05ab09e6…`, `audit_log` 3.344 `d086822b…`, `rebuild_queue` 49 `f3710576…`, `app_setting` 16 `ce7b721a…` |
| 22.41 | ✎ B0-6 antrean | blok `do` B0-6 PRD B §7, dibatalkan bila ≠ 42 baris | **42** baris `queued` 19 Okt–29 Nov → `done` ("v5.2 B0-6: di luar jendela data"). Sisa `queued` 7 baris, 24–30 Agu |
| 22.41 | ✎ B0-5 flag (O29 b) | `update app_setting set value = value \|\| '{"roles":["admin"]}' where key like 'v5\_%'` (dibatalkan bila ≠ 6) | 6 flag `v5_*` = `{"enabled":true,"roles":["admin"]}` |
| 22.41 | ✎ O36 `since` | `update app_setting set value = value \|\| '{"since":"2026-09-01"}' where key = 'v5_costing'` | `v5_costing` = `{"since":"2026-09-01","roles":["admin"],"enabled":true}` |

| 23.03 | uji kering B1 | `docs/v5.2/kgr-os-master.sql` dalam `begin … rollback` | cek 3/3 true; sesudah rollback `fixed_cost_schedule` tetap 7 baris (0 baris bulanan) |
| 23.03 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261017t1603`**: 93 tabel, 3.288 kB |
| 23.04 | ✎ B1 data master (B-R88) | `docs/v5.2/kgr-os-master.sql` (sha256 di PROGRESS) | 5 baris jadwal beban tetap Agu–Sep (GAJI, BUNGA, SEWA-ABF-NMG), total Rp 316.626.214,22; template lama tidak berubah; cek 3/3 true. Sumber per angka: sel FS v2 di kolom `note` || 23.20 | uji B-R89 | `docs/v5.2/kgr-os-coa-fix.sql` di PG16 lokal dua kali, lalu di KGR-OS dalam `begin … rollback` | cek 5/5 true di semua uji |
| 23.20 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261017t1620`**: 93 tabel, 3.288 kB |
| 23.21 | ✎ B-R89 `coa_map` | `docs/v5.2/kgr-os-coa-fix.sql` (sha256 `c86a9926…fa9f`) | 48 `fs_mapping_reference` diselaraskan ke kolom Q FS + 3 dikosongkan; 5 akun baru (213 akun); 3 `pl_line` dipindah (6100010, 6200006, 6400007); cek 5/5 true. Rincian `docs/v5.2/coa-fix.md` |

Belum dijalankan (alasan di `docs/v5.2/PROGRESS.md`): B0-3 bundel v5.1 (menunggu staging, Q-v5.2-4), B0-7 bangun
ulang 24–30 Agu (menunggu B0-3 dan akses app), B0-2 env Vercel (BUTUH-DIKA).

## 18 Okt 2026

**Keputusan Dika (chat, 18 Okt): "langsung aja merge di database utama gak usah staging".** Rem "staging dulu" (Bab 4)
dilepas untuk bundel v5.1, B2, B5; rem lain tetap: backup sebelum perubahan, tiap berkas atomik, tabel cek harus
semua true, dan sesudah tiap bundel sidik skema KGR-OS dibandingkan dengan DB lokal (PG 16 + shim) yang memuat bundel
yang sama (kueri `docs/v5.2/bukti/schema-fingerprint-*.sql`, digabung: kolom, fungsi dinormalkan, policy, trigger,
view, indeks, constraint, ACL tabel tanpa hak MAINTAIN PG17, ACL fungsi). Lewat connector Supabase `execute_sql`.

| Waktu (UTC) | Langkah | Perintah | Hasil |
|---|---|---|---|
| 06.12 | baca | sidik skema KGR-OS vs lokal v5.0 | 9/9 kategori identik (sebelum perubahan) |
| 06.12 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` (sha256 `f8893561…0461`) | skema **`bak_20261018t0612`**: 93 tabel, anon/authenticated tanpa `usage` |
| ±06.14 | ✎ bundel v5.1 | `docs/v5.1/kgr-os-migrasi-v51.sql` (tanpa 14 baris kepala komentar), satu panggilan | tabel cek **12/12 true**; sidik = lokal `ref_v51` 9/9 |
| ±06.16 | ✎ B2 1/3 meta | prasyarat + `20261025000100_v52_meta.sql` | `schema_version()` 5.2.0 |
| ±06.17 | ✎ B2 2/3 security | `20261025000200_v52_security.sql` | 5.2.1 |
| ±06.18 | ✎ B2 3/3 release + penutup | `20261025000300_v52_release.sql` + `bundle_sha256` + `notify pgrst` + tabel cek | tabel cek **24/24 true**; sidik: 8/9 sama, **fungsi beda** |
| ±06.22 | temuan + ✎ perbaikan | `norm_code`: transport connector mengubah 11 escape `\uXXXX` di regex menjadi karakter Unicode asli (makna regex setara, teks tidak). `create or replace` dengan teks persis repo (backslash dibangun `chr(92)` di blok `do`) | probe NBSP + U+3000 → "AB"; sidik fungsi = `ref_b2`; **9/9 identik** |
| ±06.25 | ✎ B5 1/2 costing | prasyarat + `20261025000400_v52_costing.sql` | 5.2.3 |
| ±06.27 | ✎ B5 2/2 fs + penutup | `20261025000500_v52_fs.sql` + `bundle_sha256` + `notify pgrst` + tabel cek | tabel cek **26/26 true**; sidik = `ref_b5` **9/9 identik**; `schema_version()` **5.2.4** |
| ±06.28 | baca | data vs manifest `bak_20261018t0612` | `gl_line` 1.840, `app_setting` 16, `rebuild_queue` queued 7, `sales_assignment` 0, `week` 1 sama; `release_override_policy` 36 → 38 (C55, C59); `audit_log` +2 (dua baris kebijakan itu); `fs_line_map` 15 draft |

| 06.41 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261018t0641`** |
| 06.42 | ✎ O24(b) mode memo | `update app_setting set value = value \|\| '{"costing_rows_mode":"memo"}' where key = 'v5_pl'` (dibatalkan bila ≠ 1 baris), sesudah kode A3 (#51 `b408a9a`) di `main` | `v5_pl` = `{"roles":["admin"],"enabled":true,"costing_rows_mode":"memo"}` |

| 08.08 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261018t0808`**: 96 tabel, 3.328 kB, anon/authenticated tanpa `usage` |
| 08.09 | ✎ B-R91 impor FS acuan | `docs/v5.2/kgr-os-data-fs.sql` (dibangkitkan `scripts/fs_import.py`; sumber `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` sha256 `7e68aa89…04c5`). Alasan SQL, bukan upload: app belum punya jenis upload "FS acuan" (PRD B B-R91 "bila belum: skrip … menghasilkan SQL") | sebelum: `fs_statement_line` 0 baris. Tabel cek **11/11 true**: PL 33 + BS 40 baris per bulan Agu dan Sep, versi 1, terkunci (Q-v5.2-66); angka cek PRD Agu revenue 8.361,8 jt, GP 306,7 jt, NIBT −26,5 jt; Sep 5.039,9 jt, −475,4 jt, −910,1 jt. md5 isi 146 baris = DB lokal (`d17710dc…`). `fs_line_map` tetap 15 `draft` |

| 08.19 | baca | status deploy Production commit `main` `0a7dc7d` (memuat A1c #53 dan A1d #54) | GitHub Deployments 7151950813 Production **success** 08.19.01 UTC (sebelumnya `5119dc1`/`f258c0a`/`3860588` tertahan kuota Vercel) |
| 08.19 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261018t0819`**: 96 tabel, 3.392 kB, anon/authenticated tanpa `usage`; `schema_version()` 5.2.4 |
| ±08.21 | ✎ bundel B6 (Q-v5.2-15/71/73/74), sesudah A1c di production (Q-v5.2-79) | `docs/v5.2/kgr-os-migrasi-v52-b6.sql` apa adanya (sha256 `227c5107…7426`), satu panggilan | tabel cek **15/15 true**; `schema_version()` **5.2.5**; sidik = lokal `ref_b6` **9/9 identik** (fn `1a5059f1`, pol `1b63d4c0`, view `3ca62957`; regex `\.` dan `\s` utuh) |

| 08.28 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261018t0828`**: 96 tabel, 3.392 kB, anon/authenticated tanpa `usage`; `schema_version()` 5.2.5 |
| ±08.30 | ✎ bundel B7 (Q-v5.2-72/74/84), sesudah CI cabang B7 hijau (`4db83d0`: engine, lint, rls, e2e) | `docs/v5.2/kgr-os-migrasi-v52-b7.sql` apa adanya (sha256 `4336a9f8…8565`), satu panggilan | tabel cek **16/16 true**; `schema_version()` **5.2.6**; sidik = lokal `ref_b7` **9/9 identik** (pol `78fa5b92`; regex `\m`/`\M` di cek 11 utuh) |

| 09.47 | baca | `select schema_version()` + registry; GitHub Deployments | KGR-OS **5.2.6** (registry 5.2.0–5.2.6, `bundle_sha256` terisi untuk tiap versi bundel); Production 7152837375 `85f7684` dengan `EXPECTED_SCHEMA` 5.2.6: **DoD 1 terpenuhi** |
| 09.59 | ✎ backup | `docs/v5.2/kgr-os-backup.sql` | skema **`bak_20261018t0959`**: 96 tabel, anon/authenticated tanpa `usage` |
| ±10.01 | uji RLS di KGR-OS (pengganti T21 tanpa staging) | 48 blok `supabase/tests/rls_roles.sql` (dipisah dan diperiksa: semuanya `do $$ … raise exception 'RLS-RESULTS …' $$`, tiap blok di-rollback sendiri), satu panggilan per blok | blok 01–03: RLS-RESULTS, **0 `(!)`**. Blok 04 (memuat `delete` di dalam blok) dijawab connector `{"status":"cancelled"}`: konfirmasi pernyataan destruktif tidak diberikan → **dihentikan, tidak diulang** (Q-v5.2-104). Sesudahnya semua tabel `public` dan `auth.users` = manifest `bak_20261018t0959` (0 tabel berubah, 0 tabel baru) |
| ±10.10 | ✎ DoD 8: flag v5 ke semua role (Q-v5.2-103) | hapus kunci `roles` dari 6 flag `v5_*` yang `roles = ["admin"]` (blok dibatalkan bila ≠ 6 baris); backup sebelum perubahan `bak_20261018t0959` (data identik, dicek) | 6 flag `v5_*` = `{"enabled":true}` (+ `since` 2026-09-01 di `v5_costing`, `costing_rows_mode` memo di `v5_pl`); 10 flag lain tidak berubah. Kembali ke Admin saja: tambahkan lagi `{"roles":["admin"]}` ke 6 flag itu |

Catatan untuk bundel berikutnya lewat connector: hindari `\uXXXX` di teks yang dikirim (pakai `chr()`); bundel B5 tidak
memuat escape itu (dicek). Lewat `db-ops` (psql) masalah ini tidak ada.
