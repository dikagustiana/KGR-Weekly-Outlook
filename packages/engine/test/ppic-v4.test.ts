/** M3 of PRD v4 (§3.1 P3.1–P3.9, K1, K2) on fixtures/plan-2026-08-24 and synthetic cases. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { headsByPattern, weeklyDemand } from "../src/demand";
import { proposeWeekPlan } from "../src/plan";
import { planVarianceDaily, ppicBlockers, ppicControls, shortfallRows, statForecastWeek, stepGates, daysAheadOf, firstDelivery } from "../src/ppic-v4";
import { planDemand, planGold, planInp, planOrders } from "./plan-fixture";

const near = (a: { minus(b: unknown): { abs(): { lte(n: string): boolean } } }, b: string, tol = planGold.tolerance_kg) => a.minus(D(b)).abs().lte(tol);

describe("golden plan-2026-08-24 (Lampiran B.3, placeholder yields, STD 2,0 kg)", () => {
  const d = planDemand();
  it("the golden is marked provisional until PPIC fills the yields (C42)", () => {
    expect(planGold.placeholder).toBe(true);
    expect(planInp.yields.every((y) => /placeholder/i.test(y.note))).toBe(true);
  });
  it("netting on the delivery date: Karkas Frozen 4.228 kg covered by frozen stock; Karkas fresh 12.307 + n/a 811 = 13.118 kg net (opening fresh is past 48 h on 27 Aug)", () => {
    const row = (k: string) => d.rows.find((r) => r.key === k)!;
    expect(row("RPA|Karkas|Frozen").net_kg.toFixed(0)).toBe("0");
    expect(row("RPA|Karkas|Frozen").stock_free_kg.toFixed(0)).toBe("4228");
    expect(row("RPA|Karkas|Fresh").stock_free_kg.toFixed(0)).toBe("0");
    for (const [u, kg] of Object.entries(planGold.unit_net_kg)) expect(near(d.unitNet.find((x) => x.key === u)!.kg, kg), u).toBe(true);
  });
  it("K1: heads set by the main product only — 9.179 heads (Karkas binding), 18.358 kg LB", () => {
    expect(d.heads.heads).toBe(planGold.heads);
    expect(d.binding).toEqual([planGold.binding]);
    expect(D(d.heads.heads).times(D(planInp.weight_class.avg_kg)).toFixed(0)).toBe(planGold.kg_lb);
    expect(d.rows.filter((r) => r.product_class === "by_product").every((r) => !r.binding)).toBe(true);
  });
  it("by-products: output at 9.179 heads and the shortfall (HJA 1.022, Usus 897, Kepala 842, Ceker 548 ± 1 kg)", () => {
    for (const [u, kg] of Object.entries(planGold.by_product_output_kg)) expect(near(d.shortfalls.find((s) => s.key === u)!.output_kg, kg), `output ${u}`).toBe(true);
    for (const [u, kg] of Object.entries(planGold.by_product_shortfall_kg)) expect(near(d.shortfalls.find((s) => s.key === u)!.shortfall_kg, kg), `shortfall ${u}`).toBe(true);
    for (const [u, k] of Object.entries(planGold.kg_per_head)) {
      const r = d.rows.find((x) => x.unit === u && x.kg_per_head);
      expect(r!.kg_per_head!.toDecimalPlaces(4).toFixed(4), u).toBe(k);
    }
  });
  it("without K1 the by-product Usus would drive 19.778 heads (39.556 kg LB) and ≈ 15.149 kg karkas surplus", () => {
    const all = planDemand({ k1: false });
    expect(all.heads.heads).toBe(planGold.without_k1.heads);
    const p = proposeWeekPlan({ heads: all.heads, unitNet: all.unitNet, yields: planInp.yields, avgLbKg: "2", prices: {}, threshold: "25000000", patternOrder: planInp.pattern_order });
    expect(D(p.plan.head_count).times(2).toFixed(0)).toBe(planGold.without_k1.kg_lb);
    expect(near(p.plan.surplus_kg_by_key.Karkas, planGold.without_k1.karkas_surplus_kg_approx, "1")).toBe(true);
  });
  it("demand_shortfall rows: buy trading when a replacement price exists, else reduce the order", () => {
    const rows = shortfallRows("2026-08-24", d, (u) => (u === "Usus" ? "12000" : null));
    expect(rows.find((r) => r.key === "Usus")!.suggested_action).toBe("buy_trading");
    expect(rows.find((r) => r.key === "Kepala")!.suggested_action).toBe("reduce_order");
  });
  it("eligibility on the first delivery date (27 Aug), 4 days after the Sunday stock date", () => {
    expect(firstDelivery(planOrders(), "2026-08-24")).toBe("2026-08-27");
    expect(daysAheadOf("2026-08-23", "2026-08-27")).toBe(4);
    expect(daysAheadOf("2026-08-23", null)).toBe(1);
  });
  it("the workbook golden is unchanged without isMain: every unit decides heads", () => {
    const h = headsByPattern({ net: [{ key: "A", kg: "100" }, { key: "B", kg: "300" }], yields: [{ pattern: "p", key: "A", yield_pct: "0.5" }, { pattern: "p", key: "B", yield_pct: "0.1" }], avgLbKg: "2" });
    expect(h.heads).toBe(1500);
    expect(h.byProducts).toEqual([]);
  });
});

describe("K2: Sales forecast wins over the statistical one; statistical = beyond the PO", () => {
  it("a key with a Sales line ignores its stat line; a key with only stat keeps it, weighted 50%", () => {
    const r = weeklyDemand({
      orders: [], weights: { tentative: "0.7", forecast: "0.5" }, weekStart: "2026-09-07",
      forecasts: [
        { week_start: "2026-09-07", key: "A", kg: "100", source: "sales" }, { week_start: "2026-09-07", key: "A", kg: "500", source: "stat" },
        { week_start: "2026-09-07", key: "B", kg: "200", source: "stat" },
      ],
    });
    expect(r.find((x) => x.key === "A")!.forecast_kg.toFixed(0)).toBe("100");
    expect(r.find((x) => x.key === "A")!.source_forecast).toBe("sales");
    expect(r.find((x) => x.key === "B")!.weighted_kg.toFixed(0)).toBe("100");
    expect(r.find((x) => x.key === "B")!.source_forecast).toBe("stat");
  });
  it("rate over Normal working days only (stockout days out), × 6 working days, minus the open PO; < 20 days of history = no line", () => {
    const sales = [] as { date: string; key: string; kg: string }[];
    const days: string[] = [];
    for (let i = 0; i < 28; i++) { const d = new Date(Date.UTC(2026, 7, 3 + i)).toISOString().slice(0, 10); if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) days.push(d); }
    for (const d of days) sales.push({ date: d, key: "A", kg: "100" });
    const stock = new Set(days.slice(0, 2)); // two stockout days with 0 sales
    const s = statForecastWeek({
      sales: sales.filter((x) => !stock.has(x.date)), from: days[0], to: days[days.length - 1], isWorkingDay: (d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0,
      stockout: (_k, d) => stock.has(d), weekStart: "2026-09-07", poKg: new Map([["A", D(250)]]),
    });
    expect(s.rates[0].avgDaily.toFixed(0)).toBe("100");
    expect(s.lines).toEqual([{ week_start: "2026-09-07", key: "A", kg: "350.00", source: "stat" }]);
    const short = statForecastWeek({ sales: sales.slice(0, 5), from: days[0], to: days[4], isWorkingDay: () => true, stockout: () => false, weekStart: "2026-09-07", poKg: new Map() });
    expect(short.lines).toEqual([]);
  });
});

describe("controls C41, C42, C44, C46, C47 and what they block (§6.4)", () => {
  const d = planDemand();
  const base = {
    weekStart: "2026-08-24", demand: d, buyPrice: () => null, yieldNotes: planInp.yields.map((y) => y.note),
    surplus: [{ key: "Karkas", kg: "0", fresh: null, frozen: null }], planDates: ["2026-08-26", "2026-08-27"], capacity: () => null,
    historyDays: new Map([["RPA|Sayap|Fresh", 24]]), forecastKeys: new Set<string>(),
  };
  const c = ppicControls(base);
  const st = (code: string) => c.find((x) => x.code === code)!.status;
  it("on the fixture: C41 PERIKSA (4 by-products short), C42 BELUM DIISI (placeholder), C44 BELUM DIISI, C46 LULUS (no surplus), C47 BELUM DIISI (no capacity)", () => {
    expect([st("C41"), st("C42"), st("C44"), st("C46"), st("C47")]).toEqual(["PERIKSA", "BELUM DIISI", "BELUM DIISI", "LULUS", "BELUM DIISI"]);
    expect(c.find((x) => x.code === "C41")!.detail).toHaveLength(4);
  });
  it("save is refused only by STALE (C45); approve needs C46; copy to batch needs C42, C45, C46, C47 LULUS", () => {
    const all = [...c, { code: "C45", status: "LULUS" as const, action: "" }];
    expect(ppicBlockers(all, "save")).toEqual([]);
    expect(ppicBlockers(all, "approve")).toEqual([]);
    expect(ppicBlockers(all, "copy").map((b) => b.code)).toEqual(["C42", "C47"]);
    expect(ppicBlockers([...c, { code: "C45", status: "STALE" as const, action: "x" }], "save").map((b) => b.code)).toEqual(["C45"]);
    const priced = ppicControls({ ...base, surplus: [{ key: "Karkas", kg: "100", fresh: "36000", frozen: null }] });
    expect(ppicBlockers([...priced, { code: "C45", status: "LULUS" as const }], "approve").map((b) => b.code)).toEqual(["C46"]);
  });
  it("step gates: step 2 opens when step 1 is LULUS or PERIKSA with a reason; step 3 waits for C42 and C46", () => {
    const ctl = [...c, { code: "C45", status: "LULUS" as const }];
    expect(stepGates(ctl).map((s) => s.open)).toEqual([true, false, false, false]);
    expect(stepGates(ctl).find((s) => s.step === 2)!.blockedBy).toEqual(["C41", "C44"]);
    const withReason = stepGates(ctl.map((x) => (x.code === "C44" ? { ...x, status: "LULUS" as const } : x)), ["C41"]);
    expect(withReason.map((s) => s.open)).toEqual([true, true, false, false]);
    expect(withReason.find((s) => s.step === 3)!.blockedBy).toEqual(["C42"]);
  });
});

describe("P3.7 actual vs plan per unit per day", () => {
  it("variance = actual − target; heads actual vs planned; a side without data stays null", () => {
    const v = planVarianceDaily({
      planDays: [{ date: "2026-08-26", head_count: 3000, target_kg_by_key: { Karkas: "4287.60", Usus: "253.75" } }],
      actualOutput: [{ date: "2026-08-26", unit: "Karkas", kg: "4100" }, { date: "2026-08-26", unit: "Karkas", kg: "50" }, { date: "2026-08-27", unit: "Kepala", kg: "80" }],
      actualHeads: [{ date: "2026-08-26", heads: 2950 }], from: "2026-08-26", to: "2026-08-27",
    });
    const k = v.find((r) => r.date === "2026-08-26" && r.key === "Karkas")!;
    expect([k.planned_kg!.toFixed(2), k.actual_kg!.toFixed(2), k.variance_kg!.toFixed(2), k.planned_heads, k.actual_heads]).toEqual(["4287.60", "4150.00", "-137.60", 3000, 2950]);
    const u = v.find((r) => r.key === "Usus")!;
    expect([u.actual_kg, u.variance_kg]).toEqual([null, null]);
    const kp = v.find((r) => r.date === "2026-08-27")!;
    expect([kp.key, kp.planned_kg, kp.planned_heads]).toEqual(["Kepala", null, null]);
  });
});
