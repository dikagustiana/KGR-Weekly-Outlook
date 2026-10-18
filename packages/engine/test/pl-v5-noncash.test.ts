/**
 * PRD v5.2-A R65 (F13): the 12-month cash projection starts from the NIBT after fixed costs and takes the non-cash costs
 * inside it (depreciation, amortised prepaid) out of the cash flow — added back once, with the reconciliation explicit.
 * August fixture (fixtures/month-2026-08 + template 8.3 as seeded).
 */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { cashProjection12m, cashProjection12mOrNull } from "../src/cash";
import { DEPRECIATION_LINE, fixedEstimateRows, fixedNominals, nonCashFixed, solvencyNibtV5 } from "../src/pl-v5";
import { augustPlan, inp } from "./month-v4-fixture";
import { JULY, SCHEDULE } from "./pl-v5-inputs";

const a = augustPlan();
const nominals = fixedNominals({ month: inp.month, schedule: SCHEDULE, lastFinal: JULY });
const rows = [...a.plan.rows, ...fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals, rows: a.plan.rows })];
const jt = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);

describe("R65: the non-cash part of August's NIBT after fixed costs", () => {
  it("depreciation 10,4 jt (the schedule), no prepaid amortisation in August (the rent starts in November)", () => {
    const n = nonCashFixed({ month: inp.month, rows, schedule: SCHEDULE });
    expect(jt(n.depreciation)).toBe("10.4");
    expect(n.prepaid).toEqual([]);
    expect(n.total.toFixed(2)).toBe(n.depreciation.toFixed(2));
  });
  it("salary and interest (last FINAL) are cash: only the depreciation line is added back", () => {
    const n = nonCashFixed({ month: inp.month, rows, schedule: SCHEDULE });
    const sal = rows.filter((r) => r.pl_line === "Salaries and allowance" && r.basis === "fixed_estimate").length;
    expect(sal).toBeGreaterThan(0);
    expect(jt(n.total)).toBe("10.4");
  });
  it("the 12 months: change = NIBT after fixed costs (−7,8) + non-cash (10,4) = +2,6 jt; the closing grows by it each month", () => {
    const nibtAfter = solvencyNibtV5(rows, false)!;
    expect(jt(nibtAfter)).toBe("-7.8");
    const n = nonCashFixed({ month: inp.month, rows, schedule: SCHEDULE });
    const m = cashProjection12m({ month: "2026-08-27", startClosing: "495400000", nibtOutlook: nibtAfter, depreciation: n.total });
    expect(jt(m[0].change)).toBe("2.6");
    expect(m).toHaveLength(12);
    expect(D(m[11].closing).minus(D("495400000")).div(12).toFixed(0)).toBe(m[0].change.toFixed(0));
    // the reversed v5.1 behaviour (depreciation 0 with NIBT after fixed costs) would have the non-cash depreciation reduce the cash
    const wrong = cashProjection12m({ month: "2026-08-27", startClosing: "495400000", nibtOutlook: nibtAfter, depreciation: 0 });
    expect(jt(wrong[0].change)).toBe("-7.8");
    expect(m[0].change.minus(wrong[0].change).toFixed(0)).toBe(n.total.toFixed(0));
  });
  it("NIBT unknown (no fixed nominal): no projection — not the journal NIBT, not 0", () => {
    expect(solvencyNibtV5(rows, true)).toBeNull();
    expect(cashProjection12mOrNull({ month: "2026-08-27", startClosing: "495400000", nibtOutlook: solvencyNibtV5(rows, true), depreciation: 0 })).toBeNull();
  });
});

describe("R65: amortised prepaid (rent paid in advance) from November", () => {
  const NOV = "2026-11-01";
  const nominalsNov = fixedNominals({ month: NOV, schedule: SCHEDULE, lastFinal: JULY });
  const novRows = fixedEstimateRows({ month: NOV, cutOff: "2026-10-31", nominals: nominalsNov, rows: [] });
  it("the rent (1.133,8 jt over 12 months = 94,5 jt) is amortisation: added back with the depreciation", () => {
    const n = nonCashFixed({ month: NOV, rows: novRows, schedule: SCHEDULE });
    expect(n.prepaid.map((p) => [p.pl_line, jt(p.amount)])).toEqual([["Rent Expenses", "94.5"]]);
    expect(jt(n.depreciation)).toBe("10.4");
    expect(jt(n.total)).toBe("104.9");
  });
  it("capped at what the P&L line carries: a rent line smaller than the amortisation is not added back beyond it", () => {
    const small = novRows.filter((r) => r.pl_line !== "Rent Expenses");
    expect(nonCashFixed({ month: NOV, rows: small, schedule: SCHEDULE }).prepaidTotal.toFixed(2)).toBe("0.00");
  });
  it("a line that is not amortised and not depreciation (salary) is never added back", () => {
    const n = nonCashFixed({ month: NOV, rows: novRows, schedule: SCHEDULE });
    expect(n.prepaid.some((p) => p.pl_line === "Salaries and allowance")).toBe(false);
    expect(DEPRECIATION_LINE).toBe("Depreciation & amortisation");
  });
});
