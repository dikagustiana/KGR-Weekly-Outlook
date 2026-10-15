/**
 * M4 golden (PRD v3 §8 M4, PLAN Fase 4b): August 2026 at cut-off 26 Aug from the example week — actual 6.385,9 / GP 347,4
 * (O_PnL MTD); PO days 27–29 Aug; Sunday 30 Aug = 0. The run-rate day (31 Aug, mockup 258,7) and the totals that depend on
 * it are not reproduced (docs/open-questions.md §E.4) and stay todo.
 */
import { describe, expect, it } from "vitest";
import { D, Decimal } from "../src/decimal";
import { loadFixtureWeek, loadV3Fixture } from "../src/fixtures";
import { computeWeek } from "../src/week";
import { workingDays } from "../src/drivers";
import {
  accuracy, actualDaily, bridge, forecastPlRows, ordersFromWeek, sharePoRows, calibrate, dailyTotals, forecastDays, gpPctWindow, monthOutlook, monthlyControls, nthWorkingDay, runrateRevenue, sumRows,
} from "../src/monthly";

type G = Record<string, unknown> & { targets: { cut_off: string; actual: Record<string, string>; forecast: Record<string, string>; outlook: Record<string, string>; daily_revenue: Record<string, string>; share_with_po: string }; fs_final_2026_08: { lines: Record<string, string> } };
const g = loadV3Fixture<G>("month-2026-08", "golden.json");
const inp = loadV3Fixture<{ month: string; cut_off: string; week_fixture: string; forecast_tolerance_pct: string }>("month-2026-08", "inputs.json");
const w = loadFixtureWeek(inp.week_fixture.replace("week-", ""));
const wk = computeWeek(w);
const jt = (v: Decimal) => v.div(1e6).toDecimalPlaces(1).toFixed(1);
const isWorking = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0;
const holidays = ["2026-08-17"]; // Hari Kemerdekaan: no journal at all that day

const rows = actualDaily({ gl: w.gl_lines, coa: w.coa_map, from: inp.month, to: inp.cut_off });
const daily = dailyTotals(rows);
const revByDay = new Map([...daily.entries()].map(([d, t]) => [d, t.revenue]));
const orders = ordersFromWeek(wk.sales, "2026-08-27", "2026-08-31", () => 1);
const rr = runrateRevenue({ revenueByDay: revByDay, from: inp.month, cutOff: inp.cut_off, isWorkingDay: isWorking, holidays });
const gp4w = gpPctWindow(daily, inp.cut_off);
const fc = forecastDays({ cutOff: inp.cut_off, orders, runrate: rr.revenue, gpPct: gp4w, isWorkingDay: isWorking, holidays });
const out = monthOutlook({ actualRows: rows, forecast: fc, tolerance: inp.forecast_tolerance_pct });

describe("monthly golden — cut-off 26 Aug", () => {
  it("actual MTD = journal 1–26 Aug: revenue 6.385,9 jt, GP 347,4 jt (O_PnL!G9 / G15 ± Rp 1)", () => {
    expect(out.actual.revenue.minus(D(g["O_PnL!G9"] as string)).abs().lte(1)).toBe(true);
    expect(out.actual.gp.minus(D(g["O_PnL!G15"] as string)).abs().lte(1)).toBe(true);
    expect(jt(out.actual.revenue)).toBe(g.targets.actual.revenue);
    expect(jt(out.actual.gp)).toBe(g.targets.actual.gp);
    expect(sumRows(rows).actual.revenue.toFixed(2)).toBe(out.actual.revenue.toFixed(2));
  });
  it("PO days 27–29 Aug = weighted PO revenue (457,8 / 232,1 / 378,0 jt ± 0,1 — the mockup rounds per segment: 27 Aug = RPA 271,8 + Trading 186,0); Sunday 30 Aug = 0", () => {
    for (const d of ["2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]) {
      const f = fc.find((x) => x.date === d)!;
      expect(f.revenue.div(1e6).minus(D(g.targets.daily_revenue[d])).abs().lte("0.1")).toBe(true);
    }
    expect(fc.find((x) => x.date === "2026-08-30")!.basis).toBe("none");
    expect(fc.filter((x) => x.basis === "po").length).toBe(3);
  });
  it("25 Aug (0 on a working day) is an anomaly and stays out of the run-rate (D6)", () => {
    expect(rr.anomalies.map((a) => [a.date, a.reason])).toContainEqual(["2026-08-25", "nol"]);
    expect(rr.days).not.toContain("2026-08-25");
    expect(rr.days.length).toBe(20);
  });
  it("mart rows of the forecast days add up to the forecast; share of PO revenue from the rows", () => {
    const fr = forecastPlRows({ days: fc, orders, opex: [] });
    expect(sumRows(fr).forecast.revenue.toFixed(2)).toBe(out.forecast.revenue.toFixed(2));
    expect(sumRows(fr).forecast.gp.toFixed(2)).toBe(out.forecast.gp.toFixed(2));
    expect(sharePoRows(fr).toFixed(6)).toBe(out.sharePo.toFixed(6));
  });
  it.todo("31 Aug run-rate = 258,7 jt (mockup Bulanan) — app gives 319,3 (mean of the 20 working days 1–26 Aug without 25 Aug); see §E.4");
  it.todo("forecast 1.326,5 / GP −54,0, outlook 7.712,4 / GP 293,4, 80,5% ber-PO — depend on the 31 Aug run-rate; see §E.4");
});

describe("monthly rules", () => {
  it("outlook range ± tolerance on the forecast part only; need per day vs budget", () => {
    const o = monthOutlook({ actualRows: rows, forecast: fc, tolerance: "0.10", budget: { revenue: "8000000000", gp: null } });
    expect(o.range.revenueHigh.minus(o.outlook.revenue).toFixed(2)).toBe(o.forecast.revenue.times("0.10").toFixed(2));
    expect(o.budget.needPerDay!.toFixed(2)).toBe(D("8000000000").minus(o.actual.revenue).div(5).toFixed(2));
    expect(o.budget.remainingDays).toBe(5);
  });
  it("V1 lock = 20th working day (Mon–Sat, without holidays); calibration proposals", () => {
    expect(nthWorkingDay("2026-08-01", 20, isWorking, holidays)).toBe("2026-08-25");
    expect(workingDays("2026-08-01").length).toBe(26);
    const c = calibrate({ revenueByDay: revByDay, daily, month: "2026-08-01", isWorkingDay: isWorking, holidays });
    expect(c.map((x) => x.code)).toEqual(["runrate_revenue", "gp_pct"]);
  });
  it("bridge V1 → V2 closes to 0: forecast days that became actual, PO volume and price, run-rate event; C32", () => {
    const v1 = [{ date: "2026-08-27", kind: "po" as const, revenue: "100", kg: "10" }, { date: "2026-08-28", kind: "po" as const, revenue: "200", kg: "20" }, { date: "2026-08-31", kind: "runrate" as const, revenue: "50" }];
    const v2 = [{ date: "2026-08-27", kind: "actual" as const, revenue: "90" }, { date: "2026-08-28", kind: "po" as const, revenue: "264", kg: "22" }, { date: "2026-08-31", kind: "runrate" as const, revenue: "60" }];
    const b = bridge(v1, v2, { runrateChanged: true });
    expect([b.dActual, b.dVolume, b.dPrice, b.dEvent, b.check].map((x) => x.toFixed(0))).toEqual(["-10", "20", "44", "10", "0"]);
    expect(monthlyControls({ bridge: b })[0].status).toBe("LULUS");
    expect(monthlyControls({ bridge: { ...b, check: D(5) } })[0].status).toBe("GAGAL");
    expect(monthlyControls({ bridge: null })[0].status).toBe("BELUM DIISI");
  });
  it("accuracy vs FINAL August (FS) after and before closing adjustments", () => {
    const fin = g.fs_final_2026_08.lines;
    const a = accuracy({
      final: { revenue: fin["Revenue"], gp: fin["GROSS PROFIT"], nibt: fin["INCOME (LOSS) BEFORE TAX"] },
      adjustments: { revenue: "0", gp: "-48354462", nibt: "-48354462" },
      versions: [{ version: "V2", revenue: out.outlook.revenue, gp: out.outlook.gp, nibt: out.outlook.nibt }],
    });
    const r = a.rows.find((x) => x.scope === "revenue")!;
    expect(r.bias.toFixed(2)).toBe(out.outlook.revenue.minus(D(fin["Revenue"])).toFixed(2));
    expect(a.mape.revenue.toFixed(6)).toBe(r.ape.toFixed(6));
    expect(a.rows.find((x) => x.scope === "gp")!.bias_pre.toFixed(2)).toBe(out.outlook.gp.minus(D(fin["GROSS PROFIT"]).plus(48354462)).toFixed(2));
  });
});
