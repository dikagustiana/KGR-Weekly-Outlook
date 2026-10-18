# KGR Weekly Outlook

Web app that replaces `KGR_Weekly_Outlook.xlsx` for PT Karya Gudang Rabat (SAMB Group): one source of truth per week for stock, RPA and trading decisions, weekly P&L, balance sheet, cash flow and the 20 controls — multi-user, role-based, released as a PDF.

- Live: https://kgr-weekly-outlook.vercel.app (login allow-list; see the handover for the first Admin login).
- Spec: [`docs/PRD.md`](docs/PRD.md). The Excel in [`reference/`](reference/) is the executable spec; where they differ the Excel wins and the difference is logged in [`docs/open-questions.md`](docs/open-questions.md).
- Parity: [`docs/parity.md`](docs/parity.md) — 17.161 of 17.161 formula cells of the reference week reproduced (Rp 1 / 0,01 kg tolerance).
- Running it, deploying it, first Admin login, weekly routine: [`docs/handover.md`](docs/handover.md).
- Changes per milestone: [`CHANGELOG.md`](CHANGELOG.md).

## Layout

| Path | What |
| --- | --- |
| `packages/engine` | Pure TypeScript calculation engine (decimal.js): stock projection, Outlook blocks 1–8, P&L, balance sheet, cash flow, controls 1–20; golden tests against every formula cell |
| `packages/parsers` | Accurate / Ops / CSV / workbook parsers (SheetJS) |
| `apps/web` | Next.js App Router app (Bahasa Indonesia UI), deployed on Vercel with root directory `apps/web` |
| `supabase/` | Migrations (schema, RLS per role, audit, login allow-list), seed generator, RLS role test |
| `fixtures/week-2026-08-24` | Example week extracted from the reference Excel (`pnpm fixtures`) |

## Commands

```bash
pnpm install
pnpm test        # golden + rule + parser tests
pnpm typecheck
pnpm outlook --week 2026-08-24 --today 2026-08-27
pnpm parity      # regenerate docs/parity.md
pnpm dev         # http://localhost:3000
pnpm build
```

## Operasi

- **Antrean rebuild (K61, PRD v5.2-A R46).** `GET /api/cron/rebuild` menguras `rebuild_queue` (maks. 30 tanggal,
  anggaran 50 dtk), mereset baris `running` > 15 menit, menandai tanggal > jam dinding + 7 sebagai `done`, lalu
  membangun tugas input dan grid kelengkapan hari ini (bila `v5_input` hidup). Dijadwalkan `vercel.json` `crons`
  `0 22 * * *` (05.00 WIB). Route tidak memakai sesi: wajib header `Authorization: Bearer $CRON_SECRET` (Vercel Cron
  mengirimnya otomatis bila env `CRON_SECRET` ada), dan membaca flag serta antrean dengan `SUPABASE_SERVICE_ROLE_KEY`.
  Tanpa secret → 401; tanpa kunci service → 503. Aksi di aplikasi memproses inline maksimal 7 tanggal; sisanya
  "dilanjutkan otomatis" oleh cron.
- **Env Vercel Production** (PRD v5.2-B B-R80): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server saja), `CRON_SECRET` (`openssl rand -hex 32`). Preview/Development menunjuk
  staging, tidak pernah KGR-OS.
- **Skema tertinggal (K57).** Bila database belum punya objek yang dipakai kode, header menampilkan satu banner;
  rilis dan aksi tulis modul ditolak dengan pesan yang sama, dan rebuild membiarkan antrean dengan catatan itu.
  Terapkan bundel `docs/v5.*/kgr-os-migrasi-*.sql` yang sesuai (lihat `docs/v5.2/kgr-os-log.md`).
- **Uji e2e (K64, PRD v5.2-A R70–R74).** `pnpm e2e` menaikkan tumpukan lokal dan menjalankan matriks flag, journey T7, A6 (irisan UI), F19 dan volume;
  log, tangkapan layar PNG, log request mock dan log proses ada di `tests/e2e/out` (diabaikan git; job CI `e2e` mengunggahnya sebagai artifact).
  Lingkungan di log bernama "PG16 lokal + PostgREST 12 + mock auth": PostgreSQL 16 sendiri (port 54329, di bawah faketime), shim, semua
  migrasi dua kali, seed, PostgREST 12, satu origin tiruan Supabase (auth, storage) dan `next start`. Bukan Supabase. Prasyarat:
  PostgreSQL 16 (`apt-get install postgresql-16`), `faketime`, binari PostgREST 12 di PATH, Chromium untuk Playwright
  (`npx playwright install --with-deps chromium`), `pnpm install`. Variabel: `tests/e2e/stack/env.sh` (semua path, port, URL, kunci dan
  user bisa diganti; journey yang sama dapat dijalankan terhadap URL staging dengan `E2E_SKIP_UP=1`, PRD v5.2-B T19). `E2E_BUILD=never`
  memakai `apps/web/.next` yang dibuat `pnpm e2e:build`; `E2E_ONLY="T7 F19"` menjalankan sebagian; `E2E_SCREENS=1` membuat A6 juga mengambil 22 tangkapan layar (enam layar utama di 1366x768, 899, 390 px, ditambah layar khusus) di `tests/e2e/out/screens`.
  A6 menulis ke database lokal (SETUP) dan hanya untuk tumpukan lokal; terhadap staging jalankan `E2E_ONLY="T7"`. Penjelasan lengkap: `docs/v5.2/a5.md`, `docs/v5.2/a6.md`.
  Ketergantungan `cdn.sheetjs.com` (`xlsx` 0.20.3 di `@kgr/parsers`): job CI memakai cache pnpm store; bila host itu diblokir pada cache dingin,
  `pnpm install --frozen-lockfile` gagal dan job `engine`, `lint`, `e2e` ikut gagal (di lingkungan tanpa akses ke host itu pasang `xlsx@0.18.5`
  secara lokal saja, jangan di-commit).
