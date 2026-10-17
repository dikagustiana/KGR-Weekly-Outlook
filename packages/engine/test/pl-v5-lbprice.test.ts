/**
 * PRD v5.2-A R67 (F14, Q-v5-25): the cost per kg of a forecast order follows the LB price decided for its cut date.
 * Golden fixtures/pl-v5-lbprice (synthetic, source.json): LB +Rp 1.000/kg → GP forecast of the month decreases by
 * −1.000 × Σ(kg × reference price) ÷ value per kg LB (golden.json, computed by generate.py apart from the engine).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { blendClassCosts, forecastPlanCost, tariffPerKgLb } from "../src/costing";
import { monthPlanV4, monthSummaryV4, runrateActualLines, type OrderV4 } from "../src/month-v4";
import { repoRoot } from "../src/fixtures";
import { augustPlan, HOLIDAYS, inp as aug, isWorking } from "./month-v4-fixture";

const dir = join(repoRoot(), "fixtures", "pl-v5-lbprice");
const read = <T,>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
const f = read<{
  month: string; cut_off: string; tariff: Record<string, string>; yields_std: Record<string, string>; ref_prices: Record<string, string>;
  orders: { date: string; key: string; kg: string; price: string }[]; lb_price_base: string; lb_price_up: string;
}>("inputs.json");
const golden = read<Record<string, string | Record<string, string>>>("golden.json");

const tariff = tariffPerKgLb({ freightPerKgLb: f.tariff.freight_plan_per_kg_lb, maklonPerKgProcessed: f.tariff.maklon_per_kg_processed, shrink: f.tariff.target_shrink });
const outputs = Object.entries(f.yields_std).map(([key, kg]) => ({ key, kg, priceRef: f.ref_prices[key] }));
const costsAt = (lb: string) => forecastPlanCost({ lbPrice: lb, tariffPerKgLb: tariff.toFixed(4), outputs });

/** The month plan with the fixture's forecast orders costed by `cost(key)`; the actual part is the August journal (run-rate), untouched. */
function planWith(cost: (key: string) => string) {
  const orders: OrderV4[] = f.orders.map((o) => ({
    delivery_date: o.date, kg: o.kg, revenue: D(o.kg).times(o.price), cost: D(o.kg).times(cost(o.key)),
    revenue_line: "Revenue - LB Main Product", cogs_line: "COGS - Live Bird", segment: "LB main", costKnown: true,
  }));
  const a = augustPlan();
  const plan = monthPlanV4({
    month: aug.month, cutOff: aug.cut_off, actualRows: a.rows, orders,
    opex: { fixed: [], runrateActual: runrateActualLines({ gl: [], coa: [], from: aug.month, to: aug.cut_off, events: [] }), runrateTable: [], variable: [], events: [] },
    isWorkingDay: isWorking, holidays: HOLIDAYS,
  });
  return monthSummaryV4(plan.rows, aug.month, "0.10", isWorking);
}
// the run-rate days of the forecast do not depend on the order cost, so the difference of the forecast GP of two plans is the orders'
const poGp = (s: ReturnType<typeof planWith>) => s.forecast.gp;

describe("R67 golden pl-v5-lbprice: the plan cost per kg and the forecast GP follow the LB price", () => {
  it("tariff, value per kg LB and the cost per kg of every SKU at the base LB price match the golden (independent decimal arithmetic)", () => {
    expect(tariff.toFixed(4)).toBe(golden.tariff_per_kg_lb);
    const base = costsAt(f.lb_price_base);
    for (const [key, v] of Object.entries(golden.cost_per_kg_base as Record<string, string>)) expect(base.get(key)!.toFixed(2), key).toBe(v);
    const up = costsAt(f.lb_price_up);
    for (const [key, v] of Object.entries(golden.cost_per_kg_up as Record<string, string>)) expect(up.get(key)!.toFixed(2), key).toBe(v);
  });
  it("LB +Rp 1.000/kg: the GP forecast of the month decreases by the golden amount (± Rp 1)", () => {
    const base = costsAt(f.lb_price_base), up = costsAt(f.lb_price_up);
    const sBase = planWith((k) => base.get(k)!.toString()), sUp = planWith((k) => up.get(k)!.toString());
    const delta = poGp(sUp).minus(poGp(sBase));
    expect(delta.minus(D(golden.gp_forecast_delta as string)).abs().lte(1), `${delta.toFixed(2)} vs ${golden.gp_forecast_delta}`).toBe(true);
    expect(delta.lt(0)).toBe(true);
    // the PO-day part: GP of the fixture's orders alone at the base LB price = golden gp_forecast_base
    const baseOrdersGp = f.orders.reduce((acc, o) => acc.plus(D(o.kg).times(D(o.price).minus(base.get(o.key)!))), D(0));
    expect(baseOrdersGp.minus(D(golden.gp_forecast_base as string)).abs().lte("0.01")).toBe(true);
  });
  it("the formula of the golden itself: Δ = −ΔLB × Σ(kg × reference price) ÷ value per kg LB", () => {
    expect(golden.check_delta_formula).toBe(golden.gp_forecast_delta);
  });
  it("control: with the MA cost per kg (no plan cost) the forecast GP does not move with the LB price — what the adapter fixes", () => {
    const ma = (k: string) => ({ "RPA|Karkas|Fresh": "30000", "RPA|Kepala|Fresh": "5000", "RPA|Lemak|Fresh": "4000" } as Record<string, string>)[k] ?? "1";
    expect(poGp(planWith(ma)).toFixed(2)).toBe(poGp(planWith(ma)).toFixed(2));
    const base = costsAt(f.lb_price_base), up = costsAt(f.lb_price_up);
    expect(poGp(planWith((k) => up.get(k)!.toString())).lt(poGp(planWith((k) => base.get(k)!.toString())))).toBe(true);
  });
});

describe("R67 forecastPlanCost / blendClassCosts", () => {
  it("a SKU without a reference price has no plan cost (null), the others are costed", () => {
    const r = forecastPlanCost({ lbPrice: "24000", tariffPerKgLb: "2552", outputs: [{ key: "A", kg: "0.7", priceRef: "36000" }, { key: "B", kg: "0.1", priceRef: null }, { key: "C", kg: "0.1", priceRef: "0" }] });
    expect(r.get("A")!.gt(0)).toBe(true);
    expect(r.get("B")).toBeNull();
    expect(r.get("C")).toBeNull();
  });
  it("one class: its own costs; several classes: averaged by volume × class yield of the key; equal when a volume is missing", () => {
    const yA = new Map([["RPA|Karkas|Fresh", "0.70"]]), yB = new Map([["RPA|Karkas|Fresh", "0.74"]]);
    const cA = new Map([["RPA|Karkas|Fresh", D(100)]]), cB = new Map([["RPA|Karkas|Fresh", D(110)]]);
    expect(blendClassCosts([{ volume: "1000", costs: cA, yields: yA }]).costs.get("RPA|Karkas|Fresh")!.toFixed(2)).toBe("100.00");
    // weights 1000 × 0,70 = 700 and 3000 × 0,74 = 2220 → (700 × 100 + 2220 × 110) ÷ 2920
    const w = blendClassCosts([{ volume: "1000", costs: cA, yields: yA }, { volume: "3000", costs: cB, yields: yB }]);
    expect(w.equalWeights).toBe(false);
    expect(w.costs.get("RPA|Karkas|Fresh")!.toFixed(4)).toBe(D(700 * 100 + 2220 * 110).div(2920).toFixed(4));
    const eq = blendClassCosts([{ volume: null, costs: cA, yields: yA }, { volume: "3000", costs: cB, yields: yB }]);
    expect(eq.equalWeights).toBe(true);
    expect(eq.costs.get("RPA|Karkas|Fresh")!.toFixed(4)).toBe(D(0.7 * 100 + 0.74 * 110).div(1.44).toFixed(4));
    // a class that cannot cost the key leaves the blended cost unknown
    const u = blendClassCosts([{ volume: "1", costs: cA, yields: yA }, { volume: "1", costs: new Map([["RPA|Karkas|Fresh", null]]), yields: yB }]);
    expect(u.costs.get("RPA|Karkas|Fresh")).toBeNull();
  });
});
