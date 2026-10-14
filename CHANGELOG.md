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
