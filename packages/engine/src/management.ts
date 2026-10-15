/**
 * v3 management view sections (PRD v3 §6): Input (purchases and batch costs) and COGS (COGS/kg vs revenue/kg per
 * segment, inventory roll-forward from the M2 ledger vs the balance sheet). Pure functions over the week's engine
 * results — the page only renders them.
 */
import { D, Decimal, ZERO, div, sum, type Num } from "./decimal";
import type { ISODate } from "./dates";
import type { WeekResult } from "./week";
import type { LedgerResult } from "./ledger";

export interface InputSummary {
  /** Live bird bought for cutting (Aktual batches this week, plus planned ones from today). */
  lb: { actualKg: Decimal; actualValue: Decimal; plannedKg: Decimal; plannedValue: Decimal; avgPriceActual: Decimal | null };
  /** Trading purchases (receipts "Beli Trading"). */
  trading: { actualKg: Decimal; actualValue: Decimal; plannedKg: Decimal; plannedValue: Decimal };
  /** Batch costs other than the live bird. */
  batchCost: { freight: Decimal; maklon: Decimal; overhead: Decimal | null; perKgLb: Decimal | null };
}

/** PRD v3 §6 "Input": pembelian LB kg/Rp, pembelian trading, biaya batch (ekspedisi, maklon/TKL/overhead). */
export function inputSummary(r: WeekResult, overhead: Num | null = null): InputSummary {
  const p = r.prepared;
  const inWeek = (d: ISODate | null) => d !== null && d >= p.weekStart && d <= p.weekEnd;
  const act = p.batches.filter((b) => b.hasLb && inWeek(b.date) && b.status === "Aktual");
  const plan = p.batches.filter((b) => b.hasLb && inWeek(b.date) && b.status === "Rencana" && (b.date as string) >= p.today);
  const trA = p.receipts.filter((x) => x.counted && x.source === "Beli Trading" && x.status === "Aktual");
  const trP = p.receipts.filter((x) => x.counted && x.source === "Beli Trading" && x.status === "Rencana");
  const lbKgA = sum(act.map((b) => b.lbKg)), lbValA = sum(act.map((b) => b.lbValue));
  const freight = sum(act.map((b) => b.freight)), maklon = sum(act.map((b) => b.maklon));
  const oh = overhead === null || overhead === undefined || overhead === "" ? null : D(overhead);
  return {
    lb: { actualKg: lbKgA, actualValue: lbValA, plannedKg: sum(plan.map((b) => b.lbKg)), plannedValue: sum(plan.map((b) => b.lbValue)), avgPriceActual: lbKgA.isZero() ? null : lbValA.div(lbKgA) },
    trading: { actualKg: sum(trA.map((x) => x.kg)), actualValue: sum(trA.map((x) => x.value)), plannedKg: sum(trP.map((x) => x.kg)), plannedValue: sum(trP.map((x) => x.value)) },
    batchCost: { freight, maklon, overhead: oh, perKgLb: lbKgA.isZero() ? null : freight.plus(maklon).plus(oh ?? ZERO).div(lbKgA) },
  };
}

export interface CogsSegment {
  segment: string;
  kg: Decimal;
  revenue: Decimal;
  cogs: Decimal;
  revenuePerKg: Decimal | null;
  cogsPerKg: Decimal | null;
  gpPerKg: Decimal | null;
}

/**
 * PRD v3 §6 "COGS": weekly P&L (projection column) per segment over the projected kg of block 1 — RPA = LB main +
 * by-product revenue vs COGS - Live Bird, Trading = Revenue - Trading vs COGS - Trading; expedition and blasting are
 * shown as their own lines (other COGS), so COGS/kg here is the product cost per kg as in PRD v3 §1 (32.721 / 30.914).
 */
export function cogsBySegment(r: WeekResult): CogsSegment[] {
  const v = (line: string) => r.statements.pnl.get(line).values.projection;
  const kg = (seg: string) => r.block1.find((s) => s.segment === seg)?.kgProjection ?? ZERO;
  const row = (segment: string, revenue: Decimal, cogs: Decimal, k: Decimal): CogsSegment => ({
    segment, kg: k, revenue, cogs,
    revenuePerKg: k.isZero() ? null : revenue.div(k), cogsPerKg: k.isZero() ? null : cogs.div(k), gpPerKg: k.isZero() ? null : revenue.minus(cogs).div(k),
  });
  const rpa = row("RPA", v("Revenue - LB Main Product").plus(v("Revenue - LB By Product")), v("COGS - Live Bird").neg(), kg("RPA"));
  const tr = row("Trading", v("Revenue - Trading"), v("COGS - Trading").neg(), kg("Trading"));
  const other = v("Other COGS - Expedition").plus(v("COGS - Blasting")).neg();
  const tot = row("TOTAL KGR", rpa.revenue.plus(tr.revenue), rpa.cogs.plus(tr.cogs).plus(other), kg("TOTAL KGR"));
  return [rpa, tr, { ...row("Biaya COGS lain (ekspedisi, blasting)", ZERO, other, ZERO) }, tot];
}

export interface RollForward {
  from: ISODate;
  to: ISODate;
  opening: { kg: Decimal; value: Decimal };
  in: { kg: Decimal; value: Decimal };
  out: { kg: Decimal; value: Decimal };
  blast: { kg: Decimal; value: Decimal };
  adjust: { kg: Decimal; value: Decimal };
  closing: { kg: Decimal; value: Decimal };
  /** Closing value (MA) − balance-sheet inventory, when given. */
  vsBalanceSheet: Decimal | null;
}

/**
 * Inventory roll-forward over [from, to] from the ledger's actual movements (moving average values):
 * opening + in − out − blast ± adjust = closing. Blast moves fresh to frozen: the out leg and the in leg net to the
 * blast cost only, shown on its own line.
 */
export function rollForward(led: LedgerResult, from: ISODate, to: ISODate, bsInventory: Num | null = null): RollForward {
  const z = () => ({ kg: ZERO, value: ZERO });
  const r = { opening: z(), in: z(), out: z(), blast: z(), adjust: z() };
  for (const m of led.movements) {
    if (m.planned) continue;
    const v = m.cost_ma ?? ZERO;
    if (m.date < from) { r.opening.kg = r.opening.kg.plus(m.kg); r.opening.value = r.opening.value.plus(v); continue; }
    if (m.date > to) continue;
    const bucket = m.type === "in" ? r.in : m.type === "out_sale" ? r.out : m.type === "out_blast" || m.type === "in_blast" ? r.blast : r.adjust;
    bucket.kg = bucket.kg.plus(m.kg);
    bucket.value = bucket.value.plus(v);
  }
  const closing = {
    kg: r.opening.kg.plus(r.in.kg).plus(r.out.kg).plus(r.blast.kg).plus(r.adjust.kg),
    value: r.opening.value.plus(r.in.value).plus(r.out.value).plus(r.blast.value).plus(r.adjust.value),
  };
  return {
    from, to, opening: r.opening, in: r.in, out: { kg: r.out.kg.neg(), value: r.out.value.neg() }, blast: { kg: r.blast.kg.neg(), value: r.blast.value.neg() }, adjust: r.adjust, closing,
    vsBalanceSheet: bsInventory === null || bsInventory === undefined || bsInventory === "" ? null : closing.value.minus(D(bsInventory)),
  };
}

/** Share helper for the headline (e.g. Rp at risk / stock value). */
export const share = (a: Num, b: Num) => div(D(a), D(b));

/** Headline "SKU jual hari ini" (PRD v3 §6): SKUs to sell today / over the age limit, kg and stock value at MA, downgrade risk. */
export function urgentStock(rows: { urgency: string | null; free_fresh_kg: Num | null; free_frozen_kg: Num | null; cost_per_kg_ma: Num | null; downgrade_risk_rp: Num | null }[]): { skus: number; kg: Decimal; value: Decimal; downgradeRisk: Decimal } {
  const u = rows.filter((r) => r.urgency === "jual_hari_ini" || r.urgency === "di_atas_umur");
  const kg = (r: (typeof u)[number]) => D(r.free_fresh_kg ?? 0).plus(D(r.free_frozen_kg ?? 0));
  return {
    skus: u.length, kg: sum(u.map(kg)), value: sum(u.map((r) => kg(r).times(D(r.cost_per_kg_ma ?? 0)))), downgradeRisk: sum(u.map((r) => D(r.downgrade_risk_rp ?? 0))),
  };
}

/** Demand section (PRD v3 §6): PO by status vs forecast vs planned cut, from the demand data mart rows of the week. */
export function demandTotals(rows: { confirmed_kg: Num | null; tentative_kg: Num | null; forecast_kg: Num | null; weighted_kg: Num | null; stock_free_kg: Num | null; net_kg: Num | null }[]): Record<"confirmed" | "tentative" | "forecast" | "weighted" | "stock" | "net", Decimal> {
  const t = (k: keyof (typeof rows)[number]) => sum(rows.map((r) => D(r[k] ?? 0)));
  return { confirmed: t("confirmed_kg"), tentative: t("tentative_kg"), forecast: t("forecast_kg"), weighted: t("weighted_kg"), stock: t("stock_free_kg"), net: t("net_kg") };
}
