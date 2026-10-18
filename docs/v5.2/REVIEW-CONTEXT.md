# Konteks lengkap untuk review dan edit (handoff 18 Okt 2026)

Untuk agen reviewer/editor (mis. Fable) yang melanjutkan KGR-Weekly-Outlook sesudah sesi agen Opus 17–18 Okt 2026. Baca
dokumen ini dari atas sampai bawah sebelum mengubah apa pun. Semua klaim di sini punya sumber di repo; bila ragu, cek
sumbernya, bukan dokumen ini.

**Tenggat:** app dipakai tim mulai **Senin 19 Okt 2026**. Pemilik: Dika (Admin). Bahasa dokumen dan UI: Indonesia. Angka
ditulis "Rp 2.600,0 jt", "9,0%".

---

## 1. Keadaan saat ini (diperiksa 18 Okt ±14.00–15.00 UTC)

| Hal | Keadaan | Sumber bukti |
|---|---|---|
| Production | `https://kgr-weekly-outlook.vercel.app`, `main` `6f9757f` (kode sama dengan `7d83173`), deploy Vercel sukses, region `hnd1` | GitHub Deployments; smoke `ops/smoke` |
| Database KGR-OS | Supabase `pczjhmzpkknzkziipvit` (Seoul), `schema_version()` **5.2.6** = `EXPECTED_SCHEMA` di `apps/web/lib/schema.ts` | `docs/v5.2/kgr-os-log.md` |
| Smoke production (runner GitHub, tanpa kredensial) | `/login` 200; `/api/cron/rebuild` 401 tanpa rahasia; halaman terlindung → `/login?next=…`; login alamat tak terdaftar → "E-mail atau kata sandi salah" (app tersambung Supabase Auth) | branch `ops/smoke`, `.github/workflows/smoke.yml` |
| Flag | 16 flag `app_setting`; 6 flag `v5_*` dibuka untuk semua role 18 Okt ±10.10 UTC (Q-v5.2-103, **menunggu konfirmasi Dika**) | log 18 Okt |
| Data KGR-OS | 1 user (Admin); 0 `sales_assignment`; 1 minggu (24 Agu, open); `gl_line` 1.840 baris 1–26 Agu (ekspor lama); TB 31 Jul 208 baris; DI-01…05 belum diposting; FS Agu–Sep 146 baris (B-R91); `rebuild_queue` 7 queued (24–30 Agu); `data_status` kosong (mart belum pernah dibangun di production); 0 upload | kueri baca 18 Okt 14.04 UTC |
| CI `main` | job `engine`, `lint`, `rls`, `e2e` hijau; e2e: matriks 120, O 15, T7 58, A6 82, A7 70, L 34, P 16, R69 65, F19 16, volume 13; 0 XFAIL (`E2E_STRICT_XFAIL=1`) | `.github/workflows/ci.yml`, run PR #62–#64 |

### Yang belum jalan karena butuh Dika (bukan kode)

1. **D2 — env Vercel Production**: `SUPABASE_SERVICE_ROLE_KEY` dan `CRON_SECRET`, lalu Redeploy. Tanpa ini rebuild mart,
   cron (22.00 UTC), tombol "Bangun ulang", dan pemilih Sales untuk Kepala Sales tidak jalan. Connector Vercel agen tidak punya
   izin project (404/403), jadi agen tidak bisa mengisinya.
2. Pengguna (Admin → Pengguna), penugasan Sales (Komersial → Penugasan Sales), minggu 19 Okt (Admin → Minggu), upload data.
3. Konfirmasi Q-v5.2-103 (flag) dan Q-v5.2-104 (uji RLS penuh di KGR-OS).
4. Staging (D1) untuk T19/T21/T23: `create_project` dibatalkan di konfirmasi biaya.

Langkah lengkap untuk Dika: `docs/v5.2/SIAP-PAKAI.md`. Daftar kebutuhan: `docs/v5.2/BUTUH-DIKA.md`.

### Pekerjaan yang sedang berjalan

- **Cabang `v5.2/a8-fixes`** (head `5a6613c`, belum di-PR): A8 perbaikan kecil sebelum dipakai (Q-v5.2-114 form komitmen tetap
  terisi sesudah ditolak, 111 teks tile akurasi, 122 tile komitmen mengikuti aturan cakupan DB, 112 label dua angka surplus,
  100 penjaga hidrasi). Gate lokal hijau, **CI e2e merah**: T7 langkah 1b, role sales, `GET /w/2026-08-24/input/harga` →
  React error #418 (hidrasi) sekali. Seorang agen sesi Opus sedang mencari akar masalahnya di cabang yang sama. **Jangan push ke
  `v5.2/a8-fixes` tanpa koordinasi** (minta Dika menghentikan agen itu dulu bila Anda mengambil alih). Rinci: `docs/v5.2/a8.md`
  di cabang itu, log CI job 117698080505.
- Check-in otomatis sesi Opus 18 Okt 22.20 UTC: membaca `rebuild_queue` sesudah cron (tanda D2 sudah diisi). Hanya baca.

---

## 2. Peta repo

```
apps/web/              Next.js 15 (App Router, server actions), @supabase/ssr, PostgREST
  app/                 halaman: w/[week]/… (minggu), m/[month]/… (bulan, rekonsiliasi), komersial/ (+assignment), input/,
                       minggu-ini/[week], kas/, admin/ (pengguna, minggu, modul, audit), api/cron/rebuild, login/
  lib/                 loader gagal-tertutup (loader.ts: must, mustRows, LoaderError), data.ts (computeForWeek), rebuild.ts,
                       release.ts, schema.ts (+schema-session.ts), modules*.ts (flag), roles.ts, supabase*.ts, v3/ v4/ v5/
  components/          ActionForm, Shell, TilePage, v4/, v5/
packages/engine/       TypeScript murni (decimal.js): computeWeek, kontrol, fs-recon, upload-validate, golden v1
packages/parsers/      SheetJS 0.20.3 (cdn.sheetjs.com), parse upload (tables.ts: jenis upload, alias header)
supabase/migrations/   SQL berurutan nama; v5.2 = 20261025000100 … 0700 (lihat §5)
supabase/tests/        rls_roles.sql (48 blok RLS-RESULTS), supabase_shim.sql (meniru auth/roles Supabase di PG16 polos)
tests/e2e/             harness e2e: stack/ (PG16 + shim + PostgREST 12 + mock auth/storage + next start di bawah faketime),
                       journey-*.cjs, matrix.cjs + matrix-expect.json, sql/ (SETUP berlabel)
scripts/               lint.py (k41/k42/missing), test-rls.sh, check-query-columns.py, fs_import.py, build_fs_recon.py
reference/             workbook FS v2 (`09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx`) — sumber angka FS dan jurnal Agu/Sep
docs/                  PRD (PRD-v5.2-A-kode.md, PRD-v5.2-B-db.md), docs/v5/QUESTIONS.md (keputusan), docs/v5.2/* (lihat §8)
```

Konvensi kode: komentar Inggris singkat dengan rujukan aturan (K41, R64, Q-v5.2-n); loader gagal-tertutup (tidak pernah
"tidak ada data" diam-diam); `?? 0` pada uang/kg/tarif adalah hit lint kecuali ada `// missing-ok: <alasan>`; tulis lewat
server action dengan cek role dulu lalu `assertSchemaCurrent`; rebuild/mart hanya dengan klien servis (`mart_replace` hanya
untuk service role).

---

## 3. Aturan yang harus dijaga (rem dari brief Dika 17 Okt + pelajaran sesi)

1. **Backup sebelum setiap perubahan ke KGR-OS.** Pengganti `pg_dump` (port DB tidak terjangkau dari container): snapshot di
   dalam DB `docs/v5.2/kgr-os-backup.sql` → skema `bak_<UTC>` (tanpa hak anon/authenticated). Catat waktu, perintah, hasil di
   `docs/v5.2/kgr-os-log.md`. Cara pulih ada di kepala log.
2. **Urutan merge.** Vercel men-deploy `main` otomatis. Kode yang memakai objek DB baru di-merge **sesudah** objek itu ada di
   KGR-OS (bundel diterapkan, tabel cek semua true). Kode yang menutup akses (mis. Sales tanpa baca rencana) di production
   **sebelum** bundel yang mencabut hak DB (Q-v5.2-79).
3. **Bundel KGR-OS**: berkas `docs/v5.2/kgr-os-migrasi-v52-b*.sql` = prasyarat + migrasi apa adanya + `bundle_sha256` +
   `notify pgrst` + tabel cek (semua harus true). Sesudah diterapkan, bandingkan sidik skema KGR-OS dengan PG16 lokal yang
   memuat migrasi yang sama: `docs/v5.2/bukti/schema-fingerprint-all.sql` (9 kategori harus identik).
4. **Connector Supabase `execute_sql`**: (a) escape `\uXXXX` di teks SQL diubah transport menjadi karakter asli — jangan
   kirim; bangun backslash dengan `chr(92)` (kasus `norm_code`, log 18 Okt 06.22); (b) pernyataan destruktif (`delete`, dll.)
   meminta konfirmasi pengguna — bila dijawab `{"status":"cancelled"}`, **berhenti, jangan diulang/diakali** (Q-v5.2-104);
   (c) `create_project` butuh konfirmasi biaya.
5. **Pengaman auto mode** menandai penulisan flag (`app_setting`) sebagai tindakan sensitif. Perubahan flag hanya dengan
   persetujuan Dika yang jelas.
6. **Angka harus bersumber; kontrol tidak dipaksa lulus** (K62). Tanpa sumber: catat di `BUTUH-DIKA.md`, lanjut.
7. **Tidak disentuh**: `computeWeek`, golden v1, parity (17.161/17.161), snapshot (`snapshot:diff` EMPTY). Project Supabase
   `uxqbtverhnpiryhzbenr` tidak pernah dipakai.
8. **Repo publik**: tanpa kredensial, e-mail user nyata, atau dump data di repo/artifact workflow.
9. **"Lulus" selalu dengan lingkungan**: "vitest", "PG16 lokal + shim", "PG16 lokal + PostgREST 12 + mock auth", "KGR-OS
   (connector)", "CI run N". PG16 lokal bukan Supabase.
10. **Kuota deploy Vercel** (Hobby, ±100/hari, jendela bergulir): tiap push ke `main` = satu deploy production. Preview untuk
    cabang `v*/**`, `ops/**`, `docs/**`, `claude/**` dimatikan (`apps/web/vercel.json`, #55). Kumpulkan merge; cek status
    commit `main` ("Vercel" success) sesudah merge. Pernah tertahan "rate limited — retry in 24 hours".
11. **CI harus hijau sebelum merge**, `E2E_STRICT_XFAIL=1` (XFAIL tanpa nomor Q dan alasan dilarang). Jangan matikan/lewati tes,
    jangan commit kosong untuk memicu CI, jangan force-push cabang orang lain.

---

## 4. Menjalankan gate

```bash
pnpm install                 # bila cdn.sheetjs.com diblokir: override lokal "@kgr/parsers>xlsx": "0.18.5" di package.json,
                             # install, lalu `git checkout -- package.json pnpm-lock.yaml` SEBELUM commit (jangan pernah di-commit)
pnpm typecheck               # periksa exit code; jangan `pnpm -s typecheck | tail` (menyembunyikan kegagalan)
pnpm test                    # engine + parsers + web (vitest); terakhir: engine 467, parsers 31, web 854 (main) / 877 (a8)
pnpm parity                  # 17161/17161
pnpm snapshot:diff           # EMPTY
DATABASE_URL="postgresql://postgres@/<db_baru>?host=/tmp" bash scripts/test-rls.sh   # 48 blok, 0 "(!)", check-query-columns 0 unknown
bash scripts/test-lint.sh && bash scripts/lint-k41.sh && bash scripts/lint-k42.sh && python3 -I scripts/lint.py missing
pnpm e2e:build && E2E_BUILD=never E2E_STRICT_XFAIL=1 pnpm e2e    # ±8 menit; hasil di tests/e2e/out
```

e2e: `tests/e2e/stack/env.sh` memuat port (default PG 54329, PostgREST 54330, mock 54321, app 3100). **Bila dua harness jalan
bersamaan, pakai port sendiri** (`E2E_PG_PORT`, `E2E_PGRST_PORT`, `E2E_SUPA_PORT`, `E2E_APP_PORT`); `up.sh`/`down.sh` mematikan
proses di port itu. `E2E_ONLY="T7 R69"` menjalankan sebagian (A6, A7, L, P, R69, F19, volume butuh T7 lebih dulu, otomatis).
Server app jalan di bawah faketime (jam uji per langkah), browser memakai jam nyata.

CI (`.github/workflows/ci.yml`, tiap push dan PR): `engine` (typecheck, test, parity, snapshot:diff, CLI outlook, `pnpm build`),
`lint` (4 langkah di atas), `rls` (PG16 service container + `test-rls.sh`), `e2e` (`e2e:build` lalu `pnpm e2e`). Workflow lain: `backup.yml` (butuh secret, D4), `db-ops.yml` (dipicu push `ops/db-ops.json` ke `ops/db-run`; butuh D4),
`ops/smoke` (smoke production, dipicu push cabang itu).

---

## 5. Yang dikerjakan v5.2 (PR ke `main`, semua CI hijau sebelum merge)

| PR | Isi | Dokumen |
|---|---|---|
| #37, #38 | A1 gagal-tertutup R41–R47, lint K41/K42 | `audit-handover.md` |
| #40 | BT-1 parser GL gagal-tertutup | `BACKTEST-SEP-2026.md` |
| #41 | B2 migrasi `v52_meta` (schema_registry, `schema_version()`), `v52_security`, `v52_release` (B-R82–84) | `b2.md` |
| #42, #49 | A4 rekonsiliasi FS R68–R69, C59 | `a4.md`, `fs-recon-fixture.md` |
| #43, #46, #48 | backup.yml tanpa artifact dump; `db-ops` | — |
| #44, #50 | A1b K69 `update_date`; banner skema dari `schema_version()` | — |
| #45 | A2 putaran PPIC–Komersial R48–R58 | `a2.md` |
| #47 | B5 `v52_costing`, `v52_fs` (B-R85, B-R86) | `b5.md` |
| #51 | A3 costing dan P&L R59–R67, lint `missing` | `a3.md` |
| #52 | A5 harness e2e + job CI `e2e` R70–R74 | `a5.md` |
| #53 | A1c objek B5 di kode; Sales tidak lagi membaca rencana/demand (sisi kode); `test-rls.sh` here-string | `a1c.md` |
| #54 | A1d cron dan builder memakai klien pemanggil (Q-v5.2-51) | `a1d.md` |
| #55 | Vercel deploy hanya `main` | Q-v5.2-83 |
| #56, #63, #64 | dokumen; `scripts/fs_import.py` (B-R91) | — |
| #57 | B6 Sales tanpa `plan_week`/`demand_weekly` (+ audit redact, view surplus, trigger definer) | `b6.md` |
| #58 | B7 Sales tanpa `plan_day`, `plan_variance_daily`, `demand_shortfall`, `plan_check_reason` | `b7.md` |
| #59 | `EXPECTED_SCHEMA` 5.2.6 | — |
| #60 | A6 R75–R79, O16 (stok bebas − komitmen terkunci), O17 (P&L collapsed ≤ 768 px), O19 | `a6.md` |
| #61 | A5b bukti e2e R48, R69, R70 (journey O, L, P, R69) | `a5b.md` |
| #62 | A7 layar Penugasan Sales; key dasar di `commercialView` | `a7.md` |

Migrasi di KGR-OS (urut): v5.1 (12/12) → B2 `20261025000100…0300` (24/24, 5.2.2) → B5 `0400`, `0500` (26/26, 5.2.4) → B6
`0600` (15/15, 5.2.5) → B7 `0700` (16/16, 5.2.6). Data: B1 jadwal beban tetap Agu–Sep, B-R89 `coa_map` (213 akun), B-R91 FS
Agu–Sep, mode memo O24(b) di `v5_pl`.

---

## 6. Daftar review (urut risiko untuk dipakai besok)

Untuk tiap butir: baca kode + tes, cari jalur nyata menuju kegagalan, jangan percaya dokumen tanpa memeriksa.

**P0 — memblokir pemakaian**
1. **A8 / #418** (§1): pastikan akar masalah ditemukan dan CI hijau sebelum merge; bila tidak sempat, A8 boleh ditunda (main
   sekarang hijau dan aman). Butir A8 yang paling berguna untuk besok: Q-v5.2-114 (form komitmen).
2. **Alur tanpa kunci servis** (bila D2 belum diisi besok pagi): halaman harus tetap terbuka dengan pesan jelas, bukan crash.
   Periksa `lib/rebuild.ts` (`REBUILD_NO_KEY`), `app/api/cron/rebuild/route.ts`, `lib/v5/assignment-data.ts` (pesan untuk
   Kepala Sales), `lib/release.ts` (grid K35 tanpa kunci).

**P1 — kebenaran dan keamanan**
3. **A1d** `lib/supabase.ts` (`supabaseServer` di-`cache` React per request) dan `lib/data.ts` (`computeForWeek` memo per
   klien, `WeakMap`): aman di server action dan route handler? Klien servis dibuat baru per panggilan (`supabase-service.ts`).
4. **RLS Sales** (B6/B7 + A1c): `supabase/migrations/20261025000600*`, `0700*`; view `surplus_for_sales_v52` (bukan
   `security_invoker`, membaca sebagai pemilik); `audit_log_sales_redact` (30 tabel). Tes: blok "v5.2 B6", "v5.2 B7" di
   `supabase/tests/rls_roles.sql`; kode Sales: `lib/v5/sales-plan-reads.test.tsx`, `planning-readers.test.ts`.
5. **Batas yang diketahui** Q-v5.2-85/86: `batch` (termasuk `lb_price`, `freight`, `maklon`) dan `release.snapshot` masih
   terbaca Sales lewat PostgREST karena mesin outlook v1 menghitung dengan sesi pengguna. Diputuskan tidak diubah di v5.2
   (usulan v5.3: outlook Sales dihitung server dengan klien servis). Nilai ulang bila Dika menganggapnya penghalang.
6. **Rilis** `lib/release.ts`: R79(b) membangun ulang grid kelengkapan dengan klien servis sebelum pre-check K35 — pastikan
   cek role pemanggil terjadi sebelumnya (aksi rilis).
7. **A7** `app/komersial/assignment/actions.ts`, `lib/v5/assignment*.ts`: cek role → `assertSchemaCurrent` → tulis dengan
   klien sesi (RLS); klien servis hanya untuk membaca daftar Sales (e-mail, nama) bagi Kepala Sales. Validasi key; upsert tanpa
   duplikat; nonaktif tanpa hapus. Perbaikan `lib/v3/commercial-view.ts` (key dasar menutupi semua bentuk, O21 b).
8. **O16** `lib/v5/free-stock.ts`, `free-stock-data.ts`: stok bebas − komitmen terkunci minggu depan yang belum tertutup PO
   Confirmed, per key, dibatasi stok; PO tanpa kg tidak dihitung 0. Baris Manajemen ikut dinetkan (Q-v5.2-101).
9. **FS/C59** `scripts/fs_import.py` (+ `kgr-os-data-fs.sql`), `lib/v5/fs-recon*.ts`, `packages/engine/src/fs-recon.ts`;
   D9: ekuitas b.77 selisih Rp 2,71 di workbook (sebab tertulis, bukan disesuaikan).
10. **Flag** (Q-v5.2-103): 6 flag v5 terbuka tanpa T19. Pengganti: matriks e2e 120 + smoke. Keputusan produk.

**P2 — konsistensi**
11. `docs/v5.2/status-r.md` (43 lulus, 8 sebagian, 3 belum), `SUMMARY-v52.md`, `PROGRESS.md`, `SIAP-PAKAI.md`: cocokkan dengan
    kode dan log; perbaiki bila ada klaim tanpa bukti.
12. Pertanyaan terbuka bernomor di `docs/v5/QUESTIONS.md` (Q-v5.2-1…123; A8 menambah 130–132 di cabangnya).

---

## 7. Data Agustus–September (B-R90) — langkah berikut yang paling berharga sesudah D2

- Jurnal: dua berkas siap unggah sudah dikirim ke Dika (`SIAP-PAKAI.md` §4b), dibentuk ulang dari sheet `Agt 26`/`Sep 26`
  workbook FS v2 (header sudah cocok dengan alias jenis upload "Accurate — General Ledger / Journal", role Admin/Inventory
  Accounting). Bisa dibangun ulang dari `reference/` bila perlu: salin baris header (baris 3) dan baris bertanggal.
- Urutan PRD B-R90: TB 31 Jul (ada) → jurnal 1–31 Agu → DI Agustus diposting → bank → stok → FINAL Agustus → minggu September
  → jurnal 1–30 Sep → DI September → bank, stok → FINAL September. FINAL hanya lewat app (snapshot hasil hitung), bukan SQL.
- FS acuan sudah di KGR-OS; `fs_line_map` masih 15 baris `draft` — persetujuan Finance diperlukan sebelum C59 dinilai.

---

## 8. Peta dokumen

| Dokumen | Isi |
|---|---|
| `docs/PRD-v5.2-A-kode.md`, `PRD-v5.2-B-db.md` | requirement R41–R79, B-R80–B-R94 (otoritas) |
| `docs/v5/QUESTIONS.md` | semua keputusan (O-, Q-v5.1-, Q-v5.2-n) — "diputuskan agen atas delegasi Dika" bila dari sesi agen |
| `docs/v5.2/SIAP-PAKAI.md` | langkah Dika untuk 19 Okt |
| `docs/v5.2/SUMMARY-v52.md` | ringkasan penutupan, Definisi Selesai 1–9 |
| `docs/v5.2/status-r.md` | status per requirement dengan bukti dan lingkungan |
| `docs/v5.2/PROGRESS.md` | langkah dan status lintas sesi |
| `docs/v5.2/kgr-os-log.md` | setiap perubahan di KGR-OS (waktu, perintah, hasil, backup) |
| `docs/v5.2/BUTUH-DIKA.md` | data/akses yang hanya Dika bisa beri (D1–D9) |
| `docs/v5.2/a*.md`, `b*.md` | rincian per irisan (file:baris, tes, gate) |
| `docs/v5.2/bukti/` | bukti (sidik skema, keluaran tes, tangkapan layar a5b/a6/a7) |
| `docs/v5/SUMMARY.md` | ringkasan v5 + bagian migrasi v5.1/v5.2 untuk KGR-OS |

---

## 9. Prompt siap tempel untuk reviewer

```
Kamu mereview dan memperbaiki repo dikagustiana/KGR-Weekly-Outlook supaya bisa dipakai tim mulai Senin 19 Okt 2026.
Baca docs/v5.2/REVIEW-CONTEXT.md sampai habis dulu, lalu docs/v5.2/SIAP-PAKAI.md dan docs/v5/QUESTIONS.md bagian Q-v5.2.

Tugas:
1. Review urut daftar §6 REVIEW-CONTEXT (P0 → P1 → P2). Untuk setiap temuan: jalur nyata menuju kegagalan, file:baris,
   tingkat (blocker / perlu sebelum dipakai / bisa nanti), usulan perbaikan.
2. Perbaiki yang blocker dan yang "perlu sebelum dipakai", masing-masing di cabang sendiri dengan tes yang gagal sebelum dan
   lulus sesudah; jalankan semua gate §4; PR ke main hanya bila CI hijau. Satu PR per tema; kumpulkan merge (kuota deploy).
3. Jangan mengubah KGR-OS, flag, atau env tanpa persetujuan Dika di percakapan; ikuti aturan §3 (backup + log bila disetujui).
4. Jangan menyentuh computeWeek, golden v1, parity, snapshot; jangan push ke v5.2/a8-fixes tanpa koordinasi.
5. Akhiri dengan laporan singkat dalam Bahasa Indonesia: apa yang diperbaiki (PR), apa yang ditemukan tapi ditunda (alasan),
   dan apa yang masih harus Dika lakukan.
```
