/** PRD v5 §4.1 (K20–K25): costing in four modes, live-bird simulation, revaluation, idle cost, C53 / C54 / C57. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadFixtureWeek, loadV3Fixture } from "../src/fixtures";
import {
  allocateBatch, c53, c54, c57, costingPlRows, costStatusOf, finalLots, idleCostDaily, lowestStatus, needBasisOutputs, planCost, revalueLots, simulateLivebird, tariffPerKgLb,
  type PlanOutput,
} from "../src/costing";
import { isCogsLine } from "../src/monthly";
import { commercialRows } from "../src/commercial";
import { balanceAt, computeLedger, ledgerInputsFromWeek } from "../src/ledger";

type SimInputs = {
  tariff_per_kg_lb: string; prices: number[];
  need: { kg_lb: string; demand: PlanOutput[]; by_products: { key: string; yield: string; priceRef: string | null }[] };
  batch: { kg_lb: string; outputs: PlanOutput[]; extra_value: string };
};
const inp = loadV3Fixture<SimInputs>("costing-sim-2026-08-24", "inputs.json");
const golden = loadV3Fixture<{ need: { rows: { price: string; cogs: string; gp: string; k: string }[]; breakeven: string }; batch: { rows: { price: string; cogs: string; gp: string }[]; breakeven: string } }>("costing-sim-2026-08-24", "golden.json");
const need = () => simulateLivebird({ basis: "need", kgLb: inp.need.kg_lb, outputs: needBasisOutputs({ kgLb: inp.need.kg_lb, demand: inp.need.demand, byProducts: inp.need.by_products }), tariffPerKgLb: inp.tariff_per_kg_lb, prices: inp.prices });
const batch = () => simulateLivebird({ basis: "batch", kgLb: inp.batch.kg_lb, outputs: inp.batch.outputs, extraValue: inp.batch.extra_value, tariffPerKgLb: inp.tariff_per_kg_lb, prices: inp.prices });
const jt = (v: { div(n: number): { toNumber(): number } }) => v.div(1e6).toNumber();
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol + 1e-9);

describe("simulasi live bird (Lampiran B.1, K25)", () => {
  it("tariff of the week = freight 1.000 + maklon 1.600 × (1 − 3%) = 2.552 / kg LB", () => {
    expect(tariffPerKgLb({ freightPerKgLb: "1000", maklonPerKgProcessed: "1600", shrink: "0.03" }).toFixed(0)).toBe("2552");
    expect(D(inp.tariff_per_kg_lb).toFixed(0)).toBe("2552");
  });
  it("need basis: 18.358 kg LB, value 486,7 jt; COGS / GP / k at the four prices of B.1 (±0,1 jt); breakeven 23.960", () => {
    const s = need();
    near(s.kgLb.toNumber(), 18358, 1);
    near(jt(s.value), 486.7, 0.1);
    near(s.breakeven!.toNumber(), 23960, 2);
    const at = (p: number) => s.rows.find((r) => r.price.eq(p))!;
    for (const [p, cogs, gp, k] of [[22000, 450.7, 36.0, 0.926], [23000, 469.1, 17.6, 0.964], [24600, 498.5, -11.8, 1.024], [25000, 505.8, -19.1, 1.039]] as const) {
      near(jt(at(p).cogs), cogs, 0.1); near(jt(at(p).gp), gp, 0.1); near(at(p).k!.toNumber(), k, 0.0015);
    }
    // COGS/kg karkas fresh at 24.600 = k × 36.705 = 37.592 (PRD with rounded kg; ±5 Rp/kg)
    near(at(24600).skus.find((x) => x.key === "RPA|Karkas|Fresh")!.costPerKg!.toNumber(), 37592, 5);
  });
  it("batch basis: 27.219 kg LB, value 633,6 jt; at 24.600 COGS 739,1, GP −105,4 (±0,1 jt; block 2 v1 −105,5); breakeven 20.727 (±2)", () => {
    const s = batch();
    near(s.kgLb.toNumber(), 27219, 1);
    near(jt(s.value), 633.6, 0.1);
    const r = s.rows.find((x) => x.price.eq(24600))!;
    near(jt(r.cogs), 739.1, 0.1); near(jt(r.gp), -105.4, 0.1);
    near(s.breakeven!.toNumber(), 20727, 2);
  });
  it("golden fixture costing-sim-2026-08-24 is what the engine computes", () => {
    const s = need(), b = batch();
    expect(s.rows.map((r) => [r.price.toFixed(0), r.cogs.toFixed(2), r.gp.toFixed(2), r.k!.toFixed(6)])).toEqual(golden.need.rows.map((r) => [r.price, r.cogs, r.gp, r.k]));
    expect(b.rows.map((r) => [r.price.toFixed(0), r.cogs.toFixed(2), r.gp.toFixed(2)])).toEqual(golden.batch.rows.map((r) => [r.price, r.cogs, r.gp]));
    expect(s.breakeven!.toFixed(2)).toBe(golden.need.breakeven);
  });
  it("a SKU without reference price (Lemak fresh) is missing, never 0", () => {
    const row = need().rows[0].skus.find((x) => x.key === "RPA|Lemak|Fresh")!;
    expect(row.priceRef).toBeNull();
    expect(row.costPerKg).toBeNull();
  });
});

describe("planCost rules (§4.1)", () => {
  const outputs = [{ key: "A", kg: "100", priceRef: "30000" }, { key: "B", kg: "50", priceRef: "3000" }];
  it("k = cost pool ÷ value, cost/kg = k × price; breakeven and margin per kg LB", () => {
    const r = planCost({ status: "rencana", kgLb: "200", lbPrice: "10000", tariffPerKgLb: "2500", outputs });
    expect(r.costPool.toFixed(0)).toBe("2500000");
    expect(r.value.toFixed(0)).toBe("3150000");
    expect(r.k!.toFixed(6)).toBe(D(2500000).div(3150000).toFixed(6));
    expect(r.lines[0].costPerKg!.toFixed(2)).toBe(r.k!.times(30000).toFixed(2));
    expect(r.breakeven!.toFixed(0)).toBe("13250");             // 3.150.000 ÷ 200 − 2.500
    expect(r.marginPerKgLb!.toFixed(0)).toBe("3250");
  });
  it("actual freight + fee replace kg LB × tariff (sementara / final); overhead is added to the pool", () => {
    const r = planCost({ status: "sementara", kgLb: "200", lbPrice: "10000", tariffPerKgLb: "2500", directCost: "100000", overhead: "50000", outputs });
    expect(r.costPool.toFixed(0)).toBe("2150000");
    expect(r.breakeven!.toFixed(0)).toBe("15000");             // (3.150.000 − 100.000 − 50.000) ÷ 200
  });
  it("an unpriced SKU is missing and the batch cannot be final; nothing priced → no k", () => {
    const r = planCost({ status: "sementara", kgLb: "200", lbPrice: "10000", tariffPerKgLb: "0", outputs: [...outputs, { key: "C", kg: "5", priceRef: null }] });
    expect(r.missingPrice).toEqual(["C"]);
    expect(r.canBeFinal).toBe(false);
    expect(r.lines[2].costPerKg).toBeNull();
    expect(planCost({ status: "rencana", kgLb: "1", lbPrice: "1", outputs: [{ key: "C", kg: "1", priceRef: null }] }).k).toBeNull();
  });
  it("status of a batch: rencana → estimasi (cut date) → sementara (WP) → final (invoice tied / allocation posted)", () => {
    expect(costStatusOf({ date: "2026-08-28" }, "2026-08-27")).toBe("rencana");
    expect(costStatusOf({ date: "2026-08-26" }, "2026-08-27")).toBe("estimasi");
    expect(costStatusOf({ date: "2026-08-26", wpReceivedAt: "2026-08-27T09:12:00+07:00" }, "2026-08-27")).toBe("sementara");
    expect(costStatusOf({ date: "2026-08-26", wpReceivedAt: "2026-08-27T09:12:00+07:00", invoiceStatus: "tied" }, "2026-08-27")).toBe("final");
    expect(costStatusOf({ date: "2026-08-26", allocationPosted: true }, "2026-08-27")).toBe("final");
    expect(lowestStatus(["final", "sementara", "estimasi"])).toBe("estimasi");
    expect(lowestStatus([])).toBeNull();
  });
  it("allocateBatch carries a status (default final)", () => {
    const r = allocateBatch({ batch: { ref: "B", mode: "maklon" }, outputs: [{ ref: "o", kg: "1", price_ref: "1" }], costLines: [{ component: "LB", amount: "1" }], options: { byProductMethod: "joint" } });
    expect(r.status).toBe("final");
    expect(allocateBatch({ batch: { ref: "B", mode: "maklon" }, outputs: [], costLines: [], options: { byProductMethod: "joint" }, status: "sementara" }).status).toBe("sementara");
  });
});

describe("G9 on the example week: the four modes of batch 126, and C54 on Ceker / Kepala fresh", () => {
  const week = loadFixtureWeek("2026-08-24", "2026-08-27");
  const b = week.batches.find((x) => x.batch_ref === "126/PO/KGR/08/2026")!;
  const price = (k: string) => week.sku_keys.find((s) => s.key === k)?.ref_sell_price ?? null;
  const receipts = week.receipt_lines.filter((r) => r.document_ref === b.batch_ref && r.receipt_source === "Produksi RPA");
  const keyOf = (code: string | null | undefined) => week.item_map.find((i) => i.item_code === code)?.key ?? null;
  const wp: PlanOutput[] = receipts.map((r) => ({ key: r.key_manual ?? keyOf(r.item_code) ?? "?", kg: String(r.kg), priceRef: price(r.key_manual ?? keyOf(r.item_code) ?? "") }));
  const plan = loadV3Fixture<{ yields: { pattern: string; key: string; yield_pct: string }[] }>("plan-2026-08-24", "inputs.json");
  const std = (sku: string) => plan.yields.find((y) => y.pattern === "karkas" && y.key === sku)!.yield_pct;
  const freshShare = D(String(b.output?.karkas_fresh ?? 0)).div(D(String(b.output?.karkas_fresh ?? 0)).plus(D(String(b.output?.karkas_frozen ?? 0))));
  const est: PlanOutput[] = [
    { key: "RPA|Karkas|Fresh", kg: D(String(b.lb_kg)).times(D(std("Karkas"))).times(freshShare).toFixed(2), priceRef: price("RPA|Karkas|Fresh") },
    { key: "RPA|Karkas|Frozen", kg: D(String(b.lb_kg)).times(D(std("Karkas"))).times(D(1).minus(freshShare)).toFixed(2), priceRef: price("RPA|Karkas|Frozen") },
    ...["Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"].map((sku) => ({ key: `RPA|${sku}|Fresh`, kg: D(String(b.lb_kg)).times(D(std(sku))).toFixed(2), priceRef: price(`RPA|${sku}|Fresh`) })),
  ];
  const direct = D(String(b.freight)).plus(D(String(b.maklon))).toFixed(2);
  const modes = {
    rencana: planCost({ status: "rencana", kgLb: String(b.lb_kg), lbPrice: "24600", tariffPerKgLb: "2552", outputs: est }),
    estimasi: planCost({ status: "estimasi", kgLb: String(b.lb_kg), lbPrice: String(b.lb_price), tariffPerKgLb: "2552", outputs: est }),
    sementara: planCost({ status: "sementara", kgLb: String(b.lb_kg), lbPrice: String(b.lb_price), directCost: direct, outputs: wp }),
  };
  const final = allocateBatch({
    batch: { ref: b.batch_ref!, mode: "maklon", lb_kg: String(b.lb_kg) }, status: "final", options: { byProductMethod: "joint" },
    outputs: wp.map((o, i) => ({ ref: `o${i}`, key: o.key, kg: o.kg, price_ref: o.priceRef })),
    costLines: [{ component: "LB", amount: D(String(b.lb_kg)).times(D(String(b.lb_price))).toFixed(2) }, { component: "freight", amount: String(b.freight) }, { component: "maklon", amount: String(b.maklon) }],
  });
  it("every mode prices every SKU with a reference price; sementara and final agree on WP outputs and actual costs", () => {
    for (const m of Object.values(modes)) expect(m.lines.filter((l) => l.priceRef !== null).every((l) => l.costPerKg !== null && l.costPerKg.gt(0))).toBe(true);
    const ceker = (lines: { key: string | null; costPerKg: unknown }[]) => lines.find((l) => l.key === "RPA|Ceker|Fresh")!.costPerKg as { toFixed(n: number): string };
    expect(ceker(final.lines).toFixed(0)).toBe(ceker(modes.sementara.lines).toFixed(0));
    expect(final.diff.abs().lte(1)).toBe(true);
  });
  it("ebe4ad8 (receipt cost) flags Ceker and Kepala fresh; the joint cost of the same batch clears them", () => {
    const receiptCost = receipts.map((r) => ({ key: r.key_manual ?? keyOf(r.item_code) ?? "?", costPerKg: String(r.unit_cost), priceRef: price(r.key_manual ?? keyOf(r.item_code) ?? "") }));
    const before = c54({ rows: receiptCost, ratio: 3 });
    expect(before.status).toBe("PERIKSA");
    // on the batch's receipt cost Usus fresh is above 3 × 1.500 too; Lampiran C names the two the Commercial view shows
    expect(before.keys).toEqual(expect.arrayContaining(["RPA|Ceker|Fresh", "RPA|Kepala|Fresh"]));
    const li = ledgerInputsFromWeek(week);
    const bal = balanceAt(computeLedger(li), "2026-08-26", li.keys, li.params);
    const stock = c54({ rows: bal.perKey.filter((k) => k.key.startsWith("RPA|") && k.form === "fresh").map((k) => ({ key: k.key, costPerKg: k.cost_per_kg_ma?.toFixed(2) ?? null, priceRef: price(k.key) })), ratio: 3 });
    expect(stock.keys.sort()).toEqual(["RPA|Ceker|Fresh", "RPA|Kepala|Fresh"]);
    const after = c54({ rows: modes.sementara.lines.map((l) => ({ key: l.key, costPerKg: l.costPerKg?.toFixed(2) ?? null, priceRef: l.priceRef?.toFixed(0) ?? null })), ratio: 3 });
    expect(after.status).toBe("LULUS");
  });
  it("revaluation example (estimasi → final on 27 Aug): lot_revaluation rows and 'Selisih costing' as revaluation_sold_mode says", () => {
    // the ledger after the posting: batch 126's lots at the M1 joint cost; before it they carried the estimasi cost
    const li = ledgerInputsFromWeek(week);
    const finalCost = new Map(final.lines.filter((l) => l.key && l.costPerKg).map((l) => [l.key!, l.costPerKg!]));
    li.receipts = li.receipts.map((r) => (r.document_ref === b.batch_ref && r.source === "Produksi RPA" && r.key && finalCost.has(r.key) ? { ...r, cost_per_kg_si: finalCost.get(r.key)!.toFixed(4) } : r));
    // the example week sells opening stock first (FIFO): one DO of 26 Aug is allocated to the batch's karkas fresh lot
    // (M3) so the sold part is not empty
    const lot = computeLedger(li).lots.find((l) => l.batch_ref === b.batch_ref && l.key === "RPA|Karkas|Fresh" && !l.planned)!;
    li.sales = [...li.sales, { ref: "DO-REVAL", date: "2026-08-26", status: "Aktual", item_code: lot.item_code, key: "RPA|Karkas|Fresh", kg: "500", document_ref: "DO-REVAL" }];
    li.allocations = [...(li.allocations ?? []), { sales_ref: "DO-REVAL", lot_ref: lot.ref, kg: "500" }];
    const led = computeLedger(li);
    const date = "2026-08-27";
    const kgByLot = new Map(balanceAt(led, date, li.keys, li.params).perLot.map((l) => [l.lot_ref, l.kg]));
    const fb = { batch_ref: b.batch_ref!, finalDate: date, statusFrom: "estimasi" as const, costFromByKey: new Map(modes.estimasi.lines.filter((l) => l.costPerKg).map((l) => [l.key, l.costPerKg!])) };
    const lots = finalLots({ led, date, kgByLot, finals: [fb] });
    expect(lots.length).toBeGreaterThan(0);
    expect(finalLots({ led, date: "2026-08-26", kgByLot, finals: [fb] })).toEqual([]);
    const cogs = revalueLots({ date, mode: "cogs_line", lots });
    const restate = revalueLots({ date, mode: "restate_sale_date", lots });
    // every kg of the batch is revalued once: in stock (lot_revaluation) or sold (P&L)
    for (const r of cogs.rows) expect(r.amount.plus(r.amount_sold).toFixed(2)).toBe(r.cost_to.minus(r.cost_from).times(r.kg_remaining.plus(r.kg_sold)).toFixed(2));
    const sold = cogs.rows.reduce((a, r) => a.plus(r.amount_sold), D(0));
    expect(sold.gt(0)).toBe(true);
    expect(cogs.rows.find((r) => r.lot_ref === lot.ref)!.kg_sold.toFixed(0)).toBe("500");
    expect(cogs.plRows.map((x) => [x.date, x.pl_line])).toEqual([[date, "Selisih costing"]]);
    expect(restate.plRows.map((x) => x.date)).toEqual(["2026-08-26"]);
    expect(cogs.plRows.reduce((a, x) => a.plus(x.amount), D(0)).toFixed(2)).toBe(sold.neg().toFixed(2));
    expect(restate.plRows.reduce((a, x) => a.plus(x.amount), D(0)).toFixed(2)).toBe(sold.neg().toFixed(2));
    expect(restate.plRows.every((x) => x.date <= date)).toBe(true);
    // the kg sold are the ledger's sales out of those lots up to the final date
    const saleKg = led.movements.filter((m) => m.type === "out_sale" && !m.planned && m.date <= date && lots.some((l) => l.lot_ref === m.lot_ref)).reduce((a, m) => a.minus(m.kg), D(0));
    expect(lots.reduce((a, l) => a.plus(D(l.kgSold ?? 0)), D(0)).toFixed(2)).toBe(saleKg.toFixed(2));
  });
});

describe("K22 revaluation (O1 behind revaluation_sold_mode)", () => {
  const lot = { lot_ref: "L1", key: "RPA|Karkas|Fresh", kgIn: "1000", kgRemaining: "400", costFrom: "37000", costTo: "37500", statusFrom: "sementara" as const, statusTo: "final" as const, sales: [{ date: "2026-08-27", kg: "250" }, { date: "2026-08-28", kg: "350" }] };
  it("cogs_line: stock part revalued, sold part as one 'Selisih costing' row on the final date", () => {
    const r = revalueLots({ date: "2026-09-02", mode: "cogs_line", lots: [lot] });
    expect(r.rows[0].amount.toFixed(0)).toBe("200000");
    expect(r.rows[0].amount_sold.toFixed(0)).toBe("300000");
    expect(r.plRows).toEqual([{ date: "2026-09-02", pl_line: "Selisih costing", amount: D(-300000) }]);
  });
  it("restate_sale_date: the sold part on each sale date; no difference → no row", () => {
    const r = revalueLots({ date: "2026-09-02", mode: "restate_sale_date", lots: [lot, { ...lot, lot_ref: "L2", costTo: "37000" }] });
    expect(r.rows.map((x) => x.lot_ref)).toEqual(["L1"]);
    expect(r.plRows.map((p) => [p.date, p.amount.toFixed(0)])).toEqual([["2026-08-27", "-125000"], ["2026-08-28", "-175000"]]);
  });
});

describe("v5 rows of pl_daily_v4", () => {
  it("Selisih costing (event) and idle capacity (fixed) are COGS, actual up to the cut-off and forecast after it", () => {
    const rows = costingPlRows({ cutOff: "2026-09-02", from: "2026-09-01", to: "2026-09-30",
      selisih: [{ date: "2026-09-02", amount: "-300000" }, { date: "2026-08-28", amount: "-1" }, { date: "2026-09-03", amount: "0" }],
      idle: [{ date: "2026-09-02", amount: "-200" }, { date: "2026-09-03", amount: "-150" }, { date: "2026-09-03", amount: "-50" }] });
    expect(rows.map((r) => [r.date, r.pl_line, r.basis, r.segment, r.actual?.toFixed(0) ?? null, r.forecast?.toFixed(0) ?? null])).toEqual([
      ["2026-09-02", "Selisih costing", "event", "LB main", "-300000", null],
      ["2026-09-02", "Biaya kapasitas idle", "fixed", "LB main", "-200", null],
      ["2026-09-03", "Biaya kapasitas idle", "fixed", "LB main", null, "-200"],
    ]);
    expect(isCogsLine("Selisih costing")).toBe(true);
    expect(isCogsLine("Biaya kapasitas idle")).toBe(true);
    expect(isCogsLine("Salary & Wages")).toBe(false);
  });
});

describe("Q63 idle capacity per day", () => {
  it("increment of max(0, basis pro rata − actual to date) × rate; a day above basis gives back what earlier days took", () => {
    const rate = { period_start: "2026-11-01", period_end: "2026-11-04", basis_kg: "40000", rate_per_kg_lb: "100" };
    const act = new Map([["2026-11-01", "8000"], ["2026-11-02", "12000"], ["2026-11-03", "10000"], ["2026-11-04", "10000"]]);
    const r = idleCostDaily({ rate, actualKgLbByDate: act, dates: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"] });
    expect(r.map((x) => x.amount.toFixed(0))).toEqual(["-200000", "200000", "0", "0"]);
    expect(idleCostDaily({ rate: { ...rate, basis_kg: null }, actualKgLbByDate: act, dates: [] })).toEqual([]);
  });
});

describe("C53, C57", () => {
  it("C53: an Aktual batch past H+1 12.00 without WP is BELUM DIISI; a planned batch or one with WP is not", () => {
    const c = c53({ now: "2026-08-27T13:00:00+07:00", batches: [
      { ref: "125", status: "Aktual", dueAt: "2026-08-26T12:00:00+07:00", wpReceivedAt: null },
      { ref: "126", status: "Aktual", dueAt: "2026-08-27T12:00:00+07:00", wpReceivedAt: "2026-08-27T09:12:00+07:00" },
      { ref: "128", status: "Rencana", dueAt: "2026-08-28T12:00:00+07:00", wpReceivedAt: null },
    ] });
    expect(c.status).toBe("BELUM DIISI");
    expect(c.detail).toEqual(["125 (tenggat 2026-08-26 12:00)"]);
  });
  it("C57: a cut date without a decision", () => {
    const c = c57({ cutDates: ["2026-08-27", "2026-08-28"], decisions: [{ date: "2026-08-27" }] });
    expect(c.status).toBe("BELUM DIISI");
    expect(c.dates).toEqual(["2026-08-28"]);
    expect(c57({ cutDates: [], decisions: [] }).status).toBe("LULUS");
  });
});

describe("Commercial on the costing cost (§4.6)", () => {
  const base = { key: "RPA|Ceker|Fresh", group_code: "By-product", form: "fresh" as const, free_kg: "100", oldest_age_days: 1, hours_to_cutoff: 10, cost_per_kg_ma: "15299", cost_per_kg_si: "15468", price_list: "3101", price_frozen: "5000", realized_price_7d: null, storage_per_kg_day: "10" };
  it("v4 rule unchanged without a costing cost", () => {
    const [r] = commercialRows({ date: "2026-08-26", items: [base], urgencyRules: [], floorRules: [], blastCostPerKg: "0" });
    expect(r.price_floor!.toFixed(0)).toBe("15369");            // MA + storage × 7
    expect(r.cost_status).toBeUndefined();
  });
  it("floor = cost (any status), margin on it, status carried, C54 flag when cost > 3 × list", () => {
    const [r] = commercialRows({ date: "2026-08-26", items: [{ ...base, cost_per_kg: "15299", cost_status: "final" }], urgencyRules: [], floorRules: [], blastCostPerKg: "0" });
    expect(r.price_floor!.toFixed(0)).toBe("15299");
    expect(r.cost_status).toBe("final");
    expect(r.cost_check).toBe(true);
    const [j] = commercialRows({ date: "2026-08-26", items: [{ ...base, cost_per_kg: "3176", cost_status: "estimasi" }], urgencyRules: [], floorRules: [], blastCostPerKg: "0" });
    expect(j.price_floor!.toFixed(0)).toBe("3176");
    expect(j.margin_per_kg_list!.toFixed(0)).toBe("-75");
    expect(j.cost_per_kg_ma!.toFixed(0)).toBe("15299");        // the MA column stays the ledger MA
    expect(j.cost_check).toBe(false);
  });
});
