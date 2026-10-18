/**
 * PRD v5.2-A R60/R61 on the ledger (K59): the lots of a batch carry the v5 cost until its allocation is posted AND priced;
 * the posting makes the batch final and revalues the lots (K22, "Selisih costing"); a tied invoice alone changes nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
const { loadLedgerSources, v5SelisihCosting } = await import("./ledger");
const { loadV5BatchCosts } = await import("../v5/costing");

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
const lines = (price_ref: string | null) => ({ allocation_line: [{ allocation_run_id: "r1", key: KEY, kg: "5004.7", price_ref }] });

describe("R60: until the allocation is posted the lots carry the v5 cost, a tied invoice or not", () => {
  it("tied invoice, nothing posted: the receipt lot takes the sementara plan cost; no revaluation", async () => {
    const sb = fakeSb({ rows: rows() }) as never;
    const src = (await loadLedgerSources(sb))!;
    const [b] = await loadV5BatchCosts(sb, week.week_start, week.update_date);
    expect(b.status).toBe("sementara");
    const lot = src.inputs.receipts.find((r) => r.document_ref === REF)!;
    expect(lot.cost_per_kg_si).toBe(b.costByKey.get(KEY)!.toFixed(4));
    expect(src.v5!.statusByBatch.get(REF)).toBe("sementara");
    expect(await v5SelisihCosting(sb)).toEqual([]);
  });
  it("posted and every line priced: the lot takes the M1 cost, final, and the sold kg are revalued on the final date", async () => {
    const sb = fakeSb({ rows: rows({ allocation_run: [posted], ...lines("36705.0000") }) }) as never;
    const src = (await loadLedgerSources(sb))!;
    const [b] = await loadV5BatchCosts(sb, week.week_start, week.update_date);
    expect(b.status).toBe("final");
    expect(src.v5!.statusByBatch.get(REF)).toBe("final");
    const m1 = 175000000 / 5004.7;
    expect(src.inputs.receipts.find((r) => r.document_ref === REF)!.cost_per_kg_si).toBe(m1.toFixed(4));
    const sel = await v5SelisihCosting(sb);
    expect(sel).toHaveLength(1);
    expect(sel[0].date).toBe("2026-08-28");
    // Selisih costing = −(final − provisional) × kg sold before the posting; P&L sign: a higher cost is negative. The 1.000 kg
    // sold on 27 Aug take the 100 kg of the opening lot first, so 900 kg come out of the batch's lot. Here the final cost is
    // below the provisional one (only the karkas had a price in the plan): a gain.
    const provisional = b.provisional!.lines.find((l) => l.key === KEY)!.costPerKg!.toNumber();
    expect(m1).toBeLessThan(provisional);
    expect(Number(sel[0].amount)).toBeCloseTo(-(m1 - provisional) * 900, 0);
    expect(Number(sel[0].amount)).toBeGreaterThan(0);
  });
});

describe("R61: a posted allocation with an unpriced SKU is not final — the lots keep the v5 cost and stay sementara", () => {
  it.each([[null], ["0.0000"]])("price_ref %s", async (price) => {
    const sb = fakeSb({ rows: rows({ allocation_run: [posted], ...lines(price) }) }) as never;
    const src = (await loadLedgerSources(sb))!;
    const [b] = await loadV5BatchCosts(sb, week.week_start, week.update_date);
    expect(b.status).toBe("sementara");
    expect(b.costCheck).toBe(`harga acuan kosong: ${KEY}`);
    expect(src.v5!.statusByBatch.get(REF)).toBe("sementara");
    // not the M1 cost of the posted allocation (35.000/kg), the v5 plan cost
    const lot = src.inputs.receipts.find((r) => r.document_ref === REF)!;
    expect(lot.cost_per_kg_si).toBe(b.costByKey.get(KEY)!.toFixed(4));
    expect(lot.cost_per_kg_si).not.toBe((175000000 / 5004.7).toFixed(4));
    expect(await v5SelisihCosting(sb)).toEqual([]);
  });
});
