/** PRD v5.2-A R64 on the ledger (ledger.ts lines 105, 323): a parameter, a kg or a value that is not there is never read as 0. */
import { describe, expect, it, vi } from "vitest";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
const { loadLedgerSources, rekonSplitForWeek } = await import("./ledger");

const REF = "126/PO/KGR/08/2026";
const KEY = "RPA|Karkas|Fresh";
const week = { id: "w35", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-29", status: "open" };
const batch = { id: "b126", week_id: "w35", date: "2026-08-26", status: "Aktual", batch_ref: REF, lb_kg: "12089.6", lb_price: null, freight: "5000000", maklon: "4000000", out_karkas_fresh: "5004.7", out_karkas_frozen: "0", wp_received_at: "2026-08-27T09:04:00+07:00", invoice_status: "tied" };
const yields = ["Karkas", "Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"].map((key, i) => ({ weight_class: "STD", cut_pattern: "karkas", key, yield_pct: i === 0 ? "0.7" : "0.02", effective_from: "2026-01-01" }));
const posted = { id: "r1", batch_id: "b126", posted_at: "2026-08-28T10:00:00+07:00", run_at: null, batch: { batch_ref: REF }, allocation_line: [{ key: KEY, kg: "5004.7", allocated_cost: "175000000" }] };

const rows = (over: Record<string, unknown[]> = {}) => ({
  week: [week], item_map: [{ item_code: "JLB0001", key: KEY }],
  opening_stock: [{ id: "o1", week_id: "w35", item_code: "JLB0001", key_manual: null, kg: "100", value: "3000000", avg_age_days: "1" }],
  receipt_line: [{ id: "rc1", week_id: "w35", date: "2026-08-26", status: "Aktual", receipt_source: "Produksi RPA", item_code: "JLB0001", key_manual: null, kg: "5004.7", unit_cost: "30000", document_ref: REF }],
  sales_line: [{ id: "s1", week_id: "w35", date: "2026-08-27", status: "Aktual", item_code: "JLB0001", key_manual: null, kg: "1000", cancelled_kg: "0", hpp_actual: null, document_ref: "DO1" }],
  blast_event: [], lot_movement: [], stock_card_snapshot: [], allocation: [], delivery: [],
  sku_key: [{ key: KEY, group_code: "KARKAS", fresh_window_hours: 48, frozen_age_limit_days: 30 }],
  parameter: [{ week_id: "w35", blast_cost_per_kg: "0", fresh_window_hours_default: 48, frozen_age_limit_days_default: 30, revaluation_sold_mode: "cogs_line", lb_price_today: "24600", freight_plan_per_kg_lb: "300", maklon_per_kg_processed: "350", target_shrink: "0.03" }],
  app_setting: [{ key: "v5_costing", value: { enabled: true, since: "2026-08-01" } }],
  batch: [batch], batch_output_sku: [{ batch_id: "b126", key: KEY, kg: "5004.7" }], lb_price_decision: [], yield_matrix: yields, price_list_week: [],
  sku_price: [{ week_id: "w35", key: KEY, ref_sell_price: "36705" }], allocation_run: [], allocation_line: [], ...over,
});

describe("ledger sources", () => {
  it("no parameter row for the week: the load fails closed, the blast cost is not 0", async () => {
    await expect(loadLedgerSources(fakeSb({ rows: rows({ parameter: [] }) }) as never)).rejects.toThrow(/ledger\.parameter.*parameter minggu ini belum ada/);
  });
  it("an opening row without kg is left out of the opening card (not a balance of 0 kg)", async () => {
    const opening = [
      { id: "o0", week_id: "w34", item_code: "JLB0001", key_manual: null, kg: "90", value: "2700000", avg_age_days: "1" },
      { id: "o1", week_id: "w35", item_code: "JLB0001", key_manual: null, kg: "100", value: "3000000", avg_age_days: "1" },
      { id: "o2", week_id: "w35", item_code: "JLB0001", key_manual: null, kg: null, value: "500000", avg_age_days: "1" },
    ];
    // the opening card of a week after the first one stands for the end of the week before
    const w34 = { id: "w34", week_start: "2026-08-17", week_end: "2026-08-23", update_date: "2026-08-22", status: "closed" };
    const src = (await loadLedgerSources(fakeSb({ rows: rows({ opening_stock: opening, week: [w34, week] }) }) as never))!;
    expect(src.cards.get("2026-08-23")!.map((c) => c.kg)).toEqual(["100"]);
  });
});

describe("D3 split (rekonSplitForWeek)", () => {
  const w = { id: "w35", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-29", status: "open" };
  const fix = { week_id: "w35", amount: "-1000000", status: "decided" };
  const opening = (value: string | null) => [{ id: "o1", week_id: "w35", item_code: "JLB0001", key_manual: null, kg: "100", value, avg_age_days: "1" }];
  it("the opening value is known: the opening BS is the value minus the D3 gap", async () => {
    const r = (await rekonSplitForWeek(fakeSb({ rows: rows({ opening_stock: opening("3000000"), data_fix: [fix] }) }) as never, w as never, null))!;
    expect(r.parts.length).toBe(5);
    const e = r.parts.find((p) => p.part === "e")!;
    expect(e.missing).toBeNull();
    expect(e.rp!.toFixed(0)).toBe("0");
  });
  it("an opening row without value: the opening value and BS are unknown (null), the split still runs", async () => {
    const r = (await rekonSplitForWeek(fakeSb({ rows: rows({ opening_stock: opening(null), data_fix: [fix] }) }) as never, w as never, null))!;
    expect(r.parts.length).toBe(5);
    const e = r.parts.find((p) => p.part === "e")!;
    expect(e.rp).toBeNull();
    expect(e.missing).toBe("neraca saldo awal belum ada");
  });
});
