/**
 * Inputs of Lampiran B.2 shared by tests/pl-v5.test.ts and scripts/pl-golden.ts (fixtures/pl-2026-08): the fixed-cost
 * schedule as seeded (template 8.3) and July FINAL from the management report (fs-2026-09). Node only.
 */
import { loadV3Fixture } from "../src/fixtures";
import type { FixedCostRow } from "../src/drivers";

// template 8.3 as seeded by 20261016000900_m5_drivers.sql: depreciation filled, salary and interest empty, rents later
export const SCHEDULE: FixedCostRow[] = [
  { id: "r1", code: "SEWA-RPA-RAWA-TERATE", pl_line: "Rent Expenses", description: "Sewa RPA", amount_per_month: null, start_date: "2026-11-01", end_date: "2027-10-31", amortize: true, prepaid_total: "1133790000", active: true },
  { id: "r2", code: "DEPRESIASI", pl_line: "Depreciation & amortisation", description: "Depresiasi", amount_per_month: "10393461.35", start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r3", code: "GAJI", pl_line: "Salaries and allowance", description: "Gaji", amount_per_month: null, start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r4", code: "SEWA-ABF-NMG", pl_line: "Storage Expenses", description: "Sewa ABF", amount_per_month: null, start_date: "2026-09-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r5", code: "BUNGA", pl_line: "Interest Expense", description: "Bunga", amount_per_month: null, start_date: "2026-05-01", end_date: null, amortize: false, prepaid_total: null, active: true },
  { id: "r6", code: "DEPOSIT-DS-CS", pl_line: "Storage Expenses", description: "Deposit", amount_per_month: null, start_date: "2026-07-22", end_date: null, amortize: false, prepaid_total: "38400000", active: false },
];
// July FINAL from the management report (fs-2026-09, PL rows 23 / 30 / 34 / 43), P&L sign
const fs = loadV3Fixture<{ pl: { row: number; line: string; values: Record<string, string> }[] }>("fs-2026-09", "inputs.json");
const jul = (row: number) => fs.pl.find((r) => r.row === row)!.values["2026-07-31"];
export const JULY = { month: "2026-07-01", byLine: { "Salaries and allowance": jul(23), "Rent Expenses": jul(30), "Depreciation & amortisation": jul(34), "Interest Expense": jul(43) } };

