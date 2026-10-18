# PROGRESS v5.2 — sumber status lintas sesi

Baca ini di awal setiap sesi. Pelaksana: agen Claude Code atas delegasi Dika (brief 17 Okt 2026). Dokumen otoritas:
`docs/PRD-v5.2-A-kode.md`, `docs/PRD-v5.2-B-db.md`, `docs/v5.2/REVIEW-v5.1.md`; keputusan: `docs/v5/QUESTIONS.md`
§ "Keputusan v5.2" dan Q-v5.2-n; kebutuhan dari Dika: `docs/v5.2/BUTUH-DIKA.md`; log production: `docs/v5.2/kgr-os-log.md`.

## Lingkungan agen (container cloud)

- PostgreSQL 16.15 lokal (`initdb` di `/srv/pg`), Docker, Node 22, pnpm 10.28.0. `cdn.sheetjs.com` diblokir: install
  lokal memakai override sementara `@kgr/parsers>xlsx` → npm `0.18.5` (tidak di-commit); CI memakai 0.20.3.
- Terjangkau: GitHub, registry npm/pypi, connector Supabase (SQL ke project mana pun di org). **Tidak terjangkau:**
  `*.supabase.co`, `api.supabase.com`, port DB, `*.vercel.app`, API Vercel (connector tanpa izin project).
- Repo **publik**: tidak ada kredensial, email user, atau dump data di repo/artifact.

## Status Definisi Selesai (brief Bab 2)

| # | Butir | Status | Bukti / blocker |
|---|---|---|---|
| 1 | Skema KGR-OS v5.2, `schema_version()` = `EXPECTED_SCHEMA` | **lulus** (KGR-OS via connector + GitHub Deployments, 18 Okt 09.47 UTC) | KGR-OS `schema_version()` 5.2.6 (registry 5.2.0–5.2.6 dengan `bundle_sha256` tiap bundel); Production deploy 7152837375 (`85f7684`, 09.46.55 UTC) dengan `EXPECTED_SCHEMA` 5.2.6. Bundel v5.1 + B2 + B5 + B6 + B7: tabel cek 12/24/26/15/16 true, sidik = repo 9/9 tiap bundel, tanpa staging atas keputusan Dika (`kgr-os-log.md`) |
| 2 | Antrean 0 queued/failed; cron sukses di Vercel | sebagian | 42 baris di luar jendela → done (log 22.41). 7 queued 24–30 Agu menunggu v5.1 + rebuild. Cron: D2 |
| 3 | Mart production 24 Agu–30 Sep | belum | menunggu 1, 2, data Sep (D6) |
| 4 | FINAL Agu & Sep, C12/C49 LULUS | belum | B6 |
| 5 | FS v2 diimpor, C59 | sebagian: **FS Agu–Sep diimpor** ke KGR-OS (B-R91, 18 Okt 08.09 UTC, cek 11/11) | C59 butuh mart (DoD 3) dan `fs_line_map` agreed; D9 (ekuitas Rp 2,71) |
| 6 | CI `main`: engine, lint, rls, e2e hijau; T7 di CI (T14) dan staging (T19); matriks R72 | sebagian: **CI 4 job hijau, T7 49/0 xfail, matriks 120** (#52); T19 staging belum | lint baru di A1 (run 39045685561 hijau); e2e: A5; T19: D1, D3/D4 |
| 7 | Parity 17.161/17.161, snapshot byte-identik | lulus (A1, lokal) | `pnpm parity` 17161/17161, `pnpm snapshot:diff` EMPTY di `f340e55`, container cloud PG16 |
| 8 | Flag v5 dibuka untuk semua role sesudah T19 | belum | O29(b) aktif sejak 17 Okt 22.41 |
| 9 | Status R41–R79, B-R80–B-R94 | berjalan: **`docs/v5.2/status-r.md`** (35 lulus, 11 sebagian, 3 belum, 5 menunggu A6) | `docs/v5.2/audit-handover.md` (audit Fase 0); R41–R47 di PR #38; B-R82–84 di PR #41 (lokal PG16; staging/KGR-OS belum) |

## Langkah (brief Bab 8)

| Langkah | Status | Catatan |
|---|---|---|
| Fase 0 — lint benar | **selesai di A1** | `scripts/lint.py` + `scripts/test-lint.sh` (berkas melanggar → 1, bersih → 0). A1: 4 hit K41 + 177 hit K42 diperbaiki (`f340e55`). Gate lokal A1: typecheck ✓; engine 362 + 1 todo; parsers 23; web 265; parity 17161/17161; snapshot EMPTY; test:rls OK (PG16). CI run 39045685561: engine ✓ lint ✓ rls ✓ |
| Fase 0 — lint-missing (A3) | **selesai** (A3 #51) | `python3 -I scripts/lint.py missing` di job CI `lint`; penanda `// missing-ok: <alasan>` (43, semua beralasan; `docs/v5.2/status-r.md`) |
| Fase 0 — rebase A2 ke A1 | **selesai** | A2 di-rebase ke `da0c179` dan merge (#45) |
| Fase 0 — audit-handover.md | berjalan | |
| B0 | sebagian | backup `bak_20261017t1539`; B0-5 flag, O36 since, B0-6 (42) selesai. B0-2 (D2), B0-3 (D1), B0-7/8 menunggu |
| Merge #37 | **selesai** | `0055cb7` (CI run 39020687202 engine ✓ rls ✓) |
| Merge #38 | **selesai** | audit R41–R47 → perbaikan cron (middleware + client service), sisa K41 (20 hit), R44 tolak lebih awal, tes bukti (`fail-closed.test.ts` 18 + `Shell.test.tsx` 2). CI run 39047258171 engine ✓ lint ✓ rls ✓. Merge `a84b64c`; deploy Production sukses 17 Okt 16.01 UTC (GitHub Deployments 7142110692) |
| B6 B-R89 `coa_map` | **selesai** | diterapkan 23.21 WIB (backup `bak_20261017t1620`), `docs/v5.2/coa-fix.md` |
| B6 sumber data Agu–Sep | ditemukan di repo | GL `Agt 26` (2.431 baris) dan `Sep 26` (1.930 baris) di workbook FS v2; GL KGR-OS 1–26 Agu adalah ekspor lama (5 tanggal berbeda) → B-R90 mengganti rentang 1–31 Agu. FINAL bulan butuh app terhadap KGR-OS (D2/D3) |
| BT-1 | **selesai** | PR #40 merge `3efb3db`: parser GL gagal-tertutup; backtest dari sumber repo |
| B2 (B-R82–84) | **merge** `8a2af21` (PR #41) | migrasi `v52_meta`/`v52_security`/`v52_release` + 14 blok RLS + bundel `kgr-os-migrasi-v52-b2.sql` (sha gabungan `e33e5716…8c7b`). test:rls OK 37 blok, 0 `(!)` (PG16 lokal, diulang reviewer di `5b25755`); probe main 118 `(!)` → 0. CI run 39050114343 engine ✓ lint ✓ rls ✓. **Di KGR-OS 18 Okt** (tanpa staging, keputusan Dika); staging/T21/T23 belum. Q-v5.2-10…19 diputuskan di QUESTIONS |
| B5 (B-R85, B-R86) | **merge** (#47 `dbf2a3f`); **di KGR-OS 18 Okt** | test:rls OK 46 blok, 0 `(!)` (diulang reviewer di `e1f3722`); probe main 175 `(!)` → 0; bundel `kgr-os-migrasi-v52-b5.sql` (sha gabungan `bb43b8ff…56e7`, `schema_version` 5.2.4). Q-v5.2-60…69 diputuskan. Isi: `v52_costing` (hanya `batch.lb_price_source`; O33(b) → tanpa `save_class_plan`), Q-v5.2-13 (`opening_stock_flag` IA/Finance minggu open), Q-v5.2-18 (dua kolom view Sales + `price_floor_rule`), `v52_fs` (B-R86 + C59). Brief: pola B2 |
| backup.yml | **merge** (#43 `da0c179`) | dump tidak lagi jadi artifact (repo publik); tanpa bucket → job gagal |
| A4 R68 | **merge** (#42 `443bbf0`) | `fsRecon` + C59 engine + fixture Agu/Sep; CI run 39100986309 ✓. Temuan D9 (ekuitas b.71) |
| A1b K69 | **merge** (#44 `bed6039`) | `update_date` hanya Admin/Finance di minggu open; CI main run 39101702229 ✓ |
| A2 R48–R58 | **merge** (#45 `4b440d8`) | gate agen di `e70e495` (engine 426, web 341, parity 17161, test:rls 37 blok); golden B.5 diubah sesuai R58; CI main run 39101910881 ✓. Sisa R51/R52 menunggu kolom B-R85 (B5) |
| A5 R70–R74 | **merge** (#52 `9431b44`) | job CI `e2e`: T7 49 lulus 0 xfail, matriks 120, volume 13, F19 12 + 4 xfail (Q-v5.2-51 cron tanpa sesi → cabang `v5.2/a1d-cron-client`). **Cron jangan dinyalakan sebelum perbaikan ini** |
| A3 R59–R67 | **merge** (#51 `b408a9a`) | gate agen + CI run 39104756583 engine ✓ lint ✓ rls ✓; mode memo O24(b) di KGR-OS 18 Okt 06.42 UTC |
| A1b schema_version | **merge** (#50 `044d735`) | banner skema dari RPC `schema_version()`, `EXPECTED_SCHEMA` 5.2.2; KGR-OS 5.2.4. CI run 39104463074 engine ✓ lint ✓ rls ✓ |
| A1c objek B5 di kode + Q-v5.2-15 sisi kode | **merge** (#53 `5119dc1`); **belum di production** | CI run 39108199326 (PR) dan 39108195839 (push): engine ✓ lint ✓ rls ✓ e2e ✓. Run PR sebelumnya merah palsu: `test-rls.sh` memakai `echo "$OUT" | grep -q` di bawah pipefail (SIGPIPE → "no results"); diperbaiki dengan here-string (`e2b09eb`, diulang lokal 50/50 → 0/50). Deploy Vercel `5119dc1` gagal: **"Deployment rate limited — retry in 24 hours"** (kuota harian habis oleh preview cabang) → PR #55 (deploy hanya `main`). Bundel B6 menunggu A1c di production (Q-v5.2-79) |
| A1d Q-v5.2-51 | PR #54 (`1a9c8f9`, sudah memuat #53) | merge lokal A1c: satu konflik `snapshot.json`; typecheck ✓, web 681/681, lint ✓ |
| B6 Q-v5.2-15 sisi DB | cabang `b2faa52` (sudah memuat #53); `ref_b6` lokal siap | test:rls OK 47 blok (lokal PG16); sidik `ref_b6` vs `ref_b5`: hanya fn, pol, view berubah. Menunggu A1c di production |
| B-R91 impor FS acuan | **di KGR-OS** 18 Okt 08.09 UTC (#56) | `scripts/fs_import.py` → `kgr-os-data-fs.sql`; cek 11/11, md5 146 baris = lokal; backup `bak_20261018t0808` |
| B6 Q-v5.2-15/71/73/74 | **di KGR-OS** ±08.21 UTC (5.2.5); **merge** (#57 `3e3a276`) | sesudah deploy Production `0a7dc7d` (A1c); backup `bak_20261018t0819`; cek 15/15, sidik 9/9 |
| B7 Q-v5.2-72/84 | **di KGR-OS** ±08.30 UTC (5.2.6); **merge** (#58 `5879930`) | `plan_day`, `plan_variance_daily`, `demand_shortfall`, `plan_check_reason` tanpa Sales; backup `bak_20261018t0828`; cek 16/16, sidik 9/9; Q-v5.2-85/86 (release, batch) batas v5.2 |
| A1d Q-v5.2-51 (merge) | **merge** (#54 `f258c0a`), di production sejak deploy `0a7dc7d` 08.19 UTC | cron boleh dinyalakan setelah D2 (kunci servis + `CRON_SECRET`) |
| Vercel deploy hanya `main` | **merge** (#55 `3860588`) | kuota deploy harian: deploy `5119dc1`/`f258c0a`/`3860588`/`f5ec2be` tertahan "rate limited"; `0a7dc7d` sukses |
| A6 R75–R79 + O16/O17/O19 + Q-v5.2-36/50/52 | **merge** (#60 `85f7684`), di production (deploy 7152837375) | CI engine ✓ lint ✓ rls ✓ e2e ✓ (A6 82 cek, 0 XFAIL); layar `docs/v5.2/bukti/a6/` |
| EXPECTED_SCHEMA 5.2.6 | **merge** (#59 `f5ec2be`), di production bersama #60 | DoD 1 |
| A4 R69 | **merge** (#49 `f3b33cb`, sesudah B5 di KGR-OS) | `origin/v5.2/a4-fs-recon` `880db36`; merge sesudah B5 di `main` dan KGR-OS |
| Sidik skema KGR-OS | **selesai** | KGR-OS = repo v5.0 (modulo CRLF, MAINTAIN PG17); gladi bundel v5.1 + B2 lokal 12/12 + 24/24 (`docs/v5.2/bukti/kgr-os-schema-vs-repo.md`) |
| Workflow `db-ops` | **merge** (#46 `e532204`, #48 `c7b5714`) | pemicu push `ops/db-ops.json` ke cabang `ops/db-run` (integrasi agen tidak bisa `workflow_dispatch`, 403). Uji pemicu run 39103012742 (18 Okt 06.09 UTC): guard berhenti benar — `STAGING_DB_URL` dan `SUPABASE_DB_URL` belum diisi (D4) | staging-migrate / test-rls / bundle, kgr-os-apply (pg_dump + uji kering + `psql -1`), restore-test T23; menunggu D1 + D4 |
| B1 data master | sebagian | `kgr-os-master.sql` (sha256 `6dcadd03…afb1`): jadwal beban tetap Agu–Sep diterapkan 23.04 WIB sesudah uji kering + backup `bak_20261017t1603`. K/S/B, yield kelas, size_class_map, kapasitas, C8/C9, users: D5/D7/D8 |

## Berikutnya

Sesi 18 Okt (±09.50 UTC). KGR-OS = repo 5.2.6. Production = `85f7684` (#59 + A6 #60), deploy 7152837375.

1. (selesai) DoD 1: Production `85f7684` EXPECTED 5.2.6 = KGR-OS 5.2.6. A6 merge (#60).
2. A5b (agen berjalan): celah e2e R48, R69, R70 (journey L4–L7, P8, O2/O5, rekonsiliasi → C59).
3. Data Agu–Sep, rebuild, FINAL, rekonsiliasi FS: butuh D2 (kunci servis + `CRON_SECRET`) dan akses menggerakkan app (D3/D4/D5).
4. T19/T21/T23 staging (D1 + D4); flag v5 ke semua role sesudah T19.

## Blocker aktif

D1 staging (dilewati untuk bundel atas keputusan Dika; T19/T21/T23 tetap butuh), D4 secret repo untuk `db-ops`, D2 Vercel, D3 jaringan (tidak lagi memblokir B3/B4), D5 users, D6 berkas data (rinci di BUTUH-DIKA).
