/** M5 drivers (PRD v3 §4.6, §8 M5): FS September 2026 — sewa RPA 94,48 jt/bulan from 1 Nov 2026 (prepaid 1.133,79 jt). */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
import { costActualByLine, dailyFixed, driverControls, monthFixedOutlook, monthlyAmount, monthsOfTerm, runrateDaily, variableCost, workingDays, type FixedCostRow } from "../src/drivers";

type Line = { row: number; line: string; values: Record<string, string> };
type In = { pl: Line[]; bs: Line[]; prepaid_rent: { row: number; vendor: string; date: string; description: string; nominal: string }[] };
const fs = loadV3Fixture<In>("fs-2026-09", "inputs.json");
const g = loadV3Fixture<Record<string, string | null>>("fs-2026-09", "golden.json");
const pl = (line: string, month: string) => D(fs.pl.find((l) => l.line === line)!.values[month] ?? "0");

const rentRow = fs.prepaid_rent.find((r) => r.description.includes("Rawa Terate"))!;
// "1 Tahun (Mulai Amor 1 Nov 26 …)": amortised over 12 months from 2026-11-01
const sewa: FixedCostRow = { id: "sewa", pl_line: "Rent Expenses", description: rentRow.description, amount_per_month: null, start_date: "2026-11-01", end_date: "2027-10-31", amortize: true, prepaid_total: rentRow.nominal, active: true };
const depr = fs.pl.find((l) => l.line === "Depreciation Expenses")!;
const deprRow: FixedCostRow = { id: "depr", pl_line: "Depreciation & amortisation", description: "Depresiasi", amount_per_month: pl("Depreciation Expenses", "2026-08-31").neg().toString(), start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true };
const gaji: FixedCostRow = { id: "gaji", pl_line: "Salaries and allowance", description: "Gaji", amount_per_month: null, start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true };

describe("FS golden — fixed costs", () => {
  it("sewa RPA Rawa Terate: prepaid 1.133,79 jt over 12 months = 94,48 jt / month from 2026-11-01", () => {
    expect(rentRow.nominal).toBe(g[`PREPAID RENT!D${rentRow.row}`]);
    expect(monthsOfTerm(sewa.start_date, sewa.end_date!)).toBe(12);
    const m = monthlyAmount(sewa)!;
    expect(m.toFixed(2)).toBe(D(g[`PREPAID RENT!D${rentRow.row}`]!).div(12).toFixed(2));
    expect(m.div(1e6).toFixed(2)).toBe("94.48");
    expect(dailyFixed([sewa], "2026-10-31")).toEqual([]);
    expect(dailyFixed([sewa], "2026-11-15")[0].amount.times(30).toFixed(2)).toBe(m.toFixed(2));
    const nov = monthFixedOutlook([sewa], {}, "2026-11-01");
    expect(nov[0].scheduled.toFixed(2)).toBe(m.toFixed(2));
    expect(monthFixedOutlook([sewa], {}, "2026-10-01")).toEqual([]);
  });
  it("depreciation 10,39 jt / month (FS Jan–Aug); September booked 0 → outlook fills the schedule, August not twice", () => {
    expect(depr.values["2026-08-31"]).toBe(g[`PL - Management Report!K${depr.row}`]);
    const aug = monthFixedOutlook([deprRow], { "Depreciation & amortisation": pl("Depreciation Expenses", "2026-08-31").neg().toString() }, "2026-08-01")[0];
    expect(aug.outlook.toFixed(2)).toBe(aug.actual_mtd.toFixed(2));
    expect(aug.outlook.toFixed(2)).toBe(aug.scheduled.toFixed(2));
    const sep = monthFixedOutlook([deprRow], { "Depreciation & amortisation": pl("Depreciation Expenses", "2026-09-30").neg().toString() }, "2026-09-01")[0];
    expect(sep.actual_mtd.toFixed(0)).toBe("0");
    expect(sep.outlook.toFixed(2)).toBe(sep.scheduled.toFixed(2));
    expect(sep.over).toBe(false);
  });
  it("salaries: no amount in the schedule (Finance fills it; FS Agu 85,57 jt / Sep 82,68 jt) → listed as missing, outlook = actual", () => {
    const sal = fs.pl.find((l) => l.line === "Salaries and allowance")!;
    expect(sal.values["2026-08-31"]).toBe(g[`PL - Management Report!K${sal.row}`]);
    expect(sal.values["2026-09-30"]).toBe(g[`PL - Management Report!L${sal.row}`]);
    const r = monthFixedOutlook([gaji], { "Salaries and allowance": pl("Salaries and allowance", "2026-09-30").neg().toString() }, "2026-09-01")[0];
    expect(r.missing).toEqual(["Gaji"]);
    expect(r.outlook.toFixed(0)).toBe(pl("Salaries and allowance", "2026-09-30").neg().toFixed(0));
    expect(r.over).toBe(false);
  });
});

describe("driver rules", () => {
  it("prorates a term starting mid-month; C34 when actual MTD exceeds the schedule; C33 lines without a driver", () => {
    const row: FixedCostRow = { ...gaji, id: "x", amount_per_month: "3100000", start_date: "2026-08-17" };
    const l = monthFixedOutlook([row], { "Salaries and allowance": "2000000" }, "2026-08-01")[0];
    expect(l.scheduled.toFixed(0)).toBe("1500000"); // 15 of 31 days
    expect(l.outlook.toFixed(0)).toBe("2000000");
    expect(l.over).toBe(true);
    const c = driverControls({ costLines: [{ pl_line: "Salaries and allowance", driver_type: "fixed" }, { pl_line: "Packaging", driver_type: "none" }, { pl_line: "Packaging", driver_type: null }], fixed: [l] });
    expect(c.map((x) => [x.code, x.status, x.detail])).toEqual([["C33", "BELUM DIISI", ["Packaging"]], ["C34", "PERIKSA", ["Salaries and allowance: actual 2000000 > jadwal 1500000"]]]);
    const ok = driverControls({ costLines: [{ pl_line: "Packaging", driver_type: "variable" }], fixed: [{ ...l, over: false }] });
    expect(ok.map((x) => x.status)).toEqual(["LULUS", "LULUS"]);
  });
  it("variable, run-rate per working day (Mon–Sat), journal cost per line", () => {
    expect(variableCost("1600", "2500.5").toFixed(0)).toBe("4000800");
    expect(workingDays("2026-08-01").length).toBe(26);
    expect(runrateDaily("26000000", 26).toFixed(0)).toBe("1000000");
    const a = costActualByLine(
      [{ date: "2026-08-03", account: "6100", debit: "100", credit: null }, { date: "2026-08-04", account: "6100", debit: null, credit: "30" }, { date: "2026-09-01", account: "6100", debit: "999", credit: null }, { date: "2026-08-05", account: "1100", debit: "5", credit: null }],
      [{ account: "6100", pl_line: "Packaging" }, { account: "1100", pl_line: null }], "2026-08-01", "2026-08-31");
    expect(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.toFixed(0)]))).toEqual({ Packaging: "70" });
  });
});
