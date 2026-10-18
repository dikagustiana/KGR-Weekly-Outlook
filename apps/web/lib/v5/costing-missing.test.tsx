/** PRD v5.1 K50 (R17, R18) and v5.2 R61/R62: a missing price stays missing in v5 costing — no Rp 0 per kg LB, no final with an unpriced SKU. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { c57 } from "@kgr/engine";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
const { loadV5BatchCosts } = await import("./costing");
const { CostingV5 } = await import("@/components/v5/CostingV5");

// freight and slaughter fee are the batch's actuals: the planned rates of the week are NOT needed (R62)
const batch = { id: "b126", week_id: "w35", date: "2026-08-26", status: "Aktual", batch_ref: "126/PO/KGR/08/2026", lb_kg: "12089.6", lb_price: null, freight: "5000000", maklon: "4000000", out_karkas_fresh: "5004.7", out_karkas_frozen: "3214.5", wp_received_at: "2026-08-27T09:04:00+07:00", invoice_status: "pending" };
const wp = [{ batch_id: "b126", key: "RPA|Karkas|Fresh", kg: "5004.7" }, { batch_id: "b126", key: "RPA|Lemak|Fresh", kg: "28.8" }];
const prices = [{ week_id: "w35", key: "RPA|Karkas|Fresh", ref_sell_price: "36705" }];
const rows = (over: Record<string, unknown[]> = {}) => ({
  batch: [batch], batch_output_sku: wp, parameter: [{ week_id: "w35", lb_price_today: "0" }],
  lb_price_decision: [], yield_matrix: [], week: [{ id: "w35", week_start: "2026-08-24" }], price_list_week: [], sku_price: prices, allocation_run: [], allocation_line: [], ...over,
});
const withLb = { parameter: [{ week_id: "w35", lb_price_today: "24600" }] };
const posted = { allocation_run: [{ id: "r1", batch_id: "b126", posted_at: "2026-08-28T10:00:00+07:00", run_at: null }] };
const html = (x: Parameters<typeof CostingV5>[0]) => renderToStaticMarkup(<CostingV5 {...x} />).replace(/<!-- -->/g, "");

describe("no LB price anywhere (R18)", () => {
  it("no plan cost, no cost per key, labelled; the costing screen says 'belum diisi' and C57 names the batch", async () => {
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows() }) as never, "2026-08-24", "2026-08-27");
    expect(b.result).toBeNull();
    expect(b.costByKey.size).toBe(0);
    expect(b.lbPriceSource).toBe("belum ada");
    const ctl = c57({ cutDates: [], decisions: [], batchesWithoutPrice: [b.batch_ref] });
    expect(ctl.status).toBe("BELUM DIISI");
    expect(ctl.detail).toEqual(["batch 126/PO/KGR/08/2026: harga LB belum ada, biaya batch belum dihitung"]);
    const h = html({ batches: [b], controls: [ctl], showControls: true });
    expect(h).toContain("harga LB belum ada (C57)");
    expect(h).toContain("belum diisi");
    expect(h).toContain("harga LB belum ada, biaya batch belum dihitung");
  });
});

describe("a SKU without reference price (R17, R61)", () => {
  it("the WP batch is sementara with Lemak at null cost and the reason named; it cannot be final", async () => {
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows(withLb) }) as never, "2026-08-24", "2026-08-27");
    expect(b.status).toBe("sementara");
    expect(b.result?.lines.find((l) => l.key === "RPA|Lemak|Fresh")?.costPerKg).toBeNull();
    expect(b.costByKey.has("RPA|Lemak|Fresh")).toBe(false);
    expect(b.costCheck).toBe("harga acuan kosong: RPA|Lemak|Fresh");
    expect(b.canBeFinal).toBe(false);
    expect(b.missingInputs).toEqual([]);
  });
  it("a posted (M1) batch whose allocation has an unpriced SKU never turns final: it stays sementara on the v5 cost", async () => {
    const lines = [{ allocation_run_id: "r1", key: "RPA|Karkas|Fresh", kg: "5004.7", price_ref: "36705.0000" }, { allocation_run_id: "r1", key: "RPA|Lemak|Fresh", kg: "28.8", price_ref: null }];
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ ...withLb, ...posted, allocation_line: lines }) }) as never, "2026-08-24", "2026-08-29");
    expect(b.status).toBe("sementara");
    expect(b.posted).toBe(true);
    expect(b.m1Final).toBe(false);
    expect(b.result).not.toBeNull();
    expect(b.provisional).toBeNull();
    expect(b.finalDate).toBeNull();
    expect(b.costCheck).toBe("harga acuan kosong: RPA|Lemak|Fresh");
  });
  it("a reference price of 0 on a posted allocation line is no price either", async () => {
    const lines = [{ allocation_run_id: "r1", key: "RPA|Karkas|Fresh", kg: "5004.7", price_ref: "36705.0000" }, { allocation_run_id: "r1", key: "RPA|Lemak|Fresh", kg: "28.8", price_ref: "0.0000" }];
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ ...withLb, ...posted, allocation_line: lines }) }) as never, "2026-08-24", "2026-08-29");
    expect(b.status).toBe("sementara");
    expect(b.m1Final).toBe(false);
  });
  it("all priced: the posted batch is final, keeps the M1 cost and carries its provisional cost for the revaluation", async () => {
    const lines = [{ allocation_run_id: "r1", key: "RPA|Karkas|Fresh", kg: "5004.7", price_ref: "36705.0000" }];
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ batch_output_sku: [wp[0]], ...withLb, ...posted, allocation_line: lines }) }) as never, "2026-08-24", "2026-08-29");
    expect(b.status).toBe("final");
    expect(b.m1Final).toBe(true);
    expect(b.result).toBeNull();
    expect(b.costCheck).toBeNull();
    expect(b.finalDate).toBe("2026-08-28");
    expect(b.provisional).not.toBeNull();
    expect(b.canBeFinal).toBe(true);
  });
  it("the price source of canBeFinal is M1's (WP price_ref → sku_price): a price list price alone does not make the batch final-able", async () => {
    // Lemak has a locked price list price (the plan can cost it) but neither a WP price_ref nor a sku_price: M1 would leave it unpriced
    const list = [{ week_start: "2026-08-17", key: "RPA|Karkas|Fresh", price_fresh: "36705", price_frozen: null }, { week_start: "2026-08-17", key: "RPA|Lemak|Fresh", price_fresh: "5000", price_frozen: null }];
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ ...withLb, price_list_week: list }) }) as never, "2026-08-24", "2026-08-27");
    expect(b.result?.lines.find((l) => l.key === "RPA|Lemak|Fresh")?.costPerKg).not.toBeNull();
    expect(b.canBeFinal).toBe(false);
    expect(b.costCheck).toBe("harga acuan kosong: RPA|Lemak|Fresh");
    // with the WP's own price_ref the same batch can be final
    const wp2 = [wp[0], { ...wp[1], price_ref: "5000" }];
    const [c] = await loadV5BatchCosts(fakeSb({ rows: rows({ ...withLb, price_list_week: list, batch_output_sku: wp2 }) }) as never, "2026-08-24", "2026-08-27");
    expect(c.canBeFinal).toBe(true);
    expect(c.costCheck).toBeNull();
  });
});
