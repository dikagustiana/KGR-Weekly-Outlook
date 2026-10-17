/** PRD v5.1 K50 (R17, R18): a missing price stays missing in v5 costing — no Rp 0 per kg LB, no final with an unpriced SKU. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { c57 } from "@kgr/engine";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
const { loadV5BatchCosts } = await import("./costing");
const { CostingV5 } = await import("@/components/v5/CostingV5");

const batch = { id: "b126", week_id: "w35", date: "2026-08-26", status: "Aktual", batch_ref: "126/PO/KGR/08/2026", lb_kg: "12089.6", lb_price: null, freight: "5000000", maklon: "4000000", out_karkas_fresh: "5004.7", out_karkas_frozen: "3214.5", wp_received_at: "2026-08-27T09:04:00+07:00", invoice_status: "pending" };
const wp = [{ batch_id: "b126", key: "RPA|Karkas|Fresh", kg: "5004.7" }, { batch_id: "b126", key: "RPA|Lemak|Fresh", kg: "28.8" }];
const prices = [{ week_id: "w35", key: "RPA|Karkas|Fresh", ref_sell_price: "36705" }];
const rows = (over: Record<string, unknown[]> = {}) => ({
  batch: [batch], batch_output_sku: wp, parameter: [{ week_id: "w35", lb_price_today: "0", freight_plan_per_kg_lb: "300", maklon_per_kg_processed: "350", target_shrink: "0.03" }],
  lb_price_decision: [], yield_matrix: [], week: [{ id: "w35", week_start: "2026-08-24" }], price_list_week: [], sku_price: prices, allocation_run: [], ...over,
});
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

describe("a SKU without reference price (R17)", () => {
  it("the WP batch is sementara with Lemak at null cost and the reason named", async () => {
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ parameter: [{ week_id: "w35", lb_price_today: "24600" }] }) }) as never, "2026-08-24", "2026-08-27");
    expect(b.status).toBe("sementara");
    expect(b.result?.lines.find((l) => l.key === "RPA|Lemak|Fresh")?.costPerKg).toBeNull();
    expect(b.costByKey.has("RPA|Lemak|Fresh")).toBe(false);
    expect(b.costCheck).toBe("harga acuan kosong: RPA|Lemak|Fresh");
  });
  it("a posted (M1) batch with an unpriced SKU never turns final: it stays sementara on the v5 cost", async () => {
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ parameter: [{ week_id: "w35", lb_price_today: "24600" }], allocation_run: [{ batch_id: "b126", posted_at: "2026-08-28T10:00:00+07:00", run_at: null }] }) }) as never, "2026-08-24", "2026-08-29");
    expect(b.status).toBe("sementara");
    expect(b.result).not.toBeNull();
    expect(b.provisional).toBeNull();
  });
  it("all priced: the posted batch is final and keeps the M1 cost", async () => {
    const [b] = await loadV5BatchCosts(fakeSb({ rows: rows({ batch_output_sku: [wp[0]], parameter: [{ week_id: "w35", lb_price_today: "24600" }], allocation_run: [{ batch_id: "b126", posted_at: "2026-08-28T10:00:00+07:00", run_at: null }] }) }) as never, "2026-08-24", "2026-08-29");
    expect(b.status).toBe("final");
    expect(b.result).toBeNull();
    expect(b.costCheck).toBeNull();
  });
});
