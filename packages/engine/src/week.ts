/** The engine entry point: one pure function of one week's inputs. */
import { Decimal } from "./decimal";
import { assertISODate } from "./dates";
import { prepare, type Prepared } from "./prepare";
import { computeStock, valueSales, type SalesValued, type StockResult } from "./stock";
import {
  alerts, batchKpi, cashOut, rpaDecision, stockActions, tradingDecisions, weekSummary,
  type Alert, type BatchKpi, type CashOutRow, type RpaDecision, type StockActionRow, type SummaryRow, type TradingRow,
} from "./outlook";
import { computeStatements, type Statements } from "./statements";
import { computeControls, type ControlSummary } from "./controls";
import type { WeekInputs } from "./types";

export const ENGINE_VERSION = "1.0.0";

export interface StatementSummaryRow {
  label: string;
  lastWeek: Decimal | null;
  projection: Decimal;
  delta: Decimal | null;
  source: string;
}

export interface WeekResult {
  engineVersion: string;
  week: { weekStart: string; weekEnd: string; today: string; tbOpeningDate: string };
  prepared: Prepared;
  stock: StockResult;
  sales: SalesValued[];
  block1: SummaryRow[];
  block2: RpaDecision;
  block3: TradingRow[];
  block4: StockActionRow[];
  block5: { rows: CashOutRow[]; total: CashOutRow };
  block6: BatchKpi;
  block7: Alert[];
  statements: Statements;
  block8: StatementSummaryRow[];
  controls: ControlSummary;
}

export function computeWeek(inputs: WeekInputs): WeekResult {
  assertISODate(inputs.week.update_date);
  assertISODate(inputs.week.week_start);
  const p = prepare(inputs);
  const stock = computeStock(p);
  const sales = valueSales(p, stock);
  const block1 = weekSummary(p, sales);
  const block2 = rpaDecision(p, stock);
  const block3 = tradingDecisions(p, stock);
  const block4 = stockActions(stock);
  const block5 = cashOut(p);
  const block6 = batchKpi(p, block2.breakevenAt100Fresh);
  const block7 = alerts(p, stock, block2, block3, block6);
  const statements = computeStatements(p, sales);
  const block8 = statementSummary(statements);
  const so = inputs.superseded_ops_rows;
  const controls = computeControls(p, stock, statements, {
    sales: inputs.sales_lines,
    receipts: inputs.receipt_lines,
    supersededSales: so?.sales ?? [],
    supersededReceipts: so?.receipts ?? [],
  });
  return {
    engineVersion: ENGINE_VERSION,
    week: { weekStart: p.weekStart, weekEnd: p.weekEnd, today: p.today, tbOpeningDate: p.tbDate },
    prepared: p, stock, sales, block1, block2, block3, block4, block5, block6, block7, statements, block8, controls,
  };
}

/** O_Outlook block 8 (rows 76–86). */
export function statementSummary(st: Statements): StatementSummaryRow[] {
  const P = (l: string) => st.pnl.get(l).values;
  const B = (l: string) => st.bs.get(l).values;
  const row = (label: string, lw: Decimal | null, pr: Decimal, source: string): StatementSummaryRow => ({
    label, lastWeek: lw, projection: pr, delta: lw === null ? null : pr.minus(lw), source,
  });
  return [
    row("Revenue", P("TOTAL REVENUE").lastWeek, P("TOTAL REVENUE").projection, "O_PnL TOTAL REVENUE"),
    row("Gross profit", P("GROSS PROFIT").lastWeek, P("GROSS PROFIT").projection, "O_PnL GROSS PROFIT"),
    row("Total operating expenses (excl. D&A)", P("TOTAL OPERATING EXPENSES (excl. D&A)").lastWeek,
      P("TOTAL OPERATING EXPENSES (excl. D&A)").projection, "O_PnL TOTAL OPEX"),
    row("NIBT (before D&A)", P("NIBT (before D&A)").lastWeek, P("NIBT (before D&A)").projection, "O_PnL NIBT"),
    row("Net income", P("NET INCOME").lastWeek, P("NET INCOME").projection, "O_PnL NET INCOME"),
    row("Saldo kas akhir minggu", st.cf.closing.lastWeek, st.cf.closing.projection, "O_CF saldo kas akhir"),
    row("Piutang usaha (pihak ketiga)", B("Trade Receivables - Third Parties").lastWeekEnd,
      B("Trade Receivables - Third Parties").projection, "O_BS Trade Receivables - Third Parties"),
    row("Persediaan (produk + trading)", B("Inventory - Product").lastWeekEnd.plus(B("Inventory - Trading").lastWeekEnd),
      B("Inventory - Product").projection.plus(B("Inventory - Trading").projection), "O_BS Inventory - Product + Trading"),
    row("Utang usaha + biaya masih harus dibayar",
      B("Trade Payables - Third Parties").lastWeekEnd.plus(B("Accrued Expenses - Third Parties").lastWeekEnd),
      B("Trade Payables - Third Parties").projection.plus(B("Accrued Expenses - Third Parties").projection),
      "O_BS Trade Payables - Third Parties + Accrued Expenses"),
    row("Utang afiliasi (pinjaman + utang dagang afiliasi)",
      B("Other Payable - Related Parties").lastWeekEnd.plus(B("Trade Payables - Affiliates").lastWeekEnd),
      B("Other Payable - Related Parties").projection.plus(B("Trade Payables - Affiliates").projection),
      "O_BS Other Payable - Related Parties + Trade Payables - Affiliates"),
    row("Saldo kas terendah minggu ini (harian)", null, st.cf.lowest.balance, `O_CF saldo harian terendah (${st.cf.lowest.date})`),
  ];
}
