# PRD v5.2-B — Database: KGR-OS layak pakai, RLS dan gate rilis di DB, data Agustus–September, FS sebagai acuan

Status: Draft untuk review pemilik produk · Owner: Dika (Group Project Finance, SAMB) · Tanggal: 17 Okt 2026 (WIB)
Repo: `dikagustiana/KGR-Weekly-Outlook` · **Basis: `main` `cb76753`** · Supabase aplikasi: **KGR-OS `pczjhmzpkknzkziipvit`** (Seoul) · Vercel `kgr-weekly-outlook` (`hnd1`)
Pasangan: **PRD v5.2-A — Kode** (`docs/PRD-v5.2-A-kode.md`). Sumber temuan: `docs/v5.2/REVIEW-v5.1.md`.

Dokumen ini mengamendemen PRD v5 dan v5.1 untuk semua yang hidup di database dan di lingkungan production.

**Cakupan:**
- migrasi SQL baru di `supabase/migrations/` beserta tesnya di `supabase/tests/rls_roles.sql`;
- bundel SQL untuk KGR-OS;
- penerapannya;
- env Vercel dan flag;
- user dan role;
- data master;
- data Agustus–September;
- impor FS.

**Siapa mengerjakan apa:**

| Pekerjaan | Pelaksana | Syarat |
|---|---|---|
| Menulis migrasi + tes RLS + bundel, dalam PR `v5.2/b*` | pelaksana DB (Claude Code atau manusia) | ikut aturan migrasi v5.1: file baru, idempoten, tanpa drop/rename |
| Menjalankan apa pun di KGR-OS (bundel, `update`, flag, user) | **manusia (Dika)**, atau Claude **dengan persetujuan eksplisit per langkah** di percakapan | backup dulu (B-R93) |
| Mengubah env Vercel | manusia | — |
| Memasukkan data keuangan (jurnal, TB, DI, bank, stok, FS) | Finance / Inventory Accounting lewat **jalur upload app** | bila sebuah jenis tidak punya jalur upload → B-R90 menyebut SQL alternatif dan alasannya |

**Cara baca.**
- Bab 1 keputusan.
- Bab 3 requirement B-R80–B-R94. Penomoran R berlanjut dari PRD A (R41–R79) supaya rujukan unik.
- Bab 4 urutan tahap.
- Bab 7 checklist dengan perintah **siap tempel**. Perintah yang mengubah data ditandai ✎ dan butuh backup B-R93 lebih dulu.
- Bila dua pasal tampak bertentangan, berhenti dan tanya.

---

## 0. Ringkasan masalah

Kueri read-only ke KGR-OS dan Vercel, 17 Okt 2026 (`REVIEW-v5.1.md` §1):

1. **Kode lebih baru dari skema.** Production menjalankan `cb76753`, tetapi bundel migrasi v5.1 belum diterapkan. Tidak ada tabel versi skema yang bisa dipercaya: `schema_migrations` berhenti di m7 karena v4/v5 diterapkan lewat SQL editor.
2. **Mart tidak pernah dibangun.**
   - 49 antrean `queued` sejak 15–16 Okt, termasuk tanggal 19 Okt–29 Nov.
   - Pengurasan antrean butuh `SUPABASE_SERVICE_ROLE_KEY` di Vercel. Statusnya tidak bisa dibaca dari connector.
   - Akibatnya semua layar manajemen kosong.
3. **Belum ada user selain admin**, padahal seluruh desain RLS dan putaran bergantung pada role.
4. **16 flag hidup untuk semua role tanpa `since`.** v5 terbuka sebelum lulus uji, dan revaluasi K22 berhenti.
5. **RLS dan gate rilis bisa dilewati di DB** (terbukti di PG16 lokal; policy yang sama ada di KGR-OS):
   - `week.update_date` bisa diubah 8 role (A-REL-1);
   - Sales membaca rencana dan jawaban surplus semua SKU (A-REL-3);
   - biaya MA dan lantai terbaca Sales walau `sales_sees_cost=false` (A-REL-2);
   - Sales mengambil alih PO rep lain (A-REL-4);
   - C53 dinilai dari snapshot klien (A-REL-5);
   - K45 lolos untuk grid parsial (A-REL-6);
   - jawaban surplus bisa ditimpa (A-REL-7);
   - price list terkunci bisa dihidupkan lagi (A-REL-9);
   - `lock_commitments` acak per ukuran dan bisa mengunci minggu lampau (A-REL-10).
6. **Data belum cukup untuk tujuan "dashboard = FS".**
   - Jurnal hanya 1–26 Agu. September, DI, saldo bank, TB awal, dan FS acuan belum ada.
   - Nominal gaji, bunga, dan sewa ABF di `fixed_cost_schedule` kosong.
   - `coa_map.fs_mapping_reference` bergeser (A-LIVE-9).

**Tujuan v5.2-B:**
- KGR-OS punya skema yang sama dengan kode, dengan versi terbaca;
- antrean berjalan;
- 9 user role ada;
- semua celah RLS/gate ditutup di DB dengan tes;
- satu putaran T7 lulus di **Supabase sungguhan** (staging);
- FINAL Agustus dan September dikunci dan direkonsiliasi ke FS dengan C59 LULUS di production.

---

## 1. Keputusan

### 1.1 Dipertahankan

Aturan migrasi v5.1 Bab 7:
- file baru, idempoten (`create … if not exists` / `create or replace`), tanpa drop/rename;
- dijalankan dua kali di DB lokal sebelum PR;
- bundel KGR-OS dengan sha256 di kepala dan tabel cek di akhir.

Pengecualian "hanya menambah" dicatat eksplisit, seperti `DROP NOT NULL` di v5.

### 1.2 Keputusan baru

"Usulan" = perlu tanda tangan pemilik; sampai itu, migrasi memakai default yang tertulis.

| # | Keputusan | Isi | Status usulan |
|---|---|---|---|
| K65 | Versi skema di DB | Tabel `schema_registry(version text pk, applied_at, applied_by, bundle_sha256)` + fungsi `schema_version()` (SECURITY DEFINER, `search_path=''`, grant `authenticated`) mengembalikan versi tertinggi. Setiap bundel diakhiri `insert into schema_registry …` dan `notify pgrst, 'reload schema'`. Bundel v5.1 yang sudah ada dicatat sebagai `5.1.0` saat B-R82 diterapkan | ditetapkan |
| K66 | Production berubah hanya lewat bundel | Tidak ada SQL ad-hoc ke KGR-OS selain kueri baca dan perintah ✎ yang tercantum di Bab 7. Setiap ✎ dicatat di `docs/v5.2/kgr-os-log.md` (tanggal, siapa, perintah, hasil) | ditetapkan |
| K67 | Staging sebelum production | Putaran T7 dan probe keamanan dijalankan dulu di **Supabase staging** (branch KGR-OS atau project terpisah, O34), dengan GoTrue, Storage, dan PostgREST asli. Production hanya menerima bundel yang lulus di staging | usulan (O34) |
| K68 | Gate rilis dihitung DB | `release_week()` menghitung sendiri C53 (dari `batch.wp_received_at`, tenggat WIB) dan kelengkapan K35 per hari, bukan dari snapshot kiriman klien. Snapshot klien tetap disimpan sebagai bukti, dan perbedaannya dengan hasil DB dicatat | ditetapkan |
| K69 | `update_date` hanya maju, hanya minggu open | Perubahan `week.update_date` hanya lewat `advance_update_date` (maju) atau oleh admin/finance (boleh mundur, dengan alasan di audit), dan hanya bila `status='open'` | ditetapkan |
| K70 | FS acuan disimpan apa adanya | `fs_statement_line` menyimpan baris FS per bulan dengan sha256 berkas sumber. Tidak pernah diubah sesudah dikunci; koreksi = versi baru | usulan (O25) |

### 1.3 Pasal yang diubah atau dicabut

| Dokumen | Pasal | Diubah menjadi |
|---|---|---|
| PRD v5.1 | K47 / Q-v5.1-2 (C53 dari `controls_v3` snapshot, mode ketat) | K68; mode menurut O22 |
| PRD v5.1 | K45 (cukup satu sel) | K68 per hari, menurut O28 |
| PRD v5.1 | K39 "RLS week tidak perlu dibuka" | K69 (RLS week memang terbuka; ditutup B-R83) |
| PRD v5.1 | K43 / Q-v5.1-3 | menurut O21 |
| `docs/v5/SUMMARY.md` | "Migrasi untuk KGR-OS" | ditambah v5.1 (status: belum diterapkan per 17 Okt) dan v5.2 |

---

## 2. Tujuan terukur

| ID | Tujuan | Ukuran penerimaan |
|---|---|---|
| T19 | T7 di Supabase sungguhan | Di staging (O34): 9 user dibuat lewat Supabase Auth (bukan shim), lalu `tests/e2e/journey-T7` (PRD A, R71) dijalankan terhadap URL staging. Hasil: semua langkah sukses, rilis Finance tanpa override dengan `v4_release` hidup, 0 respons 4xx/5xx tak terduga. Log menyebut project ref dan role |
| T20 | Dashboard = FS di production | Untuk Agustus dan September 2026: FINAL dikunci di KGR-OS, `fs_statement_line` terimpor, halaman Rekonsiliasi (R69) menunjukkan C59 LULUS. Setiap baris yang dipetakan berselisih ≤ toleransi O26; baris yang tidak dipetakan diberi sebab. Tabel rekonsiliasi diekspor ke `docs/v5.2/fs-recon-2026-08.md` dan `-09.md` |
| T21 | Keamanan di DB | Probe P1–P16 review (Sales membaca `plan_week_class`, view biaya, `update week`, ambil alih PO, timpa surplus, snapshot palsu, grid parsial, arsip price list, `lock_commitments` minggu lampau) menjadi blok `rls_roles.sql`. Semua blok ditolak sesuai harapan di PG16 lokal **dan** di staging Supabase |
| T22 | Production layak operasi | Di KGR-OS: `schema_version()` = `EXPECTED_SCHEMA` kode; 0 baris `rebuild_queue` `queued` lebih tua dari 24 jam dan 0 `running` lebih tua dari 15 menit; 9 user role ada; flag v5 sesuai O29; `v5_costing.since` terisi; Vercel Production punya `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`; Preview **tidak** menunjuk KGR-OS |
| T23 | Backup dan pemulihan | Backup sebelum setiap bundel tercatat. Satu uji pemulihan ke staging berhasil |

---

## 3. Requirement (B-R)

Format: **B-R-n [kategori] (temuan)** · Lokasi · Spesifikasi · Bukti. `M` = `supabase/migrations`. Nomor migrasi baru: `20261025000100…`.

### 3.1 Operasi dan lingkungan (tanpa migrasi baru)

**B-R80 [ops] (A-LIVE-1, -4, -6, B-UI-2, O29)** · Vercel project `kgr-weekly-outlook`; `app_setting` di KGR-OS.

Spesifikasi:
1. **Env Vercel Production** wajib berisi:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://pczjhmzpkknzkziipvit.supabase.co`;
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon KGR-OS);
   - `SUPABASE_SERVICE_ROLE_KEY` (service role KGR-OS, **server only**);
   - `CRON_SECRET` (acak 32+ karakter; dipakai PRD A, R46).
2. **Env Preview dan Development** menunjuk **staging** (O34), bukan KGR-OS. Bila staging belum ada, Preview dikosongkan supaya preview gagal-cepat (`env.ts`), bukan memakai production.
3. **Promosi production manual** (usulan, O35): matikan auto-assign domain production untuk push `main`. Sesudah bundel diterapkan, deploy di-*promote* manual. Ini menutup risiko "kode lebih baru dari skema" di luar urutan merge PRD A Bab 4.
4. **Flag** (O29, default rekomendasi): `v5_*` `roles: ["admin"]` sampai T19 lulus; v3/v4 tetap hidup. `v5_costing.since` diisi lewat Admin → Modul → "mulai" dengan tanggal pilihan Finance (O36).
5. Region Vercel `hnd1` vs DB Seoul: dicatat saja; perubahan region (`icn1`) adalah keputusan pemilik (O37). `vercel.json` adalah kode, jadi perubahannya lewat PRD A.

Bukti: tangkapan layar daftar env (nama saja, tanpa nilai); hasil kueri flag (Bab 7, B0-4).

**B-R81 [ops] (A-LIVE-2, -4)** · `docs/v5.1/kgr-os-migrasi-v51.sql`.

Spesifikasi:
1. Backup (B-R93).
2. Terapkan bundel v5.1 apa adanya; tabel cek 12 baris harus semuanya true.
3. `notify pgrst, 'reload schema';`.
4. Tanggal antrean di luar jendela data (> `update_date` + 7) ditandai `done` dengan catatan (perintah B0-6). Kode R45 juga mencegah hal ini di masa depan.
5. Admin → Modul → Bangun ulang 24–30 Agu.
6. Verifikasi bahwa mart terisi.

Bukti: keluaran tabel cek; kueri jumlah baris mart (B0-8) > 0; `kgr-os-log.md`.

### 3.2 Migrasi baru

**B-R82 [migrasi] (K65, A-LIVE-3)** · baru: `M/20261025000100_v52_meta.sql`.
Spesifikasi:
- Tabel `schema_registry`, fungsi `schema_version()`, RLS baca `is_app_user()`, tulis hanya service role.
- Seed baris `('5.1.0', …)` **hanya bila** `to_regprocedure('public.lock_commitments(date,jsonb)') is not null`.
- Baris `('5.2.0-meta', …)`.

Bukti: blok `rls_roles.sql`: authenticated membaca versi; insert oleh authenticated ditolak. Rerun dua kali.

**B-R83 [keamanan] (A-REL-1, -2, -3, -4, -7, -8, -9, -10, B-REL-2, -4, -7, O21, O31)** · baru: `M/20261025000200_v52_security.sql`.

Spesifikasi per celah:

| Celah | Perbaikan |
|---|---|
| A-REL-1 | `tg_week_guard` (`M/20261019000100_v4_release.sql:149`) diganti `create or replace`: perubahan `update_date` hanya bila `old.status='open'` **dan** (`has_role('admin','finance')` atau dipanggil dari `advance_update_date` lewat GUC lokal `kgr.advance=on` yang di-set fungsi itu). Mundur hanya admin/finance. Policy `week_upd`/`week_upd_v3` **tidak** diubah, karena kolom lain `week` mungkin ditulis role-role itu: cek dulu kolom apa yang mereka tulis dan catat di Q-v5.2 |
| A-REL-2 | `create or replace view commercial_daily_sales_v5` dan `commercial_daily_sales` dengan **daftar kolom identik**; `cost_per_kg_ma`, `price_floor`, `margin_*` dibungkus `case when sees then … end`. B-REL-4: `sees` untuk Sales default `false` bila `parameter` tidak ada |
| A-REL-3 | `alter policy plan_week_class_read` dan `demand_class_weekly_read` → `is_app_user() and not has_role('sales')`. `surplus_response_read` untuk Sales difilter assignment (`base_key` menurut O21). Kebutuhan Sales akan data surplus dipenuhi view `surplus_for_sales_v52` (key ter-assign, kolom terbatas) |
| A-REL-4 | `tg_sales_line_scope` dinilai juga pada `OLD` untuk UPDATE/DELETE-soft. `customer` null hanya diizinkan pada INSERT spot |
| A-REL-7 | `surplus_response_upd` untuk Sales: `responded_by = auth email`. Trigger menstempel `responded_by`/`responded_at` pada UPDATE |
| A-REL-8 / O21 | Bila O21=(b): fungsi `assignment_covers(a_key, key)`: sama persis, **atau** `a_key` tanpa akhiran bentuk dan `base_key(key) = a_key`. Dipakai di semua guard, policy, dan view (v4 ikut diselaraskan) |
| A-REL-9 | Baris price list dengan `locked_at` tidak bisa di-UPDATE oleh siapa pun kecuali Admin mengisi `deleted_at` (satu arah; tidak bisa dikosongkan lagi) |
| A-REL-10 / O31 | `lock_commitments`: harga per key diagregasi deterministik. Default O31=(a): tolak `23514` bila harga per ukuran berbeda, dengan daftar key. Minggu `p_week_start <= current_date at time zone 'Asia/Jakarta'` ditolak kecuali admin |
| B-REL-7 | Pencarian `item_map` di trigger memakai normalisasi yang sama dengan engine (`upper(trim(…))`; cek `packages/engine/src/prepare.ts:283-286` dan samakan) |
| B-REL-2 | `release_override_policy` hanya bisa diubah lewat migrasi (cabut UPDATE/INSERT dari admin), menurut O38 |

Bukti: satu blok `rls_roles.sql` per baris tabel di atas, memakai skenario probe review (P1, P4, P6, P7, P8, P8b, P10, P11, P12, P13, P16b). Rerun dua kali. Daftar kolom view tidak berubah (`\d+` sebelum dan sesudah dilampirkan).

**B-R84 [migrasi/rilis] (A-REL-5, -6, B-REL-3, O22, O28, O32)** · baru: `M/20261025000300_v52_release.sql`.

Spesifikasi (K68), `create or replace function release_week` dengan signature sama:
1. Bila `v5_costing` hidup: hitung C53 dari tabel. Untuk setiap batch `status='Aktual'` di minggu itu, `wp_received_at` harus ≤ tenggat (`date + wp_due_hours` jam, `wp_due_time` WIB).
   - Pelanggaran tanpa override `C53` → tolak (O22 default (b): selalu).
   - Snapshot tanpa `controls_v3` saat `v5_costing` hidup → tolak "snapshot tidak lengkap".
2. K35 (O28 default (b)): setiap tanggal `ws … least(ws+6, (now() at time zone 'Asia/Jakarta')::date - 1)` wajib punya ≥ 1 sel `input_completeness_daily`. Tanggal tanpa sel → "grid belum dibangun untuk <tanggal>".
3. `release_month` V1: C55 PERIKSA menahan (O32 default (b)), dengan override `C55` Finance (policy baru).
4. Bandingkan kontrol hasil DB dengan snapshot klien; perbedaannya disimpan di `release.note`.

Bukti: blok RLS P2 (snapshot palsu), P3 (`v4_release` mati + C53), P4 (grid parsial), P5 (C55), rilis minggu lengkap diterima. Journey T7 (PRD A, R71) tetap lulus.

**B-R85 [migrasi] (A-CST-6, F28, R51, R52 tahap 2) — hanya bagian yang diminta PRD A lewat Q-v5.2.** · baru: `M/20261025000400_v52_costing.sql`.

Spesifikasi:
- `batch.lb_price_source text` (provenance R51).
- Tabel `cost_snapshot(batch_id, key, provisional_cost_per_kg, mode, since, captured_at, captured_by)`: diisi saat posting M1, dibaca revaluasi K22 (A-CST-6). Tulis hanya service role; RLS baca finance/cost_accounting/admin.
- View `sales_stock_age_v52` (agregat per key ter-assign: `over_age_kg`, tarif simpan agregat).
- RPC `save_class_plan(p jsonb)` SECURITY DEFINER (header + `plan_day` + `plan_week_class` satu transaksi, mengembalikan ID), dengan cek role ppic/admin. Hanya bila PRD A meminta (R52 tahap 2).

Bukti: blok RLS per objek; rerun.

**B-R86 [migrasi/FS] (T20, O25–O27)** · baru: `M/20261025000500_v52_fs.sql`.

Spesifikasi:
- `fs_statement_line(id uuid, month date, statement text check in ('PL','BS'), sheet text, row_no int, line text, amount numeric(20,2), source_file text, source_sha256 text, version int, locked_at timestamptz, created_by, created_at)`; unique `(month, statement, row_no, version)`.
- `fs_line_map(statement, row_no, app_line text, sign int, note)`: pemetaan baris app ↔ baris FS. Diisi Finance; seed awal dari tabel Bab 7 review dengan status "draft".
- RLS: baca admin/finance/management/operations_director; tulis finance/admin; baris `locked_at` tidak bisa diubah.
- `release_override_policy` baris `C59` (finance).

Bukti: blok RLS (sales ditolak baca; finance tulis; baris terkunci ditolak ubah); rerun.

### 3.3 User, data master, data keuangan

**B-R87 [data/akses] (A-LIVE-5)** · Supabase Auth KGR-OS + `app_user`.

Spesifikasi: 9 user dengan email kerja asli, diundang lewat Supabase Auth atau alur login app (`login_bootstrap`). Role: finance, commercial_lead, sales (≥ 1, dengan `sales_assignment`), ppic, operations_director, cost_accounting, inventory_accounting, purchasing, management.
- Daftar email dan role diisi pemilik di `docs/v5.2/users.md` (tanpa password).
- Admin tetap satu.

Bukti: kueri B0-9 (jumlah per role).

**B-R88 [data master] (SUMMARY "yang harus diisi manusia", A-LIVE-7)** · lewat layar app bila ada; bila tidak, bundel data terpisah `docs/v5.2/kgr-os-master.sql` yang disusun pemilik data.

| Pemilik data | Yang diisi |
|---|---|
| PPIC | `weight_class` (rentang dan rata-rata K/S/B), yield per kelas, `size_class_map`, `capacity` |
| Finance | `fixed_cost_schedule.amount_per_month` untuk GAJI, BUNGA, SEWA-ABF-NMG (FS: gaji Agu 85.565.549 / Sep 82.677.332; bunga Agu 31.911.111 / Sep 54.022.222; ABF Sep 62.450.000), atau `active=false` bila diganti FINAL. Konfirmasi depresiasi September (catatan "September 0 di FS") |
| Inventory Accounting | `parameter.accurate_sales_kg`, `accurate_opening_stock_value` per minggu (C8/C9) |
| Kepala Sales | `sales_assignment` |

Bukti: kueri B3-1. C55 dan C8/C9 tidak lagi BELUM DIISI di minggu contoh.

**B-R89 [data/FS] (A-LIVE-9, B-CST-1)** · `coa_map` KGR-OS.

Spesifikasi:
1. Finance meninjau `fs_mapping_reference` per akun terhadap `TB Accurate` + `PL`/`BS` FS. Isi yang bergeser dikoreksi. Daftar awal ada di kueri B3-2.
2. Akun non-tetap yang masuk baris K29 (6400007 Stock Difference → "Depreciation & amortisation", 6200006 Travelling → "Salaries and allowance") ditandai `driver_type` yang benar, atau dipindah `pl_line`-nya. Perubahan `pl_line` mengubah P&L v1: **cek dampaknya ke golden v1** (fixture memakai `seed/04_coa_map.sql`, bukan KGR-OS, jadi golden tidak bergeser; production bergeser dan harus dicatat).
3. Perubahan masuk sebagai bundel data `docs/v5.2/kgr-os-coa-fix.sql` dengan daftar sebelum/sesudah, **bukan** migrasi skema.

Bukti: tabel sebelum/sesudah per akun; tanda tangan Finance.

**B-R90 [data keuangan] (A-LIVE-8, T20)** · lewat jalur upload app sebanyak mungkin.

Urutan:
1. Neraca saldo 31 Jul 2026 (`tb_opening`, C12 seimbang).
2. Jurnal Accurate penuh **1–31 Agu** (sekarang 1–26 Agu).
3. Penyesuaian tutup buku Agustus (DI) sebagai `closing_adjustment` posted.
4. Saldo bank harian/akhir bulan (`bank_account`, `cash_daily`).
5. Kartu stok akhir bulan.
6. Lock FINAL Agustus (`release_month`).
7. Ulangi untuk September: minggu-minggu September dibuat (`week`), jurnal 1–30 Sep, DI-01…05 September (6 baris `closing_adjustment` yang sudah ada: cek isinya), bank, stok, lalu FINAL September.

Jenis data tanpa jalur upload (bila ada) ditulis sebagai SQL di `docs/v5.2/kgr-os-data-<jenis>.sql` dengan alasan.
Bukti: kueri B4-1 (jumlah jurnal per bulan, Σ debit = Σ kredit, C12/C49 LULUS); FINAL terkunci.

**B-R91 [FS] (T20, K70) ⛓ B-R86** · impor `09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` sheet `PL - Management Report` dan `BS - Management Report` kolom Agustus dan September ke `fs_statement_line`, dengan sha256 berkas.

Cara impor:
- **Bila PRD A menyediakan jenis upload "FS acuan":** lewat upload app.
- **Bila belum:** skrip `scripts/fs-import.mjs` (kode, PRD A) menghasilkan SQL insert yang dijalankan manusia.

Lalu Finance menyetujui `fs_line_map` (status draft → disetujui).
Bukti: jumlah baris per bulan; angka cek (Agustus: revenue 8.361,8 jt, GP 306,7 jt, NIBT −26,5 jt; September: revenue 5.039,9 jt, GP −475,4 jt, NIBT −910,1 jt; dicocokkan ulang ke workbook). Halaman Rekonsiliasi C59.

### 3.4 Staging, tes, backup

**B-R92 [staging] (K67, T19, T21, O34)** · Supabase staging.

Spesifikasi:
- Pilihan O34: (a) **Supabase branch** dari KGR-OS (berbayar per jam, terhapus setelah dipakai); (b) project terpisah `KGR-OS-staging` di organisasi yang sama.
- Isi: semua migrasi (`supabase/migrations`) + seed + data contoh Agustus (fixture), **tanpa** salinan data production kecuali pemilik memintanya.
- Jalankan `journey-T7` (PRD A, R71) terhadap staging dengan 9 user Auth asli, lalu probe keamanan.

Bukti: `docs/v5.2/staging-T19.md` (project ref, tanggal, user per role, log per langkah, status HTTP).

**B-R93 [backup] (T23, SUMMARY)** · `.github/workflows/backup.yml` (sudah ada; melewati backup bila `SUPABASE_DB_URL` kosong).

Spesifikasi:
- Secret GitHub `SUPABASE_DB_URL` diisi (connection string KGR-OS, role postgres). Workflow dijalankan manual sekali.
- Sebelum setiap bundel, buat backup on-demand: Supabase Dashboard → Database → Backups, atau `pg_dump` lokal (perintah B0-1).
- Uji pemulihan satu kali ke staging.

Bukti: nama berkas backup + ukuran di `kgr-os-log.md`.

**B-R94 [tes] (T21)** · `supabase/tests/rls_roles.sql`, `scripts/test-rls.sh`.

Spesifikasi:
- Setiap B-R82–B-R86 menambah blok tes di PR yang sama.
- Probe review P1–P16 menjadi blok tetap (lihat B-R83/B-R84).
- `test-rls.sh` dijalankan juga dengan `SUPABASE_DB_URL` ke staging (mode yang sudah ada di skrip), **tidak pernah** ke KGR-OS.

Bukti: `pnpm test:rls` hijau lokal dan staging.

### 3.5 Tidak dikerjakan di v5.2-B

- Perubahan struktur `allocation_line.cost_per_kg` (NOT NULL).
- Tabel K27 tahap 2 (pola potong/fresh-frozen per SKU, O33).
- Form parameter O8.
- Penghapusan project pilot `uxqbtverhnpiryhzbenr`: cukup dicatat "jangan dipakai"; penghapusannya keputusan pemilik.

---

## 4. Tahap dan hubungan dengan PRD A

| Tahap | Isi | B-R | Pelaksana | Memblokir PRD A |
|---|---|---|---|---|
| **B0 — segera (tanpa kode baru)** | backup; env Vercel; bundel v5.1; reload; antrean; flag O29 dan `since`; rebuild Agu; cek mart | B-R93, B-R80, B-R81 | manusia (Claude dengan izin per langkah) | — (memperbaiki production sekarang) |
| **B1** | user 9 role + assignment; data master | B-R87, B-R88 | manusia/pemilik data | T7 production |
| **B2** | migrasi `v52_meta` + `v52_security` + `v52_release` + tes RLS; PR `v5.2/b2-security-release` | B-R82, B-R83, B-R84, B-R94 | pelaksana DB | R44 tahap 2, R72 bagian API |
| **B3** | staging + T19 + T21 | B-R92 | pelaksana DB + manusia | — |
| **B4** | terapkan bundel B2 ke KGR-OS (sesudah B3 lulus); promosi deploy kode yang menunggu | B-R81 pola, B-R82–84 | manusia | merge R44 tahap 2 |
| **B5** | migrasi `v52_costing` (bila diminta) + `v52_fs`; PR `v5.2/b5-costing-fs`; staging; KGR-OS | B-R85, B-R86 | pelaksana DB → manusia | R51 provenance, R52 tahap 2, R69 |
| **B6** | koreksi `coa_map`; data Agu–Sep; FINAL; impor FS; rekonsiliasi | B-R89, B-R90, B-R91 | Finance / Inventory Accounting / manusia | T20 |

Urutan yang disarankan bersama PRD A:

```
B0 → A0 → A1 ∥ B1 → B2 → A2 ∥ B3 → B4 → A1b → A3 → B5 → A4 → A5 → B6 → A6 → T20
```

`∥` = boleh paralel. Aturan merge PRD A Bab 4 berlaku: kode yang memakai objek DB baru di-merge (dan di-promote, bila O35 diterima) hanya sesudah bundelnya ada di KGR-OS.

---

## 5. Pengujian

### 5.1 Lingkungan

| Uji | Lingkungan |
|---|---|
| Tes RLS (B-R94) | PG16 lokal + shim, dan staging Supabase |
| T19, T21 | staging Supabase (Auth asli) |
| T20, T22 | production KGR-OS, hanya kueri baca + layar app |

### 5.2 Data

| Lingkungan | Data |
|---|---|
| Staging | fixture Agustus + `week-complete.sql` |
| Production | data asli Agustus–September (B-R90) |

### 5.3 Kombinasi flag di production

Menurut O29. Menyalakan `v5_*` untuk role selain admin adalah tindakan manusia sesudah T19 lulus, dicatat di `kgr-os-log.md`.

---

## 6. Pertanyaan terbuka

O21–O33 ada di PRD A Bab 6 (nomor sama). Tambahan khusus DB/ops:

| # | Pertanyaan | Pilihan | Rekomendasi | Pemilik |
|---|---|---|---|---|
| O34 | Bentuk staging | (a) Supabase branch dari KGR-OS; (b) project terpisah `KGR-OS-staging` | **(b)**: tetap ada untuk preview dan CI, tidak menyalin data production | Pemilik produk |
| O35 | Promosi production manual | (a) auto-deploy `main` (sekarang); (b) promote manual sesudah bundel | **(b)** selama v5.2 | Pemilik produk |
| O36 | Tanggal `since` v5 costing | 24 Agu 2026 / 1 Sep 2026 / tanggal lain | **1 Sep 2026** bila Agustus akan dikunci FINAL dengan biaya v1/M1; **24 Agu** bila minggu contoh harus memakai revaluasi v5 | Finance |
| O37 | Region Vercel `hnd1` → `icn1` (dekat KGR-OS Seoul) | ya / tidak | ukur latensi dulu; ubah bila halaman > 3 dtk | Pemilik produk |
| O38 | `release_override_policy` dikunci dari Admin | (a) admin boleh ubah; (b) hanya lewat migrasi | **(b)** | Finance |
| O39 | Data production disalin ke staging untuk uji | ya (dengan masking) / tidak | **tidak** di v5.2 | Pemilik produk |

---

## 7. Checklist eksekusi (perintah siap tempel)

Konvensi:
- Kueri baca boleh dijalankan siapa saja di Supabase Dashboard → SQL Editor project **KGR-OS**.
- ✎ = mengubah data/skema: hanya sesudah backup B0-1, satu per satu, dan hasilnya dicatat di `docs/v5.2/kgr-os-log.md`.
- Bila hasil berbeda dari "harapan", berhenti.

### Tahap B0 — segera

- [ ] **B0-1 Backup.** Supabase Dashboard KGR-OS → Database → Backups → buat backup sekarang (atau pastikan daily backup kemarin ada). Catat waktunya di log.
- [ ] **B0-2 Env Vercel** (manusia). Vercel → `kgr-weekly-outlook` → Settings → Environment Variables. Pastikan **Production** berisi empat nama berikut (nilai dari Supabase → Project Settings → API untuk KGR-OS):
  - `NEXT_PUBLIC_SUPABASE_URL` = `https://pczjhmzpkknzkziipvit.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CRON_SECRET` (buat dengan `openssl rand -hex 32`, atau generator password 64 karakter)

  Untuk **Preview**: kosongkan atau arahkan ke staging (O34). Jangan ke KGR-OS.
- [ ] **B0-3 ✎ Bundel v5.1.** SQL Editor KGR-OS → buka `docs/v5.1/kgr-os-migrasi-v51.sql` dari repo (`main`) → jalankan seluruhnya → semua baris tabel cek di akhir harus `true`. Lalu jalankan:
  ```sql
  notify pgrst, 'reload schema';
  ```
- [ ] **B0-4 Cek skema dan flag** (baca). Harapan: lima kolom pertama `true`.
  ```sql
  select
    to_regprocedure('public.base_key(text)') is not null                 as base_key,
    to_regprocedure('public.lock_commitments(date,jsonb)') is not null   as lock_commitments,
    exists(select 1 from pg_proc where proname = 'advance_update_date')  as advance_update_date,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='price_list_week' and column_name='deleted_at') as plw_deleted_at,
    exists(select 1 from pg_trigger where tgname ilike '%sales_line_scope%') as sales_line_scope,
    (select json_agg(json_build_object('k', key, 'v', value) order by key) from public.app_setting) as flags;
  ```
- [ ] **B0-5 ✎ Flag v5 hanya admin** (bila O29 = (b)):
  ```sql
  update public.app_setting
     set value = value || '{"roles":["admin"]}'::jsonb
   where key like 'v5\_%' escape '\';
  select key, value from public.app_setting where key like 'v5\_%' escape '\' order by key;
  ```
  Lalu Admin → Modul → `v5_costing` → isi "mulai" sesuai O36 → Simpan.
- [ ] **B0-6 ✎ Antrean di luar jendela data.** Harapan: 42 baris (19 Okt–29 Nov) berubah. Bila jumlahnya lain, berhenti.
  ```sql
  update public.rebuild_queue q
     set status = 'done', finished_at = now(),
         error  = 'v5.2 B0-6: di luar jendela data (update_date + 7), tidak dibangun'
   where q.status = 'queued'
     and q.date > (select max(update_date) + 7 from public.week);
  select status, count(*), min(date), max(date) from public.rebuild_queue group by status;
  ```
- [ ] **B0-7 Bangun ulang.** Login Admin di https://kgr-weekly-outlook.vercel.app → Admin → Modul → Bangun ulang 24 Agu – 30 Agu 2026. Bila muncul "server belum punya SUPABASE_SERVICE_ROLE_KEY", kembali ke B0-2 lalu redeploy.
- [ ] **B0-8 Cek mart** (baca). Harapan: `pl_daily_v4`, `lot`, `sku_balance_daily` > 0; antrean `queued` = 0.
  ```sql
  select
    (select count(*) from public.pl_daily_v4)            as pl_daily_v4,
    (select count(*) from public.pl_daily)               as pl_daily,
    (select count(*) from public.lot)                    as lot,
    (select count(*) from public.sku_balance_daily)      as sku_balance_daily,
    (select count(*) from public.cash_position_daily)    as cash_position_daily,
    (select count(*) from public.input_completeness_daily) as grid,
    (select json_agg(r) from (select status, count(*) n from public.rebuild_queue group by status) r) as queue,
    (select json_agg(r) from (select date, error from public.rebuild_queue where status = 'failed' order by date) r) as failed;
  ```
- [ ] **B0-9 Cek user per role** (baca; jalankan lagi sesudah B1):
  ```sql
  select role, count(*) from public.app_user group by role order by role;
  ```
- [ ] **B0-10 Buka app** sebagai Admin: Minggu ini 24 Agu, Kas, Outlook bulan. Tidak ada banner/tile "Gagal memuat" karena kolom atau fungsi tidak ada. Tangkapan layar ke log.

### Tahap B1 — user dan data master
- [ ] Pemilik mengisi `docs/v5.2/users.md` (email, nama, role, assignment Sales).
- [ ] Undang user (Supabase Auth → Users → Invite, atau alur login app). Pastikan baris `app_user` dengan role yang benar (B0-9).
- [ ] `sales_assignment` lewat layar Admin/Komersial bila ada; bila tidak, Kepala Sales menyusun daftar dan pelaksana DB membuat bundel data.
- [ ] Data master B-R88 diisi pemilik data. Lalu cek:
  ```sql
  select
    (select count(*) from public.weight_class where avg_kg is not null) as kelas_terisi,
    (select count(*) from public.size_class_map where deleted_at is null) as peta_ukuran,
    (select json_agg(r) from (select code, amount_per_month, active from public.fixed_cost_schedule order by code) r) as beban_tetap,
    (select json_agg(r) from (select week_id, accurate_sales_kg, accurate_opening_stock_value from public.parameter) r) as accurate,
    (select count(*) from public.sales_assignment) as assignment;
  ```

### Tahap B2 — migrasi keamanan dan rilis (PR `v5.2/b2-security-release`)
- [ ] `git log -1 origin/main` dicatat; branch dari `main`.
- [ ] `20261025000100_v52_meta.sql` (B-R82), `…0200_v52_security.sql` (B-R83), `…0300_v52_release.sql` (B-R84). Default O21/O22/O28/O31/O32/O38 dipakai bila pemilik belum memutuskan, dan dicatat di QUESTIONS sebagai Q-v5.2-n.
- [ ] Sebelum menulis A-REL-1: cari semua penulis kolom `week` di `apps/web` (`rg "from\(\"week\"\)\.(update|upsert)" apps/web`) dan catat kolom apa yang ditulis role mana.
- [ ] Blok `rls_roles.sql` untuk setiap baris tabel B-R83 + P2/P3/P4/P5 (B-R84).
- [ ] Jalankan migrasi dua kali; `pnpm test:rls` hijau → `docs/v5.2/bukti/b2-rls.txt`.
- [ ] Bundel `docs/v5.2/kgr-os-migrasi-v52-b2.sql`: kepala sha256, isi tiga file, `insert into schema_registry`, `notify pgrst, 'reload schema'`, tabel cek.
- [ ] PR. **BERHENTI — sign-off. Bundel belum ke KGR-OS.**

### Tahap B3 — staging (T19, T21)
- [ ] O34 diputuskan. Buat staging; terapkan semua migrasi (`supabase/migrations`, urut) + seed.
- [ ] 9 user di Supabase Auth staging; `sales_assignment` uji.
- [ ] `SUPABASE_DB_URL=<staging> pnpm test:rls` → hijau.
- [ ] `tests/e2e/journey-T7` (sesudah PRD A irisan A5) dengan `E2E_BASE_URL` = preview Vercel yang env-nya menunjuk staging → `docs/v5.2/staging-T19.md`.
- [ ] Uji pemulihan backup ke staging (B-R93).
- [ ] **BERHENTI — sign-off.**

### Tahap B4 — bundel B2 ke KGR-OS
- [ ] B0-1 backup.
- [ ] ✎ Jalankan `docs/v5.2/kgr-os-migrasi-v52-b2.sql`; tabel cek semua true.
- [ ] Cek versi:
  ```sql
  select public.schema_version();
  ```
- [ ] Cek probe keamanan dengan kueri baca: policy `plan_week_class_read`, `surplus_response_read`, trigger `tg_week_guard`, sesuai harapan.
  ```sql
  select tablename, policyname, cmd, qual from pg_policies
   where schemaname='public' and tablename in ('week','plan_week_class','surplus_response','demand_class_weekly','sales_line')
   order by 1, 2;
  ```
- [ ] Merge/promote PR kode A1b (R44 tahap 2). **BERHENTI.**

### Tahap B5 — costing dan FS
- [ ] Hanya objek yang diminta Q-v5.2 dari PRD A (B-R85) + `v52_fs` (B-R86). Tes RLS, rerun, bundel, staging, lalu KGR-OS (pola B2–B4).
- [ ] Merge/promote R69 sesudahnya. **BERHENTI.**

### Tahap B6 — data Agustus–September dan FS (T20)
- [ ] B-R89: Finance meninjau `coa_map`. Kueri awal untuk tinjauan:
  ```sql
  select account, name, pl_line, fs_mapping_reference, driver_type
    from public.coa_map
   where fs_mapping_reference is not null
   order by account;
  ```
- [ ] B-R90 berurutan: TB 31 Jul → jurnal 1–31 Agu → DI Agustus → bank → stok → FINAL Agustus → minggu September → jurnal September → DI September → bank → stok → FINAL September. Sesudah tiap bulan:
  ```sql
  select date_trunc('month', date)::date as bulan, count(*) as baris,
         sum(debit) as debit, sum(credit) as kredit, sum(debit) - sum(credit) as selisih
    from public.gl_line
   group by 1 order by 1;
  ```
  (Kolom `debit`/`credit` disesuaikan dengan skema `gl_line`. Cek dulu dengan `\d public.gl_line` atau `select * from public.gl_line limit 1;`.)
- [ ] B-R91: impor FS Agustus dan September → `fs_line_map` disetujui Finance → halaman Rekonsiliasi → C59.
- [ ] Ekspor `docs/v5.2/fs-recon-2026-08.md` dan `-09.md`. Setiap selisih diberi sebab: data / definisi / bug.
- [ ] **BERHENTI — sign-off T20.**

### Larangan sepanjang v5.2-B
- [ ] Tidak menjalankan ✎ tanpa backup dan tanpa catatan log.
- [ ] Tidak menjalankan `scripts/test-rls.sh` dengan `DATABASE_URL` ke KGR-OS (skrip menerapkan shim + seed). Ke KGR-OS hanya bundel.
- [ ] Tidak drop/rename; tidak mengubah fungsi yang ada kecuali `create or replace` dengan signature sama.
- [ ] Tidak memakai project pilot `uxqbtverhnpiryhzbenr`.
- [ ] Tidak menyalakan `v5_*` untuk role selain admin sebelum T19 lulus (bila O29 = b).
- [ ] Tidak mengubah kode di `apps/**` atau `packages/**`: itu PRD A. Kebutuhan kode ditulis sebagai Q-v5.2 dengan rujukan R.
- [ ] Tidak memfinalkan O21–O39.
