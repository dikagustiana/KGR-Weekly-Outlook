# Open questions and Excel ↔ PRD differences

Rule: when the PRD and `reference/KGR_Weekly_Outlook.xlsx` disagree, **the Excel wins** and the difference is logged here with the cell reference and the amount affected in the example week (24–30 Aug 2026, update 27 Aug). Nothing below has been "fixed" in the engine — each item keeps the Excel behaviour until the owner decides.

Status legend: **OPEN** = needs a decision; **INFO** = documented behaviour, no decision needed.

## A. Differences found while reading the Excel (engine keeps the Excel behaviour)

| # | Topic | Excel (cell) | PRD | Amount affected (example week) | Status |
| --- | --- | --- | --- | --- | --- |
| A1 | Controls 14, 17, 18 pass with one exception | `Z_Kontrol!F18`, `F21`, `F22` use `ABS(C)<=1` → 1 unmapped account, 1 uncategorised cash line or 1 cash-plan row without counter line still shows LULUS | §8: pass condition "0" | 0 (all counts are 0) | OPEN — recommend `=0`; one line changed in `packages/engine/src/controls.ts` |
| A2 | Block 5 "Kas keluar" is structurally zero | `O_Outlook!B50:C56` sum batches dated d − 7 (any status) and **counted** trading receipts dated d − 14. Rows of previous weeks are not in the week's sheets, and "counted" requires a date inside the week, so trading payments can never appear and live-bird payments only if last week's batches are kept in T_Batch | §5.5 "Cash out by day" | Rp 0 every day (Excel and engine) | OPEN — the app keeps all weeks; should block 5 read previous weeks' batches/receipts? Same for `O_BS!B64:B66` (payments due this week) |
| A3 | Yields from all Aktual batches, no date filter | `I_Parameter!E19:E24` SUMIFS over the whole T_Batch | §5.3 "this week's Aktual batches" | none (T_Batch holds only this week) | INFO — the app stores batches per week, so identical |
| A4 | Trading planned receipts not filtered by source | `O_Outlook!D30:D40` = key + Rencana + date in [today, week end] | §5.4 "Rencana, Beli Trading" | none (only trading keys) | INFO |
| A5 | Controls 1–2 count an unmapped row twice | `Z_Kontrol!C5` = COUNTIF(G,"KODE BARU") + COUNTIF(N,"?") | §8 "0 unmapped" | 0 | INFO — status is right, the displayed count is ×2 |
| A6 | Control 6 checks sales rows only | `Z_Kontrol!C10` | §8 "Rows outside the current week" | 0 | OPEN — add receipts/batches? |
| A7 | Control 17 only catches "?" (account not in I_COA) | `T_GL!S` takes I_COA column F; a mapped counter account with an **empty** cash-flow category gives an empty category, not "?" | §8 "Cash lines without a cash-flow category" | 0 (control 16 would catch the gap) | OPEN — recommend counting empty categories too |
| A8 | Run-rate days-in-month uses the month of the update date | `O_PnL!D12` `DAY(EOMONTH(I_Parameter!C4,0))` | §5.6 | none in August; a week spanning two months uses the update date's month | INFO |
| A9 | Stock-age limit parameter is not used in any formula | `I_Parameter!C13` (30 days); kg over the limit is an input in `I_Stok_Awal!G` | §4 parameter `stock_age_limit` | n/a | OPEN — v1 keeps kg-over-limit as an input of the Monday upload; computing it from FIFO receipt dates is a v2 item (PRD §3) |
| A10 | Block 1 "kg aktual s.d. kemarin" includes every Aktual row of the week | `O_Outlook!B6` uses the counted flag, not the date < today | §5.2 | 0 (no Aktual dated ≥ 27 Aug) | INFO |
| A11 | Daily cash table uses all cash-plan rows of the day | `O_CF!B31:B34` SUMIFS on date only; category totals use the counted flag | §5.8 | none (identical for days ≥ today) | INFO |
| A12 | "Affiliate payables" in the PRD golden list = Other Payable – Related Parties only | `O_BS!E26` = 5.600,0 jt; block 8 `O_Outlook!C85` = E26 + E24 = 5.238,8 jt (planned payment of trade payables – affiliates −361,2 jt) | §10 "affiliate payables 5.600,0 jt" | — | INFO — both are shown: the BS line on Neraca, the combined figure in block 8 |
| A13 | Empty reference price propagates as "blank" | `O_Stok!W29` shows 0 but `X29` is blank because `W=""` is true for an empty source cell (LibreOffice-style blank propagation in the cached values) | — | RPA\|Lemak\|Fresh, RPA\|Usus\|Frozen | INFO — the engine models an empty price as `null`, which reproduces every cached value |
| A14 | P&L line names | `O_PnL!A6:A37` ("Delivery Expenses", "Commission Expenses", "Storage Expenses", …) | §5.6 ("Delivery", "Commission", "Storage", …) | — | INFO — Excel names used (they are also the I_COA mapping values) |
| A15 | Item master size | `I_Item` holds 125 codes | §7 "129 codes" | — | INFO — seed loads the 125 codes in the Excel |
| A16 | Control 10 compares output kg to production receipts of the counted rows only | `Z_Kontrol!D14` | §8 | 0 | INFO |
| A17 | P&L actual columns follow the journal (invoice date) while block 1 follows deliveries (DO) | `O_PnL!A39` note | §5.6 | revenue this week: GL 589,0 jt vs DO 571,1 jt | INFO — as designed in the Excel |
| A18 | Counter account of a cash line is matched on the amount rounded to Rp | `T_GL!P6` key = voucher & `ROUND(O,0)`; `T_GL!Q6` MATCHes the rounded MAXIFS → when two non-cash lines of one voucher round to the same rupiah (e.g. 100,1 and 100,4) the first in sheet order wins, not the exact largest | §5.8 "largest counter account" | 0 vouchers of 606 in the example week | OPEN — engine keeps the Excel rule (`classifyCashLines`); matching the exact largest amount is a one-line change if preferred |

## B. PRD §11 open questions (decide before go-live)

| # | Question | v1 default in the app (placeholder) |
| --- | --- | --- |
| B1 | Minimum trading spread — who sets it, one number or per SKU? | Rp 2.000/kg, one number per week (`parameter.min_trading_spread`) |
| B2 | Payment terms per supplier type | LB 7 days, trading 14, freight/maklon 30 (`parameter.terms_*`) |
| B3 | Collections: manual cash plan or AR aging with customer terms? | Manual cash plan (T_Kas_Rencana) |
| B4 | HPP of actual sales: DO value from inventory valuation, or weekly average cost? | DO value when uploaded (`sales_line.hpp_actual`), else weekly average cost |
| B5 | Karkas by size (Uk 0,5–2,0)? | Fresh/frozen only |
| B6 | Hosting/ownership: SAMB Vercel/Supabase accounts, user administration | Supabase project `uxqbtverhnpiryhzbenr` and a Vercel project imported from this repo (root `apps/web`, see `docs/handover.md` §2); Admin manages users in the app. Move both to SAMB-owned accounts before go-live |
| B7 | Accurate API on the current licence? | Uploads only |
| B8 | Horizon fresh days 3, target shrink 3%, stock-age limit 30 days | Seeded as placeholders, flagged in `parameter.placeholder_note` |

## C. Implementation choices to confirm

| # | Topic | Choice | Why |
| --- | --- | --- | --- |
| C1 | PDF export | Server-side PDF generated in Node (pdfmake) from the engine snapshot, A4 landscape; the browser print view uses the same layout via print CSS | PRD §9 suggests headless Chromium; a Chromium binary in a Vercel function is fragile and slow on cold start during the 06:00–10:00 window. Numbers come from the same snapshot, so they match the screen |
| C2 | Week rollover opening stock | From the Sunday inventory-valuation upload; if missing, carried from last week's projected closing per key and flagged `source = Ops` until the upload lands | PRD §2 weekly routine |
| C3 | Money in the database | `numeric(18,2)`; kg `numeric(12,2)`; engine uses decimal.js | PRD §9 |
| C4 | Login | E-mail + password; logins are created by the Admin (Admin → Pengguna) or, for the first Admin, with `set_login_password` in the SQL editor. Self sign-up is refused by the `auth.users` trigger; Google OAuth is optional and still limited to the allow-list | PRD §9 asks for Supabase Auth with Google Workspace e-mail. The Google provider needs an OAuth client in SAMB's Google Workspace (not available during the build), and Supabase's built-in mailer only delivers to project members (no SMTP configured), so e-mail links would not reach the team. Password logins work today; the "Masuk dengan Google" button is already built — enable the provider, add the redirect URL and set `NEXT_PUBLIC_AUTH_GOOGLE=1` |
| C5 | Supabase URL / publishable key | Defaults in `apps/web/lib/env.ts`; env vars override | The publishable key is public by design (shipped to the browser, RLS protects data); a fresh Vercel import works without configuration |
| C6 | Mobile | All pages render on a phone; input navigation is hidden below 760 px, wide tables scroll inside their card with the line label pinned | PRD §9 "mobile read-only Outlook and statement summary". Writes stay possible for roles that have them (the server and RLS do not depend on screen size) |

## D. Pilot log (M5 — two live weeks in parallel with the Excel)

One row per difference between the app and the Excel during the pilot. Rule unchanged until the owner decides; a decided change gets a test, a CHANGELOG line and a parity re-run.

| Date | Week | Block / statement line | Excel (cell, value) | App (value) | Cause | Decision | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — |
