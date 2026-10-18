/**
 * PRD v5.2-A R68 (T15, O24 b, O27): the app side of the FS reconciliation — the numbers `fsRecon` compares with the FS.
 * Pure functions, decimal.js.
 *
 *  - PL (`appPlLines`): the month's journal + posted closing adjustments per P&L line, folded into the FS structure
 *    (revenue, COGS, GP, operating expenses, other income/expense, NIBT). With `costing_rows_mode = 'memo'` (O24 b) the v5
 *    rows "Selisih costing" and "Biaya kapasitas idle" are NOT cost of sales for the comparison and not part of the
 *    journal NIBT (they are memo lines under it), so GP and NIBT equal the FS; in mode 'cogs' (the default) they are in
 *    COGS and the difference to the FS is a `definisi` difference.
 *  - BS (`appBsLines`): trial balance of the opening date + journal up to the balance date, per `bs_line` of the chart
 *    of accounts (the same arithmetic as the v1 balance sheet, statements.ts), folded into the mapped FS rows.
 *  - Causes (`reconHints`): a month whose journal stops before the month end differs for lack of data, not because of a
 *    different definition.
 */
import { D, ZERO, sum, type Decimal, type Num } from "./decimal";
import type { ISODate } from "./dates";
import type { AppLine, ReconHint } from "./fs-recon";
import { isCogsLine, isRevenueLine, V5_COGS_LINES, type CostingRowsMode } from "./monthly";

/** `app_setting` v5_pl.costing_rows_mode (R66): 'cogs' = the v5 rows are in COGS (default), 'memo' = memo lines under NIBT. The type is monthly.ts's. */
export const isCostingRowsMode = (v: unknown): v is CostingRowsMode => v === "cogs" || v === "memo";

/** decimal.js keeps a negative zero (−0 × 1, 0 × −1): "-0.00" must never reach a table or a comparison. */
const nz = (d: Decimal): Decimal => (d.isZero() ? ZERO : d);

export interface PlAmount {
  pl_line: string;
  /** P&L sign: + income / − cost. */
  amount: Num;
}

/** The three lines of "TOTAL OTHER INCOME (EXPENSE)" (FS b.49); every other non-revenue, non-COGS line is operating expense. */
export const OTHER_INCOME_LINES = ["Interest Expense", "Other Income", "Other Expense"] as const;
export const isOtherIncomeLine = (l: string) => (OTHER_INCOME_LINES as readonly string[]).includes(l);
export const isV5CostingLine = (l: string) => (V5_COGS_LINES as readonly string[]).includes(l);

/**
 * P&L rows of the month (actual, any basis but the v5 fixed-cost estimate, which is never journal) and the posted
 * closing adjustments → amount per P&L line. The rows of `finalPreview` and the adjustments of `closing_adjustment`.
 */
export function plLineAmounts(
  rows: { pl_line: string; basis: string; actual: Num | null }[],
  adjustments: PlAmount[] = [],
): PlAmount[] {
  const m = new Map<string, Decimal>();
  for (const r of rows) if (r.actual !== null && r.basis !== "fixed_estimate") m.set(r.pl_line, (m.get(r.pl_line) ?? ZERO).plus(D(r.actual)));
  for (const a of adjustments) m.set(a.pl_line, (m.get(a.pl_line) ?? ZERO).plus(D(a.amount)));
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pl_line, amount]) => ({ pl_line, amount }));
}

export interface AppPl {
  lines: AppLine[];
  /** Σ of the v5 rows "Selisih costing" and "Biaya kapasitas idle" (P&L sign), whatever the mode. */
  v5: Decimal;
  /** Memo mode: the v5 rows kept out of the totals (shown as memo lines), else empty. */
  memo: PlAmount[];
}

/**
 * P&L lines of the app in the FS structure; see the file header for the memo mode. Without any P&L line (no journal in
 * the month) the app has no number: every amount is null, never 0.
 */
export function appPlLines(x: { lines: PlAmount[]; costingRowsMode?: CostingRowsMode }): AppPl {
  const mode: CostingRowsMode = x.costingRowsMode ?? "cogs";
  if (!x.lines.length) {
    return { lines: ["revenue", "cogs", "gp", "opex", "other", "nibt"].map((app_line) => ({ app_line, amount: null })), v5: ZERO, memo: [] };
  }
  const v5Rows = x.lines.filter((l) => isV5CostingLine(l.pl_line));
  const body = x.lines.filter((l) => !(mode === "memo" && isV5CostingLine(l.pl_line)));
  const tot = (p: (l: string) => boolean) => sum(body.filter((l) => p(l.pl_line)).map((l) => D(l.amount)));
  const revenue = tot(isRevenueLine);
  const cogs = tot(isCogsLine);
  const other = tot(isOtherIncomeLine);
  const opex = tot((l) => !isRevenueLine(l) && !isCogsLine(l) && !isOtherIncomeLine(l));
  const gp = revenue.plus(cogs);
  return {
    lines: [
      { app_line: "revenue", amount: revenue }, { app_line: "cogs", amount: cogs }, { app_line: "gp", amount: gp },
      { app_line: "opex", amount: opex }, { app_line: "other", amount: other }, { app_line: "nibt", amount: gp.plus(opex).plus(other) },
    ],
    v5: sum(v5Rows.map((l) => D(l.amount))),
    memo: mode === "memo" ? v5Rows.map((l) => ({ pl_line: l.pl_line, amount: D(l.amount) })) : [],
  };
}

export interface BsInput {
  /** Trial balance of the opening date: debit positive, credit negative. */
  tb: { account: string; balance: Num | null }[];
  gl: { date: ISODate | null; account: string | null; debit: Num | null; credit: Num | null }[];
  coa: { account: string; type: string; bs_line: string | null }[];
  /** The balance date (journal up to and including it). */
  date: ISODate;
  /** Date of the trial balance: only journal after it is added (default: all journal up to `date`, as the v1 balance sheet). */
  tbDate?: ISODate;
}

/** `bs_line` (chart of accounts) behind each app line of the balance sheet; "liability" and "equity" lines are credit-positive. */
const BS_SOURCE: { app_line: string; bs_lines: string[]; side: 1 | -1 }[] = [
  { app_line: "kas", bs_lines: ["Cash and cash equivalents"], side: 1 },
  { app_line: "piutang_pihak_ketiga", bs_lines: ["Trade Receivables - Third Parties"], side: 1 },
  { app_line: "piutang_pihak_berelasi", bs_lines: ["Trade Receivables - Related Parties"], side: 1 },
  { app_line: "persediaan_produk", bs_lines: ["Inventory - Product"], side: 1 },
  { app_line: "persediaan_trading", bs_lines: ["Inventory - Trading"], side: 1 },
  { app_line: "utang_dagang_pihak_ketiga", bs_lines: ["Trade Payables - Third Parties"], side: -1 },
  { app_line: "utang_dagang_afiliasi", bs_lines: ["Trade Payables - Affiliates"], side: -1 },
  { app_line: "utang_lain_afiliasi", bs_lines: ["Other Payable - Related Parties"], side: -1 },
];
/** Equity = Shareholder Equity + Retained earnings (credit-positive) + the profit of the year (P&L accounts, same date). */
const EQUITY_BS_LINES = ["Shareholder Equity", "Retained earnings"];

export interface AppBs {
  lines: AppLine[];
  /** Accounts with a balance or journal that the chart of accounts cannot place on the balance sheet or the P&L. */
  unplaced: { account: string; net: Decimal }[];
}

/**
 * Balance sheet lines of the app at `date`: trial balance + journal, per `bs_line`. Without a trial balance there is no
 * balance sheet: every line is null (never 0).
 */
export function appBsLines(x: BsInput): AppBs {
  const coa = new Map(x.coa.map((c) => [String(c.account).trim(), c]));
  const hasTb = x.tb.length > 0;
  const bs = new Map<string, Decimal>();
  let profit = ZERO;
  const unplaced = new Map<string, Decimal>();
  const add = (account: string, v: Decimal) => {
    const c = coa.get(account);
    if (c?.type === "LabaRugi") profit = profit.plus(v);
    else if (c?.type === "Neraca" && c.bs_line) bs.set(c.bs_line, (bs.get(c.bs_line) ?? ZERO).plus(v));
    else if (c?.type !== "Header" && !v.isZero()) unplaced.set(account, (unplaced.get(account) ?? ZERO).plus(v));
  };
  for (const t of x.tb) if (t.balance !== null) add(String(t.account).trim(), D(t.balance));
  for (const g of x.gl) {
    if (!g.date || !g.account || g.date > x.date || (x.tbDate && g.date <= x.tbDate)) continue;
    add(String(g.account).trim(), D(g.debit ?? 0).minus(D(g.credit ?? 0)));
  }
  const of = (lines: string[]) => sum(lines.map((l) => bs.get(l) ?? ZERO));
  const lines: AppLine[] = BS_SOURCE.map((s) => ({ app_line: s.app_line, amount: hasTb ? nz(of(s.bs_lines).times(s.side)) : null }));
  lines.push({ app_line: "ekuitas", amount: hasTb ? nz(of(EQUITY_BS_LINES).neg().plus(profit.neg())) : null });
  return { lines, unplaced: [...unplaced.entries()].map(([account, net]) => ({ account, net })).sort((a, b) => a.account.localeCompare(b.account)) };
}

/**
 * Known causes per app line (`fsRecon` hints). A journal that stops before the month end → every flow and balance line
 * differs for lack of data; in mode 'cogs' with v5 rows, COGS, GP and NIBT also carry a definition difference.
 */
export function reconHints(x: {
  /** Last date the journal covers (null = unknown); a month is complete when it reaches `monthEnd`. */
  journalThrough: ISODate | null;
  monthEnd: ISODate;
  costingRowsMode?: CostingRowsMode;
  /** Σ of the v5 rows (AppPl.v5). */
  v5?: Num;
  appLines: string[];
}): Record<string, ReconHint> {
  const out: Record<string, ReconHint> = {};
  const partial = x.journalThrough !== null && x.journalThrough < x.monthEnd;
  const v5 = D(x.v5 ?? 0);
  const defV5 = (x.costingRowsMode ?? "cogs") === "cogs" && !v5.isZero();
  for (const line of x.appLines) {
    const notes: string[] = [];
    if (partial) notes.push(`jurnal baru sampai ${x.journalThrough}, akhir bulan ${x.monthEnd}: transaksi dan jurnal penutup setelahnya belum ada`);
    if (defV5 && ["cogs", "gp", "nibt"].includes(line)) notes.push("mode 'cogs': COGS memuat Selisih costing dan Biaya kapasitas idle, FS tidak (O24)");
    if (notes.length) out[line] = { cause: partial ? "data belum ada" : "definisi", note: notes.join("; ") };
  }
  return out;
}
