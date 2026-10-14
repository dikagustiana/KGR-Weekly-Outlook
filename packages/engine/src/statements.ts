/** PRD §5.6–5.8 — weekly P&L (O_PnL), balance sheet (O_BS) and direct cash flow (O_CF). */
import { Decimal, ZERO, div, round0 } from "./decimal";
import { addDays, daysInMonth, diffDays, firstOfMonth, weekDays, type ISODate } from "./dates";
import type { Prepared } from "./prepare";
import type { SalesValued } from "./stock";

/* ------------------------------------------------------------------ P&L */

export const PNL_REVENUE = ["Revenue - LB Main Product", "Revenue - LB By Product", "Revenue - Trading"] as const;
export const PNL_COGS = ["COGS - Live Bird", "COGS - Trading", "Other COGS - Expedition", "COGS - Blasting"] as const;
export const PNL_OPEX = [
  "Delivery Expenses", "Commission Expenses", "Packaging", "Salaries and allowance", "Storage Expenses",
  "Office Transportation expenses", "Rent Expenses", "Professional Fee", "Office Supplies & Utilities",
  "Maintenance Expenses", "Tax expenses", "Other operating expenses",
] as const;
export const PNL_OTHER = ["Interest Expense", "Other Income", "Other Expense"] as const;
export const PNL_DA = "Depreciation & amortisation";

export type PnlColumn = "lastWeek" | "actual" | "outlook" | "projection" | "delta" | "mtd" | "mtdPlusOutlook";
export const PNL_COLUMNS: PnlColumn[] = ["lastWeek", "actual", "outlook", "projection", "delta", "mtd", "mtdPlusOutlook"];

export interface PnlLine {
  line: string;
  kind: "line" | "total" | "ratio";
  values: Record<PnlColumn, Decimal>;
  /** Basis sisa minggu (column I) */
  basis?: string;
}

export interface PnlRanges {
  lastWeek: [ISODate, ISODate];
  actual: [ISODate, ISODate];
  mtd: [ISODate, ISODate];
  remainingDays: number;
  daysInMonth: number;
}

export interface Pnl {
  lines: PnlLine[];
  get(line: string): PnlLine;
  ranges: PnlRanges;
}

function cols(f: (c: PnlColumn) => Decimal): Record<PnlColumn, Decimal> {
  return Object.fromEntries(PNL_COLUMNS.map((c) => [c, f(c)])) as Record<PnlColumn, Decimal>;
}

export function pnlRanges(p: Prepared): PnlRanges {
  return {
    lastWeek: [addDays(p.weekStart, -7), addDays(p.weekStart, -1)],
    actual: [p.weekStart, addDays(p.today, -1)],
    mtd: [firstOfMonth(p.today), addDays(p.today, -1)],
    remainingDays: diffDays(p.weekEnd, p.today) + 1,
    daysInMonth: daysInMonth(p.today),
  };
}

export function computePnl(p: Prepared, sales: SalesValued[]): Pnl {
  const R = pnlRanges(p);
  // −Σ (debit − credit) of GL lines mapped to the line within [lo, hi]
  const glByLine = new Map<string, { date: ISODate | null; v: Decimal }[]>();
  for (const g of p.gl) {
    if (!g.plLine) continue;
    const a = glByLine.get(g.plLine) ?? [];
    a.push({ date: g.date, v: g.drCr });
    glByLine.set(g.plLine, a);
  }
  const actualOf = (line: string, [lo, hi]: [ISODate, ISODate]) =>
    (glByLine.get(line) ?? []).filter((x) => x.date !== null && x.date >= lo && x.date <= hi).reduce((a, x) => a.minus(x.v), ZERO);

  const orders = sales.filter((s) => s.status === "Order" && s.counted);
  const outlookRevenue: Record<string, Decimal> = {
    "Revenue - LB Main Product": orders.filter((s) => s.segment === "RPA" && s.group !== "By-product").reduce((a, s) => a.plus(s.value), ZERO),
    "Revenue - LB By Product": orders.filter((s) => s.segment === "RPA" && s.group === "By-product").reduce((a, s) => a.plus(s.value), ZERO),
    "Revenue - Trading": orders.filter((s) => s.segment === "Trading").reduce((a, s) => a.plus(s.value), ZERO),
    "COGS - Live Bird": orders.filter((s) => s.segment === "RPA").reduce((a, s) => a.minus(s.hpp), ZERO),
    "COGS - Trading": orders.filter((s) => s.segment === "Trading").reduce((a, s) => a.minus(s.hpp), ZERO),
  };
  const basis: Record<string, string> = {
    "Revenue - LB Main Product": "order RPA (non by-product) × harga",
    "Revenue - LB By Product": "order by-product × harga",
    "Revenue - Trading": "order Trading × harga",
    "COGS - Live Bird": "order × biaya rata-rata stok RPA",
    "COGS - Trading": "order × biaya rata-rata stok Trading",
  };
  const factor = new Decimal(R.remainingDays).div(R.daysInMonth);
  const runRateOutlook = (line: string) => {
    const r = p.runrate.find((x) => x.plLine === line);
    const v = r ? r.monthly.times(factor).plus(r.adjustment) : ZERO;
    return line === "Other Income" ? v : v.neg();
  };

  const lineOf = (line: string): PnlLine => {
    const outlook = outlookRevenue[line] ?? runRateOutlook(line);
    const lastWeek = actualOf(line, R.lastWeek);
    const actual = actualOf(line, R.actual);
    const mtd = actualOf(line, R.mtd);
    const projection = actual.plus(outlook);
    return {
      line, kind: "line", basis: basis[line] ?? "run-rate (I_RunRate)",
      values: { lastWeek, actual, outlook, projection, delta: projection.minus(lastWeek), mtd, mtdPlusOutlook: mtd.plus(outlook) },
    };
  };
  const total = (line: string, parts: PnlLine[]): PnlLine => ({
    line, kind: "total", values: cols((c) => parts.reduce((a, x) => a.plus(x.values[c]), ZERO)),
  });

  const rev = PNL_REVENUE.map(lineOf);
  const totalRev = total("TOTAL REVENUE", rev);
  const cogs = PNL_COGS.map(lineOf);
  const totalCogs = total("TOTAL COST OF SALES", cogs);
  const gp = total("GROSS PROFIT", [totalRev, totalCogs]);
  const gpMargin: PnlLine = { line: "GP margin", kind: "ratio", values: cols((c) => div(gp.values[c], totalRev.values[c])) };
  const opex = PNL_OPEX.map(lineOf);
  const totalOpex = total("TOTAL OPERATING EXPENSES (excl. D&A)", opex);
  const opInc = total("OPERATING INCOME", [gp, totalOpex]);
  const other = PNL_OTHER.map(lineOf);
  const totalOther = total("TOTAL OTHER INCOME (EXPENSE)", other);
  const nibt = total("NIBT (before D&A)", [opInc, totalOther]);
  const da = lineOf(PNL_DA);
  const ni = total("NET INCOME", [nibt, da]);

  const lines = [...rev, totalRev, ...cogs, totalCogs, gp, gpMargin, ...opex, totalOpex, opInc, ...other, totalOther, nibt, da, ni];
  const byName = new Map(lines.map((l) => [l.line, l]));
  return {
    lines,
    ranges: R,
    get(line: string) {
      const l = byName.get(line);
      if (!l) throw new Error(`Baris laba rugi tidak dikenal: ${line}`);
      return l;
    },
  };
}

/* ------------------------------------------------------------------ Planned flows (O_BS B60:B73) */

export interface PlannedFlows {
  /** B60 */ batchTotalCost: Decimal;
  /** B61 */ lbValue: Decimal;
  /** B62 */ freightMaklon: Decimal;
  /** B63 */ tradingReceipts: Decimal;
  /** B64 */ lbDue: Decimal;
  /** B65 */ tradingDue: Decimal;
  /** B66 */ freightMaklonDue: Decimal;
  /** B67 */ revenueOutlook: Decimal;
  /** B68 */ cogsLbOutlook: Decimal;
  /** B69 */ cogsTradingOutlook: Decimal;
  /** B70 */ runRateCostsNet: Decimal;
  /** B71 */ daOutlook: Decimal;
  /** B72 */ netIncomeOutlook: Decimal;
  /** B73 */ netCashFlowOutlook: Decimal;
}

function plannedFlowsBase(p: Prepared, pnl: Pnl) {
  const plan = p.batches.filter((b) => b.status === "Rencana");
  const inRange = (d: ISODate | null, lo: ISODate, hi: ISODate) => d !== null && d >= lo && d <= hi;
  const thisWeek = plan.filter((b) => inRange(b.date, p.today, p.weekEnd));
  const S = <T>(xs: T[], f: (x: T) => Decimal) => xs.reduce((a, x) => a.plus(f(x)), ZERO);
  const lbDueRange = plan.filter((b) => inRange(b.date, addDays(p.today, -p.params.termsLb), addDays(p.weekEnd, -p.params.termsLb)));
  const fmDueRange = plan.filter((b) =>
    inRange(b.date, addDays(p.today, -p.params.termsFreightMaklon), addDays(p.weekEnd, -p.params.termsFreightMaklon)),
  );
  const trPlan = p.receipts.filter((r) => r.source === "Beli Trading" && r.status === "Rencana");
  const D = (c: PnlColumn, l: string) => pnl.get(l).values[c];
  return {
    batchTotalCost: S(thisWeek, (b) => b.totalCost),
    lbValue: S(thisWeek, (b) => b.lbValue),
    freightMaklon: S(thisWeek, (b) => b.freight.plus(b.maklon)),
    tradingReceipts: S(trPlan.filter((r) => r.counted), (r) => r.value),
    lbDue: S(lbDueRange, (b) => b.lbValue),
    tradingDue: S(
      trPlan.filter((r) => inRange(r.date, addDays(p.today, -p.params.termsTrading), addDays(p.weekEnd, -p.params.termsTrading))),
      (r) => r.value,
    ),
    freightMaklonDue: S(fmDueRange, (b) => b.freight.plus(b.maklon)),
    revenueOutlook: D("outlook", "TOTAL REVENUE"),
    cogsLbOutlook: D("outlook", "COGS - Live Bird").neg(),
    cogsTradingOutlook: D("outlook", "COGS - Trading").neg(),
    runRateCostsNet: D("outlook", "NIBT (before D&A)")
      .minus(D("outlook", "TOTAL REVENUE"))
      .minus(D("outlook", "COGS - Live Bird"))
      .minus(D("outlook", "COGS - Trading"))
      .neg(),
    daOutlook: D("outlook", PNL_DA).neg(),
    netIncomeOutlook: D("outlook", "NET INCOME"),
  };
}

/* ------------------------------------------------------------------ Cash flow */

export const CF_CATEGORIES = [
  "Penerimaan dari pelanggan", "Penerimaan lain", "Bayar pemasok barang (live bird & trading)",
  "Bayar jasa (maklon, angkut, cold storage, sewa)", "Bayar karyawan", "Bayar biaya operasional lain", "Bayar pajak",
  "Bunga & biaya bank", "Belanja aset tetap", "Pinjaman afiliasi (net)", "Setoran modal", "Transfer antar rekening",
] as const;

export type CfColumn = "lastWeek" | "actual" | "outlook" | "projection";

export interface CfLine {
  category: string;
  values: Record<CfColumn, Decimal>;
}

export interface DailyCash {
  date: ISODate;
  netFlow: Decimal;
  closing: Decimal;
  basis: "aktual" | "rencana";
}

export interface CashFlow {
  lines: CfLine[];
  net: Record<CfColumn, Decimal>;
  opening: Record<CfColumn, Decimal>;
  closing: Record<CfColumn, Decimal>;
  /** Kontrol: saldo kas akhir = neraca (B23, C23, E23) */
  tieOut: { lastWeek: Decimal; actual: Decimal; projection: Decimal };
  daily: DailyCash[];
  lowest: { date: ISODate; balance: Decimal };
}

/* ------------------------------------------------------------------ Balance sheet */

export const BS_ASSETS = [
  "Cash and cash equivalents", "Trade Receivables - Third Parties", "Trade Receivables - Related Parties",
  "Other Receivable - Third Party", "Other Receivable - Affiliated Party", "Advance Payment", "Inventory - Product",
  "Inventory - Trading", "Prepaid Tax", "Prepaid Expenses", "Other assets", "Fixed assets - cost", "Accumulated depreciation",
] as const;
export const BS_LIABILITIES = [
  "Trade Payables - Third Parties", "Trade Payables - Affiliates", "Other Payable - Third Parties",
  "Other Payable - Related Parties", "Accrued Expenses - Third Parties", "Unearned Revenue", "Taxes Payable",
  "Temporary account (to reclassify)",
] as const;
export const BS_EQUITY = ["Shareholder Equity", "Retained earnings", "Current year profit"] as const;

export type BsColumn = "tb" | "lastWeekEnd" | "yesterday" | "projection" | "delta" | "plannedFlow";

export interface BsLine {
  line: string;
  side: "asset" | "liability" | "equity" | "total" | "control";
  values: Record<BsColumn, Decimal>;
}

export interface BalanceSheet {
  dates: { tb: ISODate; lastWeekEnd: ISODate; yesterday: ISODate; projection: ISODate };
  lines: BsLine[];
  get(line: string): BsLine;
  totals: { assets: BsLine; liabilities: BsLine; equity: BsLine; liabilitiesAndEquity: BsLine; control: BsLine };
  planned: PlannedFlows;
}

export interface Statements {
  pnl: Pnl;
  bs: BalanceSheet;
  cf: CashFlow;
}

export function computeStatements(p: Prepared, sales: SalesValued[]): Statements {
  const pnl = computePnl(p, sales);
  const base = plannedFlowsBase(p, pnl);
  const S = <T>(xs: T[], f: (x: T) => Decimal) => xs.reduce((a, x) => a.plus(f(x)), ZERO);

  /* ---- cash flow (needs only P&L-independent planned flows) */
  const lastWeek: [ISODate, ISODate] = [addDays(p.weekStart, -7), addDays(p.weekStart, -1)];
  const actual: [ISODate, ISODate] = [p.weekStart, addDays(p.today, -1)];
  const cashLines = p.gl.filter((g) => g.isCash);
  const glCat = (cat: string, [lo, hi]: [ISODate, ISODate]) =>
    S(cashLines.filter((g) => g.cfCategory === cat && g.date !== null && g.date >= lo && g.date <= hi), (g) => g.drCr);
  const planCat = (cat: string) => S(p.cashPlan.filter((c) => c.category === cat && c.counted), (c) => c.amount);
  const model: Record<string, Decimal> = {
    "Bayar pemasok barang (live bird & trading)": base.lbDue.plus(base.tradingDue).neg(),
    "Bayar jasa (maklon, angkut, cold storage, sewa)": base.freightMaklonDue.neg(),
  };
  const cfLines: CfLine[] = CF_CATEGORIES.map((cat) => {
    const lw = glCat(cat, lastWeek);
    const ac = glCat(cat, actual);
    const ol = planCat(cat).plus(model[cat] ?? ZERO);
    return { category: cat, values: { lastWeek: lw, actual: ac, outlook: ol, projection: ac.plus(ol) } };
  });
  const cfNet = {
    lastWeek: S(cfLines, (l) => l.values.lastWeek),
    actual: S(cfLines, (l) => l.values.actual),
    outlook: S(cfLines, (l) => l.values.outlook),
    projection: S(cfLines, (l) => l.values.projection),
  };
  const planned: PlannedFlows = { ...base, netCashFlowOutlook: cfNet.outlook };

  /* ---- balance sheet */
  const dates = {
    tb: p.tbDate,
    lastWeekEnd: addDays(p.weekStart, -1),
    yesterday: addDays(p.today, -1),
    projection: p.weekEnd,
  };
  const balanceAt = (line: string, x: ISODate) =>
    S(p.tb.filter((t) => t.bsLine === line), (t) => t.balance).plus(
      S(p.gl.filter((g) => g.bsLine === line && g.date !== null && g.date <= x), (g) => g.drCr),
    );
  const profitAt = (x: ISODate) =>
    S(p.tb.filter((t) => t.type === "LabaRugi"), (t) => t.balance)
      .plus(S(p.gl.filter((g) => g.type === "LabaRugi" && g.date !== null && g.date <= x), (g) => g.drCr))
      .neg();
  const planCounter = (line: string) => S(p.cashPlan.filter((c) => c.counterLine === line && c.counted), (c) => c.amount).neg();
  const specificFlow: Record<string, Decimal> = {
    "Cash and cash equivalents": planned.netCashFlowOutlook,
    "Trade Receivables - Third Parties": planned.revenueOutlook,
    "Inventory - Product": planned.batchTotalCost.minus(planned.cogsLbOutlook),
    "Inventory - Trading": planned.tradingReceipts.minus(planned.cogsTradingOutlook),
    "Accumulated depreciation": planned.daOutlook.neg(),
    "Trade Payables - Third Parties": planned.lbValue.neg().minus(planned.tradingReceipts).plus(planned.lbDue).plus(planned.tradingDue),
    "Accrued Expenses - Third Parties": planned.freightMaklon.neg().plus(planned.freightMaklonDue).minus(planned.runRateCostsNet),
  };

  const mk = (line: string, side: "asset" | "liability" | "equity"): BsLine => {
    const sign = side === "asset" ? 1 : -1;
    const at = (x: ISODate) => (line === "Current year profit" ? profitAt(x) : balanceAt(line, x).times(sign));
    const G = line === "Current year profit" ? planned.netIncomeOutlook.neg() : planCounter(line).plus(specificFlow[line] ?? ZERO);
    const tb = at(dates.tb);
    const lw = at(dates.lastWeekEnd);
    const y = at(dates.yesterday);
    const proj = side === "asset" ? y.plus(G) : y.minus(G);
    return { line, side, values: { tb, lastWeekEnd: lw, yesterday: y, projection: proj, delta: proj.minus(lw), plannedFlow: G } };
  };
  const assets = BS_ASSETS.map((l) => mk(l, "asset"));
  const liabilities = BS_LIABILITIES.map((l) => mk(l, "liability"));
  const equity = BS_EQUITY.map((l) => mk(l, "equity"));
  const BSC: BsColumn[] = ["tb", "lastWeekEnd", "yesterday", "projection", "delta", "plannedFlow"];
  const tot = (line: string, xs: BsLine[]): BsLine => ({
    line, side: "total", values: Object.fromEntries(BSC.map((c) => [c, S(xs, (x) => x.values[c])])) as Record<BsColumn, Decimal>,
  });
  const tA = tot("TOTAL ASSETS", assets);
  const tL = tot("TOTAL LIABILITIES", liabilities);
  const tE = tot("TOTAL EQUITY", equity);
  const tLE = tot("TOTAL LIABILITIES AND EQUITY", [tL, tE]);
  const control: BsLine = {
    line: "Kontrol: aset − (liabilitas + ekuitas) (harus 0)", side: "control",
    values: Object.fromEntries(
      BSC.map((c) => [c, c === "plannedFlow" ? ZERO : round0(tA.values[c].minus(tLE.values[c]))]),
    ) as Record<BsColumn, Decimal>,
  };
  const bsLines = [...assets, tA, ...liabilities, tL, ...equity, tE, tLE, control];
  const bsByName = new Map(bsLines.map((l) => [l.line, l]));
  const bs: BalanceSheet = {
    dates, lines: bsLines, planned,
    get(line) {
      const l = bsByName.get(line);
      if (!l) throw new Error(`Pos neraca tidak dikenal: ${line}`);
      return l;
    },
    totals: { assets: tA, liabilities: tL, equity: tE, liabilitiesAndEquity: tLE, control },
  };

  /* ---- cash tie-out and daily cash */
  const cashBs = bs.get("Cash and cash equivalents").values;
  const opening = {
    lastWeek: cashBs.lastWeekEnd.minus(cfNet.lastWeek),
    actual: cashBs.lastWeekEnd,
    outlook: cashBs.yesterday,
    projection: cashBs.lastWeekEnd,
  };
  const closing = {
    lastWeek: opening.lastWeek.plus(cfNet.lastWeek),
    actual: opening.actual.plus(cfNet.actual),
    outlook: opening.outlook.plus(cfNet.outlook),
    projection: opening.projection.plus(cfNet.projection),
  };
  const r0 = round0;
  const tieOut = {
    lastWeek: r0(closing.lastWeek.minus(cashBs.lastWeekEnd)),
    actual: r0(closing.actual.minus(cashBs.yesterday)),
    projection: r0(closing.projection.minus(cashBs.projection)),
  };

  const plan = p.batches.filter((b) => b.status === "Rencana");
  const trPlan = p.receipts.filter((r) => r.source === "Beli Trading" && r.status === "Rencana");
  let bal = cashBs.lastWeekEnd;
  const daily: DailyCash[] = weekDays(p.weekStart).map((d) => {
    let net: Decimal;
    if (d < p.today) {
      net = S(cashLines.filter((g) => g.date === d), (g) => g.drCr);
    } else {
      const lbD = addDays(d, -p.params.termsLb);
      const trD = addDays(d, -p.params.termsTrading);
      const fmD = addDays(d, -p.params.termsFreightMaklon);
      net = S(p.cashPlan.filter((c) => c.date === d), (c) => c.amount)
        .minus(S(plan.filter((b) => b.date === lbD), (b) => b.lbValue))
        .minus(S(trPlan.filter((r) => r.date === trD), (r) => r.value))
        .minus(S(plan.filter((b) => b.date === fmD), (b) => b.freight))
        .minus(S(plan.filter((b) => b.date === fmD), (b) => b.maklon));
    }
    bal = bal.plus(net);
    return { date: d, netFlow: net, closing: bal, basis: d < p.today ? "aktual" : "rencana" };
  });
  const lowestDay = daily.reduce((a, b) => (b.closing.lessThan(a.closing) ? b : a));

  const cf: CashFlow = {
    lines: cfLines, net: cfNet, opening, closing, tieOut, daily,
    lowest: { date: lowestDay.date, balance: lowestDay.closing },
  };
  return { pnl, bs, cf };
}
