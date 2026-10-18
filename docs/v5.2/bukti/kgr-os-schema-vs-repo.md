# KGR-OS vs repo: sidik skema `public` (18 Okt 2026, ±05.50 UTC)

Tujuan: memastikan gladi bundel di PostgreSQL lokal mewakili KGR-OS selama staging (D1) belum ada. **Bukan pengganti
staging** (Bab 4): tanpa Auth, PostgREST, peran Supabase.

Dua sisi:
- **KGR-OS** (`pczjhmzpkknzkziipvit`), baca-saja lewat connector `execute_sql` (tidak ada perubahan; tidak perlu backup).
- **Lokal** `dry_v50`: PG 16.15 + `supabase/tests/supabase_shim.sql` + semua migrasi repo **kecuali** `20261024*` (v5.1)
  dan `20261025*` (v5.2), + `supabase/seed/*.sql` — yaitu keadaan v5.0 yang diklaim ada di KGR-OS.

Kueri: `schema-fingerprint-1.sql` (kolom tabel, fungsi, policy, trigger, view, indeks) dan `schema-fingerprint-2.sql`
(constraint, ACL tabel/sequence/view + RLS, ACL fungsi, tipe, ACL kolom). md5 atas daftar terurut.

| Objek | n KGR-OS | n lokal | md5 | Hasil |
|---|---|---|---|---|
| kolom tabel | 1.384 | 1.384 | `e4899213…` sama | identik |
| indeks | 200 | 200 | `d9c5c343…` sama | identik |
| policy (qual, with check) | 295 | 295 | `da0353c2…` sama | identik |
| trigger | 218 | 218 | `88400c32…` sama | identik |
| view | 2 | 2 | `49159261…` sama | identik |
| constraint | 312 | 312 | `c2c2ca82…` sama | identik |
| ACL fungsi | 53 | 53 | `403b0376…` sama | identik |
| fungsi (nama, argumen, isi, definer, search_path) | 53 | 53 | beda mentah; **sama** sesudah whitespace dinormalkan (`6f0f9a72…` di kedua sisi) | 41 fungsi KGR-OS ber-CRLF (diterapkan lewat SQL Editor); isi sama |
| ACL tabel/view/sequence + RLS | 93 | 93 | beda | hanya hak `m` (MAINTAIN, PG 17) di KGR-OS; penerima dan tabel sama; RLS sama |
| tipe, ACL kolom | 0 | 0 | — | — |

Gladi bundel di `dry_v50` (skrip: bundel v5.1 lalu bundel B2 dalam satu transaksi, tabel cek ke tabel sementara,
diakhiri `raise exception` sehingga semuanya batal):

```
ERROR:  DRYRUN-RESULT v51_rows=12 v51_false=[none] b2_rows=24 b2_false=[none] schema_version=5.2.2
```

Sesudahnya `to_regclass('public.schema_registry')` dan `to_regprocedure('public.base_key(text)')` null (tidak ada sisa).

Kesimpulan: kedua bundel terpasang bersih di atas skema yang identik dengan KGR-OS (lingkungan: PG 16 lokal + shim).
Yang belum terbukti dan tetap butuh staging: perilaku di PG 17 Supabase dengan Auth/PostgREST (T21 test:rls di staging,
T23 uji pulih).
