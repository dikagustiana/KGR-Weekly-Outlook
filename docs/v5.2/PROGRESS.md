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
| 9 | Status R41–R79, B-R80–B-R94 | berjalan | `docs/v5.2/audit-handover.md` (menyusul) |

## Langkah (brief Bab 8)

| Langkah | Status | Catatan |
|---|---|---|
| Fase 0 — lint benar | **selesai di A1** | `scripts/lint.py` + `scripts/test-lint.sh` (berkas melanggar → 1, bersih → 0). A1: 4 hit K41 + 177 hit K42 diperbaiki (`f340e55`). Gate lokal A1: typecheck ✓; engine 362 + 1 todo; parsers 23; web 265; parity 17161/17161; snapshot EMPTY; test:rls OK (PG16). CI run 39045685561: engine ✓ lint ✓ rls ✓ |
| Fase 0 — lint-missing (A3) | belum | penanda `// missing-ok: <alasan>` |
| Fase 0 — rebase A2 ke A1 | belum | |
| Fase 0 — audit-handover.md | berjalan | |
| B0 | sebagian | backup `bak_20261017t1539`; B0-5 flag, O36 since, B0-6 (42) selesai. B0-2 (D2), B0-3 (D1), B0-7/8 menunggu |
| Merge #37 | **selesai** | `0055cb7` (CI run 39020687202 engine ✓ rls ✓) |
| Merge #38 | belum | menunggu audit R41–R47 |

## Berikutnya

1. Audit A1 (R41–R47) → merge #38.
2. A2: rebase ke A1, R55/R58, lint, PR.
3. A3: lint-missing dengan penanda, hit K42 nyata, golden R67, PR.
4. Migrasi B2 (`v52_meta`, `v52_security`, `v52_release`) + tes RLS PG16 lokal (tidak butuh staging untuk ditulis).
5. A5: harness e2e di repo + job CI `e2e` (PG16 + PostgREST + mock auth, lokal dulu).

## Blocker aktif

D1 staging, D2 Vercel, D3/D4 akses T19, D5 users, D6 berkas data (rinci di BUTUH-DIKA).
