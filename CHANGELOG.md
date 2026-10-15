# Changelog

All notable changes to KGR Weekly Outlook. Format: Keep a Changelog; milestones from PRD §11.

## [M1] Engine and golden tests

### Added
- Monorepo (pnpm workspaces) with `packages/engine`; reference Excel files in `reference/`.
- `scripts/extract_fixtures.py` — reads `reference/KGR_Weekly_Outlook.xlsx` with openpyxl; writes the example week's inputs to `fixtures/week-2026-08-24/*.json` and the cached value of every formula cell to `golden.json`.
- `@kgr/engine` — pure TypeScript, decimal.js arithmetic (no floating-point money):
  - `prepare` — derived columns of the input sheets (keys, counted flags, values, batch KPIs, GL classification, cash-line counter accounts).
  - §5.1 stock projection (O_Stok), HPP per sales line.
  - §5.2 week summary (block 1), §5.3 RPA decision (block 2), §5.4 Trading decision (block 3), stock actions (block 4), cash out (block 5), batch KPI (block 6), alerts (block 7).
  - Deterministic snapshot (`snapshotJson`) — identical inputs give byte-identical JSON.
- Golden tests: every formula cell of O_Outlook, O_Stok, O_PnL, O_BS, O_CF, Z_Kontrol, I_Parameter and the derived T_*/I_* columns (17.161 cells) within Rp 1 / 0,01 kg; PRD §10 headline numbers; rule unit tests for every branch of §5.
- CLI: `pnpm outlook --week 2026-08-24 --today 2026-08-27` prints blocks 1–8 as text.
- `pnpm parity` writes `docs/parity.md` and `docs/parity-cells.csv`.
- `docs/open-questions.md` — Excel ↔ PRD differences with cell references.

## [M4-engine] Statements and controls (engine part, delivered with M1)

### Added
- §5.6 weekly P&L (O_PnL), §5.7 balance sheet with planned-flow roll-forward (O_BS), §5.8 direct cash flow with counter-account classification, tie-outs and daily cash (O_CF).
- Controls 1–19 (Z_Kontrol) and control 20 (Ops vs Accurate), block 8 statement summary.

## [M2] Data layer and uploads

### Added
- Supabase schema for PRD §4 (`supabase/migrations/`): weeks, parameters, SKU keys and prices, item/COA maps, opening stock, sales, receipts, batches, GL lines, opening TB, run-rate, cash plan, uploads, releases, audit log. Money `numeric(18,2)`, kg `numeric(12,2)`; provenance on every input row (source Accurate/Ops/Manual, document ref, line key, upload id); soft delete.
- Row Level Security per role (Admin, Inventory Accounting, Finance, Sales, PPIC, Purchasing/Ops, Management) with column guards on parameters, prices and weeks; closed weeks are read-only; every change written to `audit_log` by trigger; `apply_changes` RPC applies an upload atomically under the caller's RLS.
- Login allow-list on `auth.users` (only active `app_user` e-mails); Admin creates logins and resets passwords in the app; first Admin via `set_login_password` in the SQL editor.
- `@kgr/parsers` (SheetJS): Accurate sales, goods receipts, inventory ledger and balance, journal, trial balance; Ops batch costing, delivery notes, trading GRN, stock count; CSV orders and plans; the full KGR_Weekly_Outlook workbook. Indonesian and English number/date notation; header detection by alias.
- Upload wizard: file to private Storage, server-side parse, preview with new/updated/unchanged/superseded counts, item-mapping shortcuts, commit. Re-uploading the same file is idempotent (line keys; legacy rows matched by content).
- Week rollover (Monday): parameters, prices, run-rate and TB carried; opening stock from last week's projected closing until the Monday inventory valuation lands; last-week summary from the latest release.

## [M3] Outlook, input pages, controls 1–11 + 20, PDF

### Added
- Next.js App Router app (`apps/web`), Bahasa Indonesia UI with the Excel labels, house number format (`id-ID`), cream inputs, green source links, red warnings, a "Cara hitung" tooltip on every computed figure.
- Pages: Outlook (blocks 1–8), Stok (O_Stok with status codes and CSV export), Batch RPA, input pages per table (Penjualan with "Terkirim", Penerimaan, Batch, Kas, Stok awal, Parameter, Harga, Run-rate) with keyboard entry and CSV paste, master Item/COA/SKU, Admin Minggu/Pengguna/Audit (restore).
- Week banner: control status, last release, rows still sourced from Ops, opening-stock flag, closed week.
- PDF export (pdfmake, A4 landscape, 3 pages) and a print view with the same layout; deterministic snapshot JSON per week.

## [M4] Statements, controls 12–19, block 8, release

### Added
- Laba Rugi, Neraca and Arus Kas pages (statement lines in English as in the P&L deck), drill-down from actual figures to journal lines, cash-flow category override per voucher.
- Kontrol page (controls 1–20, LULUS / PERIKSA / BELUM DIISI / GAGAL) and Rilis: a release stores the snapshot JSON and the PDF in Storage with who/when; any GAGAL blocks the release.

## [M5] Pilot support

### Added
- Mobile read-only layout: input navigation hidden below 760 px, wide tables scroll inside their card with the line label pinned.
- `docs/handover.md` (deploy, first Admin, weekly routine, roles, troubleshooting); pilot log section D in `docs/open-questions.md`.
- `apps/web/vercel.json` (functions in `hnd1`, next to the Supabase region); Supabase URL and publishable key default to the pilot project so a fresh Vercel import builds without configuration.
- CI also typechecks and builds the web app.
- Deployed to Vercel: https://kgr-weekly-outlook.vercel.app (project `kgr-weekly-outlook`, root `apps/web`, functions in `hnd1`), verified end to end on the live URL.

### Fixed
- Week dates must be real calendar days: `2026-02-31` is rejected by the engine and gives 404 on `/w/…` and `/api/w/…` instead of a database error.
- Control 20 states how many sales/receipt rows are still Ops-sourced (status unchanged; the rows are stored with each release).
- Logged A18 in `docs/open-questions.md`: the cash-line counter account is matched on the amount rounded to Rp, as in `T_GL!P6:Q6`.

### Security
- Self sign-up through the Auth API is refused: before, an allow-listed e-mail without a login could be claimed by anyone who called the sign-up endpoint (the trigger auto-confirms). Logins now come only from `set_login_password` / Admin, or Google OAuth for allow-listed e-mails (`20261014000600_signup_lock.sql`).
- Trigger functions are no longer exposed under `/rest/v1/rpc`.

## [Management View v2] Role-based Outlook (`docs/PRD-management-view-v2.md`)

Evidence per stage (checklist PRD §5, screenshots 1366×768): `docs/management-view/README.md`. Engine numbers are guarded by `tests/snapshots/outlook-2026-08-24.before.json` (`pnpm snapshot:diff`, `snapshot-baseline.test.ts`).

### Stage 1 — R1 role split
- `viewMode` (`management` | `preparer`) from the existing role: `management` always gets the management view; every other role is a preparer and can preview the management view from the topbar (cookie `kgr_view`). Presentation only; access rules are unchanged.
- Root `pnpm test` also runs the web unit tests.

### Stage 2 — R2, R4, R9 (zero rows)
- Engine: `block2.action` — the RPA recommendation as one action from {TUNDA, NEGOSIASI ≤ Rp X, BELI, POTONG N kg} with the text `[AKSI]: [alasan]`. Mapped from the existing Excel code and figures (NEGOSIASI target = breakeven of today's plan, B21); no formula changed. Example week: "NEGOSIASI ≤ Rp 20.726: harga live bird hari ini Rp 24.600 di atas breakeven rencana potong".
- Management view: headline block under the title (GP projection and Δ vs last week, today's RPA action, stock above the age limit with a link to the SKU detail), read from the same fields as the tables; section 2 shows the action; stock rows with 0 SKU are hidden (grey in the preparer view).
