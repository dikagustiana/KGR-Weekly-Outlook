# Irisan 0 — foundation

Branch `v4/0-foundation`, dari `main` 23f973f (HEAD sama dengan basis audit PRD v4, jadi analisis dampak PRD tidak perlu diperbarui). Isi: PRD v4 dan token desain, perbaikan keamanan S1–S6, pengiriman parsial K7, kontrol C45, kolom §4.1, tabel §4.2 (kosong), registri status §4.3, parameter K3/K8/K9.

Semua modul tetap mati. Tidak ada SQL yang dijalankan ke Supabase mana pun. Dua migrasi baru menunggu diterapkan manusia ke KGR-OS (`pczjhmzpkknzkziipvit`) setelah irisan ini diterima:

```
supabase/migrations/20261017000100_v4_schema.sql
supabase/migrations/20261017000200_v4_security.sql
```

Setelah keduanya diterapkan, satu-satunya perilaku production yang berubah adalah S1: pengguna yang login tidak lagi bisa memanggil `mart_replace`. Dengan semua modul mati, app tidak memanggilnya.

## Requirement dan bukti

| ID | Isi | Bukti |
|---|---|---|
| §11.2 | PRD disimpan, empat dokumen lama diberi baris "Digantikan", commit sebelum kode | commit 38790dd; `docs/PRD-v4.md` |
| §5.2 | `reference/design/tokens.css` | berkas; aset yang belum ada: `reference/design/README.md`, QUESTIONS Q3 |
| S1 | `mart_replace` hanya service role; tidak ada tulis mart dari klien | migrasi `20261017000200` bagian S1; tes G2: 9 peran `mart_replace: denied`, 9 peran `direct mart/status write: denied`, `service mart_replace written=1`, `authenticated with service claim: denied`; web `lib/supabase-service.ts`, `lib/rebuild.ts`, tes `rebuildMode` |
| S2 | sales tanpa assignment tidak melihat SKU | view `commercial_daily_sales`; tes F6a `sales read view without assignment=0`, `with assignment=1`; `discount_approval` `other sales read request=0`; web `assignedKeysFor` + tes |
| S3 / K7 | Terkirim meminta kg; outstanding = kg − Σ delivery − batal | tabel `delivery`, trigger `tg_delivery_sync`, `tg_sales_line_fulfilled_guard`; tes K7 (`outstanding=1200.00`, `line still Order=1`, `deliver beyond order: denied`, `set fulfilled_kg directly: denied`, `sales deliver closed week: denied`, `fulfilled after soft delete=0.00`); engine `deliveryCheck`, fixture `fixtures/delivery-partial`; form kg + No. DO di Input → Penjualan dan Alokasi |
| S4 | audit biaya tidak terbaca sales | policy `audit_log_sales_redact`; tes G2 `sales audit cost_pool rows=0`, admin/finance `rows=1` |
| S5 | C29, C38, versi terkunci di database | trigger `allocation_cap`, `floor_guard`, `version_no_delete`, `plan_week_approved`, larangan approval sendiri di `tg_discount_guard`; tes `over-allocate: denied`, `order under floor via API: denied`, `order under floor with approval: OK`, `flag off, under floor: OK`, 9 peran `edit/delete locked version` 0 baris atau ditolak, `cl approve own request: denied`, `edit approved plan: denied` |
| S6 | SECURITY DEFINER: `search_path` tetap, tidak bisa dipanggil anon, fungsi trigger tidak bisa dipanggil lewat API | blok S6 di migrasi (gagal bila dilanggar); tes `definer without search_path=0`, `definer callable by anon=0`, `definer trigger fn callable by authenticated=0` |
| C45 | mart stok STALE memblokir simpan rencana dan alokasi | engine `staleControl`, `blocking`, status `STALE`/`N/A`; web `lib/v3/stale.ts`, cek di `savePlan` dan `allocateDay`; C45 tampil di Rencana dan Alokasi; tes engine C45 |
| §4.1 | kolom baru | migrasi `20261017000100`; tes `parameter runrate 7 + lock week 3 + spot off=10`, `by-product keys=12`, `karkas by-product=0`, `finance 8.3 fields rows=1` |
| §4.2 | `delivery`, `cost_event`, `budget`, `demand_shortfall`, `plan_variance_daily`, `assumption_register`, `forecast_accuracy_daily`, `pl_daily_v4`; stamp, audit, RLS, indeks, entri `rls_roles.sql` | migrasi; tes `finance cost_event: OK`, `sales read cost_event=0`, `finance edit locked budget: denied`, `mgmt assumption: denied`, `ppic direct shortfall mart: denied`, `admin direct accuracy mart: denied` |
| §4.3 | status data | `data_status` (ditulis `mart_replace`), `status_map` 15 baris; tes `data_status recorded=1`, `mgmt read status_map=15` |
| G1 | test, typecheck, parity, build; snapshot tidak berubah | `docs/v4/bukti/irisan-0-gates.txt`: engine 187 + 3 todo, parser 20, web 17; parity 17.161/17.161; snapshot EMPTY; `pnpm build` lulus |
| G2 | matriks RLS/RPC 9 peran | `docs/v4/bukti/irisan-0-test-rls.txt`: 13 blok, 0 hasil bertanda (!) |

Empat tabel v3 yang sebelumnya tidak punya entri di `rls_roles.sql` (allocation_line, ccc_daily, outlook_assumption, substitution) sekarang ikut diuji.

## Cara menjalankan ulang bukti

```
DATABASE_URL="postgresql://postgres@/<db kosong>?host=<socket>&port=<port>" pnpm test:rls
pnpm typecheck && pnpm test && pnpm parity && git diff --exit-code docs/parity.md docs/parity-cells.csv
pnpm snapshot:diff && pnpm build
```

`scripts/test-rls.sh` sekarang menjalankan ulang migrasi v3/v4 setelah seed (urutan yang sama dengan production) dan gagal bila jumlah blok yang melapor tidak sama dengan jumlah blok di `rls_roles.sql`.

Migrasi juga dicoba pada salinan lokal database latihan KGR-OS (v1 + seed + v3): keduanya berjalan, dan berjalan lagi tanpa error; 12 key by-product terisi; tidak ada baris `sales_line` dengan `fulfilled_kg` bukan nol.

## Keputusan K yang dipakai

K7 (ditetapkan), K1 hanya kolom `product_class` dan seed, K3/K8/K9 hanya parameter. Logika K1, K3, K8, K9 dikerjakan di irisan 2 dan 3.

## Yang belum

Ledger M2 belum membaca tabel `delivery` (irisan 3, P3.8). Pertentangan dan pilihan sementara: `docs/v4/QUESTIONS.md` Q1–Q15.
