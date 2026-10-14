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
