/** Month fixture of PRD v4 (§9.2 month-2026-08): the example week's journal and PO lines through the v4 engine. */
import { D } from "../src/decimal";
import { loadFixtureWeek, loadV3Fixture } from "../src/fixtures";
import { computeWeek } from "../src/week";
import { actualRowsV4, engineAssumptions, monthPlanV4, monthSummaryV4, ordersV4FromWeek, runrateActualLines, runrateTest, versionDaysV4 } from "../src/month-v4";

export const inp = loadV3Fixture<{ month: string; cut_off: string; week_fixture: string; forecast_tolerance_pct: string }>("month-2026-08", "inputs.json");
export const week = loadFixtureWeek(inp.week_fixture.replace("week-", ""));
export const weekResult = computeWeek(week);
export const isWorking = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0;
export const HOLIDAYS = ["2026-08-17"];

export function augustPlan(opts: { events?: { date: string; pl_line: string; amount: string }[] } = {}) {
  const rows = actualRowsV4({ gl: week.gl_lines, coa: week.coa_map, from: "2026-07-01", to: inp.cut_off });
  const orders = ordersV4FromWeek(weekResult.sales, "2026-08-27", "2026-08-31", () => 1);
  const events = opts.events ?? [];
  const plan = monthPlanV4({
    month: inp.month, cutOff: inp.cut_off, actualRows: rows, orders,
    opex: { fixed: [], runrateActual: runrateActualLines({ gl: week.gl_lines, coa: week.coa_map, from: inp.month, to: inp.cut_off, events }), runrateTable: [], variable: [], events },
    isWorkingDay: isWorking, holidays: HOLIDAYS,
  });
  const summary = monthSummaryV4(plan.rows, inp.month, inp.forecast_tolerance_pct);
  const register = engineAssumptions({ month: inp.month, cutOff: inp.cut_off, plan, tolerance: inp.forecast_tolerance_pct, windowDays: 7, lockWeek: 3 });
  const test = runrateTest({ plan, tolerance: inp.forecast_tolerance_pct, reasons: [] });
  return { rows, orders, plan, summary, register, test, days: versionDaysV4(plan.rows, inp.month, inp.cut_off), D };
}
