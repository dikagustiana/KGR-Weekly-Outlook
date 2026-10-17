/**
 * Tables for the A2 loop tests (R48–R58): one week (24–30 Aug 2026, data date 27 Aug) with the master data
 * loadPlanning reads, for the in-memory client (test-support/mem-sb.ts). Each test adds its own PO lines, commitments, plan
 * rows and flags. Sizes: 1,30 → S, 0,90 → K, 1,50 → B (the illustrative map of PRD v5 Lampiran B.3, a test input).
 */
import type { MemRow } from "./mem-sb";

export const WEEK = { id: "w-0824", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", tb_opening_date: "2026-07-31", status: "open" };

const key = (sku: string, form: string, segment = "RPA", extra: MemRow = {}): MemRow => ({ key: `${segment}|${sku}|${form}`, segment, sku, form, product_class: "main", fresh_window_hours: null, frozen_age_limit_days: null, ...extra });

export const ITEMS: MemRow[] = [
  { item_code: "JLB0092", item_name: "Karkas Uk 0.9 Fresh", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null },
  { item_code: "JLB0829", item_name: "Karkas Uk 1.3 Fresh", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null },
  { item_code: "JLB0922", item_name: "Karkas Uk 1.5 Fresh", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null },
  { item_code: "JLB0300", item_name: "Karkas Frozen", key: "RPA|Karkas|Frozen", size_kg: null, deleted_at: null },
];

const yieldRow = (cls: string, k: string, y: string): MemRow => ({ weight_class: cls, cut_pattern: "karkas", key: k, yield_pct: y, effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null });

export function planSeed(extra: Record<string, MemRow[]> = {}): Record<string, MemRow[]> {
  return {
    week: [WEEK],
    parameter: [{ week_id: WEEK.id, tentative_weight: "0.7", forecast_weight: "0.5", downgrade_approval_threshold: "25000000", lead_time_days: 1, target_shrink: "0.03", freight_plan_per_kg_lb: "300", maklon_per_kg_processed: "200", lb_price_today: "24000", yield_karkas: "0.7146", yield_kepala: "0.03", yield_ceker: "0.04", yield_usus: "0.05", yield_hja: "0.03", yield_lemak: "0.02", cut_off_time: "14:00", commitment_lock_dow: 5, commitment_lock_time: "17:00" }],
    item_map: ITEMS,
    sku_key: [key("Karkas", "Fresh"), key("Karkas", "Frozen"), key("Karkas", "n/a")],
    sku_price: [{ week_id: WEEK.id, key: "RPA|Karkas|Fresh", ref_sell_price: "36705", replacement_buy_price: null }, { week_id: WEEK.id, key: "RPA|Karkas|Frozen", ref_sell_price: "31658", replacement_buy_price: null }],
    weight_class: [
      { code: "STD", min_kg: "1.8", max_kg: "2.2", avg_kg: "2.0", sort_order: 0 },
      { code: "K", min_kg: "0.8", max_kg: "1.1", avg_kg: "0.95", sort_order: 1 }, { code: "S", min_kg: "1.2", max_kg: "1.4", avg_kg: "1.3", sort_order: 2 }, { code: "B", min_kg: "1.4", max_kg: "1.6", avg_kg: "1.5", sort_order: 3 },
    ],
    size_class_map: [
      { size_kg: "0.90", weight_class: "K", effective_from: "2026-01-01", effective_to: null, deleted_at: null },
      { size_kg: "1.30", weight_class: "S", effective_from: "2026-01-01", effective_to: null, deleted_at: null },
      { size_kg: "1.50", weight_class: "B", effective_from: "2026-01-01", effective_to: null, deleted_at: null },
    ],
    yield_matrix: ["STD", "K", "S", "B"].flatMap((c, i) => [yieldRow(c, "Karkas", ["0.7146", "0.70", "0.72", "0.74"][i]), yieldRow(c, "Kepala", "0.03"), yieldRow(c, "Ceker", "0.04")]),
    app_setting: [], sales_line: [], forecast_line: [], substitution: [], capacity: [], lb_supply: [], plan_week: [], plan_day: [], plan_week_class: [], plan_check_reason: [],
    sku_balance_daily: [], lot_balance_daily: [], sales_commitment: [], lb_price_decision: [], batch: [], rebuild_queue: [], input_task_rule: [],
    ...extra,
  };
}

/** An Order line of the week (Confirmed unless said otherwise). */
export const po = (id: string, item: string, kg: string, delivery: string, extra: MemRow = {}): MemRow => ({
  id, date: delivery, delivery_date: delivery, status: "Order", demand_status: "Confirmed", item_code: item, key_manual: null, kg, fulfilled_kg: null, cancelled_kg: null,
  price: "36705", customer: "PT A", po_ref: `PO-${id}`, po_date: "2026-08-20", sales_rep: "Rep A", deleted_at: null, superseded_at: null, ...extra,
});

export const flag = (k: string, enabled = true, roles?: string[]): MemRow => ({ key: k, value: roles ? { enabled, roles } : { enabled } });
