# Journey P (T8) — Finance merilis minggu 24–30 Agu 2026 dengan K35 / K45

PRD v5.1 Bab 5.1, 5.5, T8. Dijalankan 17 Okt 2026 03:17–03:18 UTC pada branch `v5.1/1-release-access`.
Log lengkap: `docs/v5.1/bukti/journey-P.log`. Tangkapan layar: `docs/v5.1/bukti/journey-P-*.png`.

## Lingkungan (bukan KGR-OS, bukan Supabase)

| Bagian | Isi |
|---|---|
| Database | PostgreSQL 16.15 lokal, DB `kgr_os_prod` = salinan lokal fixture minggu 24–30 Agu 2026 yang dipakai PR #31, semua migrasi v1–v5 + bundel `docs/v5.1/kgr-os-migrasi-v51.sql` (tabel cek 12/12 true) |
| API | PostgREST v12.2.3 (Docker), JWT HS256 lokal, `db-max-rows` 1000 |
| Auth / storage | mock lokal (`/auth/v1` password apa saja → JWT untuk email itu; `/storage/v1/object` ke disk) |
| App | `next build` + `next start` dari commit irisan ini |
| Jam uji | `faketime` pada PostgreSQL dan `next start`: Senin 24 Agu 2026 10.30 WIB (berjalan). PostgREST, mock dan browser memakai jam dinding |
| Role | `finance@t` (finance) dan `ppic@t` (ppic), dibuat dengan SQL uji di bawah. Admin tidak dipakai |
| Flag | semua `m*`, `v4_*`, `v5_*` hidup, kecuali `v4_release` (lihat batasan); hanya di DB lokal |

```sql
-- PRD v5.1 §5.1: user uji journey (DB lokal saja)
insert into public.app_user (email, role) values
  ('finance@t', 'finance'), ('lead@t', 'commercial_lead'), ('sales@t', 'sales'),
  ('ppic@t', 'ppic'), ('opsdir@t', 'operations_director'), ('costacc@t', 'cost_accounting')
on conflict (email) do update set role = excluded.role, active = true;
insert into public.sales_assignment (sales_rep, email, customer, key) values ('SALES-T', 'sales@t', 'PT A', 'RPA|Karkas|Fresh');
```

## Langkah dan hasil

SETUP (postgres, DB lokal, bukan langkah role): `v4_release` mati, `v5_input` hidup; sel grid dan tugas 18–30 Agu
dihapus (grid kosong); antrean rebuild kosong; tidak ada override dan rilis untuk minggu ini.

| # | Role | Request (status HTTP) | Yang terlihat | Hasil |
|---|---|---|---|---|
| P1 | finance@t | GET `/w/2026-08-24/kontrol` (200) | tombol Rilis nonaktif; "Rilis ditolak — K35: grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas" | K45 menolak (sesuai) |
| P2 | finance@t | GET `/input` (200); POST action "Perbarui status tugas" (200) | grid 24/08: `plan_week` late (tenggat 10.00), `gl_daily` passed, lima sel belum jatuh tempo; tidak ada sel `release_week` | grid dibangun oleh Finance |
| P3 | finance@t | GET `/w/2026-08-24/kontrol` (200) | tombol nonaktif; "Rilis ditolak — K35 kelengkapan data merah: plan_week 24/08." | satu sel merah, disebut namanya (sesuai) |
| P4 | ppic@t | GET `/w/2026-08-24/rencana` (200); POST "Simpan rencana" (200) | "Rencana v1 (yield sementara): 12138 ekor; 1 kelas"; `plan_week` dibuat oleh ppic@t | pemilik input mengisi |
| P5 | finance@t | GET `/input` (200); POST "Perbarui status tugas" (200) | `plan_week 24/08 passed`; tidak ada sel merah | |
| P6 | finance@t | SETUP `v4_release` hidup; GET `/w/2026-08-24/kontrol` (200) | tombol nonaktif; "Rilis ditolak: C8 BELUM DIISI, C9 BELUM DIISI" + panel override Finance; tidak ada K35 | sisa penolakan = kontrol v1 fixture (lihat batasan) |
| P7 | finance@t | SETUP `v4_release` mati; GET kontrol (200); POST "Rilis outlook" (200); PostgREST `POST /rpc/release_week` 200 | "Outlook dirilis (PERIKSA); snapshot SHA-256 a5dc7a389dea…"; DB: 1 rilis oleh finance@t, minggu `released`, `release_override` minggu ini 0 | rilis tanpa override (sesuai) |
| P8 | finance@t (JWT) | `POST /rpc/release_week` langsung ke PostgREST, snapshot rilis P7: SETUP grid dihapus → **400** P0001 "K35: grid kelengkapan belum dibangun"; SETUP satu sel `plan_week` merah → **400** "K35 kelengkapan data merah: plan_week 24/08"; SETUP sel lolos + sel `release_week` lama `late` → **200** | aturan yang sama di transaksi DB, tanpa pre-check app | K45, K35, K44 di DB (sesuai) |

Selama P1–P8 PostgREST menjawab 1.941 × 200, 5 × 201, 28 × 204, 2 × 400 (dua 400 = penolakan yang diharapkan di P8);
log `next start` tanpa error.

## Batasan (jangan dibaca sebagai "lulus" di luar ini)

- T8 "lulus tanpa override" diuji dengan `v4_release` **mati**. Fixture asli tidak punya total Accurate
  (`accurate_sales_kg`, `accurate_opening_stock_value` = null), sehingga dengan `v4_release` hidup (seperti KGR-OS) C8 dan
  C9 BELUM DIISI menahan rilis sampai Inventory Accounting mengisi angka Accurate atau Finance mencatat override (P6).
  Itu aturan v4 §7.2, bukan K35 (Q-v5.1-11).
- "Semua input terisi" berarti semua input yang jatuh tempo sebelum jam uji (Senin 10.30: hanya `plan_week`). Pada jam
  Bab 5.2 (Kamis 27 Agu 09.00) fixture punya 13 sel merah karena input pemilik v5 (alokasi, keputusan dan supply LB,
  kartu stok harian) tidak ada di workbook; minggu dengan semua input terisi oleh pemiliknya dibangun di journey L
  (irisan 3, enam user).
- Jam uji memakai `faketime`, karena `clock()` dengan `KGR_TEST_NOW` baru ada di irisan 2.
- Satu lingkungan, satu minggu fixture; tidak diuji pada KGR-OS.
