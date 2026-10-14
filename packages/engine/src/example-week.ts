/**
 * The example week (24–30 Aug 2026, update 27 Aug) bundled as data — the reference Excel's inputs.
 * Used by the app's "Muat minggu contoh" action and by tests. Pure data, no I/O.
 */
import type { WeekInputs } from "./types";
import week from "../../../fixtures/week-2026-08-24/week.json";
import parameters from "../../../fixtures/week-2026-08-24/parameters.json";
import sku_keys from "../../../fixtures/week-2026-08-24/sku_keys.json";
import item_map from "../../../fixtures/week-2026-08-24/item_map.json";
import coa_map from "../../../fixtures/week-2026-08-24/coa_map.json";
import opening_stock from "../../../fixtures/week-2026-08-24/opening_stock.json";
import sales_lines from "../../../fixtures/week-2026-08-24/sales_lines.json";
import receipt_lines from "../../../fixtures/week-2026-08-24/receipt_lines.json";
import batches from "../../../fixtures/week-2026-08-24/batches.json";
import gl_lines from "../../../fixtures/week-2026-08-24/gl_lines.json";
import tb_opening from "../../../fixtures/week-2026-08-24/tb_opening.json";
import runrate from "../../../fixtures/week-2026-08-24/runrate.json";
import cash_plan from "../../../fixtures/week-2026-08-24/cash_plan.json";

export const EXAMPLE_WEEK_START = "2026-08-24";

export function exampleWeekInputs(): WeekInputs {
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  return clone({
    week: { week_start: week.week_start, update_date: week.update_date, tb_opening_date: week.tb_opening_date },
    parameters, sku_keys, item_map, coa_map, opening_stock, sales_lines, receipt_lines, batches, gl_lines, tb_opening, runrate, cash_plan,
  } as unknown as WeekInputs);
}
