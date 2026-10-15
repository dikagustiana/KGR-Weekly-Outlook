/**
 * M6 — cash conversion cycle (PRD v3 §4.7). Pure functions, decimal.js.
 *
 * DIO = inventory / (COGS 90 days / 90); DSO = AR / (revenue 90 days / 90); DPO = AP / (COGS 90 days / 90);
 * CCC = DIO + DSO − DPO. Working capital need = CCC / 365 × annual COGS. Simulation: payment terms (live bird,
 * trading) weighted by their share of purchases give the DPO; a target stock days gives the DIO; DSO unchanged.
 */
import { D, Decimal, ZERO, div, type Num } from "./decimal";

export interface CccInput {
  inventory: Num;
  ar: Num;
  ap: Num;
  /** COGS over the window (positive). */
  cogs: Num;
  revenue: Num;
  /** Days the COGS / revenue window covers (90, or fewer when the journal is shorter). */
  windowDays: number;
}

export interface CccResult {
  dio: Decimal;
  dso: Decimal;
  dpo: Decimal;
  ccc: Decimal;
  cogsPerDay: Decimal;
  revenuePerDay: Decimal;
  workingCapital: Decimal;
}

export function ccc(x: CccInput): CccResult {
  const cogsPerDay = x.windowDays > 0 ? D(x.cogs).abs().div(x.windowDays) : ZERO;
  const revenuePerDay = x.windowDays > 0 ? D(x.revenue).abs().div(x.windowDays) : ZERO;
  const dio = div(D(x.inventory), cogsPerDay), dso = div(D(x.ar), revenuePerDay), dpo = div(D(x.ap), cogsPerDay);
  const c = dio.plus(dso).minus(dpo);
  return { dio, dso, dpo, ccc: c, cogsPerDay, revenuePerDay, workingCapital: c.div(365).times(cogsPerDay.times(365)) };
}

/** What-if: terms per purchase type (weighted by purchase share) and a target stock days. */
export function simulateCcc(base: CccResult, x: { termsLbDays: Num; termsTradingDays: Num; shareLb: Num; targetStockDays: Num | null }): CccResult & { delta: Decimal; deltaWorkingCapital: Decimal } {
  const share = D(x.shareLb);
  const dpo = D(x.termsLbDays).times(share).plus(D(x.termsTradingDays).times(D(1).minus(share)));
  const dio = x.targetStockDays === null || x.targetStockDays === undefined || x.targetStockDays === "" ? base.dio : D(x.targetStockDays);
  const c = dio.plus(base.dso).minus(dpo);
  const wc = c.div(365).times(base.cogsPerDay.times(365));
  return { ...base, dio, dpo, ccc: c, workingCapital: wc, delta: c.minus(base.ccc), deltaWorkingCapital: wc.minus(base.workingCapital) };
}
