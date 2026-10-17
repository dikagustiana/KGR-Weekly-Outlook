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
| 9 | Status R41–R79, B-R80–B-R94 | berjalan | `docs/v5.2/audit-handover.md` (audit Fase 0); R41–R47 di PR #38 |

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
| B1 data master | sebagian | `kgr-os-master.sql` (sha256 `6dcadd03…afb1`): jadwal beban tetap Agu–Sep diterapkan 23.04 WIB sesudah uji kering + backup `bak_20261017t1603`. K/S/B, yield kelas, size_class_map, kapasitas, C8/C9, users: D5/D7/D8 |

## Berikutnya

Sub-agen berjalan (worktree terpisah, cabang masing-masing): A2 (`v5.2/a2-loop`, R48–R58 lengkap), A3 (`v5.2/a3-costing-pl`, R59–R67 + lint `missing`), A5 (`v5.2/a5-e2e-ci`, harness + job `e2e`), B2 (`v5.2/b2-security-release`, B-R82–84 + tes RLS + bundel). Agen utama me-review diff, menjalankan gate, membuka PR, merge.

1. Review + PR A2 → merge (tanpa objek DB baru); bagian ⛓ B-R85 ke A2b.
2. Review + PR B2 (migrasi saja; bundel ke KGR-OS menunggu staging D1).
3. Review + PR A3, A5.
4. Tulis B5 (`v52_costing` + `v52_fs`) termasuk kolom yang diminta A2/A3.

## Blocker aktif

D1 staging, D2 Vercel, D3/D4 akses T19, D5 users, D6 berkas data (rinci di BUTUH-DIKA).
