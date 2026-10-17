Kamu pelaksana DB irisan **B5** PRD v5.2 untuk repo KGR-Weekly-Outlook (`/home/user/wt-b5`, cabang `v5.2/b5-costing-fs`, dibuat dari `origin/main` yang sudah memuat B2 / PR #41). Bahasa dokumen: Indonesia; angka "Rp 2.600,0 jt", "9,0%". Commit kecil dan sering, push ke `origin v5.2/b5-costing-fs` (`git push -u origin v5.2/b5-costing-fs`). Jangan buka PR, jangan merge, jangan sentuh project Supabase mana pun (tidak ada koneksi ke KGR-OS / staging dari kamu). Jangan ubah `apps/**`, `packages/**`, `computeWeek`, golden, parity, snapshot. Hanya `supabase/**` dan `docs/v5.2/**`.

Akhiri setiap pesan commit dengan:
```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJPiPyjnWyT3jytRNYv3G
```

## Baca dulu
- `docs/PRD-v5.2-B-db.md` B-R85, B-R86, B-R91 dan aturan migrasi (Bab 3–5).
- `docs/v5.2/b2.md` (pola kerja B2 yang diterima: blok RLS per objek, probe main vs cabang, rerun, bundel, bukti).
- `docs/v5/QUESTIONS.md` bagian v5.2 (Q-v5.2-10…19 sudah diputuskan; kamu mengerjakan -13 dan -18).
- `docs/v5.2/REVIEW-v5.1.md` Bab 7 (tabel Dashboard vs laporan keuangan → seed `fs_line_map` status draft).
- Berkas FS: `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx`; sheet `PL - Management Report` dan `BS - Management Report` — hanya untuk menentukan baris (`row_no`, `line`) seed `fs_line_map`. Jangan impor angka FS ke migrasi (itu B-R91, bundel data terpisah, nanti).
- Pola tes: `supabase/tests/rls_roles.sql` (hasil di `raise exception 'RLS-RESULTS …'`, `(!)` = gagal), `scripts/test-rls.sh`.

## Lingkungan lokal
PostgreSQL 16 sudah jalan: socket `/tmp`, port 5432, user `postgres`. Buat DB sendiri dengan nama `b5_*` (mis. `psql -h /tmp -U postgres -c "create database b5_t1"`), jalankan `DATABASE_URL="postgresql://postgres@/b5_t1?host=/tmp" bash scripts/test-rls.sh`. Jangan sentuh DB lain (`a2_pgrst`, `b2_review`, cluster e2e di `wt-a5`).

## Pekerjaan

### 1. `supabase/migrations/20261025000400_v52_costing.sql` (B-R85, hanya yang diminta PRD A)
- `batch.lb_price_source text` nullable, `check (lb_price_source in ('keputusan_kelas','keputusan_semua_kelas','manual'))`, comment kolom (R51: harga LB batch dari keputusan kelas spesifik → keputusan semua kelas → manual; null = belum ada, C57). Hak tulis kolom mengikuti hak tulis `batch` yang ada (jangan buka hak baru).
- Diminta A2 (laporan WIP 17 Okt): `plan_check_reason.plan_week_id uuid references plan_week(id)` + unik per (versi rencana, kode kontrol, tanggal/kelas sesuai kolom yang ada) agar alasan C58 terikat versi; `plan_week_class.detail jsonb` (pembagian per tanggal hasil simpan rencana, R52 tahap 1; null = baris lama). Hak tulis mengikuti tabelnya.
- Diminta A3: override posting alokasi oleh Finance (R61) — `allocation_run` hanya bisa di-UPDATE admin/cost_accounting. Tambah hak UPDATE untuk `finance` yang terbatas pada kolom/kondisi override (cek kode `postOverride` di cabang `v5.2/a3-costing-pl`), atau RPC SECURITY DEFINER; pilih yang paling sempit, dengan blok tes.
- TIDAK dibuat: `save_class_plan` (O33(b) menunda K27 tahap 2), `cost_snapshot` dan `sales_stock_age_v52` (tidak diminta PRD A). Tulis itu di dokumen.
- Q-v5.2-13: `tg_week_guard` (definisi terbaru ada di `20261025000200_v52_security.sql`) — `create or replace` dengan isi sama ditambah: kolom `opening_stock_flag` boleh diubah oleh `inventory_accounting` dan `finance` hanya bila `old.status = 'open'`. Kolom lain dan aturan `update_date` tidak berubah.
- Q-v5.2-18: dua view Sales `commercial_daily_sales` dan `commercial_daily_sales_v5` (`create or replace`, daftar kolom, nama, urutan, tipe identik dengan B2): `holding_loss_per_day` dan `downgrade_risk_rp` juga dibungkus `case when s.sees` (cast ke tipe aslinya). Policy baca `price_floor_rule`: Sales tidak membaca (peran lain tetap seperti sekarang — cek policy yang ada dulu).
- Daftarkan `insert into public.schema_registry (version) values ('5.2.3') on conflict do nothing;`

### 2. `supabase/migrations/20261025000500_v52_fs.sql` (B-R86)
- Tabel `fs_statement_line` persis spesifikasi B-R86 (id uuid default gen_random_uuid(), month date check hari pertama bulan, statement check in ('PL','BS'), sheet, row_no int, line, amount numeric(20,2), source_file, source_sha256, version int default 1, locked_at, created_by default current_email, created_at default now()); unique `(month, statement, row_no, version)`.
- Tabel `fs_line_map(statement, row_no, app_line, sign int check in (-1,1), note, status text check in ('draft','agreed') default 'draft', updated_by, updated_at)`, PK `(statement, row_no)`. Seed baris dari REVIEW Bab 7 dengan status `draft` (`on conflict do nothing`), hanya baris yang bisa kamu tunjuk sumbernya (sel FS + baris app); sisanya kosong (Finance mengisi).
- RLS kedua tabel: baca admin/finance/management/operations_director; tulis finance/admin; baris `fs_statement_line` dengan `locked_at` tidak bisa diubah/dihapus (trigger, `42501`), termasuk oleh admin; `anon` tanpa hak. Sales, ppic, purchasing, dll. ditolak baca.
- `release_override_policy` baris `C59` (`array['finance']`, note O25–O27) `on conflict do nothing`.
- Daftarkan versi `5.2.4`.

### 3. Tes dan bukti (pola B2)
- Tambah blok di akhir `supabase/tests/rls_roles.sql` per objek: lb_price_source (check menolak nilai lain; role yang boleh tulis batch bisa mengisi); opening_stock_flag (IA dan finance boleh di minggu open; ditolak di released/closed; sales/ppic ditolak; kolom lain tetap ditolak untuk IA); dua view Sales (dua kolom baru kosong bila `sees` false, terisi bila true; management melihat); price_floor_rule (Sales 0 baris / ditolak, finance/admin baca); fs_statement_line & fs_line_map (sales/ppic ditolak baca, finance tulis, baris terkunci ditolak ubah dan hapus oleh finance dan admin, anon tanpa hak); C59 ada dan hanya finance; registry punya 5.2.3 dan 5.2.4. Blok kebersihan B2 harus tetap lulus.
- Jalankan blok baru di migrasi `origin/main` saja (probe "main vs cabang") → catat jumlah `(!)` di main vs 0 di cabang.
- Rerun dua migrasi di DB yang sudah memuatnya: exit 0, definisi tidak berubah.
- `test:rls OK` penuh di cabang.
- Bundel KGR-OS `docs/v5.2/kgr-os-migrasi-v52-b5.sql` dengan pola persis bundel B2 (`docs/v5.2/kgr-os-migrasi-v52-b2.sql`): kepala (tujuan, sha256 tiap berkas dan gabungan), prasyarat (schema_version() = '5.2.2' dan objek B2 ada), dua berkas apa adanya, isi `bundle_sha256` registry, `notify pgrst, 'reload schema'`, tabel cek (kolom `ada` true semua). Uji dua kali di DB baru (shim + migrasi s.d. B2 + seed) dan ditolak di DB tanpa B2.
- Dokumen `docs/v5.2/b5.md` (pola `b2.md`: hasil, berkas, per requirement, probe, keputusan baru Q-v5.2-20…, batas bukti) dan `docs/v5.2/bukti/b5-*.txt`.

## Laporan akhir (pesan terakhirmu)
Cabang + SHA head, daftar berkas, hasil test:rls (jumlah blok, `(!)`), probe main vs cabang, sha bundel, Q-v5.2 baru, dan apa pun yang tidak bisa kamu kerjakan beserta alasannya. Jangan mengklaim "lulus" tanpa menyebut lingkungannya (PG16 lokal + shim).
