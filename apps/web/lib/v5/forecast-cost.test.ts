/**
 * PRD v5.2-A R67 (F14, Q-v5-25) on the web side: the cost per kg of a forecast order is the plan cost of its cut date —
 * the NEWEST decision of the class, the class yield (STD labelled), keys matched as the weekly engine does, reads filtered
 * and paged, a labelled MA fallback. Numbers from fixtures/pl-v5-lbprice (synthetic, golden.json).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { D, ordersV4FromWeek } from "@kgr/engine";
import { repoRoot } from "../../../../packages/engine/src/fixtures";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
const { forecastCostsOf } = await import("./forecast-cost");
const { applyForecastCosts, forecastCostText, normKey } = await import("./forecast-cost-core");

const dir = join(repoRoot(), "fixtures", "pl-v5-lbprice");
const f = JSON.parse(readFileSync(join(dir, "inputs.json"), "utf8")) as { yields_std: Record<string, string>; ref_prices: Record<string, string>; orders: { date: string; key: string; kg: string; price: string }[]; lb_price_base: string; lb_price_up: string };
const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8")) as { cost_per_kg_base: Record<string, string>; cost_per_kg_up: Record<string, string> };

const yieldRows = Object.entries(f.yields_std).map(([key, y]) => ({ weight_class: "STD", cut_pattern: "karkas", key: key.replace(/^RPA\|/, "").replace(/\|Fresh$/, ""), yield_pct: y, effective_from: "2026-01-01" }));
const priceRows = Object.entries(f.ref_prices).map(([key, p]) => ({ week_id: "w35", key, ref_sell_price: p }));
const dec = (date: string, price: string, extra: Record<string, unknown> = {}) => ({ date, weight_class: null, price, volume_kg_lb: null, decided_at: "2026-08-25T09:00:00Z", ...extra });
const rows = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  lb_price_decision: [dec("2026-08-27", f.lb_price_base)], yield_matrix: yieldRows,
  week: [{ id: "w35", week_start: "2026-08-24", week_end: "2026-08-30" }],
  parameter: [{ week_id: "w35", freight_plan_per_kg_lb: "1000", maklon_per_kg_processed: "1600", target_shrink: "0.03" }],
  sku_price: priceRows, price_list_week: [], ...over,
});
const costs = (r: Record<string, Record<string, unknown>[]>) => forecastCostsOf(fakeSb({ rows: r }) as never, "2026-08-27", "2026-08-31");
const KAR = normKey("RPA|Karkas|Fresh");

describe("forecastCostsOf: the plan cost of the cut date", () => {
  it("the cost per kg of each SKU equals the golden at the decided LB price; keys are normalised as the weekly engine does", async () => {
    const c = await costs(rows());
    const day = c.byDate.get("2026-08-27")!;
    expect(KAR).toBe("RPA|KARKAS|FRESH");
    expect(day.get(KAR)!.toFixed(2)).toBe(golden.cost_per_kg_base["RPA|Karkas|Fresh"]);
    for (const [key, v] of Object.entries(golden.cost_per_kg_base)) expect(day.get(normKey(key))!.toFixed(2), key).toBe(v);
    expect(c.reasons.size).toBe(0);
  });
  it("two decisions for the day and class: the NEWEST one counts (rows come newest first), not the oldest", async () => {
    const c = await costs(rows({ lb_price_decision: [dec("2026-08-27", f.lb_price_up, { decided_at: "2026-08-26T09:00:00Z" }), dec("2026-08-27", f.lb_price_base, { decided_at: "2026-08-25T09:00:00Z" })] }));
    expect(c.byDate.get("2026-08-27")!.get(KAR)!.toFixed(2)).toBe(golden.cost_per_kg_up["RPA|Karkas|Fresh"]);
  });
  it("classes decided for the same day are averaged by volume × class yield (a class with its own yield, the others STD)", async () => {
    const kYield = yieldRows.filter((r) => r.key === "Karkas").map((r) => ({ ...r, weight_class: "K", yield_pct: "0.74" }));
    const c = await costs(rows({
      yield_matrix: [...yieldRows, ...kYield],
      lb_price_decision: [dec("2026-08-27", f.lb_price_up, { weight_class: "K", volume_kg_lb: "3000" }), dec("2026-08-27", f.lb_price_base, { weight_class: null, volume_kg_lb: "1000" })],
    }));
    // class K: LB 25.000, karkas yield 0,74 → value per kg LB 26.640 + 1.390 = 28.030, k = (25.000 + 2.552) ÷ 28.030
    // the "all classes" decision: LB 24.000 on the STD yields → value 26.590, k = (24.000 + 2.552) ÷ 26.590; cost of the karkas = k × 36.000
    const cK = (25000 + 2552) / 28030 * 36000, cS = (24000 + 2552) / 26590 * 36000;
    // weights: volume × the class yield of the key: 3.000 × 0,74 and 1.000 × 0,70
    const w = 3000 * 0.74, z = 1000 * 0.70;
    const got = c.byDate.get("2026-08-27")!.get(KAR)!.toNumber();
    expect(got).toBeGreaterThan(Math.min(cK, cS));
    expect(got).toBeLessThan(Math.max(cK, cS));
    expect(got).toBeCloseTo((w * cK + z * cS) / (w + z), 2);
    expect(c.notes.size).toBe(0);
    const eq = await costs(rows({ lb_price_decision: [dec("2026-08-27", f.lb_price_up, { weight_class: "K" }), dec("2026-08-27", f.lb_price_base, { weight_class: null })] }));
    expect(eq.notes.get("2026-08-27")).toContain("kelas dirata-rata sama rata");
  });
  it("no plan cost, with the reason, when the date has no week, no rate, no yield or an empty decided price", async () => {
    expect((await costs(rows({ week: [] }))).reasons.get("2026-08-27")).toBe("minggu belum ada");
    expect((await costs(rows({ parameter: [{ week_id: "w35", freight_plan_per_kg_lb: "1000", maklon_per_kg_processed: null, target_shrink: "0.03" }] }))).reasons.get("2026-08-27")).toBe("tarif freight/maklon belum diisi");
    expect((await costs(rows({ parameter: [] }))).reasons.get("2026-08-27")).toBe("tarif freight/maklon belum diisi");
    const noYield = await costs(rows({ yield_matrix: yieldRows.filter((r) => r.key !== "Lemak") }));
    expect(noYield.reasons.get("2026-08-27")).toBe("yield belum diisi: Lemak");
    expect(noYield.byDate.has("2026-08-27")).toBe(false);
  });
  it("a SKU without a reference price has no cost (it keeps the MA cost), the others are costed", async () => {
    const c = await costs(rows({ sku_price: priceRows.filter((p) => p.key !== "RPA|Lemak|Fresh") }));
    const day = c.byDate.get("2026-08-27")!;
    expect(day.has(normKey("RPA|Lemak|Fresh"))).toBe(false);
    expect(day.has(KAR)).toBe(true);
  });
  it("reads are filtered and paged (K42): parameter / sku_price / price_list by the weeks of the range, the week table by the range", async () => {
    const sb = fakeSb({ rows: rows() });
    await forecastCostsOf(sb as never, "2026-08-27", "2026-08-31");
    for (const c of ["parameter:in", "sku_price:in", "price_list_week:in", "week:lte", "week:gte", "lb_price_decision:gte", "lb_price_decision:lte"]) expect(sb.calls, c).toContain(c);
    // newest decision first, then a unique tie-break
    const ord = sb.args.filter((a) => a.call === "lb_price_decision:order").map((a) => a.args);
    expect(ord).toEqual([["decided_at", { ascending: false }], ["id"]]);
  });
  it("no decision for any date: nothing is read beyond the decisions, the yields and the weeks", async () => {
    const sb = fakeSb({ rows: rows({ lb_price_decision: [] }) });
    const c = await forecastCostsOf(sb as never, "2026-08-27", "2026-08-31");
    expect(c.byDate.size + c.reasons.size).toBe(0);
    expect(sb.calls.some((x) => x.startsWith("parameter:"))).toBe(false);
  });
});

describe("applyForecastCosts: the Order lines of the weekly engine re-costed, the rest left alone and labelled", () => {
  const line = (over: Partial<{ status: string; date: string | null; key: string; kg: string; hpp: string }> = {}) => ({
    status: "Order", date: "2026-08-27", key: "RPA|Karkas|Fresh", kg: D(over.kg ?? "1000"), hpp: D(over.hpp ?? "30000000"), value: D(38000000), segment: "RPA", group: "Karkas", src: { id: "x" }, ...over,
  }) as ReturnType<typeof line> & { status: string; date: string | null; key: string; kg: ReturnType<typeof D>; hpp: ReturnType<typeof D> };
  const range = { from: "2026-08-27", to: "2026-08-31" };
  it("the key of the weekly engine (original case) is found; hpp = cost per kg × kg; the orders then carry that cost", async () => {
    const c = await costs(rows());
    const r = applyForecastCosts([line()], c, range);
    // the golden carries cents per kg: × 1.000 kg within Rp 10
    expect(r.sales[0].hpp.minus(D(golden.cost_per_kg_base["RPA|Karkas|Fresh"]).times(1000)).abs().lt(10)).toBe(true);
    expect(r.label).toMatchObject({ plan: 1, ma: 0 });
    const orders = ordersV4FromWeek(r.sales as never, "2026-08-27", "2026-08-31", () => 1);
    expect(orders[0].cost.toFixed(2)).toBe(r.sales[0].hpp.toFixed(2));
    // and a tentative weight scales it as for any order (the weight is applied after the cost)
    expect(ordersV4FromWeek(r.sales as never, "2026-08-27", "2026-08-31", () => "0.5")[0].cost.toFixed(2)).toBe(r.sales[0].hpp.times("0.5").toFixed(2));
  });
  it("a delivered line, a line outside the range and a trading SKU keep their MA cost; the label counts and names why", async () => {
    const c = await costs(rows());
    const sales = [line({ status: "Aktual" }), line({ date: "2026-08-26" }), line({ key: "Trading|Sayap|Frozen" }), line({ date: "2026-08-28" })];
    const r = applyForecastCosts(sales, c, range);
    expect(r.sales[0].hpp.toFixed(0)).toBe("30000000");
    expect(r.sales[1].hpp.toFixed(0)).toBe("30000000");
    expect(r.sales[2].hpp.toFixed(0)).toBe("30000000");
    expect(r.label.plan).toBe(0 + 0 + 0 + 0); // 28 Aug has no decision either
    expect(r.label.ma).toBe(2);
    expect(r.label.maKeys).toEqual(["Trading|Sayap|Frozen"]);
    expect(r.label.noPlan).toEqual([{ date: "2026-08-28", reason: "belum ada keputusan harga LB" }]);
    expect(forecastCostText(r.label)).toBe("COGS forecast: biaya rencana (planCost kelas, harga LB keputusan) pada 0 baris order, biaya MA pada 2 baris (2026-08-28: belum ada keputusan harga LB; harga acuan kosong atau bukan SKU live bird: Trading|Sayap|Frozen)");
  });
  it("the reason of a date without a plan cost comes from the loader", async () => {
    const c = await costs(rows({ yield_matrix: [] }));
    const r = applyForecastCosts([line()], c, range);
    expect(r.label.noPlan).toEqual([{ date: "2026-08-27", reason: "yield belum diisi: Karkas, Kepala, Ceker, Usus, HJA (Hati/Jantung/Ampela), Lemak" }]);
    expect(r.sales[0].hpp.toFixed(0)).toBe("30000000");
  });
  it("forecastCostText: nothing to say without order lines", () => {
    expect(forecastCostText(null)).toBeNull();
    expect(forecastCostText({ plan: 0, ma: 0, maKeys: [], noPlan: [], notes: [] })).toBeNull();
  });
});
