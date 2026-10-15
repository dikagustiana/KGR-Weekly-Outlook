/** M3 golden (PRD v3 §8): KGR_Demand_Forecast.xlsx — 7.051 heads, BLD binding, profit Base 70,8 jt. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
import { SCENARIOS, demandRate, eligibleFree, forecastDaily, headsByPattern, weekDemand, netDemand, toHeads, weeklyDemand, type ForecastConfig, type Scenario } from "../src/demand";
import { planningControls } from "../src/controls-v3";
import { dailyPlan, demandByDay, jointEconomics, mixParts, planBatchRow, proposeWeekPlan, splitHeadsByDay, weeklyPlan } from "../src/plan";

type In = {
  products: { sku: string; name: string; sell_price: string; frozen_capable: boolean; frozen_price_factor: string; tier: string }[];
  yield: { part: string; sellable: boolean; yield_pct: string }[];
  sales_history: { date: string; sku: string; kg: string; flag: string }[];
  live_bird: Record<string, string>;
  seasonality: Record<string, string>;
  overrides: { date: string; uplift: string }[];
  tiers: Record<string, { bear: string; bull: string }>;
  mev: Record<Scenario, string>;
  wow_trend: Record<string, string>;
  forecast_days: string[];
  scenario_weights: Record<Scenario, string>;
};
const inp = loadV3Fixture<In>("demand-2026-09", "inputs.json");
const g = loadV3Fixture<Record<string, string | null>>("demand-2026-09", "golden.json");
const skus = inp.products.map((p) => p.sku);
const cfg: ForecastConfig = {
  days: inp.forecast_days, seasonality: inp.seasonality, overrides: inp.overrides, tiers: inp.tiers,
  skuTier: Object.fromEntries(inp.products.map((p) => [p.sku, p.tier])), mev: inp.mev,
  trendMode: inp.live_bird.trend_mode, trendClamp: inp.live_bird.trend_clamp, wowTrend: inp.wow_trend,
};
const rates = demandRate(inp.sales_history, skus);
const fc = forecastDaily(rates, cfg);
const total = (sc: Scenario) => Object.fromEntries(fc.filter((r) => r.scenario === sc).map((r) => [r.sku, r.total]));
const kgPerHead = (sku: string) => D(inp.yield.find((y) => y.part === sku)!.yield_pct).times(D(inp.live_bird.avg_weight_kg));
const near = (a: { toNumber(): number } | number, b: string | null | undefined, tol = 1e-6) => expect(Math.abs((typeof a === "number" ? a : a.toNumber()) - Number(b))).toBeLessThanOrEqual(tol);

describe("demand golden — O_Demand_Rate / O_Demand_Forecast", () => {
  it("censored demand rate: average of Normal days only (stockout days excluded)", () => {
    rates.forEach((r, i) => {
      near(r.avgDaily, g[`O_Demand_Rate!C${4 + i}`], 1e-9);
      expect(String(r.days)).toBe(g[`O_Demand_Rate!D${4 + i}`]);
      expect(String(r.stockoutDays)).toBe(g[`O_Demand_Rate!E${4 + i}`]);
    });
    expect(rates[0].stockoutDays).toBe(2);
  });

  it("daily forecast per SKU × scenario (ROUND 0,1 kg) and 7-day totals: every cell of D7:K30", () => {
    const cols = ["D", "E", "F", "G", "H", "I", "J"];
    let n = 0;
    skus.forEach((sku, si) => SCENARIOS.forEach((sc, ci) => {
      const row = 7 + si * 3 + ci;
      const f = fc.find((x) => x.sku === sku && x.scenario === sc)!;
      cols.forEach((c, di) => { near(f.days[di], g[`O_Demand_Forecast!${c}${row}`], 1e-9); n++; });
      near(f.total, g[`O_Demand_Forecast!K${row}`], 1e-9);
    }));
    expect(n).toBe(8 * 3 * 7);
  });
});

describe("optimizer golden — O_Optimizer / B_Purchase_Plan", () => {
  const heads = (sc: Scenario) => toHeads({ net: skus.map((sku) => ({ key: sku, kg: total(sc)[sku] })), yieldPct: (k) => inp.yield.find((y) => y.part === k)?.yield_pct ?? null, avgLbKg: inp.live_bird.avg_weight_kg });
  const base = heads("base");

  it("implied heads per SKU per scenario (G6:I13); binding cut BLD; 7.051 heads", () => {
    for (const [col, sc] of [["G", "bear"], ["H", "base"], ["I", "bull"]] as const) {
      heads(sc).rows.forEach((r, i) => near(r.heads, g[`O_Optimizer!${col}${6 + i}`], 1e-9));
    }
    expect(base.binding).toBe("BLD");
    expect(g["O_Optimizer!B16"]).toBe("Boneless Dada (fillet)");
    near(base.maxHeads, g["O_Optimizer!B17"], 1e-9);
    near(base.minHeads, g["O_Optimizer!B18"], 1e-9);
    expect(base.heads).toBe(7051);
    expect(String(base.heads)).toBe(g["O_Optimizer!B20"]);
    expect(Number(inp.live_bird.cut_capacity_per_day) * Number(inp.live_bird.window_days)).toBe(Number(g["O_Optimizer!B19"]));
  });

  it("one cut pattern (the workbook's I_Yield): headsByPattern = toHeads, 7.051 heads, BLD binding", () => {
    const r = headsByPattern({
      net: skus.map((sku) => ({ key: sku, kg: total("base")[sku] })),
      yields: inp.yield.filter((y) => y.sellable).map((y) => ({ pattern: "boneless", key: y.part, yield_pct: y.yield_pct })),
      avgLbKg: inp.live_bird.avg_weight_kg,
    });
    expect(r.heads).toBe(Number(g["O_Optimizer!B20"]));
    expect(r.patterns[0].binding).toBe("BLD");
    expect(r.topUps).toEqual([]);
  });

  const econ = jointEconomics({
    heads: base.heads,
    parts: inp.products.map((p) => ({ sku: p.sku, kgPerHead: kgPerHead(p.sku), price: p.sell_price, frozenCapable: p.frozen_capable, frozenFactor: p.frozen_price_factor })),
    demand: { bear: total("bear"), base: total("base"), bull: total("bull") },
    handlingPerKg: inp.live_bird.frozen_handling_per_kg, salvagePerKg: inp.live_bird.salvage_per_kg,
    costPerHead: D(inp.live_bird.avg_weight_kg).times(D(inp.live_bird.price_per_kg)).plus(D(inp.live_bird.cut_cost_per_head)),
    freezerCapacityKg: inp.live_bird.freezer_capacity_kg, weights: inp.scenario_weights,
  });

  it("app flow on the workbook's base demand: weekDemand → 7.051 heads, BLD binding; plan surplus = O_Optimizer surplus", () => {
    const orders = skus.map((sku) => ({ ref: sku, key: `RPA|${sku}|Fresh`, delivery_date: "2026-06-23", demand_status: "Confirmed", kg: total("base")[sku].toFixed(1) }));
    const yields = inp.yield.filter((y) => y.sellable).map((y) => ({ pattern: "boneless", key: y.part, yield_pct: y.yield_pct }));
    const r = weekDemand({
      weekStart: "2026-06-22", orders, forecasts: [], weights: { tentative: "0.7", forecast: "0.5" }, freeLots: [], daysAhead: 1,
      windows: { freshHours: () => 48, frozenDays: () => 30 }, substitutions: [], unitOf: (k) => k.split("|")[1] ?? null, yields, avgLbKg: inp.live_bird.avg_weight_kg,
    });
    expect(r.heads.heads).toBe(7051);
    expect(r.binding).toEqual(["BLD"]);
    expect(r.rows.find((x) => x.key === "RPA|BLD|Fresh")!.binding).toBe(true);
    const p = proposeWeekPlan({ heads: r.heads, unitNet: r.unitNet, yields, avgLbKg: inp.live_bird.avg_weight_kg, prices: {}, threshold: "25000000" });
    expect(p.plan.head_count).toBe(7051);
    expect(p.patternMix).toEqual({ boneless: 7051 });
    inp.products.forEach((pr, i) => near(p.plan.surplus_kg_by_key[pr.sku], g[`O_Optimizer!F${24 + i}`], 1e-6));
    const days = demandByDay({ orders, forecasts: [], weights: { tentative: "0.7", forecast: "0.5" }, weekStart: "2026-06-22", isCut: () => true });
    expect(splitHeadsByDay({ weekHeads: 7051, weekStart: "2026-06-22", ...days })).toEqual([{ delivery_date: "2026-06-23", heads: 7051 }]);
  });

  it("economics per SKU at N = 7.051 (C24:M31) and totals (row 32)", () => {
    econ.rows.forEach((r, i) => {
      const row = 24 + i;
      near(r.supply, g[`O_Optimizer!C${row}`], 1e-6); near(r.sold, g[`O_Optimizer!E${row}`], 1e-6); near(r.surplus, g[`O_Optimizer!F${row}`], 1e-6);
      near(r.shortfall, g[`O_Optimizer!G${row}`], 1e-6); near(r.fill, g[`O_Optimizer!H${row}`], 1e-9);
      near(r.surplusValue, g[`O_Optimizer!J${row}`], 1e-3); near(r.revenue, g[`O_Optimizer!K${row}`], 1e-3);
      near(r.contribution.bear, g[`O_Optimizer!L${row}`], 1e-3); near(r.contribution.bull, g[`O_Optimizer!M${row}`], 1e-3);
    });
    near(econ.sold, g["O_Optimizer!E32"], 1e-6); near(econ.surplus, g["O_Optimizer!F32"], 1e-6);
    near(econ.surplusValue, g["O_Optimizer!J32"], 1e-3); near(econ.revenue, g["O_Optimizer!K32"], 1e-3);
  });

  it("profit Bear / Base / Bull and expected (B34:B40): Base Rp 70,8 jt", () => {
    near(econ.cost, g["O_Optimizer!B34"], 1e-6);
    near(econ.profit.bear, g["O_Optimizer!B35"], 1e-3);
    near(econ.profit.base, g["O_Optimizer!B36"], 1e-3);
    near(econ.profit.bull, g["O_Optimizer!B37"], 1e-3);
    near(econ.expectedProfit, g["O_Optimizer!B40"], 1e-3);
    expect(econ.profit.base.div(1e6).toFixed(1)).toBe("70.8");
    near(econ.surplusToFreeze, g["O_Optimizer!B42"], 1e-6);
    expect(econ.freezerOk ? "OK" : "OVER").toBe(g["O_Optimizer!B44"]);
    near(D(base.heads).div(7), g["B_Purchase_Plan!B6"], 1e-9);
  });
});

describe("demand rules (app flow)", () => {
  it("weekly demand: open PO kg by status and delivery week, weighted (Q20 70% / 50%)", () => {
    const w = weeklyDemand({
      weekStart: "2026-09-07", weights: { tentative: "0.7", forecast: "0.5" },
      orders: [
        { ref: "a", key: "K", delivery_date: "2026-09-08", demand_status: "Confirmed", kg: "100", fulfilled_kg: "30" },
        { ref: "b", key: "K", delivery_date: "2026-09-13", demand_status: "Tentative", kg: "100" },
        { ref: "c", key: "K", delivery_date: "2026-09-14", demand_status: "Confirmed", kg: "999" },
        { ref: "d", key: "K", delivery_date: null, demand_status: "Confirmed", kg: "999" },
      ],
      forecasts: [{ week_start: "2026-09-07", key: "K", kg: "40" }, { week_start: "2026-09-14", key: "K", kg: "1" }],
    });
    expect(w).toHaveLength(1);
    expect([w[0].confirmed_kg, w[0].tentative_kg, w[0].forecast_kg, w[0].weighted_kg].map((x) => x.toFixed(0))).toEqual(["70", "100", "40", "160"]);
  });

  it("netting: own eligible free stock first, then substitutes by priority within max %", () => {
    const free = eligibleFree([
      { key: "F", form: "fresh", free_kg: "50", age_days: 1 }, { key: "F", form: "fresh", free_kg: "20", age_days: 2 },
      { key: "Z", form: "frozen", free_kg: "100", age_days: 10 }, { key: "Z", form: "frozen", free_kg: "100", age_days: 40 },
    ], 0, { freshHours: () => 48, frozenDays: () => 30 });
    expect(free.get("F")!.toFixed(0)).toBe("70");
    expect(free.get("Z")!.toFixed(0)).toBe("100");
    expect(eligibleFree([{ key: "F", form: "fresh", free_kg: "50", age_days: 1 }], 2, { freshHours: () => 48, frozenDays: () => 30 }).size).toBe(0);
    const n = netDemand({ demand: [{ key: "F", kg: "200" }], free, substitutions: [{ key_demand: "F", key_substitute: "Z", priority: 1, max_pct: "0.25" }] });
    expect([n[0].stock_used_kg, n[0].substituted_kg, n[0].net_kg].map((x) => x.toFixed(0))).toEqual(["70", "50", "80"]);
    expect(netDemand({ demand: [{ key: "F", kg: "10" }], free: new Map() })[0].net_kg.toFixed(0)).toBe("10");
  });

  it("heads: ceil of the binding cut; keys without a yield are not cut", () => {
    const h = toHeads({ net: [{ key: "A", kg: "100" }, { key: "B", kg: "10" }, { key: "T", kg: "999" }], yieldPct: (k) => (k === "A" ? "0.18" : k === "B" ? "0.03" : null), avgLbKg: "2" });
    // A: 100 / (0,18 × 2) = 277,8 heads; B: 10 / 0,06 = 166,7 → A binds, ceil = 278
    expect(h.binding).toBe("A");
    expect(h.heads).toBe(278);
    expect(h.rows.map((r) => r.key)).toEqual(["A", "B"]);
  });

  it("weekly plan: committed supply raises heads, capacity caps them; surplus downgrade needs approval above the threshold (Q10)", () => {
    const parts = [{ key: "A", kgPerHead: "0.36", demandKg: "300", priceFresh: "55000", priceFrozen: "49500" }];
    const p = weeklyPlan({ headsNeeded: 834, supplyCommittedHeads: 1000, capacityHeads: 10500, parts, threshold: "25000000" });
    expect(p.head_count).toBe(1000);
    expect(p.surplus_kg_by_key.A.toFixed(0)).toBe("60");
    expect(p.rp_downgrade.toFixed(0)).toBe("330000");
    expect(p.needsApproval).toBe(false);
    const big = weeklyPlan({ headsNeeded: 100000, capacityHeads: 10500, parts: [{ ...parts[0], demandKg: "0" }], threshold: "1000000" });
    expect(big.head_count).toBe(10500);
    expect(big.cappedByCapacity).toBe(true);
    expect(big.shortHeads).toBe(89500);
    expect(big.needsApproval).toBe(true);
  });

  it("daily plan: cut on delivery − lead time; over capacity / supply moves to the day before", () => {
    const r = dailyPlan({ weekStart: "2026-09-07", leadTimeDays: 1, weekHeads: 2500, needs: [{ delivery_date: "2026-09-10", heads: 2000 }, { delivery_date: "2026-09-08", heads: 500 }],
      limits: [{ date: "2026-09-09", cut_capacity_head: 1500 }, { date: "2026-09-08", lb_supply_heads: 400 }] });
    const by = Object.fromEntries(r.rows.map((x) => [x.date, x.head_count]));
    expect(by["2026-09-09"]).toBe(1500);
    expect(by["2026-09-08"]).toBe(400);
    expect(by["2026-09-07"]).toBe(600);
    expect(r.unplaced).toBe(0);
    expect(r.rows.find((x) => x.date === "2026-09-09")!.limited_by).toBe("capacity");
  });

  it("heads by cut pattern: exclusive SKUs set each pattern, shared by-products top up the highest-yield pattern", () => {
    const yields = [
      { pattern: "karkas", key: "Karkas", yield_pct: "0.7" }, { pattern: "karkas", key: "Kepala", yield_pct: "0.05" },
      { pattern: "boneless", key: "BLD", yield_pct: "0.2" }, { pattern: "boneless", key: "Kepala", yield_pct: "0.03" },
    ];
    // Karkas 1.400 kg / (2 × 0,7) = 1.000 heads; BLD 400 / (2 × 0,2) = 1.000 heads; Kepala supply 1.000×0,1 + 1.000×0,06 = 160 kg
    const r = headsByPattern({ net: [{ key: "Karkas", kg: "1400" }, { key: "BLD", kg: "400" }, { key: "Kepala", kg: "100" }, { key: "Trading", kg: "50" }], yields, avgLbKg: "2", order: ["karkas", "boneless"] });
    expect(r.patterns.map((p) => [p.pattern, p.heads, p.binding])).toEqual([["karkas", 1000, "Karkas"], ["boneless", 1000, "BLD"]]);
    expect(r.heads).toBe(2000);
    expect(r.topUps).toEqual([]);
    expect(r.notCut).toEqual(["Trading"]);
    // Kepala 260 kg: short 100 kg → karkas (yield 0,05 > 0,03): ceil(100 / 0,1) = 1.000 extra heads
    const t = headsByPattern({ net: [{ key: "Karkas", kg: "1400" }, { key: "BLD", kg: "400" }, { key: "Kepala", kg: "260" }], yields, avgLbKg: "2", order: ["karkas", "boneless"] });
    expect(t.topUps.map((u) => [u.key, u.pattern, u.short_kg.toFixed(0), u.heads])).toEqual([["Kepala", "karkas", "100", 1000]]);
    expect(t.heads).toBe(3000);
    // only by-products demanded: heads go to the best pattern
    const o = headsByPattern({ net: [{ key: "Kepala", kg: "10" }], yields, avgLbKg: "2" });
    expect(o.patterns.find((p) => p.pattern === "karkas")!.heads).toBe(100);
    expect(o.heads).toBe(100);
  });

  it("controls C28–C31: late confirmed PO, over-allocation, heads over capacity, blast without lot_to", () => {
    const c = planningControls({
      today: "2026-09-10",
      orders: [
        { ref: "a", key: "K", delivery_date: "2026-09-08", demand_status: "Confirmed", kg: "100", fulfilled_kg: "40" },
        { ref: "b", key: "K", delivery_date: "2026-09-08", demand_status: "Tentative", kg: "100", fulfilled_kg: "0" },
        { ref: "c", key: "K", delivery_date: "2026-09-12", demand_status: "Confirmed", kg: "100", fulfilled_kg: "0" },
      ],
      allocated: [{ sales_ref: "a", kg: "70", line_kg: "100" }, { sales_ref: "c", kg: "120", line_kg: "100" }],
      planDays: [{ date: "2026-09-09", head_count: 1600, capacity: 1500 }, { date: "2026-09-10", head_count: 100, capacity: null }],
      blasts: [{ ref: "x", lot_ref_to: null }, { ref: "y", lot_ref_to: "blast:y" }],
    });
    const by = Object.fromEntries(c.map((x) => [x.code, x]));
    expect(by.C28.status).toBe("PERIKSA");
    expect(by.C29.status).toBe("GAGAL");
    expect(by.C30.status).toBe("GAGAL");
    expect(by.C31.status).toBe("GAGAL");
    const ok = planningControls({ today: "2026-09-10", orders: [], allocated: [], planDays: [], blasts: [] });
    expect(ok.map((x) => x.status)).toEqual(["BELUM DIISI", "LULUS", "BELUM DIISI", "LULUS"]);
  });

  it("plan parts from a pattern mix; heads split per delivery day; plan day → v1 planned batch", () => {
    const parts = mixParts({
      patterns: [{ pattern: "karkas", heads: 750 }, { pattern: "boneless", heads: 250 }],
      yields: [{ pattern: "karkas", key: "Kepala", yield_pct: "0.04" }, { pattern: "boneless", key: "Kepala", yield_pct: "0.08" }, { pattern: "boneless", key: "BLD", yield_pct: "0.2" }],
      avgLbKg: "2", demand: [{ key: "BLD", kg: "90" }], prices: { BLD: { fresh: "55000", frozen: "49500" } },
    });
    // Kepala: 0,75 × 2 × 0,04 + 0,25 × 2 × 0,08 = 0,1 kg/head; BLD: 0,25 × 2 × 0,2 = 0,1
    expect(parts.map((p) => [p.key, D(p.kgPerHead).toFixed(4), D(p.demandKg).toFixed(0)])).toEqual([["BLD", "0.1000", "90"], ["Kepala", "0.1000", "0"]]);
    const wp = weeklyPlan({ headsNeeded: 1000, parts, threshold: "25000000" });
    expect(wp.surplus_kg_by_key.BLD.toFixed(0)).toBe("10");
    expect(wp.rp_downgrade.toFixed(0)).toBe("55000");
    const days = splitHeadsByDay({ weekHeads: 1000, weekStart: "2026-09-07", orderKgByDay: { "2026-09-08": "300", "2026-09-10": "300" }, forecastKg: "0" });
    expect(days).toEqual([{ delivery_date: "2026-09-08", heads: 500 }, { delivery_date: "2026-09-10", heads: 500 }]);
    const even = splitHeadsByDay({ weekHeads: 10, weekStart: "2026-09-07", orderKgByDay: {}, forecastKg: "70" });
    expect(even.reduce((a, d) => a + d.heads, 0)).toBe(10);
    expect(even.map((d) => d.heads)).toEqual([2, 2, 2, 1, 1, 1, 1]);
    const b = planBatchRow({ date: "2026-09-09", heads: 1000, avgLbKg: "2", lbPrice: "19000", shrink: "0.03", freightPerKgLb: "1000", maklonPerKgProcessed: "1600",
      yields: { karkas: "0.7367", kepala: "0.0467", ceker: "0.0294", usus: "0.0436", hja: "0.056", lemak: "0.0034" } });
    expect(b).toMatchObject({ lb_kg: "2000.00", processed_kg: "1940.00", freight: "2000000.00", maklon: "3104000.00", out_karkas_fresh: "1429.20", out_kepala: "90.60" });
  });
});
