/**
 * Parse a KGR_Weekly_Outlook.xlsx workbook (the Excel template) into engine inputs.
 * Reads only the input columns of the I_* and T_* sheets, by position — exactly what
 * scripts/extract_fixtures.py reads with openpyxl. Used to import a week the team still keeps in Excel.
 */
import type { WeekInputs } from "@kgr/engine";
import { cell, sheetByName, type Sheet } from "./workbook";
import { isBlank, parseDate, parseNumber, text, type Cell } from "./values";

export class WorkbookError extends Error {}

function need(sheets: Sheet[], name: string): Sheet {
  const s = sheetByName(sheets, name);
  if (!s) throw new WorkbookError(`Sheet ${name} tidak ada — ini bukan workbook KGR Weekly Outlook`);
  return s;
}

function dataRows(s: Sheet, lastCol: number, from = 6, until?: number): { row: number; v: Cell[] }[] {
  const out: { row: number; v: Cell[] }[] = [];
  const last = until ?? s.rows.length;
  for (let r = from; r <= last; r++) {
    const v = Array.from({ length: lastCol }, (_, i) => cell(s, r, i + 1));
    out.push({ row: r, v });
  }
  return out;
}

export function parseWeekWorkbook(sheets: Sheet[]): WeekInputs {
  const P = need(sheets, "I_Parameter");
  const c = (ref: string) => {
    const m = ref.match(/^([A-Z]+)(\d+)$/)!;
    const col = m[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    return cell(P, Number(m[2]), col);
  };
  const updateDate = parseDate(c("C4"));
  if (!updateDate) throw new WorkbookError("I_Parameter!C4 (Tanggal update) kosong");
  const weekStart = mondayOf(updateDate);

  const num = parseNumber;
  const reqNum = (ref: string) => {
    const v = num(c(ref));
    if (v === null) throw new WorkbookError(`I_Parameter!${ref} kosong`);
    return v;
  };

  const inputs: WeekInputs = {
    week: { week_start: weekStart, update_date: updateDate, tb_opening_date: parseDate(c("C47")) ?? weekStart },
    parameters: {
      horizon_fresh_days: reqNum("C7"),
      target_shrink: reqNum("C8"),
      freight_plan_per_kg_lb: reqNum("C9"),
      maklon_per_kg_processed: reqNum("C10"),
      lb_price_today: reqNum("C11"),
      min_trading_spread: reqNum("C12"),
      stock_age_limit_days: reqNum("C13"),
      terms_lb_days: reqNum("C14"),
      terms_trading_days: reqNum("C15"),
      terms_freight_maklon_days: num(c("C48")) ?? "30",
      yield_default: {
        karkas: reqNum("D19"), kepala: reqNum("D20"), ceker: reqNum("D21"),
        usus: reqNum("D22"), hja: reqNum("D23"), lemak: reqNum("D24"),
      },
      last_week: {
        RPA: { kg: num(c("C38")) ?? "0", revenue: num(c("D38")) ?? "0", gp: num(c("E38")) ?? "0" },
        Trading: { kg: num(c("C39")) ?? "0", revenue: num(c("D39")) ?? "0", gp: num(c("E39")) ?? "0" },
      },
      accurate_sales_kg: num(c("C43")),
      accurate_opening_stock_value: num(c("C44")),
    },
    sku_keys: [],
    item_map: [],
    coa_map: [],
    opening_stock: [],
    sales_lines: [],
    receipt_lines: [],
    batches: [],
    gl_lines: [],
    tb_opening: [],
    runrate: [],
    cash_plan: [],
  };

  for (const { v } of dataRows(need(sheets, "I_Master"), 8)) {
    if (isBlank(v[0])) continue;
    inputs.sku_keys.push({
      key: text(v[0])!, segment: text(v[1])!, sku: text(v[2])!, form: text(v[3])!, decision_group: text(v[4])!,
      ref_sell_price: num(v[5]), replacement_buy_price: num(v[6]), note: text(v[7]),
    });
  }
  for (const { v } of dataRows(need(sheets, "I_Item"), 3)) {
    if (isBlank(v[0])) continue;
    inputs.item_map.push({ item_code: text(v[0])!, item_name: text(v[1]), key: text(v[2])! });
  }
  for (const { v } of dataRows(need(sheets, "I_COA"), 8)) {
    if (isBlank(v[0])) continue;
    inputs.coa_map.push({
      account: text(v[0])!, name: text(v[1]) ?? "", type: text(v[2]) ?? "", pl_line: text(v[3]), bs_line: text(v[4]),
      cf_category_as_counter: text(v[5]), is_cash: text(v[6]) === "Y", fs_mapping_reference: text(v[7]),
    });
  }
  for (const { row, v } of dataRows(need(sheets, "I_Stok_Awal"), 8, 6, 305)) {
    if (isBlank(v[0])) continue;
    inputs.opening_stock.push({
      row, item_code: text(v[0]), item_name: text(v[1]), kg: num(v[3]), value: num(v[4]),
      avg_age_days: num(v[5]), kg_over_age_limit: num(v[6]), note: text(v[7]),
    });
  }
  for (const { row, v } of dataRows(need(sheets, "T_Penjualan"), 11)) {
    if (v.every(isBlank)) continue;
    inputs.sales_lines.push({
      row, date: parseDate(v[0]), status: text(v[1]), document_ref: text(v[2]), customer: text(v[3]),
      item_code: text(v[4]), key_manual: text(v[5]), kg: num(v[7]), price: num(v[8]), hpp_actual: num(v[10]),
    });
  }
  for (const { row, v } of dataRows(need(sheets, "T_Penerimaan"), 10)) {
    if (v.every(isBlank)) continue;
    inputs.receipt_lines.push({
      row, date: parseDate(v[0]), status: text(v[1]), receipt_source: text(v[2]), document_ref: text(v[3]),
      supplier: text(v[4]), item_code: text(v[5]), key_manual: text(v[6]), kg: num(v[8]), unit_cost: num(v[9]),
    });
  }
  for (const { row, v } of dataRows(need(sheets, "T_Batch"), 17)) {
    if (v.every(isBlank)) continue;
    inputs.batches.push({
      row, date: parseDate(v[0]), status: text(v[1]), batch_ref: text(v[2]), supplier: text(v[3]),
      lb_kg: num(v[4]), lb_price: num(v[5]), freight: num(v[6]), maklon: num(v[7]), processed_kg: num(v[8]),
      output: {
        karkas_fresh: num(v[9]), karkas_frozen: num(v[10]), kepala: num(v[11]), ceker: num(v[12]),
        usus: num(v[13]), hja: num(v[14]), lemak: num(v[15]), other: num(v[16]),
      },
    });
  }
  for (const { row, v } of dataRows(need(sheets, "T_GL"), 18)) {
    if (v.slice(0, 9).every(isBlank)) continue;
    inputs.gl_lines.push({
      row, date: parseDate(v[0]), voucher_no: text(v[1]), voucher_type: text(v[2]), account: text(v[3]),
      account_name: text(v[4]), description: text(v[5]), debit: num(v[6]), credit: num(v[7]), party: text(v[8]),
      cf_override: text(v[17]),
    });
  }
  for (const { row, v } of dataRows(need(sheets, "I_TB"), 3, 6, 265)) {
    if (isBlank(v[0])) continue;
    inputs.tb_opening.push({ row, account: text(v[0])!, name: text(v[1]), balance: num(v[2]) });
  }
  for (const { v } of dataRows(need(sheets, "I_RunRate"), 4)) {
    if (isBlank(v[0])) continue;
    inputs.runrate.push({ pl_line: text(v[0])!, monthly_amount: num(v[1]), week_adjustment: num(v[2]), basis: text(v[3]) });
  }
  for (const { row, v } of dataRows(need(sheets, "T_Kas_Rencana"), 5)) {
    if (v.every(isBlank)) continue;
    inputs.cash_plan.push({
      row, date: parseDate(v[0]), cf_category: text(v[1]), bs_counter_line: text(v[2]), description: text(v[3]), amount: num(v[4]),
    });
  }
  return inputs;
}

function mondayOf(d: string): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}
