/**
 * PRD v5 §4.7 fixture for the page models: August 2026 (fixtures/month-2026-08 through the v4 engine) plus the K29
 * fixed-cost rows the month builder writes with v5_pl on — template 8.3 as seeded by 20261016000900_m5_drivers.sql and
 * July FINAL from the management report (fixtures/fs-2026-09). Node only.
 */
import { fixedEstimateRows, fixedNominals, type FixedCostRow } from "@kgr/engine";
import { loadV3Fixture } from "../../../packages/engine/src/fixtures";
import { augustPlan, inp } from "../../../packages/engine/test/month-v4-fixture";
import type { FixedSource } from "../lib/v5/pl-tiles";

export const SCHEDULE_SEED: FixedCostRow[] = [
  { id: "r1", code: "SEWA-RPA-RAWA-TERATE", pl_line: "Rent Expenses", description: "Sewa RPA", amount_per_month: null, start_date: "2026-11-01", end_date: "2027-10-31", amortize: true, prepaid_total: "1133790000", active: true },
  { id: "r2", code: "DEPRESIASI", pl_line: "Depreciation & amortisation", description: "Depresiasi", amount_per_month: "10393461.35", start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r3", code: "GAJI", pl_line: "Salaries and allowance", description: "Gaji", amount_per_month: null, start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r4", code: "SEWA-ABF-NMG", pl_line: "Storage Expenses", description: "Sewa ABF", amount_per_month: null, start_date: "2026-09-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r5", code: "BUNGA", pl_line: "Interest Expense", description: "Bunga", amount_per_month: null, start_date: "2026-05-01", end_date: null, amortize: false, prepaid_total: null, active: true },
];

const fs = loadV3Fixture<{ pl: { row: number; line: string; values: Record<string, string> }[] }>("fs-2026-09", "inputs.json");
const jul = (row: number) => fs.pl.find((r) => r.row === row)!.values["2026-07-31"];
export const JULY_FINAL = { month: "2026-07-01", byLine: { "Salaries and allowance": jul(23), "Rent Expenses": jul(30), "Depreciation & amortisation": jul(34), "Interest Expense": jul(43) } };

export function augustV5() {
  const a = augustPlan();
  const nominals = fixedNominals({ month: inp.month, schedule: SCHEDULE_SEED, lastFinal: JULY_FINAL });
  const fixedRows = fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals, rows: a.plan.rows });
  const fixed: FixedSource[] = nominals.map((n) => ({ pl_line: n.pl_line, nominal: n.nominal.toFixed(2), source: n.source, finalMonth: n.finalMonth }));
  return { plan: a.plan, rows: [...a.plan.rows, ...fixedRows], fixedRows, fixed, nominals };
}
