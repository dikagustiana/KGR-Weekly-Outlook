/**
 * PRD v5.2-A irisan A3 — R60 (K59: final only from a posted allocation), R61 (posting refuses an unpriced SKU), R62 (a
 * missing yield / rate is "belum diisi", never 0) and R63 (class-specific LB decision and yield): the probes of the
 * v5.1 review as loader tests with a fake database.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
const { loadV5BatchCosts, v5CostingControls, lbDecisionOf, yieldOfClass } = await import("./costing");
const { postWeek } = await import("../v3/costing");

const REF = "126/PO/KGR/08/2026";
const batch = { id: "b126", week_id: "w35", date: "2026-08-26", status: "Aktual", batch_ref: REF, lb_kg: "12089.6", lb_price: null, freight: "5000000", maklon: "4000000", out_karkas_fresh: "5004.7", out_karkas_frozen: "3214.5", wp_received_at: "2026-08-27T09:04:00+07:00", invoice_status: "pending" };
const wp = [{ batch_id: "b126", key: "RPA|Karkas|Fresh", kg: "5004.7" }, { batch_id: "b126", key: "RPA|Lemak|Fresh", kg: "28.8" }];
const prices = [{ week_id: "w35", key: "RPA|Karkas|Fresh", ref_sell_price: "36705" }, { week_id: "w35", key: "RPA|Lemak|Fresh", ref_sell_price: "5000" }];
const base = (over: Record<string, unknown[]> = {}) => ({
  batch: [batch], batch_output_sku: wp, parameter: [{ week_id: "w35", lb_price_today: "24600", cost_anomaly_ratio: "3" }],
  lb_price_decision: [], yield_matrix: [], week: [{ id: "w35", week_start: "2026-08-24" }], price_list_week: [], sku_price: prices, allocation_run: [], allocation_line: [], ...over,
});
const load = (rows: Record<string, unknown[]>, today = "2026-08-27") => loadV5BatchCosts(fakeSb({ rows }) as never, "2026-08-24", today);

describe("R60 probe TIED_NO_POSTED: a tied invoice is not final", () => {
  const tied = { batch: [{ ...batch, invoice_status: "tied" }] };
  it("sementara on the WP, costByKey filled, finalDate null, labelled 'faktur tie, alokasi belum diposting'", async () => {
    const [b] = await load(base(tied));
    expect(b.status).toBe("sementara");
    expect(b.costByKey.size).toBeGreaterThan(0);
    expect(b.costByKey.get("RPA|Karkas|Fresh")!.gt(0)).toBe(true);
    expect(b.finalDate).toBeNull();
    expect(b.posted).toBe(false);
    expect(b.costCheck).toContain("faktur tie, alokasi belum diposting");
  });
  it("without WP the tied batch stays estimasi/rencana — never final", async () => {
    const [b] = await load(base({ ...tied, batch_output_sku: [], batch: [{ ...batch, invoice_status: "tied", wp_received_at: null }], yield_matrix: [] }));
    expect(["estimasi", "rencana"]).toContain(b.status);
    expect(b.finalDate).toBeNull();
  });
  it("after the posting (every allocation line priced) the batch is final, with the provisional cost it replaces", async () => {
    const run = { allocation_run: [{ id: "r1", batch_id: "b126", posted_at: "2026-08-28T10:00:00+07:00", run_at: null }] };
    const lines = { allocation_line: wp.map((w) => ({ allocation_run_id: "r1", key: w.key, kg: w.kg, price_ref: "5000.0000" })) };
    const [b] = await load(base({ ...tied, ...run, ...lines }), "2026-08-29");
    expect(b.status).toBe("final");
    expect(b.finalDate).toBe("2026-08-28");
    expect(b.result).toBeNull();
    expect(b.provisional?.status).toBe("sementara");
    expect(b.provisional!.lines.find((l) => l.key === "RPA|Karkas|Fresh")!.costPerKg!.gt(0)).toBe(true);
  });
});

describe("R61: posting refuses a batch with an unpriced SKU (probe: Lemak without a price)", () => {
  const draft = { id: "r1", batch_id: "b126", status: "draft", diff: "0", issues: [], run_at: "2026-08-27T10:00:00+07:00" };
  const line = (key: string, kg: string, price_ref: string | null) => ({ allocation_run_id: "r1", key, item_code: null, kg, price_ref, sales_value: "0", share: "0", allocated_cost: "0", cost_per_kg: "0", by_product_method: "joint", nrv_floor: null, nrv_writedown: "0" });
  const week = { id: "w35", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-28", status: "open" };
  const rowsOf = (lines: ReturnType<typeof line>[]) => ({ ...base(), batch: [{ ...batch, cost_mode: "maklon", seq: 1 }], allocation_run: [draft], allocation_line: lines, cost_pool: [], cost_pool_line: [], overhead_rate: [], sku_key: [] });
  const viewer = (role: string) => ({ email: `${role}@x.id`, role, fullName: null }) as never;

  it("Lemak without price → posting refused, naming batch and SKU; nothing is written", async () => {
    const sb = fakeSb({ rows: rowsOf([line("RPA|Karkas|Fresh", "5004.7", "36705.0000"), line("RPA|Lemak|Fresh", "28.8", null)]) });
    await expect(postWeek(sb as never, viewer("cost_accounting"), week as never)).rejects.toThrow(new RegExp(`${REF}: RPA\\|Lemak\\|Fresh`));
    expect(sb.calls).not.toContain("allocation_run:update");
    expect(sb.calls).not.toContain("batch:update");
  });
  it("a price of 0 is refused the same way", async () => {
    const sb = fakeSb({ rows: rowsOf([line("RPA|Karkas|Fresh", "5004.7", "36705.0000"), line("RPA|Lemak|Fresh", "28.8", "0.0000")]) });
    await expect(postWeek(sb as never, viewer("admin"), week as never)).rejects.toThrow(/harga acuan kosong/);
  });
  it("every SKU priced → posted (allocation_run and batch updated)", async () => {
    const sb = fakeSb({ rows: { ...rowsOf([line("RPA|Karkas|Fresh", "5004.7", "36705.0000"), line("RPA|Lemak|Fresh", "28.8", "5000.0000")]), allocation_run: [draft] } });
    await expect(postWeek(sb as never, viewer("cost_accounting"), week as never)).resolves.toBe("Diposting: 1 batch");
    expect(sb.calls).toContain("allocation_run:update");
  });
  it("Finance's override posts it, with a reason of 10+ characters, recorded as an issue of the run; other roles cannot", async () => {
    const rows = rowsOf([line("RPA|Karkas|Fresh", "5004.7", "36705.0000"), line("RPA|Lemak|Fresh", "28.8", null)]);
    const sb = fakeSb({ rows });
    await expect(postWeek(sb as never, viewer("finance"), week as never, { override: { reason: "pendek" } })).rejects.toThrow(/alasan minimal 10/);
    await expect(postWeek(sb as never, viewer("cost_accounting"), week as never, { override: { reason: "harga Lemak menyusul dari pemasok" } })).rejects.toThrow(/hanya oleh Finance/);
    expect(sb.calls).not.toContain("allocation_run:update");
    const ok = fakeSb({ rows });
    const msg = await postWeek(ok as never, viewer("finance"), week as never, { override: { reason: "harga Lemak menyusul dari pemasok" } });
    expect(msg).toContain("override Finance");
    const upd = ok.args.find((a) => a.call === "allocation_run:update")!.args[0] as { status: string; issues: string[] };
    expect(upd.status).toBe("posted");
    expect(upd.issues.join(" ")).toMatch(/override Finance: diposting tanpa harga acuan RPA\|Lemak\|Fresh — harga Lemak menyusul dari pemasok \(finance@x\.id/);
  });
});

describe("R62 probe 'yield kosong': no cost, C54 PERIKSA, C42 BELUM DIISI, canBeFinal false", () => {
  const estimasi = { batch: [{ ...batch, wp_received_at: null, freight: null, maklon: null }], batch_output_sku: [], parameter: [{ week_id: "w35", lb_price_today: "24600", freight_plan_per_kg_lb: "300", maklon_per_kg_processed: "350", target_shrink: "0.03", cost_anomaly_ratio: "3" }] };
  it("an empty yield matrix: result null, costCheck names the yields, canBeFinal false", async () => {
    const [b] = await load(base(estimasi));
    expect(b.result).toBeNull();
    expect(b.costByKey.size).toBe(0);
    expect(b.canBeFinal).toBe(false);
    expect(b.missingInputs).toContain("yield Karkas");
    expect(b.costCheck).toMatch(/^yield\/tarif belum diisi: yield Karkas, yield Kepala/);
  });
  it("C54 → PERIKSA and C42 → BELUM DIISI for that batch (the week's controls)", async () => {
    const sb = fakeSb({ rows: base(estimasi) });
    const costs = await loadV5BatchCosts(sb as never, "2026-08-24", "2026-08-27");
    const wk = { id: "w35", week_start: "2026-08-24", week_end: "2026-08-30" };
    const ctl = await v5CostingControls(fakeSb({ rows: base(estimasi) }) as never, wk as never, "2026-08-27", "2026-08-27T03:00:00Z", costs);
    const c54 = ctl.find((c) => c.code === "C54")!, c42 = ctl.find((c) => c.code === "C42")!;
    expect(c54.status).toBe("PERIKSA");
    expect(c54.detail.join(" ")).toContain(`batch ${REF}: biaya belum ada (yield/tarif belum diisi: yield Karkas`);
    expect(c42.status).toBe("BELUM DIISI");
    expect(c42.detail[0]).toContain(`batch ${REF}: yield Karkas`);
  });
  it("with the yields filled the same batch has a cost and no C42 comes out of the costing controls", async () => {
    const ys = ["Karkas", "Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"].map((key, i) => ({ weight_class: "STD", cut_pattern: "karkas", key, yield_pct: i === 0 ? "0.7" : "0.02", effective_from: "2026-01-01" }));
    const allPrices = ["Karkas|Fresh", "Karkas|Frozen", "Kepala|Fresh", "Ceker|Fresh", "Usus|Fresh", "HJA (Hati/Jantung/Ampela)|Fresh", "Lemak|Fresh"].map((k) => ({ week_id: "w35", key: `RPA|${k}`, ref_sell_price: k.startsWith("Karkas") ? "36000" : "12000" }));
    const rows = base({ ...estimasi, yield_matrix: ys, sku_price: allPrices });
    const costs = await load(rows);
    expect(costs[0].result).not.toBeNull();
    expect(costs[0].missingInputs).toEqual([]);
    expect(costs[0].canBeFinal).toBe(true);
    const ctl = await v5CostingControls(fakeSb({ rows }) as never, { id: "w35", week_start: "2026-08-24", week_end: "2026-08-30" } as never, "2026-08-27", "2026-08-27T03:00:00Z", costs);
    expect(ctl.find((c) => c.code === "C42")).toBeUndefined();
    expect(ctl.find((c) => c.code === "C54")!.status).toBe("LULUS");
  });
  it("no planned rates and no actuals: 'tarif freight, tarif maklon' are missing (no parameter row = nothing assumed)", async () => {
    const ys = ["Karkas", "Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"].map((key) => ({ weight_class: "STD", cut_pattern: "karkas", key, yield_pct: "0.1", effective_from: "2026-01-01" }));
    const [b] = await load(base({ batch: estimasi.batch, batch_output_sku: [], parameter: [], yield_matrix: ys, lb_price_decision: [{ date: "2026-08-26", weight_class: null, price: "24000", decided_at: "2026-08-25T09:00:00Z" }] }));
    expect(b.result).toBeNull();
    expect(b.missingInputs).toEqual(["tarif freight", "tarif maklon"]);
  });
  it("actual freight and maklon of the batch replace the planned rates: no rate needed, and one actual alone is not 'maklon 0'", async () => {
    // WP in, both actuals present, the week has no planned rates → costs exist
    const [a] = await load(base({ parameter: [{ week_id: "w35", lb_price_today: "24600" }] }));
    expect(a.result).not.toBeNull();
    expect(a.missingInputs).toEqual([]);
    expect(a.result!.tariffCost.toFixed(0)).toBe("9000000");
    // only the freight is actual: the maklon comes from the planned rate (and is missing without it)
    const [b] = await load(base({ batch: [{ ...batch, maklon: null }], parameter: [{ week_id: "w35", lb_price_today: "24600" }] }));
    expect(b.result).toBeNull();
    expect(b.missingInputs).toEqual(["tarif maklon"]);
    const [c] = await load(base({ batch: [{ ...batch, maklon: null }], parameter: [{ week_id: "w35", lb_price_today: "24600", maklon_per_kg_processed: "350", target_shrink: "0.03" }] }));
    expect(c.result!.tariffCost.toFixed(2)).toBe((5000000 + 12089.6 * 350 * 0.97).toFixed(2));
  });
});

describe("R63 probe CLASS_PRICE: the LB decision of the batch's class, else all classes; the class yield, else STD (labelled)", () => {
  const yRow = (weight_class: string, key: string, yield_pct: string, effective_from = "2026-01-01") => ({ weight_class, cut_pattern: "karkas", key, yield_pct, effective_from });
  const std = ["Karkas", "Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"].map((k, i) => yRow("STD", k, i === 0 ? "0.7" : "0.02"));
  // 100 kg LB, planned rates 0 → the pool cost is kg LB × the decided price
  const est = (cls: string | null) => ({
    batch: [{ ...batch, lb_kg: "100", wp_received_at: null, freight: null, maklon: null, weight_class: cls }], batch_output_sku: [],
    parameter: [{ week_id: "w35", lb_price_today: "24600", freight_plan_per_kg_lb: "0", maklon_per_kg_processed: "0", target_shrink: "0.03", cost_anomaly_ratio: "3" }],
    yield_matrix: std, sku_price: [...prices, { week_id: "w35", key: "RPA|Karkas|Frozen", ref_sell_price: "30000" }],
    lb_price_decision: [
      { date: "2026-08-26", weight_class: "S", price: "26000", decided_at: "2026-08-25T11:00:00Z" }, // newest first
      { date: "2026-08-26", weight_class: "K", price: "20000", decided_at: "2026-08-25T09:00:00Z" },
      { date: "2026-08-26", weight_class: null, price: "24000", decided_at: "2026-08-24T09:00:00Z" },
    ],
  });
  it("a class K batch costs its pool at the K decision: Rp 2,0 jt, not the newest decision (S: Rp 2,6 jt)", async () => {
    const [k] = await load(base(est("K")));
    expect(k.result!.costPool.toFixed(0)).toBe("2000000");
    expect(k.lbPriceSource).toBe("keputusan");
    const [s] = await load(base(est("S")));
    expect(s.result!.costPool.toFixed(0)).toBe("2600000");
  });
  it("a class without its own decision takes the decision for all classes; a batch without class too", async () => {
    const [b] = await load(base(est("B")));
    expect(b.result!.costPool.toFixed(0)).toBe("2400000");
    const [n] = await load(base(est(null)));
    expect(n.result!.costPool.toFixed(0)).toBe("2400000");
  });
  it("lbDecisionOf: the latest of the class, else the latest for every class, else none", () => {
    const ds = est("K").lb_price_decision;
    expect(lbDecisionOf(ds, "2026-08-26", "K")?.price).toBe("20000");
    expect(lbDecisionOf(ds, "2026-08-26", "B")?.price).toBe("24000");
    expect(lbDecisionOf(ds.filter((d) => d.weight_class !== null), "2026-08-26", "B")).toBeNull();
    expect(lbDecisionOf(ds, "2026-08-27", "K")).toBeNull();
    expect(lbDecisionOf(ds, null, "K")).toBeNull();
  });
  it("yield: the class's own row first, else STD — labelled 'yield STD dipakai'", async () => {
    const [stdOnly] = await load(base(est("K")));
    expect(stdOnly.yieldSource).toBe("yield STD dipakai");
    const own = ["Karkas", "Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"].map((k, i) => yRow("K", k, i === 0 ? "0.75" : "0.02"));
    const [k] = await load(base({ ...est("K"), yield_matrix: [...std, ...own] }));
    expect(k.yieldSource).toBe("kelas K");
    const kar = k.result!.lines.find((l) => l.key === "RPA|Karkas|Fresh")!.kg.plus(k.result!.lines.find((l) => l.key === "RPA|Karkas|Frozen")!.kg);
    expect(kar.toFixed(2)).toBe("75.00");
    const [s] = await load(base({ ...est("S"), yield_matrix: [...std, ...own] }));
    expect(s.yieldSource).toBe("yield STD dipakai");
  });
  it("yieldOfClass: the latest effective_from on or before the date", () => {
    const ys = [yRow("STD", "Karkas", "0.70", "2026-01-01"), yRow("STD", "Karkas", "0.72", "2026-08-01"), yRow("STD", "Karkas", "0.74", "2026-09-01")];
    expect(yieldOfClass(ys, "Karkas", null, "2026-08-26")).toEqual({ value: "0.72", source: "STD" });
    expect(yieldOfClass(ys, "Karkas", "K", "2026-12-01")).toEqual({ value: "0.74", source: "STD" });
    expect(yieldOfClass(ys, "Kepala", "K", "2026-08-26").value).toBeNull();
  });
});
