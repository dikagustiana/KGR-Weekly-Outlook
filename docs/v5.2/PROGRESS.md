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
| 1 | Skema KGR-OS v5.2, `schema_version()` = `EXPECTED_SCHEMA` | belum | v5.1 belum diterapkan; menunggu staging (D1) |
| 2 | Antrean 0 queued/failed; cron sukses di Vercel | sebagian | 42 baris di luar jendela → done (log 22.41). 7 queued 24–30 Agu menunggu v5.1 + rebuild. Cron: D2 |
| 3 | Mart production 24 Agu–30 Sep | belum | menunggu 1, 2, data Sep (D6) |
| 4 | FINAL Agu & Sep, C12/C49 LULUS | belum | B6 |
| 5 | FS v2 diimpor, C59 | belum | B5/A4/B6 |
| 6 | CI `main`: engine, lint, rls, e2e hijau; T7 di CI (T14) dan staging (T19); matriks R72 | sebagian | lint baru di A1 (run 39045685561 hijau); e2e: A5; T19: D1, D3/D4 |
| 7 | Parity 17.161/17.161, snapshot byte-identik | lulus (A1, lokal) | `pnpm parity` 17161/17161, `pnpm snapshot:diff` EMPTY di `f340e55`, container cloud PG16 |
| 8 | Flag v5 dibuka untuk semua role sesudah T19 | belum | O29(b) aktif sejak 17 Okt 22.41 |
| 9 | Status R41–R79, B-R80–B-R94 | berjalan | `docs/v5.2/audit-handover.md` (audit Fase 0); R41–R47 di PR #38; B-R82–84 di PR #41 (lokal PG16; staging/KGR-OS belum) |

## Langkah (brief Bab 8)

| Langkah | Status | Catatan |
|---|---|---|
| Fase 0 — lint benar | **selesai di A1** | `scripts/lint.py` + `scripts/test-lint.sh` (berkas melanggar → 1, bersih → 0). A1: 4 hit K41 + 177 hit K42 diperbaiki (`f340e55`). Gate lokal A1: typecheck ✓; engine 362 + 1 todo; parsers 23; web 265; parity 17161/17161; snapshot EMPTY; test:rls OK (PG16). CI run 39045685561: engine ✓ lint ✓ rls ✓ |
| Fase 0 — lint-missing (A3) | belum | penanda `// missing-ok: <alasan>` |
| Fase 0 — rebase A2 ke A1 | belum | |
| Fase 0 — audit-handover.md | berjalan | |
| B0 | sebagian | backup `bak_20261017t1539`; B0-5 flag, O36 since, B0-6 (42) selesai. B0-2 (D2), B0-3 (D1), B0-7/8 menunggu |
| Merge #37 | **selesai** | `0055cb7` (CI run 39020687202 engine ✓ rls ✓) |
| Merge #38 | **selesai** | audit R41–R47 → perbaikan cron (middleware + client service), sisa K41 (20 hit), R44 tolak lebih awal, tes bukti (`fail-closed.test.ts` 18 + `Shell.test.tsx` 2). CI run 39047258171 engine ✓ lint ✓ rls ✓. Merge `a84b64c`; deploy Production sukses 17 Okt 16.01 UTC (GitHub Deployments 7142110692) |
| B6 B-R89 `coa_map` | **selesai** | diterapkan 23.21 WIB (backup `bak_20261017t1620`), `docs/v5.2/coa-fix.md` |
| B6 sumber data Agu–Sep | ditemukan di repo | GL `Agt 26` (2.431 baris) dan `Sep 26` (1.930 baris) di workbook FS v2; GL KGR-OS 1–26 Agu adalah ekspor lama (5 tanggal berbeda) → B-R90 mengganti rentang 1–31 Agu. FINAL bulan butuh app terhadap KGR-OS (D2/D3) |
| BT-1 | **selesai** | PR #40 merge `3efb3db`: parser GL gagal-tertutup; backtest dari sumber repo |
| B2 (B-R82–84) | **merge** `8a2af21` (PR #41) | migrasi `v52_meta`/`v52_security`/`v52_release` + 14 blok RLS + bundel `kgr-os-migrasi-v52-b2.sql` (sha gabungan `e33e5716…8c7b`). test:rls OK 37 blok, 0 `(!)` (PG16 lokal, diulang reviewer di `5b25755`); probe main 118 `(!)` → 0. CI run 39050114343 engine ✓ lint ✓ rls ✓. **Belum di staging / KGR-OS** (B3/B4 menunggu D1). Q-v5.2-10…19 diputuskan di QUESTIONS |
| B5 | WIP | cabang `v5.2/b5-costing-fs`: `v52_costing` (hanya `batch.lb_price_source`; O33(b) → tanpa `save_class_plan`), Q-v5.2-13 (`opening_stock_flag` IA/Finance minggu open), Q-v5.2-18 (dua kolom view Sales + `price_floor_rule`), `v52_fs` (B-R86 + C59). Brief: pola B2 |
| backup.yml | cabang docs | dump tidak lagi jadi artifact (repo publik); tanpa bucket → job gagal, bukan menyimpan diam-diam |
| B1 data master | sebagian | `kgr-os-master.sql` (sha256 `6dcadd03…afb1`): jadwal beban tetap Agu–Sep diterapkan 23.04 WIB sesudah uji kering + backup `bak_20261017t1603`. K/S/B, yield kelas, size_class_map, kapasitas, C8/C9, users: D5/D7/D8 |

## Berikutnya

Sesi 17 Okt dihentikan atas permintaan Dika ("lanjut besok"). Semua sub-agen (Sonnet) menyimpan WIP ke cabangnya; belum ada yang direview Opus. Commit berawalan `wip(` = belum lulus.

| Cabang | Head | Keadaan (laporan agen, belum diverifikasi) | Lanjut dari |
|---|---|---|---|
| `v5.2/a2-loop` | `01fcfd7` | R48–R58 berkode + tes; typecheck, web 338, k41/k42 0 hijau. Belum: parity/snapshot (engine `demand.ts`, `upload-validate.ts` disentuh), `a2.md`, CHANGELOG. **Golden B.5 diubah** (C22 6,9% → 17,1%, baris tertahan tidak dihitung) — review khusus. Butuh B-R85: `plan_check_reason.plan_week_id`, `plan_week_class.detail` | gate penuh → tes `splitClassPlan` → docs |
| `v5.2/a3-costing-pl` | `5e98cb2` | R60–R63, R66, R67 berkode + tes; **typecheck merah** (3 galat di `forecast-cost.test.ts`). Belum: R64 (lint `missing` 132 hit), R65, Q-v5.2-5 `setFlag`, O13, `a3.md`. Butuh: hak Finance untuk override posting alokasi | typecheck → R65 → Q-v5.2-5 → R64 |
| `v5.2/a4-fs-recon` | `7bb1225` | R68 selesai, gate penuh hijau di `63173f2` (bisa di-merge sendiri). R69 WIP (tes layar belum jalan; butuh B-R86). Temuan Finance: BS MR b.71 laba ditahan awal beda Rp 2,71 dari TB → C59 ekuitas GAGAL tiap bulan | PR R68 dari `63173f2`; R69 sesudah B5 |
| `v5.2/a5-e2e-ci` | `7015bd9` | R70 tumpukan lokal jalan (PG16 + faketime + PostgREST + mock auth/storage). T7 draf: 28 lulus / 12 gagal. Belum: F19, matriks R72, volume, `run.sh`, job CI `e2e`, `a5.md`. Keputusan perlu: alokasi 27–28 Agu lewat SQL setup atau harga PO dinaikkan (C38) | perbaiki T7 |
| `v5.2/b5-costing-fs` | `8a2af21` (= main) | belum ada kode | `docs/v5.2/brief-b5.md` (sudah memuat permintaan A2/A3) |

Urutan sesi berikut:
1. Lanjutkan agen per tabel di atas di worktree yang sama (`/home/user/wt-*`; bila container baru: `git worktree add` dari cabang remote). B5 dulu (jalur kritis A4 R69 dan A2).
2. Review + PR A2 → merge (tanpa objek DB baru). Review + PR A3, A5, B5. A4 R69 sesudah B5 merge.
3. Staging (D1): Dika membuat `KGR-OS-staging` (Seoul, Micro) — connector `create_project` timeout 4×. Lalu: migrasi s.d. B2 + seed → test:rls di staging (T21) → bundel v5.1 ke KGR-OS (backup dulu) → T23 uji pulih → bundel B2 ke KGR-OS.
4. A1b sesudah B2 di KGR-OS: `EXPECTED_SCHEMA` = versi registry; `roles.ts` `update_date` hanya Admin/Finance (Q-v5.2-12); komersial Sales lewat `surplus_for_sales_v52` (Q-v5.2-15), lalu migrasi B berikut mencabut baca `plan_week`/`demand_weekly` untuk Sales.
5. PR cabang docs `claude/nice-gauss-tblqrt` (QUESTIONS, PROGRESS, backup.yml) ke `main`.

## Blocker aktif

D1 staging (belum ada di daftar project, dicek 17 Okt 16.40 UTC), D2 Vercel, D3/D4 akses T19, D5 users, D6 berkas data (rinci di BUTUH-DIKA).
