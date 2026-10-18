/**
 * The tables `loadWeek` reads, rebuilt from the engine's golden week (fixtures/week-YYYY-MM-DD) — the inverse of the mapping
 * in lib/data.ts — so a test can run `computeForWeek` and the data builders on a memSb with real numbers. Node only.
 * Rows carry `week_id`, `seq` (= the fixture row) and no `deleted_at` / `superseded_at`, as live rows.
 */
import { addDays, type WeekInputs } from "@kgr/engine";
import { loadFixtureWeek } from "../../../packages/engine/src/fixtures";
import type { MemRow } from "./mem-sb";

export const WEEK_ID = "wk-golden";

export function weekRows(weekStart = "2026-08-24", today?: string): { inputs: WeekInputs; rows: Record<string, MemRow[]> } {
  const inputs = loadFixtureWeek(weekStart, today);
  const p = inputs.parameters;
  const w = (r: object, extra: MemRow = {}): MemRow => ({ week_id: WEEK_ID, ...r, ...extra });
  const rows: Record<string, MemRow[]> = {
    week: [{
      id: WEEK_ID, week_start: inputs.week.week_start, week_end: addDays(inputs.week.week_start, 6), update_date: inputs.week.update_date,
      tb_opening_date: inputs.week.tb_opening_date, status: "open",
      lw_rpa_kg: p.last_week.RPA.kg, lw_rpa_revenue: p.last_week.RPA.revenue, lw_rpa_gp: p.last_week.RPA.gp,
      lw_trading_kg: p.last_week.Trading.kg, lw_trading_revenue: p.last_week.Trading.revenue, lw_trading_gp: p.last_week.Trading.gp,
      lw_source: null, opening_stock_flag: null, note: null,
    }],
    parameter: [{
      week_id: WEEK_ID, horizon_fresh_days: p.horizon_fresh_days, target_shrink: p.target_shrink, freight_plan_per_kg_lb: p.freight_plan_per_kg_lb,
      maklon_per_kg_processed: p.maklon_per_kg_processed, lb_price_today: p.lb_price_today, min_trading_spread: p.min_trading_spread,
      stock_age_limit_days: p.stock_age_limit_days, terms_lb_days: p.terms_lb_days, terms_trading_days: p.terms_trading_days,
      terms_freight_maklon_days: p.terms_freight_maklon_days,
      yield_karkas: p.yield_default.karkas, yield_kepala: p.yield_default.kepala, yield_ceker: p.yield_default.ceker, yield_usus: p.yield_default.usus,
      yield_hja: p.yield_default.hja, yield_lemak: p.yield_default.lemak,
      accurate_sales_kg: p.accurate_sales_kg ?? null, accurate_opening_stock_value: p.accurate_opening_stock_value ?? null,
    }],
    sku_key: inputs.sku_keys.map((k, i) => ({ key: k.key, segment: k.segment, sku: k.sku, form: k.form, decision_group: k.decision_group, active: true, sort_order: i, note: k.note })),
    sku_price: inputs.sku_keys.map((k) => w({ key: k.key, ref_sell_price: k.ref_sell_price ?? null, replacement_buy_price: k.replacement_buy_price ?? null, note: k.note ?? null })),
    item_map: inputs.item_map.map((i) => ({ item_code: i.item_code, item_name: i.item_name, key: i.key })),
    coa_map: inputs.coa_map.map((c) => ({ ...c })),
    opening_stock: inputs.opening_stock.map((r) => w({ ...r, id: `os-${r.row}`, seq: r.row })),
    sales_line: inputs.sales_lines.map((r) => w({ ...r, id: `sl-${r.row}`, seq: r.row })),
    receipt_line: inputs.receipt_lines.map((r) => w({ ...r, id: `rl-${r.row}`, seq: r.row })),
    batch: inputs.batches.map((b) => w({
      id: `bt-${b.row}`, seq: b.row, source: b.source, document_ref: b.document_ref, date: b.date, status: b.status, batch_ref: b.batch_ref, supplier: b.supplier,
      lb_kg: b.lb_kg, lb_price: b.lb_price, freight: b.freight, maklon: b.maklon, processed_kg: b.processed_kg,
      out_karkas_fresh: b.output.karkas_fresh, out_karkas_frozen: b.output.karkas_frozen, out_kepala: b.output.kepala, out_ceker: b.output.ceker,
      out_usus: b.output.usus, out_hja: b.output.hja, out_lemak: b.output.lemak, out_other: b.output.other,
    })),
    tb_opening: inputs.tb_opening.map((t) => w({ ...t, id: `tb-${t.row}`, seq: t.row })),
    runrate: inputs.runrate.map((r, i) => w({ ...r, seq: i })),
    cash_plan: inputs.cash_plan.map((c) => w({ ...c, id: `cp-${c.row}`, seq: c.row })),
    gl_line: inputs.gl_lines.map((g) => ({ ...g, id: `gl-${g.row}`, seq: g.row })),
  };
  return { inputs, rows };
}
