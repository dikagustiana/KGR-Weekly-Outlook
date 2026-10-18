/** M7 commercial view (PRD v3 §4.8, §8 M7): urgency Q18, price floor, holding loss, downgrade risk, ranking, controls, scorecard. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadFixtureWeek } from "../src/fixtures";
import { balanceAt, computeLedger, ledgerInputsFromWeek } from "../src/ledger";
import { belowFloor, commercialControls, guardOrders, commercialRows, priceFloor, realizedPrice, scorecard, urgency, type CommercialInput, type UrgencyRule } from "../src/commercial";

const Q18: UrgencyRule[] = [
  { form: "fresh", age_from: 0, age_to: 0, status: "aman" }, { form: "fresh", age_from: 1, age_to: null, status: "jual_hari_ini" },
  { form: "frozen", age_from: 0, age_to: 21, status: "aman" }, { form: "frozen", age_from: 22, age_to: 30, status: "jual_minggu_ini" },
  { form: "frozen", age_from: 31, age_to: null, status: "di_atas_umur" },
];
const item = (o: Partial<CommercialInput>): CommercialInput => ({
  key: "K|Fresh", group_code: "KARKAS", form: "fresh", free_kg: "100", oldest_age_days: 0, hours_to_cutoff: 48, cost_per_kg_ma: "30000", cost_per_kg_si: "29000",
  price_list: "36000", price_frozen: "32000", realized_price_7d: "35000", storage_per_kg_day: "50", ...o,
});

describe("commercial rules", () => {
  it("urgency Q18: fresh > 24 h = jual hari ini; frozen > 21 days = jual minggu ini; > 30 = di atas batas umur", () => {
    expect([urgency(Q18, 0, "fresh"), urgency(Q18, 1, "fresh"), urgency(Q18, 21, "frozen"), urgency(Q18, 22, "frozen"), urgency(Q18, 31, "frozen"), urgency(Q18, null, "frozen")])
      .toEqual(["aman", "jual_hari_ini", "aman", "jual_minggu_ini", "di_atas_umur", "aman"]);
  });
  it("price floor = MA + markup of the most specific rule; default storage × 7 + blast cost", () => {
    const rules = [{ key: null, group_code: "KARKAS", markup_rp_per_kg: "500", markup_pct: "0", effective_from: "2026-01-01" }, { key: "K|Fresh", group_code: null, markup_rp_per_kg: "0", markup_pct: "0.05", effective_from: "2026-09-01" }];
    expect(priceFloor({ key: "K|Fresh", group_code: "KARKAS", costPerKgMa: "30000", rules, date: "2026-08-26", storagePerKgDay: "50", blastCostPerKg: "700" })!.toFixed(0)).toBe("30500");
    expect(priceFloor({ key: "K|Fresh", group_code: "KARKAS", costPerKgMa: "30000", rules, date: "2026-09-02", storagePerKgDay: "50", blastCostPerKg: "700" })!.toFixed(0)).toBe("31500");
    expect(priceFloor({ key: "X", group_code: null, costPerKgMa: "30000", rules: [], date: "2026-09-02", storagePerKgDay: "50", blastCostPerKg: "700" })!.toFixed(0)).toBe("31050");
    expect(priceFloor({ key: "X", group_code: null, costPerKgMa: null, rules: [], date: "2026-09-02", storagePerKgDay: "50", blastCostPerKg: "700" })).toBeNull();
  });
  it("holding loss, downgrade risk (fresh only), margins; ranking: urgency first, then priority; it changes when the age changes", () => {
    const a = item({ key: "A|Fresh", oldest_age_days: 0 });
    const b = item({ key: "B|Frozen", form: "frozen", oldest_age_days: 10, price_frozen: null, free_kg: "1000" });
    const r1 = commercialRows({ date: "2026-08-26", items: [a, b], urgencyRules: Q18, floorRules: [], blastCostPerKg: "0" });
    const ra = r1.find((r) => r.key === "A|Fresh")!;
    expect([ra.holding_loss_per_day.toFixed(0), ra.downgrade_risk_rp.toFixed(0), ra.margin_per_kg_list!.toFixed(0), ra.margin_per_kg_realized!.toFixed(0)]).toEqual(["5000", "400000", "6000", "5000"]);
    expect(ra.priority_score.toFixed(0)).toBe("205000"); // 5.000 + 400.000 / (48 h / 24)
    expect(r1.map((r) => r.key)).toEqual(["A|Fresh", "B|Frozen"]);
    const r2 = commercialRows({ date: "2026-08-26", items: [a, { ...b, oldest_age_days: 35 }], urgencyRules: Q18, floorRules: [], blastCostPerKg: "0" });
    expect(r2.map((r) => [r.key, r.urgency, r.rank])).toEqual([["B|Frozen", "di_atas_umur", 1], ["A|Fresh", "aman", 2]]);
    expect(commercialRows({ date: "2026-08-26", items: [item({ free_kg: "0" })], urgencyRules: Q18, floorRules: [], blastCostPerKg: "0" })).toEqual([]);
  });
  it("realised price = Σ value / Σ kg; below the floor → approver by the limit (Q19: Rp 500/kg)", () => {
    expect(realizedPrice([{ key: "K", kg: "10", price: "100" }, { key: "K", kg: "30", price: "200" }]).get("K")!.toFixed(0)).toBe("175");
    expect(belowFloor({ price: "30000", floor: "30400", kg: "100", limitRpPerKg: "500" })).toMatchObject({ below: true, approver: "commercial_lead" });
    expect(belowFloor({ price: "30000", floor: "30600", kg: "100", limitRpPerKg: "500" }).approver).toBe("finance");
    expect(belowFloor({ price: "31000", floor: "30600", kg: "100", limitRpPerKg: "500" }).below).toBe(false);
    expect(belowFloor({ price: "30000", floor: "30600", kg: "100", limitRpPerKg: "500" }).total.toFixed(0)).toBe("60000");
  });
  it("C38 under floor without approval, C39 jual hari ini without order today, C40 reps without assignment", () => {
    const rows = commercialRows({ date: "2026-08-26", items: [item({ oldest_age_days: 2 }), item({ key: "Z|Fresh", oldest_age_days: 2, ordered_today_kg: "5" })], urgencyRules: Q18, floorRules: [], blastCostPerKg: "0" });
    const c = commercialControls({ belowFloorUnapproved: [{ ref: "abcdef123", key: "K|Fresh", rpPerKg: D(300) }], rows, reps: ["Budi", "Sari", ""], assigned: ["budi"] });
    expect(c.map((x) => [x.code, x.status, x.detail.length])).toEqual([["C38", "GAGAL", 1], ["C39", "PERIKSA", 1], ["C40", "BELUM DIISI", 1]]);
    expect(c[2].detail).toEqual(["Sari"]);
  });
  it("scorecard per rep: target vs actual, frozen unsold, forecast error, discounts", () => {
    const s = scorecard({
      targets: [{ sales_rep: "Budi", target_kg: "1000", target_rp: "30000000" }], actuals: [{ sales_rep: "Budi", kg: "800", value: "24000000" }, { sales_rep: "Sari", kg: "100", value: "3000000" }],
      forecasts: [{ sales_rep: "Budi", kg: "1000" }], blasts: [{ sales_rep: "Budi", kg: "50", rp_downgrade: "200000" }], discounts: [{ sales_rep: "Budi", total_below: "30000" }],
    });
    expect(s.map((r) => [r.sales_rep, r.pct?.toFixed(2) ?? null, r.forecast_mape?.toFixed(2) ?? null, r.kg_to_frozen_unsold.toFixed(0), r.discount_count])).toEqual([["Budi", "0.80", "0.20", "50", 1], ["Sari", null, null, "0", 0]]);
  });
});

describe("R64: a missing price / cost is not 0", () => {
  it("scorecard: a blast without downgrade (no price) makes the rep's Rp downgrade unknown (null), the kg still count; a rep without blasts has 0 (nothing frozen)", () => {
    const base = { targets: [], actuals: [], forecasts: [], discounts: [] };
    const s = scorecard({ ...base, blasts: [{ sales_rep: "Budi", kg: "50", rp_downgrade: "200000" }, { sales_rep: "Budi", kg: "30", rp_downgrade: null }, { sales_rep: "Sari", kg: "10", rp_downgrade: "5000" }] });
    const by = Object.fromEntries(s.map((r) => [r.sales_rep, r]));
    expect(by.Budi.rp_downgrade).toBeNull();
    expect(by.Budi.kg_to_frozen_unsold.toFixed(0)).toBe("80");
    expect(by.Sari.rp_downgrade!.toFixed(0)).toBe("5000");
  });
  it("default floor (no rule): without the blast cost per kg it is unknown, not storage only; a rule still applies", () => {
    const f = (blastCostPerKg: string | null, rules: Parameters<typeof priceFloor>[0]["rules"] = []) => priceFloor({ key: "K|Fresh", group_code: null, costPerKgMa: "30000", rules, date: "2026-08-26", storagePerKgDay: "10", blastCostPerKg });
    expect(f(null)).toBeNull();
    expect(f("500")!.toFixed(0)).toBe("30570");
    expect(f(null, [{ key: "K|Fresh", group_code: null, markup_rp_per_kg: "300", markup_pct: "0", effective_from: "2026-01-01" }])!.toFixed(0)).toBe("30300");
  });
});

describe("order guard (PRD v3 §8 M7: order < price floor refused without approval)", () => {
  const floors = new Map([["K|Fresh", "30500"]]);
  const line = { key: "K|Fresh", customer: "PT A", price: "30000", kg: "100" };
  it("under the floor without approval → refused, one pending request (lead ≤ Rp 500/kg)", () => {
    const g = guardOrders({ lines: [line, { ...line }], floors, requests: [], limitRpPerKg: "500" });
    expect(g.refused.length).toBe(2);
    expect(g.refused[0].approver).toBe("commercial_lead");
    expect(g.newRequests.map((r) => [r.key, r.rp_per_kg_below.toFixed(0), r.total_below.toFixed(0)])).toEqual([["K|Fresh", "500", "50000"]]);
  });
  it("approved request covers one line (same customer, price ≥ requested, kg ≤ approved); a pending one does not", () => {
    const req = [{ id: "a1", key: "K|Fresh", customer: "PT A", requested_price: "30000", kg: "100", status: "approved" }, { id: "p1", key: "K|Fresh", customer: "PT B", requested_price: "30000", kg: "100", status: "pending" }];
    const g = guardOrders({ lines: [line, { ...line, customer: "PT B" }, { ...line, kg: "150" }], floors, requests: req, limitRpPerKg: "500" });
    expect(g.covered).toEqual(["a1"]);
    expect(g.refused.map((r) => r.line.customer + "/" + r.line.kg)).toEqual(["PT B/100", "PT A/150"]);
    expect(g.newRequests.map((r) => r.customer + "/" + r.kg.toFixed(0))).toEqual(["PT A/150"]);
    expect(guardOrders({ lines: [{ ...line, price: "30600" }], floors, requests: [], limitRpPerKg: "500" }).refused).toEqual([]);
    expect(guardOrders({ lines: [{ ...line, price: "29000" }], floors, requests: [], limitRpPerKg: "500" }).refused[0].approver).toBe("finance");
  });
});

describe("example week (ledger 26 Aug): commercial view per SKU", () => {
  const w = loadFixtureWeek("2026-08-24");
  const inp = ledgerInputsFromWeek(w);
  const b = balanceAt(computeLedger(inp), "2026-08-26", inp.keys, inp.params);
  const price = new Map(w.sku_keys.map((k) => [k.key, k.ref_sell_price]));
  const rows = commercialRows({
    date: "2026-08-26", urgencyRules: Q18, floorRules: [], blastCostPerKg: "0",
    items: b.perKey.map((k) => ({ key: k.key, group_code: k.group_code, form: k.form === "fresh" ? "fresh" as const : "frozen" as const, free_kg: k.free_kg, oldest_age_days: k.oldest_age_days, hours_to_cutoff: null,
      cost_per_kg_ma: k.cost_per_kg_ma, cost_per_kg_si: k.cost_per_kg_si, price_list: price.get(k.key) ?? null, price_frozen: price.get(k.key.replace("|Fresh", "|Frozen")) ?? null, realized_price_7d: null, storage_per_kg_day: null })),
  });
  it("one row per key with free stock, ranks 1…n, urgent statuses first; fresh downgrade risk only on fresh keys", () => {
    expect(rows.length).toBe(b.perKey.filter((k) => D(k.free_kg).gt(0)).length);
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
    const order = ["di_atas_umur", "jual_hari_ini", "jual_minggu_ini", "aman"];
    for (let i = 1; i < rows.length; i++) expect(order.indexOf(rows[i].urgency)).toBeGreaterThanOrEqual(order.indexOf(rows[i - 1].urgency));
    expect(rows.filter((r) => r.form === "frozen").every((r) => r.downgrade_risk_rp.isZero())).toBe(true);
    expect(rows.some((r) => r.urgency === "di_atas_umur")).toBe(true);
  });
});
