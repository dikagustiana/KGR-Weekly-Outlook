# PRD — KGR Weekly Outlook (web app)

Oct 14, 2026 · @Dika

## 1. Summary and goals

Build a web app that replaces `KGR_Weekly_Outlook.xlsx`: one weekly cycle (Monday–Sunday), updated every morning, that tells KGR what to decide today — how much live bird to cut and at what price, what trading stock to buy, which stock to sell, and whether the week closes with enough cash. The Excel file is the functional specification: every calculation below must reproduce its numbers (see §10 golden tests).

**Problem.** KGR (PT Karya Gudang Rabat, SAMB Group) runs two segments: RPA (own-brand slaughtering, currently maklon at ISA) and Trading (buy-sell frozen/chilled poultry). Decisions are taken daily by Sales, PPIC, Purchasing and Finance, but the numbers live in one Excel on one laptop, are re-keyed, and cannot be seen by management. The budget model shows the economics are unforgiving: above roughly Rp22.500/kg live bird the plant does not break even at any volume, and in August 2026 every cut batch lost money (−Rp389 jt on August production) while 45,6 t of August karkas was still in stock at month end.

**Goals (v1).**

1. One source of truth per week, multi-user, role-based, accessible from any browser (desktop first, read-only on mobile).
2. Daily update in ≤ 30 minutes: upload Accurate exports, enter orders and plans, read the outlook.
3. A decision page (RPA, Trading, stock, cash) plus weekly P&L, balance sheet and direct cash flow that tie to Accurate.
4. Controls that block a release when inputs do not tie (LULUS/GAGAL), and an audit trail of who changed what.
5. Printable A4 outlook (PDF) for the morning stand-up and for management.

**Non-goals (v1).** No integration with Accurate's API (uploads only), no demand forecasting, no per-size karkas planning, no budget-vs-actual (the budget is not running yet; its cost card is used only for benchmarks).

**Success measure.** The outlook is produced every working day by the team without Finance's help, Z\_Kontrol is LULUS before 09:00, and the RPA cut plan for the next three days is agreed on the page, not in chat.

## 2. Users, roles and the daily routine

Five roles, each owning the inputs it is accountable for; everyone can read the outlook. UI language is Bahasa Indonesia; numbers use the house format (period for thousands, comma for decimals: Rp 24.600; 6,3%).

| Role | Who (KGR) | Writes | Reads |
| --- | --- | --- | --- |
| Admin | Group Project Finance (Dika) | Parameters, master data (keys, item map, COA map), run-rate, users, week rollover | Everything |
| Inventory Accounting | Senior Inventory Accounting | Accurate uploads: sales actual, goods receipts, inventory valuation (Monday), journal (daily), TB (opening); HPP aktual per sale line | Everything |
| Sales | Manajer Sales / admin sales | Orders (customer, SKU, kg, price, delivery date); marks delivered orders | Outlook, stock, Trading page |
| PPIC | PPIC | Cut plan (T\_Batch Rencana) and batch actuals (kg LB, output per product); production receipts plan | Outlook, stock, RPA page, batch KPI |
| Purchasing / Ops | Manajer Operasional, Purchasing | Live-bird price of the day, trading purchase plan, replacement buy prices, payment terms, cash plan (payments) | Outlook, Trading page, cash |
| Finance | Finance / AR | Cash plan (collections, salaries, taxes, interest, loans), run-rate adjustments | P&L, BS, CF, controls |
| Management | Direktur Operasional, Pak Jo, Bu Lenny | — | Outlook, statements (read-only, mobile) |

**Daily routine (target ≤ 30 minutes, before 09:00).**

1. Inventory Accounting uploads yesterday's Accurate exports: Sales by Item Detail (actual sales), Goods Receipt list (actual receipts), Journal (GL lines). The app maps item codes and accounts; unmapped ones are listed for Admin.
2. Sales marks delivered orders as actual (or the upload does it by invoice number) and adds new orders with planned delivery dates.
3. PPIC enters yesterday's batch (bought kg, price, freight, maklon, processed kg, output per product) and updates the cut plan for the next days.
4. Purchasing enters today's live-bird offer price, trading purchase plan and replacement buy prices.
5. Finance updates the cash plan (collections expected, payments scheduled).
6. Anyone opens Z\_Kontrol: all LULUS → the outlook is released (PDF snapshot stored); GAGAL → the page shows what to fix.

**Weekly routine (Monday).** Admin creates the new week: opening stock from the Sunday inventory valuation upload (or carried from last week's projected closing, flagged until the upload lands), opening TB date confirmed, last week's summary frozen for comparison, prices refreshed. Every week is kept (history, no overwrite).

## 3. Scope — v1 and later

v1 is the Excel, made multi-user and auditable. Nothing in v1 needs the Accurate API.

| Area | v1 (must) | Later (v2+) |
| --- | --- | --- |
| Weeks | Week = Monday–Sunday; update date; history of all weeks; Monday rollover | Multi-week horizon (2–4 weeks ahead) |
| Master data | Key = Segment · SKU · Form; item code → key map; COA → P&L / BS / cash-flow map; reference prices; benchmarks | Karkas by size (Uk 0,5–2,0); customer master with payment terms |
| Inputs | Uploads: sales detail, goods receipts, inventory valuation, journal, TB. Forms: orders, batches, purchase plan, cash plan, parameters | Accurate API sync; order intake from WhatsApp/PO form; AR aging import |
| Stock | Daily projected stock per key (Mon–Sun), weekly average cost, age, status flags | Per-item (code-level) projection; lot/FIFO age from receipts |
| Decisions | RPA cut/buy recommendation, Trading buy/hold/sell per SKU, stock-to-sell list, cash out next days | What-if simulator (price, volume, fresh share); demand forecast feeding the cut plan |
| Statements | Weekly P&L, balance sheet, direct cash flow: actual from GL + outlook roll-forward; daily cash balance and minimum | Monthly close view; budget vs actual once the budget runs |
| Controls | Z\_Kontrol list (ties to Accurate totals, balance, cash tie-out, mapping gaps); alerts | Automatic e-mail/WhatsApp digest of the released outlook |
| Output | Outlook page, Stock, P&L, BS, CF, Batch KPI, Kontrol; A4 PDF export; week-over-week comparison | Management dashboard across SAMB entities |
| Access | Roles above, SSO by e-mail (Google Workspace), RLS per role; audit log | Field-level approvals (e.g. price changes) |

## 4. Domain model and data tables

Every table mirrors a sheet of the Excel (name in brackets) so the two stay comparable. All amounts in IDR, dates in Asia/Jakarta, kg with 2 decimals. Every row carries `week_id`, `created_by`, `updated_at`; nothing is hard-deleted.

| Table | Grain | Key fields | Source / who |
| --- | --- | --- | --- |
| `week` | one per Monday | week\_start, week\_end, update\_date, tb\_opening\_date, status (open/released/closed), last-week summary (kg, revenue, GP per segment) | Admin |
| `parameter` (I\_Parameter) | per week | horizon\_fresh\_days (3), target\_shrink (3%), freight\_plan Rp/kg LB, maklon Rp/kg processed, lb\_price\_today, min\_trading\_spread, stock\_age\_limit (30), terms: lb, trading, freight\_maklon (days), yield defaults per product, accurate control totals | Admin / Purchasing |
| `sku_key` (I\_Master) | per key | key \`Segment | SKU |
| `item_map` (I\_Item) | per Accurate item code | item\_code, item\_name, key | Admin |
| `coa_map` (I\_COA) | per GL account | account, name, type (LabaRugi/Neraca/Header), pl\_line, bs\_line, cf\_category\_as\_counter, is\_cash | Admin |
| `opening_stock` (I\_Stok\_Awal) | per item code per week | kg, value, avg\_age\_days, kg\_over\_age\_limit, note | Inventory Accounting (Monday upload) |
| `sales_line` (T\_Penjualan) | per order/invoice line | date, status (Aktual/Order), document no, customer, item\_code or key, kg, price, value, hpp\_actual (optional), derived: key, segment, group, counted flag | Upload (Aktual) / Sales (Order) |
| `receipt_line` (T\_Penerimaan) | per GRN/plan line | date, status (Aktual/Rencana), source (Produksi RPA / Beli Trading), document, supplier, item\_code or key, kg, unit cost, value | Upload / PPIC / Purchasing |
| `batch` (T\_Batch) | per cut | date, status, PO/batch id, supplier, lb\_kg, lb\_price, freight, maklon, processed\_kg, output kg per product (karkas fresh, karkas frozen, kepala, ceker, usus, HJA, lemak, other) | PPIC |
| `gl_line` (T\_GL) | per journal line | date, voucher no, type, account, name, description, debit, credit, party, cf\_override; derived: dr\_cr, type, pl\_line, bs\_line, is\_cash, counter\_account, cf\_category | Upload |
| `tb_opening` (I\_TB) | per account per week | account, balance (debit +) at tb\_opening\_date | Upload |
| `runrate` (I\_RunRate) | per P&L line | monthly amount, this-week adjustment, basis note | Finance |
| `cash_plan` (T\_Kas\_Rencana) | per planned cash movement | date, cf\_category, bs\_counter\_line, description, amount (+in/−out) | Finance / Purchasing |
| `release` | per released outlook | week, update\_date, snapshot JSON, PDF, released\_by, control status | System |
| `audit_log` | per change | table, row, field, old, new, user, time | System |

Reference lists (enums): segment (RPA, Trading), status values, receipt source, decision group (RPA: Karkas fresh / Karkas frozen / Karkas mix / By-product / Boneless & parting; Trading: SKU), P&L lines (§5.6), BS lines (§5.7), cash-flow categories (§5.8).

Every input row also carries `source` (Accurate / Ops / Manual), `document_ref` (invoice, SJ, PO, GRN or voucher number) and `confirmed_by`, so the same fact can arrive first from operations and later from Accurate without double counting (§7).

## 5. Calculation engine — parity with the Excel

The engine is a set of pure functions over one week's data; same inputs must give the same outputs as the Excel to the rupiah. Conventions: `today` = update date; actual = rows with status Aktual whose date is inside the week; outlook = Order/Rencana rows with date ≥ today and ≤ week end; rows outside the week or past-dated orders are ignored and reported by the controls. Costs are shown negative in statements, positive in operational blocks.

### 5.1 Stock projection per key (O\_Stok)

- Opening per key = Σ opening\_stock.kg (and value) of its item codes; average age = kg-weighted avg\_age\_days; kg over age limit = Σ kg\_over\_age\_limit.
- For day d = Monday..Sunday: `closing[d] = closing[d−1] + receipts[d] − sales[d]`, where a past day (d < today) uses Aktual rows only and a day ≥ today uses Aktual (if any) + Rencana/Order rows.
- Weekly average cost per key = (opening value + Σ receipts value counted this week) ÷ (opening kg + Σ receipts kg).
- HPP of a sales line = hpp\_actual if given (Accurate DO value), else kg × weekly average cost of its key.
- Stock today = closing of yesterday (opening on Monday). Orders rest of week = Σ Order kg with date in \[today, week end\]. Lowest projected stock = min closing\[d\].
- Status, first match wins: KURANG (lowest < −0,5 kg); JUAL (stock today > 0 and no orders, note if some kg are over the age limit); PERHATIAN (kg over age limit > 0); "order below average cost" (reference price − average cost < 0 and orders exist); otherwise "-".

### 5.2 Week summary (O\_Outlook block 1)

Per segment and total: kg, revenue, GP for Aktual, for Order (rest of week), projection = sum; GP/kg; GP %; last week's GP/kg from `week` summary; Δ. Product GP only — cost of sales others is not allocated to segments.

### 5.3 RPA decision (block 2)

Inputs: `P_lb` offer price; `s` target shrink; `y_k` karkas yield on processed kg; by-product yields `y_i` and reference prices `P_i` (kepala, ceker, usus, HJA, lemak); `P_f`, `P_z` reference prices karkas fresh/frozen; `freight` Rp/kg LB plan; `maklon` Rp/kg processed; horizon `H` days. Yields used = this week's Aktual batches if any processed kg exists, else the defaults in parameters (August 2026 averages: karkas 73,67%, kepala 4,67%, ceker 2,94%, usus 4,36%, HJA 5,60%, lemak 0,34%).

1. Fresh need = Σ Order kg of key `RPA|Karkas|Fresh` with date in \[today, today+H−1\].
2. Net need = max(0, fresh need − stock today of that key).
3. LB max without adding frozen = net need ÷ ((1 − s) × y\_k).
4. LB planned (Rencana batches dated in the horizon) = Σ lb\_kg; karkas at risk of freezing = max(0, planned − LB max) × (1 − s) × y\_k; fresh share of plan f = 1 if planned = 0 else min(1, net need ÷ (planned × (1 − s) × y\_k)).
5. Value per kg LB at share f:

```latex
V(f) = (1-s)\,\Big[\,y_k\,\big(f\,P_f + (1-f)\,P_z\big) + \sum_i y_i P_i\Big]
```

6. Breakeven LB price at share f = V(f) − freight − maklon × (1 − s); also at f = 1 (upper bound). Margin per kg LB = breakeven(f) − P\_lb; expected margin of the plan = margin × planned kg; frozen price gap = karkas at risk × (P\_f − P\_z).
7. Recommendation text, first match: P\_lb > breakeven(1) → "TUNDA / NEGOSIASI"; planned > LB max + 0,5 → "KURANGI potong ke maksimum X kg LB"; margin < 0 → "POTONG HANYA SESUAI ORDER"; else "LANJUT sesuai rencana".

### 5.4 Trading decision per key (block 3)

Stock today, orders rest of week, planned receipts rest of week (Rencana, Beli Trading); net need = max(0, orders − stock − planned). Sell price = kg-weighted price of Order rows ≥ today, else reference price. Spread = sell − replacement buy price; spread % = spread ÷ sell; average stock cost from §5.1. Recommendation, first match: net need > 0,5 and no buy price → "BELI X kg — isi harga beli"; net need > 0,5 and spread ≥ minimum → "BELI X kg"; net need > 0,5 → "TAHAN: spread below minimum"; stock > 0,5 and orders ≤ 0,5 → "JUAL STOK: X kg tanpa order"; orders > 0,5 and sell price < average stock cost → "CEK HARGA"; stock > 0,5 → "Cukup — sisa X kg"; else "-".

### 5.5 Batches, cash out, alerts

- Batch (T\_Batch): LB value = kg × price; total cost = LB + freight + maklon; shrink = 1 − processed ÷ bought; output = Σ products; yield output = output ÷ processed; karkas yield = (fresh + frozen) ÷ processed; fresh % = fresh ÷ karkas; output value at reference prices; margin = value − total cost; margin per kg LB; breakeven LB = (value − freight − maklon) ÷ kg LB; cost and value per kg output. Block 6 aggregates by status against targets (shrink target, karkas yield default, breakeven at 100% fresh).
- Cash out by day (block 5): LB value of batches dated d − terms\_lb; trading receipt value (counted rows) dated d − terms\_trading.
- Alerts (block 7): past-dated undelivered orders; new item codes; keys with projected negative stock; keys with stock but no reference price; actual shrink above target; LB price above breakeven(1); Trading keys on TAHAN.

### 5.6 Weekly P&L (O\_PnL)

Lines (deck format, costs negative): Revenue - LB Main Product; Revenue - LB By Product; Revenue - Trading; TOTAL REVENUE; COGS - Live Bird; COGS - Trading; Other COGS - Expedition; COGS - Blasting; TOTAL COST OF SALES; GROSS PROFIT; GP margin; Delivery; Commission; Packaging; Salaries and allowance; Storage; Office transportation; Rent; Professional fee; Office supplies & utilities; Maintenance; Tax expenses; Other operating expenses; TOTAL OPEX (excl. D&A); OPERATING INCOME; Interest expense; Other income; Other expense; TOTAL OTHER; NIBT (before D&A); Depreciation & amortisation; NET INCOME.

- Actual columns (last week; this week to yesterday; month to date) = −Σ (debit − credit) of gl\_line mapped to the line within the date range.
- Outlook (rest of week): revenue lines from Order rows (RPA non-by-product → LB Main; RPA by-product group → LB By Product; Trading → Trading); COGS lines = −Σ HPP of Order rows by segment; every other line = −(monthly run-rate × remaining days of the week ÷ days in month + this-week adjustment), Other income with positive sign.
- Projection = actual + outlook; MTD + outlook likewise.

### 5.7 Weekly balance sheet (O\_BS)

Balance of a BS line at date X (debit-positive) = Σ tb\_opening of its accounts + Σ gl\_line dr\_cr of its accounts with date ≤ X; assets shown positive, liabilities and equity sign-flipped; Current year profit = −(Σ P&L accounts in TB + Σ P&L gl lines ≤ X). Columns: TB date, end of last week, yesterday, projected week end, Δ.

Projected week end = yesterday + planned flows (debit terms; ‘plan’ = Rencana/Order rows from today to week end, ‘due’ = plan rows whose date + terms falls in \[today, week end\]):

| BS line | Planned flow (debit +) |
| --- | --- |
| Cash | net cash flow of the rest of the week (§5.8) |
| Trade receivables | + revenue outlook − collections in cash plan with this counter line |
| Inventory - Product | + planned batch total cost − COGS Live Bird outlook |
| Inventory - Trading | + planned trading receipts − COGS Trading outlook |
| Trade payables | − planned LB value − planned trading receipts + LB and trading payments due this week |
| Accrued expenses | − planned freight and maklon + their payments due − net run-rate costs (excl. D&A) |
| Accumulated depreciation | − D&A outlook |
| Current year profit | − net income outlook (credit) |
| Any line named as counter in the cash plan | − amount of those cash-plan rows |

The roll-forward is double-entry by construction; the control "assets − (liabilities + equity) = 0" must hold in every column.

### 5.8 Weekly cash flow, direct method (O\_CF)

Categories: Penerimaan dari pelanggan; Penerimaan lain; Bayar pemasok barang (live bird & trading); Bayar jasa (maklon, angkut, cold storage, sewa); Bayar karyawan; Bayar biaya operasional lain; Bayar pajak; Bunga & biaya bank; Belanja aset tetap; Pinjaman afiliasi (net); Setoran modal; Transfer antar rekening.

- Actual: every gl\_line on a cash account (is\_cash) gets the category of its counter account = the non-cash line with the largest absolute amount in the same voucher, via coa\_map.cf\_category; vouchers with only cash lines → transfer; a user override on the line wins.
- Outlook: cash plan rows by category + model payments: Bayar pemasok −(LB due + trading due); Bayar jasa −(freight + maklon due).
- Tie-outs: opening cash + net flow = BS cash for last week, yesterday and projection; daily cash table (actual past days from GL, planned days from the model) gives the week's minimum balance.

## 6. Pages, outputs and print

Seven read pages mirror the Excel output sheets; input pages are forms and upload wizards. A week selector and the update date sit in the header of every page; a release banner shows control status (LULUS / PERIKSA / GAGAL) and who released the last snapshot.

| Page | Content | Excel sheet |
| --- | --- | --- |
| Outlook (home) | Blocks 1–8: week summary, RPA decision with recommendation, Trading table with recommendations, stock action counts, cash out 7 days, batch KPI vs target, alerts, statement summary (NI, cash end of week, lowest daily cash, AR, inventory, payables, affiliate debt) | O\_Outlook |
| Stok | Per key: opening, 7 daily closings (negative cells red), receipts, average cost, orders, stock today, surplus, lowest, reference price, margin/kg, value, status; filters by segment/status; export CSV | O\_Stok |
| Laba Rugi | Weekly P&L columns of §5.6; click a line to see its GL lines (drill-down) | O\_PnL |
| Neraca | §5.7 columns; drill-down to accounts; planned-flow block visible | O\_BS |
| Arus Kas | §5.8 categories, tie-out, daily cash table with minimum; drill-down to vouchers; override category from the drill-down | O\_CF |
| Batch RPA | Batch table (actual and plan) with KPIs; 12-batch trend charts (shrink, fresh %, cost vs value per kg) | T\_Batch, Batch Ops KPI |
| Kontrol | Control list with LULUS/GAGAL/PERIKSA/BELUM DIISI and the fix action; release button (Admin/Finance) | Z\_Kontrol |
| Input pages | Orders, Batches, Receipts plan, Cash plan, Parameters, Prices; Upload wizard (file → preview → mapping check → commit) | T\_\* , I\_\* |

**Print / export.** "Cetak outlook" produces an A4 landscape PDF: page 1 blocks 1–2, page 2 blocks 3–7, page 3 statement summary; Stok and the three statements each print fit-to-width. Numbers in the house format; charts show their data labels. Every released outlook is stored as PDF + JSON snapshot and can be reopened for any past week.

**UI rules.** Inputs on a cream background, computed values plain, links to source rows in green, warnings in red; every computed figure has a tooltip naming its source (table and rule), matching the Excel's "Cara hitung" column. Mobile: read-only Outlook and statement summary.

## 7. Data import — Accurate or confirmed operational data — and mapping maintenance

Actuals come from Accurate exports (.xls/.xlsx/.csv) or from operational data the team has already confirmed (second table below); every row records its source and document reference. One upload wizard: pick the export type, preview the parsed rows, see unmapped codes/accounts, commit. Re-uploading the same date range replaces the earlier rows for that range (idempotent), never duplicates.

| Export | Lands in | Required columns (as named in Accurate) | Rules |
| --- | --- | --- | --- |
| Sales by Item Detail | sales\_line (Aktual) | invoice date, invoice no, customer, item code, item name, quantity, unit, amount | kg × price → value; an existing Order with the same invoice/DO number becomes Aktual; hpp\_actual blank unless DO cost is uploaded |
| Inventory Valuation (ledger) | sales\_line.hpp\_actual, receipt\_line (Aktual), opening\_stock (Monday) | item code, date, document, qty in/out, value in/out, balance qty/value | DO rows → HPP per sales line by document; receipts (GRN) → receipt\_line with unit cost; balance at Sunday → opening stock; FIFO age from receipt dates |
| General Ledger / Journal | gl\_line | date, source no, source type, account, account name, description, debit, credit, party | Voucher = source no; cash lines classified per §5.8; undated month-end adjustments are excluded until dated |
| Trial Balance (per date) | tb\_opening | account, name, balance | Must sum to zero; replaces the week's opening TB |
| Ops batch costing (Pot\_ISA sheets) | batch (Aktual) | cut date, supplier, live bird kg and price, freight, maklon, processed kg, output per item | Optional in v1 (manual entry allowed); output per item mapped to product groups via item\_map |

**Operational sources (confirmed by Ops, usable before or instead of the Accurate posting).** Ops data is accepted when it is signed off in the operational document; it feeds the same tables with `source = Ops`. When the Accurate posting for the same document arrives later, the Accurate row replaces the Ops row and control 20 reports any difference.

| Operational document | Lands in | Confirmed by | Rules |
| --- | --- | --- | --- |
| Batch costing sheet (Pot\_ISA per cut, from ISA/ops) | batch (Aktual), receipt\_line Produksi RPA (Aktual) | PPIC | Output per item becomes receipts at the batch's cost per kg output (ops allocation); live-bird kg = ops weighbridge, not the PI narrative |
| Sales delivery list (DATA PENJUALAN / surat jalan) | sales\_line (Aktual), HPP blank until Accurate DO | Sales admin | Delivered = Aktual on SJ date; invoice number filled later by the Accurate upload |
| Goods receipt note / purchase confirmation (trading) | receipt\_line Beli Trading (Aktual) | Purchasing | Unit cost from the agreed price; replaced by GRN value from Accurate |
| EOD stock count sheet (SOP 4) | opening\_stock on Monday when the valuation export is late | Warehouse / Inventory Accounting | kg only; value = last known average cost; flagged until the valuation upload lands |
| Daily cash book / bank statement | cash\_plan actuals (converted to gl\_line only after posting) | Finance | Used for the daily cash balance before the journal is posted |

Provenance is visible on every page (chip: Accurate / Ops / Manual) and in the audit log; the release snapshot records which rows were still Ops-sourced.

**Mapping maintenance (Admin).**

- item\_map: new Accurate codes appear in the wizard with a suggested key (by SKU/form words in the name); Admin confirms. Keys are `Segment|SKU|Form`; the initial list is the Excel's I\_Master (41 keys) and I\_Item (129 codes).
- coa\_map: initial mapping from the Excel's I\_COA (208 accounts): P&L line, BS line, cash-flow category as counter, cash flag. New accounts appear in the wizard; the control "accounts without mapping" blocks release until mapped. Keep the accounting team's original mapping as a reference column.
- Reference prices: Sales updates sell prices (default = last 7 days' realised price per key, editable); Purchasing updates replacement buy prices.
- Parameters and terms: Admin; changes are audited and versioned per week.

## 8. Controls, alerts and audit trail

Release requires every control at LULUS; PERIKSA and BELUM DIISI allow release with a warning banner; GAGAL blocks. Each control shows value, comparator, difference, status and the fix action, exactly as Z\_Kontrol does.

| # | Control | Pass condition | On fail |
| --- | --- | --- | --- |
| 1–3 | Every sales, receipt and opening-stock row has a registered key | 0 unmapped | GAGAL |
| 4–5 | Status filled on every sales and receipt row with kg | 0 blank | GAGAL |
| 6 | Rows outside the current week | 0 | PERIKSA |
| 7 | Past-dated orders not delivered | 0 | PERIKSA |
| 8 | Actual sales kg this week = Accurate report total (entered) | diff ≤ 1 kg | GAGAL; BELUM DIISI if no total |
| 9 | Opening stock value = Accurate inventory valuation (entered) | diff ≤ Rp 1 | GAGAL; BELUM DIISI if no total |
| 10 | Actual batch output kg = actual production receipts kg | ≤ 2% (PERIKSA up to 60%: GRN dated one day later) | GAGAL |
| 11 | Keys with projected negative stock | 0 | PERIKSA |
| 12 | Opening TB sums to zero | ≤ Rp 1 | GAGAL |
| 13 | Journal balanced (Σ debit − credit) | ≤ Rp 1 | GAGAL |
| 14 | Journal/TB accounts without mapping | 0 | GAGAL |
| 15 | Balance sheet balances (end last week, yesterday, projection) | ≤ Rp 1 each | GAGAL |
| 16 | Cash-flow closing cash = balance-sheet cash (three columns) | ≤ Rp 1 | GAGAL |
| 17 | Cash lines without a cash-flow category | 0 | GAGAL |
| 18 | Cash-plan rows without a balance-sheet counter line | 0 | GAGAL |
| 19 | Temporary accounts (910004, 1102008) carry a balance | 0 | PERIKSA |

Control 20 — Ops-sourced vs Accurate: for any document present from both sources, kg must match within 0,5% and value within 1%; a mismatch is PERIKSA (the Accurate row is used, the Ops row kept for reference). Rows still Ops-sourced at release are listed in the release banner.

**Alerts** (§5.5) are informational and appear on the Outlook page; they never block release.

**Audit trail.** Every insert/update/delete on input tables is logged with user, time, old and new values; uploads are logged with file name, hash and row counts; releases store the full computed snapshot so a past outlook can be reproduced even after inputs change. Deleting is soft (flag), and Admin can restore.

## 9. Non-functional requirements and recommended architecture

Recommended stack: Next.js (App Router, TypeScript) on Vercel, Supabase (Postgres, Auth, Storage, Row Level Security), the calculation engine as a pure TypeScript package shared by server and tests. Both services are already connected to Dika's workspace; nothing else is needed for v1.

**Architecture (what calls what).**

1. Browser (Next.js pages, Bahasa Indonesia UI) → server actions / route handlers.
2. Route handlers → `@kgr/engine` (pure functions: stock, decisions, statements, controls; no I/O) → results cached per week in `release`/snapshot tables.
3. Upload wizard → parser package (SheetJS for .xls/.xlsx, csv) → staging table → validation → commit to input tables.
4. Supabase Postgres holds all tables of §4 with RLS policies per role; Supabase Auth with Google Workspace e-mail; Storage for uploaded files and PDFs.
5. PDF export via headless Chromium (Playwright) rendering the print layout.

**Requirements.**

- Data volume: ≤ 5.000 sales lines, ≤ 10.000 journal lines, ≤ 300 items per week; any page renders in < 2 s; recalculation of a week < 5 s.
- Numbers: store rupiah as numeric(18,2), kg as numeric(12,2); never float in the database. Display with the house format (`id-ID` locale).
- Timezone Asia/Jakarta; week boundaries computed server-side.
- Determinism: the engine is a pure function of the week's inputs; the same inputs produce byte-identical snapshots (needed for the golden tests).
- Security: RLS per role (§2); Admin-only on master data and parameters; all writes audited; backups daily (Supabase PITR).
- Availability: a working morning window (06:00–10:00 WIB) must not be blocked by deployments; migrations are backward compatible.
- Accessibility and devices: desktop Chrome/Edge; mobile read-only; keyboard entry on input forms; CSV paste into order and batch forms.
- Internationalisation: UI Bahasa Indonesia; statement line names in English as in the FS deck.

## 10. Acceptance criteria and golden tests

Acceptance = the app loaded with the Excel's example week (24–30 August 2026, update date 27 August) reproduces the Excel's numbers below, plus the functional checks. The Excel ships with the repo as `reference/KGR_Weekly_Outlook.xlsx`; its input sheets are the test fixtures.

**Golden numbers (example week, Rp unless stated).**

| Item | Expected |
| --- | --- |
| Week summary — kg actual to yesterday / projected week | 23.588 / 64.025 kg |
| Projected product GP KGR (block 1) | −47,6 jt; GP/kg −743 |
| RPA: fresh orders in horizon / stock fresh today | 12.307 / 18.768 kg → net need 0, LB max 0 |
| RPA: planned LB in horizon; karkas at risk of freezing | 27.219 kg; 19.475 kg |
| RPA: breakeven at plan share / at 100% fresh | Rp 20.726 / Rp 24.337 per kg LB; margin at Rp 24.600 = −3.874 |
| RPA recommendation | TUNDA / NEGOSIASI |
| Trading: BLP Frozen recommendation | CEK HARGA (order 43.086 < average cost 47.199) |
| Trading: BLD Frozen recommendation | JUAL STOK 4.848 kg |
| Stock actions | KURANG 0; JUAL 23 keys / 17.834 kg; PERHATIAN 7 keys / 116.290 kg |
| Batches: actual shrink / karkas yield / fresh % | 6,3% / 73,8% / 66,6% (2 batches) |
| P&L projection: revenue / GP / NI | 1.656,8 jt / −67,5 jt / −107,6 jt |
| P&L last week NI / MTD actual NI | −111,0 jt / +165,2 jt |
| BS projected: total assets; control | 8.531,3 jt; 0 in all columns |
| BS projected: cash / inventory / affiliate payables | 818,2 jt / 3.992,4 jt / 5.600,0 jt |
| CF projected: net / customer receipts / supplier payments | +439,1 jt / 1.872,9 jt / −1.325,0 jt |
| CF: lowest daily cash balance | 289,7 jt on 28 Aug |
| Controls | 17 LULUS, 2 BELUM DIISI (Accurate totals not entered) |

**Functional checks.**

- [ ] Changing the update date to 28 Aug moves 27-Aug Order rows to "past-dated" (control 7) and shifts every actual/outlook split without manual edits.
- [ ] Re-uploading the same sales export does not duplicate rows; a changed row is updated and audited.
- [ ] A new item code or GL account blocks release until mapped; mapping it clears the control.
- [ ] Role test: Sales cannot edit batches or parameters; Management sees no input pages; Admin sees everything.
- [ ] Monday rollover creates the new week with opening stock from the uploaded valuation and last-week summary from the released snapshot.
- [ ] PDF export matches the on-screen numbers and fits A4 landscape without cut-off columns.
- [ ] Engine unit tests cover every rule in §5 with the fixtures; CI fails on any golden mismatch > Rp 1 or > 0,01 kg.

## 11. Delivery plan and open questions

Five milestones; each ends with the golden tests of its scope green and a demo on the example week. Order matters: the engine and its tests come before any page.

1. **M1 — Engine and fixtures.** Monorepo, `@kgr/engine` with §5.1–5.5 (stock, decisions, batches, alerts), fixtures loaded from the reference Excel, golden tests for blocks 1–7. No UI yet.
2. **M2 — Data layer and uploads.** Supabase schema (§4), RLS, auth, audit log; upload wizard for the four Accurate exports; mapping pages; week rollover.
3. **M3 — Outlook and input pages.** Outlook (blocks 1–7), Stok, Batch RPA, input forms (orders, batches, receipts plan, parameters, prices), controls 1–11, PDF of Outlook.
4. **M4 — Statements.** Engine §5.6–5.8 with golden tests, P&L / Neraca / Arus Kas pages with drill-downs, cash plan and run-rate pages, controls 12–19, block 8, release flow.
5. **M5 — Pilot.** Two live weeks run by the team in parallel with the Excel; differences logged and fixed; mobile read-only; handover notes.

**Open questions (decide before M3).**

- [ ] Minimum trading spread: the Excel uses Rp 2.000/kg as a placeholder. Who sets it and per SKU or one number?
- [ ] Payment terms: example uses LB 7 days, trading 14, freight/maklon 30. Confirm actual terms per supplier type.
- [ ] Collections: manual cash plan in v1, or derive from AR aging with customer terms (needs a customer master)?
- [ ] HPP of actual sales: from the inventory valuation ledger (DO value) or accept weekly average cost for all lines?
- [ ] Karkas by size: keep fresh/frozen only in v1, or add the Uk dimension for orders and stock now?
- [ ] Hosting and ownership: SAMB Vercel/Supabase accounts, who administers users?
- [ ] Accurate API: available on the current licence? If yes, M2 can add a daily sync instead of uploads.

## 12. Working instructions for Claude Opus (Claude Code)

Treat `reference/KGR_Weekly_Outlook.xlsx` as the executable spec: when this PRD and the Excel disagree, the Excel wins and the PRD gets a comment.

1. Start by reading the Excel with openpyxl: every output sheet, its formulas and the `Cara hitung` columns. Extract the example week's inputs into JSON fixtures and the output cells into golden expectations before writing engine code.
2. Build the engine test-first: one module per §5 subsection, pure functions, no database access, Decimal or integer-rupiah arithmetic (no floating-point money). Run the golden tests on every commit; tolerance Rp 1 and 0,01 kg.
3. Keep the vocabulary of the Excel in code and UI: keys `Segment|SKU|Form`, statuses Aktual/Order/Rencana, control names, block numbers. Do not rename lines or categories.
4. Database: Supabase migrations under version control; RLS policies written with each table; seed scripts load I\_Master, I\_Item, I\_COA, I\_RunRate and parameters from the Excel.
5. Uploads: parse with SheetJS, stage, validate, commit; write a parser test per export type using the Excel's input sheets as samples.
6. UI: Bahasa Indonesia labels taken from the Excel headers; house number format via `Intl.NumberFormat('id-ID')`; cream input cells, green links, red warnings; A4 landscape print CSS.
7. Work in the milestone order of §11; at the end of each milestone post a short status (what is green, what is open) and stop for review before the next one.
8. Never silently change a rule because it looks wrong; log it as an open question with the cell reference and the number affected.
9. Deliverables per milestone: code, migrations, tests, a `CHANGELOG.md`, and an updated `docs/parity.md` listing every golden number and its current status.
