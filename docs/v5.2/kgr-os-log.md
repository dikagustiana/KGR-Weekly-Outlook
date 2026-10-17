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

Belum dijalankan (alasan di `docs/v5.2/PROGRESS.md`): B0-3 bundel v5.1 (menunggu staging, Q-v5.2-4), B0-7 bangun
ulang 24–30 Agu (menunggu B0-3 dan akses app), B0-2 env Vercel (BUTUH-DIKA).
