/** PRD v5 §4.7 (K29–K31, C55, G11) on fixtures/month-2026-08: Lampiran B.2 from the engine, ±0,1 jt. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { c55, cumulativeSeries, fixedAllMissing, fixedEstimateRows, fixedNominals, plTable, plTotalsV5, plWeeks, solvencyNibtV5, FIXED_LINES_K29 } from "../src/pl-v5";
import { solvency } from "../src/cash";
import { lockBlockers, monthSummaryV4, totalsV4 } from "../src/month-v4";
import { plRowsFromMart, plRowsToMart } from "../src/week-outlook";
import { augustPlan, inp } from "./month-v4-fixture";

import { JULY, SCHEDULE } from "./pl-v5-inputs";

const a = augustPlan();
const nominals = fixedNominals({ month: inp.month, schedule: SCHEDULE, lastFinal: JULY });
const fixed = fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals, rows: a.plan.rows });
const rows = [...a.plan.rows, ...fixed];
const jt = (v: { div(n: number): { toNumber(): number } } | null) => (v === null ? NaN : v.div(1e6).toNumber());
const near = (a: number, b: number, tol = 0.1) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol + 1e-9);

describe("K29 fixed costs not journaled yet", () => {
  it("August nominal: depreciation from the schedule 10,4 + salary 52,2 and interest 24,4 from July FINAL = 87,0 jt; 2,806 jt per calendar day", () => {
    expect(nominals.map((n) => [n.pl_line, n.source, n.nominal!.div(1e6).toFixed(1)])).toEqual([
      ["Depreciation & amortisation", "jadwal", "10.4"], ["Salaries and allowance", "estimasi bulan lalu", "52.2"], ["Interest Expense", "estimasi bulan lalu", "24.4"],
    ]);
    const total = nominals.reduce((s, n) => s.plus(n.nominal!), D(0));
    near(jt(total), 87.0);
    // 87,02 ÷ 31 = 2,807; PRD divides the rounded 87,0 (2,806)
    near(jt(total.div(31)), 2.806, 0.002);
    // rents are not in force in August (Sep / Nov); without any schedule the K29 list is used
    expect(fixedNominals({ month: inp.month, schedule: [], lastFinal: JULY }).map((n) => n.pl_line)).toEqual(FIXED_LINES_K29);
  });
  it("rows per day: −73,0 actual 1–26, −14,0 forecast 27–31; the month never below the nominal and never twice", () => {
    const t = { a: plTotalsV5(fixed, (r) => r.actual ?? D(0)).fixed, f: plTotalsV5(fixed, (r) => r.forecast ?? D(0)).fixed };
    near(jt(t.a), -73.0); near(jt(t.f), -14.0);
    expect(fixed.every((r) => r.basis === "fixed_estimate" && r.segment === "Umum")).toBe(true);
    // a salary of 85,6 booked on 25 Aug: the line's estimate stops (outlook = max(nominal, journal)), never negative per month
    const booked = [...a.plan.rows, { date: "2026-08-25", segment: "Umum" as const, pl_line: "Salaries and allowance", basis: "journal" as const, actual: D(-85565549), forecast: null, kg: null, anomaly: false }];
    const sal = fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals: nominals.filter((n) => n.pl_line === "Salaries and allowance"), rows: booked });
    expect(plTotalsV5(sal).fixed.toFixed(2)).toBe("0.00");
    // a salary of 30 booked: the estimate carries the 22,2 still missing
    const part = [...a.plan.rows, { ...booked[booked.length - 1], actual: D(-30000000) }];
    near(jt(plTotalsV5(fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals: nominals.filter((n) => n.pl_line === "Salaries and allowance"), rows: part })).fixed), -22.2, 0.05);
  });
  it("v4 totals stay on the journal (K29 rows are skipped by totalsV4 and plRowsFromMart)", () => {
    expect(totalsV4(rows, "actual").nibt.toFixed(2)).toBe(totalsV4(a.plan.rows, "actual").nibt.toFixed(2));
    expect(monthSummaryV4(rows, inp.month, "0.10").outlook.nibt.toFixed(2)).toBe(a.summary.outlook.nibt.toFixed(2));
    const mart = plRowsToMart(rows) as Parameters<typeof plRowsFromMart>[0];
    expect(plRowsFromMart(mart).length).toBe(a.plan.rows.length);
    expect(plRowsFromMart(mart, { fixedEstimate: true }).length).toBe(rows.length);
  });
  it("C55 PERIKSA while a line uses last month's estimate; it holds V1; the Finance schedule clears it", () => {
    const c = c55({ month: inp.month, nominals });
    expect(c.status).toBe("PERIKSA");
    expect(c.detail[0]).toContain("Salaries and allowance: estimasi bulan lalu (FINAL 2026-07)");
    const b = lockBlockers({ month: inp.month, today: "2026-08-27", lockWeek: 3, plan: a.plan, register: [], test: [], controls: [c] });
    expect(b.map((x) => x.code)).toContain("C55");
    const filled = SCHEDULE.map((r) => (r.code === "GAJI" ? { ...r, amount_per_month: "85565549" } : r.code === "BUNGA" ? { ...r, amount_per_month: "31911111" } : r));
    expect(c55({ month: inp.month, nominals: fixedNominals({ month: inp.month, schedule: filled, lastFinal: JULY }) }).status).toBe("LULUS");
  });
});

describe("PRD v5.1 K51: the fixed lines per line, a missing nominal stays missing", () => {
  const onlyDepr = SCHEDULE.filter((r) => r.code === "DEPRESIASI");
  it("schedule with depreciation only: salary, interest and rent still come from the July FINAL", () => {
    const n = fixedNominals({ month: inp.month, schedule: onlyDepr, lastFinal: JULY });
    expect(n.map((x) => [x.pl_line, x.source, x.nominal?.div(1e6).toFixed(1) ?? null])).toEqual([
      ["Depreciation & amortisation", "jadwal", "10.4"], ["Salaries and allowance", "estimasi bulan lalu", "52.2"],
      ["Interest Expense", "estimasi bulan lalu", "24.4"], ["Rent Expenses", "estimasi bulan lalu", "3.3"],
    ]);
  });
  it("without a FINAL month: the lines without schedule are null ('belum ada'), not 0; C55 names them", () => {
    const n = fixedNominals({ month: inp.month, schedule: onlyDepr, lastFinal: null });
    expect(n.filter((x) => x.source === "belum ada").map((x) => [x.pl_line, x.nominal])).toEqual([["Salaries and allowance", null], ["Interest Expense", null], ["Rent Expenses", null]]);
    const c = c55({ month: inp.month, nominals: n });
    expect(c.status).toBe("PERIKSA");
    expect(c.detail).toContain("Salaries and allowance: belum ada nominal");
    // the depreciation still makes its rows; the missing lines make none (no Rp 0 rows)
    const r = fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals: n, rows: a.plan.rows });
    expect(new Set(r.map((x) => x.pl_line))).toEqual(new Set(["Depreciation & amortisation"]));
    expect(fixedAllMissing(n)).toBe(false);
  });
  it("no nominal at all: the table writes 'Beban tetap' and 'NIBT setelah beban tetap' as unknown", () => {
    const n = fixedNominals({ month: inp.month, schedule: [], lastFinal: null });
    expect(n.every((x) => x.nominal === null)).toBe(true);
    const t = plTable("rr", inp.month, { rows: a.plan.rows, cutOff: inp.cut_off, nominals: n });
    expect(t.fixedMissing).toBe(true);
    for (const key of ["fixed", "nibt_after", "nibt_pct"] as const) expect(t.rows.find((x) => x.key === key)!.values.every((v) => v === null), key).toBe(true);
    expect(t.rows.find((x) => x.key === "nibt")!.values.some((v) => v !== null)).toBe(true);
  });
});

describe("PRD v5.1 K52: the solvency on NIBT after fixed costs", () => {
  it("August: −7,8 jt (NIBT 79,2 − fixed 87,0); equity 702,6 jt → 89,6 months; v4 NIBT 79,2 would read 'profit'", () => {
    const mart = plRowsFromMart(plRowsToMart(rows) as Parameters<typeof plRowsFromMart>[0], { fixedEstimate: true });
    const nibt = solvencyNibtV5(mart, fixedAllMissing(nominals))!;
    near(jt(nibt), -7.8);
    // the mart rounds every row to 2 decimals: ± Rp 1 against the engine rows
    expect(nibt.minus(plTotalsV5(rows).nibtAfter).abs().lte(1)).toBe(true);
    const equity = D("702600000");
    const s = solvency({ equity, paidInCapital: D("5000000000"), affiliatePayable: D(0), affiliateReceivable: D(0), nibtMonth: nibt });
    expect(s.basis_nibt!.toFixed(2)).toBe(nibt.toFixed(2));
    expect(s.months_to_negative_equity!.toFixed(2)).toBe(equity.div(nibt.neg()).toFixed(2));
    expect(s.months_to_negative_equity!.toFixed(1)).toBe("89.6");
    // v4 (flag off): NIBT without the fixed costs is a profit, no months
    expect(solvency({ equity, paidInCapital: D("5000000000"), affiliatePayable: D(0), affiliateReceivable: D(0), nibtMonth: a.summary.outlook.nibt }).months_to_negative_equity).toBeNull();
  });
  it("no fixed nominal at all: NIBT unknown (null), not the NIBT without fixed costs", () => {
    const none = fixedNominals({ month: inp.month, schedule: [], lastFinal: null });
    expect(solvencyNibtV5(a.plan.rows, fixedAllMissing(none))).toBeNull();
    const s = solvency({ equity: D(1), paidInCapital: D(1), affiliatePayable: D(0), affiliateReceivable: D(0), nibtMonth: null });
    expect([s.months_to_negative_equity, s.basis_nibt]).toEqual([null, null]);
  });
});

describe("K30 plTable on August (Lampiran B.2, ±0,1 jt)", () => {
  const val = (t: ReturnType<typeof plTable>, key: string, col: number) => jt(t.rows.find((r) => r.key === key)!.values[col]);
  it("Actual vs run-rate: actual 1–26 · PO + run-rate 27–31 · outlook", () => {
    const t = plTable("rr", inp.month, { rows, cutOff: inp.cut_off });
    expect(t.columns.map((c) => [c.id, c.from, c.to])).toEqual([["actual", "2026-08-01", "2026-08-26"], ["forecast", "2026-08-27", "2026-08-31"], ["outlook", "2026-08-01", "2026-08-31"], ["share", null, null], ["budget", null, null]]);
    const B2: Record<string, [number, number, number]> = {
      revenue: [6385.9, 1378.2, 7764.1], cogs: [-6038.5, -1429.2, -7467.7], gp: [347.4, -51.0, 296.4], opex: [-182.2, -35.0, -217.2],
      nibt: [165.3, -86.1, 79.2], fixed: [-73.0, -14.0, -87.0], nibt_after: [92.3, -100.1, -7.8],
    };
    for (const [k, v] of Object.entries(B2)) v.forEach((x, i) => near(val(t, k, i), x));
    near(t.rows.find((r) => r.key === "gp_pct")!.values[2]!.times(100).toNumber(), 3.8, 0.05);
    // without a budget the budget column is empty, never 0
    expect(t.rows.every((r) => r.values[4] === null)).toBe(true);
  });
  it("Per minggu: 1–2 · 3–9 · 10–16 · 17–23 · 24–30 · 31 · Agustus; Σ weeks = month", () => {
    const t = plTable("wk", inp.month, { rows, cutOff: inp.cut_off, highlight: "2026-08-27" });
    expect(plWeeks(inp.month).map((w) => `${Number(w.from.slice(8))}–${Number(w.to.slice(8))}`)).toEqual(["1–2", "3–9", "10–16", "17–23", "24–30", "31–31"]);
    expect(t.columns.map((c) => c.kind)).toEqual(["actual", "actual", "actual", "actual", "mixed", "forecast", "total"]);
    expect(t.columns.find((c) => c.current)!.from).toBe("2026-08-24");
    const B2: Record<string, number[]> = {
      revenue: [809.0, 1278.9, 2136.7, 1572.3, 1656.8, 310.4, 7764.1], cogs: [-649.1, -1276.0, -1948.3, -1576.5, -1724.3, -293.5, -7467.7],
      gp: [159.9, 2.9, 188.4, -4.2, -67.5, 16.9, 296.4], opex: [-2.0, -27.8, -35.0, -106.8, -38.5, -7.0, -217.2],
      nibt: [157.9, -24.9, 153.3, -111.0, -106.0, 9.9, 79.2], fixed: [-5.6, -19.6, -19.6, -19.6, -19.6, -2.8, -87.0],
      nibt_after: [152.3, -44.6, 133.7, -130.6, -125.7, 7.1, -7.8],
    };
    for (const [k, v] of Object.entries(B2)) v.forEach((x, i) => near(val(t, k, i), x));
    for (const r of t.rows.filter((x) => !x.pct)) expect(r.values.slice(0, 6).reduce((s, v) => s!.plus(v!), D(0))!.toFixed(2), r.key).toBe(r.values[6]!.toFixed(2));
  });
  it("split: the running week as actual 24–26 and rest 27–30", () => {
    const t = plTable("wk", inp.month, { rows, cutOff: inp.cut_off, split: true });
    expect(t.columns.slice(4, 6).map((c) => [c.from, c.to, c.kind])).toEqual([["2026-08-24", "2026-08-26", "actual"], ["2026-08-27", "2026-08-30", "forecast"]]);
  });
});

describe("K31 COGS and GP per forecast day; cumulative series of five measures", () => {
  it("GP per day 27–30 comes from the engine and sums to −67,9 (B.2); 31 Aug run-rate GP 16,9", () => {
    const gp = cumulativeSeries("gp", inp.month, rows, inp.cut_off, "0.10");
    const days = gp.daily.slice(26, 30);
    near(jt(days.reduce((s, v) => s.plus(v), D(0))), -67.9);
    near(jt(gp.daily[30]), 16.9);
  });
  it("revenue: MTD 6.385,9 → outlook 7.764,1, band ±10% of the forecast part = 7.626,3–7.901,9; NIBT after fixed ends at −7,8", () => {
    const s = cumulativeSeries("revenue", inp.month, rows, inp.cut_off, "0.10");
    expect(s.dates.length).toBe(31);
    expect(s.cutIndex).toBe(25);
    near(jt(s.mtd), 6385.9); near(jt(s.total), 7764.1); near(jt(s.bandLow), 7626.3); near(jt(s.bandHigh), 7901.9);
    expect(s.actual[26]).toBeNull(); expect(s.outlook[24]).toBeNull(); expect(s.outlook[25]!.eq(s.actual[25]!)).toBe(true);
    expect(s.low[25]).toBeNull();
    near(jt(cumulativeSeries("nibt_after", inp.month, rows, inp.cut_off, "0.10").total), -7.8);
    near(jt(cumulativeSeries("nibt", inp.month, rows, inp.cut_off, "0.10").total), 79.2);
    near(jt(cumulativeSeries("cogs", inp.month, rows, inp.cut_off, "0.10").total), 7467.7);
  });
});

describe("golden fixtures/pl-2026-08 (PRD v5 §9.2)", () => {
  it("both views of the P&L table and the five cumulative series = the golden; totals = Lampiran B.2", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { repoRoot } = await import("../src/fixtures");
    const { plGolden } = await import("./pl-golden");
    const golden = JSON.parse(readFileSync(join(repoRoot(), "fixtures/pl-2026-08/golden.json"), "utf8"));
    const now = plGolden();
    expect(now).toEqual(golden);
    const c = now.cumulative as Record<string, { total: string }>;
    near(Number(c.revenue.total) / 1e6, 7764.1);
    near(Number(c.gp.total) / 1e6, 296.4);
    near(Number(c.nibt.total) / 1e6, 79.2);
    near(Number(c.nibt_after.total) / 1e6, -7.8);
  });
});
