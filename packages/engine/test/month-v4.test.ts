/** M4 v4 (PRD v4 §3.2 P1–P14, K3, K5, K9, K11, K12) on the fixtures month-2026-08 and accuracy-2026-08. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
import { addDays } from "../src/dates";
import { weekOutlook, weekPlDaily } from "../src/week-outlook";
import {
  accuracyDays, accuracyV4, bridgeV4, c32, c49, lockBlockers, monthSummaryV4, opexRowsV4, registerOpen, runrateTest, versionDaysV4, vsBudget,
  type RegisterRow, type VersionDayV4,
} from "../src/month-v4";
import { carryForwardFixed, dailyFixed, fixedFreshnessControl, withoutEvents, type FixedCostRow } from "../src/drivers";
import { augustPlan, inp, isWorking, weekResult } from "./month-v4-fixture";

type Golden = {
  status: string; actual: Record<string, string>; forecast: Record<string, string>; outlook: Record<string, string>;
  range: { revenue: string[]; gp: string[] }; po: { revenue: string; kg: string };
  runrate: { revenue_per_day: string; days: string[]; anomalies: { date: string; reason: string }[]; mean_actual_window: string; off_day_factor: string; margin_ref_pct: string };
  daily_revenue: Record<string, string>; share_po: string; by_segment: { segment: string; revenue: string; gp: string }[];
};
const g = loadV3Fixture<Golden>("month-2026-08", "golden-v4.json");
const old = loadV3Fixture<Record<string, unknown>>("month-2026-08", "golden.json");
const jt = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);
const A = augustPlan();

describe("golden month-2026-08 (K4: computed by the engine with K3, K5, K11)", () => {
  it("the revoked v3 targets stay in golden.json only as a record, marked revoked", () => {
    expect(old.revoked_v3_targets).toBeDefined();
    expect(old.targets).toBeUndefined();
    expect(g.status).toContain("diusulkan");
  });
  it("actual 1–26 Aug = O_PnL month to date: revenue 6.385,9 / COGS 6.038,5 / GP 347,4 jt (G5, C49)", () => {
    for (const k of ["revenue", "cogs", "gp", "opex", "nibt"] as const) expect(jt(A.summary.actual[k]), k).toBe(g.actual[k]);
    expect([g.actual.revenue, g.actual.cogs, g.actual.gp]).toEqual(["6385.9", "-6038.5", "347.4"]);
  });
  it("PO 27–29 Aug = 1.067,8 jt, 40.437 kg; 30 Aug (Sunday) nothing; 31 Aug run-rate 310,4 jt (K3)", () => {
    expect(jt(A.plan.poRevenue)).toBe("1067.8");
    expect(A.summary.poKg.toFixed(0)).toBe("40437");
    expect(Object.fromEntries(A.plan.days.map((d) => [d.date, jt(d.revenue)]))).toEqual(g.daily_revenue);
    expect(A.plan.days.map((d) => d.kind)).toEqual(["po", "po", "po", "none", "runrate"]);
    expect(jt(A.plan.runrate.revenue)).toBe("310.4");
    expect(g.runrate.revenue_per_day).toBe("310.4");
  });
  it("forecast 1.378,2 jt; outlook 7.764,1 jt, range 7.626,3–7.901,9; GP P&L margin of the month to date 5,44% on run-rate days", () => {
    expect(jt(A.summary.forecast.revenue)).toBe(g.forecast.revenue);
    expect(jt(A.summary.outlook.revenue)).toBe("7764.1");
    expect([jt(A.summary.range.revenueLow), jt(A.summary.range.revenueHigh)]).toEqual(g.range.revenue);
    expect(A.plan.margin.times(100).toFixed(2)).toBe("5.44");
    for (const k of ["revenue", "cogs", "gp", "opex", "nibt"] as const) {
      expect(jt(A.summary.forecast[k]), `forecast ${k}`).toBe(g.forecast[k]);
      expect(jt(A.summary.outlook[k]), `outlook ${k}`).toBe(g.outlook[k]);
    }
    expect(A.summary.poShare!.toFixed(3)).toBe(g.share_po);
  });
  it("P6 run-rate day: GP = revenue × margin, with no expedition or blasting row on top (the margin already carries them); 31 Aug GP 16,9 jt", () => {
    const d31 = A.plan.rows.filter((r) => r.date === "2026-08-31" && r.forecast !== null);
    const rev = d31.filter((r) => r.pl_line.startsWith("Revenue")).reduce((a, r) => a.plus(r.forecast!), D(0));
    const cogs = d31.filter((r) => r.pl_line.startsWith("COGS") || r.pl_line.startsWith("Other COGS")).reduce((a, r) => a.plus(r.forecast!), D(0));
    expect(jt(rev.plus(cogs))).toBe("16.9");
    expect(d31.some((r) => r.pl_line === "Other COGS - Expedition" || r.pl_line === "COGS - Blasting")).toBe(false);
    // PO days keep the M5 COGS lines (P6: "dikurangi COGS lain (ekspedisi, blasting) dari driver M5")
    expect(A.plan.rows.some((r) => r.date === "2026-08-27" && r.pl_line === "COGS - Blasting" && r.forecast !== null)).toBe(true);
    // Lampiran B.2: GP forecast ≈ −68,0 + 310,4 × 5,4% = −51,2 jt; with the unrounded 5,44% the engine gives −51,0
    expect(jt(A.summary.forecast.gp)).toBe("-51.0");
  });
  it("the revoked 7.712,4 is not reproduced: the engine is 51,7 jt above it and the gap is the K3 run-rate and PO weighting", () => {
    expect(A.summary.outlook.revenue.div(1e6).minus("7712.4").toFixed(1)).toBe("51.7");
  });
  it("by segment: LB main, LB by-product, Trading, Umum add up to the outlook", () => {
    expect(A.summary.bySegment.map((s) => s.segment)).toEqual(["LB main", "LB by-product", "Trading", "Umum"]);
    expect(A.summary.bySegment.reduce((a, s) => a.plus(s.revenue), D(0)).toFixed(2)).toBe(A.summary.outlook.revenue.toFixed(2));
    expect(A.summary.bySegment.reduce((a, s) => a.plus(s.gp), D(0)).toFixed(2)).toBe(A.summary.outlook.gp.toFixed(2));
    expect(A.summary.bySegment.map((s) => ({ segment: s.segment, revenue: jt(s.revenue), gp: jt(s.gp) }))).toEqual(g.by_segment);
  });
});

describe("K12: 25 Aug is a missing day, not a zero", () => {
  it("25 Aug has no revenue row at all (not a 0), its rows are flagged anomaly; the run-rate window drops it", () => {
    const r = A.plan.rows.filter((x) => x.date === "2026-08-25");
    expect(r.filter((x) => x.pl_line.startsWith("Revenue"))).toEqual([]);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.anomaly)).toBe(true);
    expect(A.plan.runrate.anomalies).toEqual([{ date: "2026-08-25", reason: "nol" }]);
    expect(A.plan.runrate.days).not.toContain("2026-08-25");
  });
  it("register: the 25 Aug row is 'belum disepakati' with owner Finance + Sales", () => {
    const a = A.register.find((x) => x.code === "anomaly_2026-08-25")!;
    expect(a.status).toBe("proposed");
    expect(a.owner).toBe("Finance + Sales");
    expect(registerOpen(A.register).map((x) => x.code)).toContain("anomaly_2026-08-25");
  });
});

describe("one number: the week reads the month's rows (§3.4, K17)", () => {
  it("revenue of 24–30 Aug from the month rows = the weekly engine's revenue (journal 589,0 + PO 1.067,8 = 1.656,8 jt)", () => {
    const wk = weekOutlook(A.plan.rows, { weekStart: "2026-08-24", today: "2026-08-27" });
    expect(jt(wk.projection.revenue)).toBe("1656.8");
    const w1 = weekOutlook(weekPlDaily(weekResult), { weekStart: "2026-08-24", today: "2026-08-27" });
    expect(wk.projection.revenue.toFixed(2)).toBe(w1.projection.revenue.toFixed(2));
    expect(wk.actual.revenue.toFixed(2)).toBe(w1.actual.revenue.toFixed(2));
  });
});

describe("C49: Σ pl_daily actual (journal) = P&L month to date, ± Rp 1", () => {
  const pnl = { revenue: "6385876039", cogs: "-6038472784.16", gp: "347403254.84" };
  it("lulus on the fixture; gagal at Rp 2; belum diisi without the P&L", () => {
    expect(c49({ rows: A.plan.rows, pnlMtd: pnl }).status).toBe("LULUS");
    expect(c49({ rows: A.plan.rows, pnlMtd: { ...pnl, gp: "347403256.84" } }).status).toBe("GAGAL");
    expect(c49({ rows: A.plan.rows, pnlMtd: null }).status).toBe("BELUM DIISI");
  });
});

describe("P8, P10, P11: what blocks V1 (K9)", () => {
  const controls = [{ code: "C33", status: "LULUS" }, { code: "C34", status: "LULUS" }, { code: "C49", status: "LULUS" }];
  const agreed = (rows: RegisterRow[]) => rows.map((r) => ({ ...r, status: "agreed" as const, agreed_at: "2026-08-20T10:00:00Z" }));
  it("run-rate 310,4 vs the mean actual 258,7 of the window is +20,0%: outside the 10% tolerance until a reason is in the register", () => {
    expect(A.test[0].deviation!.times(100).toFixed(1)).toBe("20.0");
    expect(A.test[0].outside).toBe(true);
    expect(A.test[0].reasoned).toBe(false);
    expect(runrateTest({ plan: A.plan, tolerance: "0.10", reasons: ["2026-08-25"] })[0].reasoned).toBe(true);
  });
  it("on 27 Aug (after the lock Thursday 20 Aug): blocked by the open register and the run-rate test; nothing else", () => {
    const b = lockBlockers({ month: inp.month, today: "2026-08-27", lockWeek: 3, plan: A.plan, register: A.register, test: A.test, controls });
    expect(b.map((x) => x.code).sort()).toEqual(["P10", "P8"]);
  });
  it("before the lock Thursday: K9; with the reason, the agreed register and green controls: free", () => {
    expect(lockBlockers({ month: inp.month, today: "2026-08-19", lockWeek: 3, plan: A.plan, register: agreed(A.register), test: runrateTest({ plan: A.plan, tolerance: "0.10", reasons: ["2026-08-25"] }), controls }).map((x) => x.code)).toEqual(["K9"]);
    expect(lockBlockers({ month: inp.month, today: "2026-08-20", lockWeek: 3, plan: A.plan, register: agreed(A.register), test: runrateTest({ plan: A.plan, tolerance: "0.10", reasons: ["2026-08-25"] }), controls })).toEqual([]);
  });
  it("controls C33, C34 and C49 must not be GAGAL / BELUM DIISI / STALE; a missing plan cost blocks too (P6)", () => {
    const base = { month: inp.month, today: "2026-08-27", lockWeek: 3, register: agreed(A.register), test: runrateTest({ plan: A.plan, tolerance: "0.10", reasons: ["2026-08-25"] }) };
    expect(lockBlockers({ ...base, plan: A.plan, controls: [{ code: "C49", status: "GAGAL" }, { code: "C33", status: "BELUM DIISI" }, { code: "C34", status: "PERIKSA" }] }).map((x) => x.code).sort()).toEqual(["C33", "C49"]);
    expect(lockBlockers({ ...base, plan: { ...A.plan, costMissingKeys: 2 }, controls }).map((x) => x.code)).toEqual(["P6"]);
  });
});

describe("P12 bridge V1 → V2 for revenue, GP and NIBT (C32)", () => {
  const day = (date: string, kind: VersionDayV4["kind"], revenue: number, cogs: number, opex: number, kg?: number): VersionDayV4 => ({ date, kind, revenue: String(revenue), cogs: String(cogs), opex: String(opex), kg: kg === undefined ? null : String(kg) });
  const v1 = [day("2026-08-27", "po", 1000, -900, -50, 100), day("2026-08-28", "po", 2000, -1800, -50, 200), day("2026-08-29", "runrate", 500, -470, -50), day("2026-08-30", "none", 0, 0, -50), day("2026-08-31", "runrate", 300, -280, -50)];
  const v2 = [day("2026-08-27", "actual", 950, -910, -48), day("2026-08-28", "po", 2640, -2200, -50, 220), day("2026-08-29", "po", 400, -380, -50, 40), day("2026-08-30", "none", 0, 0, -50), day("2026-08-31", "runrate", 360, -336, -55)];
  const b = bridgeV4(v1, v2);
  it("every metric closes: residual 0 (revenue, GP, NIBT)", () => {
    for (const k of ["revenue", "gp", "nibt"] as const) expect(b[k].residual.abs().lte(1), k).toBe(true);
    expect(c32(b).status).toBe("LULUS");
  });
  it("Δ actual = the day that became actual; Δ volume at the V1 price, Δ harga on the V2 kg, Δ cost on the V2 kg, Δ event = PO added and run-rate change", () => {
    expect(b.revenue.dActual.toFixed(0)).toBe("-50");
    // 28 Aug: 200 kg → 220 kg at 10/kg = +200 volume; price 10 → 12 on 220 kg = +440
    expect(b.revenue.dVolume.toFixed(0)).toBe("200");
    expect(b.revenue.dPrice.toFixed(0)).toBe("440");
    // GP: volume at the V1 unit margin (1 per kg), price +440, cost rate (c 9 → 10 on 220 kg) −220
    expect(b.gp.dVolume.toFixed(0)).toBe("20");
    expect(b.gp.dPrice.toFixed(0)).toBe("440");
    expect(b.gp.dCost.toFixed(0)).toBe("-220");
    // 29 Aug: run-rate → PO (−100), 31 Aug: run-rate level 300 → 360 (+60): events −40 in total
    expect(b.revenue.dEvent.toFixed(0)).toBe("-40");
    expect(b.revenue.to.minus(b.revenue.from).toFixed(0)).toBe("550");
  });
  it("unequal months (a day missing from one version) are an event, still closing", () => {
    const short = bridgeV4(v1.slice(0, 4), v2);
    for (const k of ["revenue", "gp", "nibt"] as const) expect(short[k].residual.abs().lte(1)).toBe(true);
    expect(c32(null).status).toBe("BELUM DIISI");
    expect(c32({ ...b, gp: { ...b.gp, residual: D(5) } }).status).toBe("GAGAL");
  });
  it("versionDaysV4 of the August rows: 26 days actual, 27–29 po, 30 none, 31 runrate; the missing 25 Aug counts as actual", () => {
    const vd = versionDaysV4(A.plan.rows, inp.month, inp.cut_off);
    expect(vd).toHaveLength(31);
    expect(vd.slice(0, 26).every((d) => d.kind === "actual")).toBe(true);
    expect(vd.slice(26).map((d) => d.kind)).toEqual(["po", "po", "po", "none", "runrate"]);
    expect(vd[24].revenue).toBe("0.00");
    expect(jt(vd.reduce((a, d) => a.plus(d.revenue), D(0)))).toBe("7764.1");
  });
});

describe("P9 vs budget", () => {
  const out = { ...A.summary.outlook, kg: "100000" };
  const act = { ...A.summary.actual, kg: "80000" };
  it("selisih Rp dan %, butuh per hari = (budget − actual MTD) / hari kerja tersisa", () => {
    const v = vsBudget({ outlook: out, actual: act, remainingWorkingDays: 4, budget: [{ segment: "Total", metric: "revenue", value: "8000000000" }, { segment: "Total", metric: "gp", value: "300000000" }] })!;
    const rev = v.lines.find((l) => l.metric === "revenue")!;
    expect(jt(rev.diff)).toBe("-235.9");
    expect(rev.diffPct!.times(100).toFixed(1)).toBe("-2.9");
    expect(rev.needPerDay!.toFixed(2)).toBe(D("8000000000").minus(A.summary.actual.revenue).div(4).toFixed(2));
    expect(v.split).toBeNull();
  });
  it("with kg in the budget the difference splits into volume, price and margin", () => {
    const v = vsBudget({ outlook: out, actual: act, remainingWorkingDays: 4, budget: [{ segment: "Total", metric: "kg", value: "90000" }, { segment: "Total", metric: "revenue", value: "8000000000" }, { segment: "Total", metric: "gp", value: "300000000" }] })!;
    expect(v.split!.revenueVolume.plus(v.split!.revenuePrice).toFixed(0)).toBe(out.revenue.minus("8000000000").toFixed(0));
    expect(v.split!.gpVolume.plus(v.split!.gpMargin).toFixed(0)).toBe(out.gp.minus("300000000").toFixed(0));
  });
  it("no budget = null (the page says 'budget belum diisi'), never a number", () => {
    expect(vsBudget({ outlook: out, actual: act, remainingWorkingDays: 4, budget: [] })).toBeNull();
  });
});

describe("P13 accuracy against FINAL (fixture accuracy-2026-08)", () => {
  const f = loadV3Fixture<{ final: { revenue: string; gp: string; nibt: string }; v1: { revenue_jt: string; gp_jt: string; actual_mtd_revenue_jt: string }; adjustments: Record<"revenue" | "gp" | "nibt", string> }>("accuracy-2026-08", "inputs.json");
  const gold = loadV3Fixture<{ revenue: Record<string, string>; gp: Record<string, string> }>("accuracy-2026-08", "golden.json");
  const rows = accuracyV4({
    final: f.final, adjustments: f.adjustments,
    versions: [{ version: "V1", revenue: D(f.v1.revenue_jt).times(1e6), gp: D(f.v1.gp_jt).times(1e6), nibt: 0, forecastPart: { revenue: D(f.v1.revenue_jt).minus(f.v1.actual_mtd_revenue_jt).times(1e6) } }],
  });
  const rev = rows.find((r) => r.metric === "revenue")!, gp = rows.find((r) => r.metric === "gp")!;
  it("revenue: V1 7.712,4 vs FINAL 8.361,8 = 649,4 jt below (+8,4% of V1), 49% of the forecast part", () => {
    expect(jt(rev.absError)).toBe(gold.revenue.abs_error_jt);
    expect(rev.pctOfVersion!.toFixed(3)).toBe(gold.revenue.pct_of_version);
    expect(rev.shareOfForecast!.toFixed(2)).toBe(gold.revenue.share_of_forecast_part);
    expect(rev.mape!.toFixed(4)).toBe(gold.revenue.mape);
    expect(rev.bias.lt(0)).toBe(true);
  });
  it("GP: V1 293,4 vs FINAL 306,7 = 13,3 jt; GP and NIBT carry abs error and bias, no MAPE", () => {
    expect(jt(gp.absError)).toBe(gold.gp.abs_error_jt);
    expect(gp.mape).toBeNull();
    expect(rows.find((r) => r.metric === "nibt")!.mape).toBeNull();
  });
  it("before and after the closing adjustments: equal while none is recorded; with the adjustment of the PRD the 'before' error shrinks", () => {
    expect(rev.absErrorPre.toFixed(2)).toBe(rev.absError.toFixed(2));
    const adj = accuracyV4({ final: f.final, adjustments: { revenue: "500000000", gp: "0", nibt: "0" }, versions: [{ version: "V1", revenue: D(f.v1.revenue_jt).times(1e6), gp: 0, nibt: 0 }] }).find((r) => r.metric === "revenue")!;
    expect(jt(adj.absErrorPre)).toBe("149.4");
  });
  it("MAPE is N/A when FINAL is 0", () => {
    expect(accuracyV4({ final: { revenue: "0", gp: "0", nibt: "0" }, adjustments: { revenue: "0", gp: "0", nibt: "0" }, versions: [{ version: "V1", revenue: "10", gp: "1", nibt: "1" }] })[0].mape).toBeNull();
  });
  it("per day: PO day difference splits into kg shipped (at the forecast price) and price (on the shipped kg); run-rate days have no split", () => {
    const ver: VersionDayV4[] = [{ date: "2026-08-27", kind: "po", revenue: "1000", cogs: "-900", opex: "0", kg: "100" }, { date: "2026-08-31", kind: "runrate", revenue: "300", cogs: "-280", opex: "0" }, { date: "2026-08-24", kind: "actual", revenue: "10", cogs: "0", opex: "0" }];
    const d = accuracyDays({ version: ver, actual: [{ date: "2026-08-27", revenue: "1155", kg: "110" }, { date: "2026-08-31", revenue: "0", kg: null }] });
    expect(d.map((x) => [x.date, x.day_kind, x.diff.toFixed(0)])).toEqual([["2026-08-27", "po", "155"], ["2026-08-31", "runrate", "-300"]]);
    expect([d[0].diff_kg!.toFixed(0), d[0].diff_price!.toFixed(0)]).toEqual(["100", "55"]);
    expect(d[1].diff_kg).toBeNull();
  });
});

describe("M5 template 8.3 in the forecast (K6, §3.3)", () => {
  const cut = "2026-08-26";
  const base = { month: "2026-08-01", cutOff: cut, isWorkingDay: isWorking, holidays: [] as string[], kgByDay: new Map<string, ReturnType<typeof D>>() };
  const empty = { fixed: [], runrateActual: [], runrateTable: [], variable: [], events: [] };
  it("fixed: outlook = actual MTD + max(0, nominal − actual MTD), spread over the remaining calendar days; never twice", () => {
    const rows = opexRowsV4({ ...base, input: { ...empty, fixed: [{ pl_line: "Salaries and allowance", scheduled: D(85565549), actual_mtd: D(30000000), day_basis: "calendar", missing: false }] } });
    expect(rows).toHaveLength(5);
    expect(rows.reduce((a, r) => a.plus(r.forecast!), D(0)).toFixed(2)).toBe("-55565549.00");
    expect(rows.every((r) => r.basis === "fixed")).toBe(true);
    const over = opexRowsV4({ ...base, input: { ...empty, fixed: [{ pl_line: "Salaries and allowance", scheduled: D(85565549), actual_mtd: D(90000000), day_basis: "calendar", missing: false }] } });
    expect(over).toEqual([]);
  });
  it("working-day basis spreads over the remaining working days only (30 Aug is a Sunday)", () => {
    const rows = opexRowsV4({ ...base, input: { ...empty, fixed: [{ pl_line: "Rent Expenses", scheduled: D(100), actual_mtd: D(0), day_basis: "working", missing: false }] } });
    expect(rows.map((r) => r.date)).toEqual(["2026-08-27", "2026-08-28", "2026-08-29", "2026-08-31"]);
    expect(rows.reduce((a, r) => a.plus(r.forecast!), D(0)).toFixed(2)).toBe("-100.00");
  });
  it("a fixed line without an amount forecasts nothing (Finance fills it; C33 / C43 flag it)", () => {
    expect(opexRowsV4({ ...base, input: { ...empty, fixed: [{ pl_line: "Rent Expenses", scheduled: D(0), actual_mtd: D(0), day_basis: "calendar", missing: true }] } })).toEqual([]);
  });
  it("run-rate lines = the average actual day of the month (MTD / 26 days), without one-off cost events", () => {
    const input = { ...empty, runrateActual: [{ pl_line: "Office Supplies & Utilities", actual_mtd: D(2600) }] };
    const rows = opexRowsV4({ ...base, input });
    expect(rows.map((r) => r.forecast!.toFixed(0))).toEqual(["-100", "-100", "-100", "-100", "-100"]);
    expect(rows[0].basis).toBe("runrate");
  });
  it("events: past ones are taken out of the average, a future one lands on its own date with basis 'event'", () => {
    const ev = [{ date: "2026-08-10", pl_line: "Maintenance Expenses", amount: "-1000" }, { date: "2026-08-28", pl_line: "Maintenance Expenses", amount: "-500" }];
    expect(withoutEvents({ "Maintenance Expenses": D(1260) }, ev, "2026-08-01", cut)["Maintenance Expenses"].toFixed(0)).toBe("260");
    const rows = opexRowsV4({ ...base, input: { ...empty, runrateActual: [{ pl_line: "Maintenance Expenses", actual_mtd: D(260) }], events: ev } });
    expect(rows.filter((r) => r.basis === "event").map((r) => [r.date, r.forecast!.toFixed(0)])).toEqual([["2026-08-28", "-500"]]);
    expect(rows.filter((r) => r.basis === "runrate").map((r) => r.forecast!.toFixed(0))).toEqual(["-10", "-10", "-10", "-10", "-10"]);
  });
  it("variable lines = Rp/kg × the kg of the PO days; Other Income stays positive", () => {
    const kg = new Map([["2026-08-27", D(1000)], ["2026-08-28", D(500)]]);
    const rows = opexRowsV4({ ...base, kgByDay: kg, input: { ...empty, variable: [{ pl_line: "Other COGS - Expedition", rp_per_kg: "90" }], runrateActual: [{ pl_line: "Other Income", actual_mtd: D(2600) }] } });
    expect(rows.filter((r) => r.basis === "variable").map((r) => [r.date, r.forecast!.toFixed(0)])).toEqual([["2026-08-27", "-90000"], ["2026-08-28", "-45000"]]);
    expect(rows.find((r) => r.pl_line === "Other Income")!.forecast!.toFixed(0)).toBe("100");
  });
  it("dailyFixed on the working-day basis costs nothing on a Sunday; calendar basis divides by the calendar days", () => {
    const r: FixedCostRow = { id: "a", pl_line: "Rent Expenses", description: "sewa", amount_per_month: "3100", start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true };
    expect(dailyFixed([r], "2026-08-30")[0].amount.toFixed(2)).toBe("100.00");
    expect(dailyFixed([{ ...r, day_basis: "working" }], "2026-08-30", isWorking)[0].amount.toFixed(2)).toBe("0.00");
    expect(dailyFixed([{ ...r, day_basis: "working" }], "2026-08-31", isWorking)[0].amount.toFixed(2)).toBe("119.23"); // 3.100 / 26 working days
  });
  it("C43: a fixed line without an input for the running month carries last month's nominal, labelled 'belum diperbarui' (PERIKSA)", () => {
    const gaji: FixedCostRow = { id: "g", code: "gaji", pl_line: "Salaries and allowance", description: "Gaji", amount_per_month: "85565549", start_date: "2026-07-01", end_date: "2026-07-31", amortize: false, prepaid_total: null, active: true };
    const { schedule, carried } = carryForwardFixed([gaji], "2026-08-01");
    expect(carried).toHaveLength(1);
    expect(schedule).toHaveLength(2);
    expect(dailyFixed(schedule, "2026-08-15").length).toBe(1);
    expect(fixedFreshnessControl(carried).status).toBe("PERIKSA");
    // a fresh August row removes the label
    const fresh = carryForwardFixed([gaji, { ...gaji, id: "g2", start_date: "2026-08-01", end_date: "2026-08-31", amount_per_month: "82677332" }], "2026-08-01");
    expect(fresh.carried).toEqual([]);
    expect(fixedFreshnessControl(fresh.carried).status).toBe("LULUS");
    // older than last month: not carried (it ended for a reason)
    expect(carryForwardFixed([{ ...gaji, end_date: "2026-05-31" }], "2026-08-01").carried).toEqual([]);
  });
});

describe("summary helpers", () => {
  it("remaining days after the last actual day, working days without Sundays", () => {
    expect(A.summary.lastActual).toBe("2026-08-26");
    expect(A.summary.remainingDays).toBe(5);
    expect(A.summary.remainingWorkingDays).toBe(4);
    expect(addDays(A.summary.lastActual!, 1)).toBe("2026-08-27");
  });
  it("monthSummaryV4 on an empty month: no share, no division by zero", () => {
    const s = monthSummaryV4([], "2026-08-01", "0.10");
    expect(s.poShare).toBeNull();
    expect(s.actual.revenue.toFixed(0)).toBe("0");
  });
});
