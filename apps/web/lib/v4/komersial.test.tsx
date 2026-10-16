/** Page "Komersial" (PRD v4 §6.7): ranking in the v4 grammar, spot path (K8), approval queue. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TilePage } from "@/components/v4/TilePage";
import { commercialView } from "../v3/commercial-view";
import { komersialModel, type ApprovalRow, type KomersialInput } from "./komersial";
import type { TileModel } from "./minggu-ini";

const text = (t: TileModel | undefined) => renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// two SKUs as the commercial mart stores them; Paha Atas has no floor (no MA yet)
const mart = [
  { date: "2026-08-26", key: "Karkas Fresh", group_code: "Karkas", form: "fresh", free_fresh_kg: "480.00", free_frozen_kg: "0", oldest_age_days: 1, hours_to_cutoff: 3, cost_per_kg_ma: "29850.0000", cost_per_kg_si: "29110.0000", price_floor: "30850.0000", price_list: "33000.0000", margin_per_kg_list: "3150.0000", realized_price_7d: "29500.0000", margin_per_kg_realized: "-350.0000", holding_loss_per_day: "48000.00", downgrade_risk_rp: "1920000.00", urgency: "jual_hari_ini", priority_score: "688000", rank: 1, ordered_today_kg: "0" },
  { date: "2026-08-26", key: "Paha Atas", group_code: "Parting", form: "frozen", free_fresh_kg: "0", free_frozen_kg: "1200.00", oldest_age_days: 12, hours_to_cutoff: null, cost_per_kg_ma: null, cost_per_kg_si: null, price_floor: null, price_list: "38000.0000", margin_per_kg_list: null, realized_price_7d: null, margin_per_kg_realized: null, holding_loss_per_day: "6000.00", downgrade_risk_rp: "0", urgency: "jual_minggu_ini", priority_score: "6000", rank: 2, ordered_today_kg: "0" },
];
const approvals: ApprovalRow[] = [
  { id: "a1", key: "Karkas Fresh", customer: "PT Uji", requested_price: "30000", floor_price: "30850", rp_per_kg_below: "850", kg: "300", total_below: "255000", status: "pending", used: false, mine: true, mayDecide: true },
  { id: "a2", key: "Karkas Fresh", customer: "PT Lain", requested_price: "30500", floor_price: "30850", rp_per_kg_below: "350", kg: "200", total_below: "70000", status: "pending", used: false, mine: false, mayDecide: true },
  { id: "a3", key: "Karkas Fresh", customer: "PT Uji", requested_price: "30000", floor_price: "30850", rp_per_kg_below: "850", kg: "100", total_below: "85000", status: "approved", used: false, mine: true, mayDecide: false },
];
const base = (o: Partial<KomersialInput> = {}): KomersialInput => ({
  today: "2026-08-26", date: "2026-08-26", role: "commercial_lead",
  rows: commercialView(mart, { role: "commercial_lead", salesSeesCost: true, assignedKeys: "all" }),
  unassigned: false, spot: { enabled: true, cutOffTime: "14:00:00", now: "10:30", canRecord: true }, approvals, controls: [], ...o,
});

describe("Komersial §6.7", () => {
  const m = komersialModel(base());
  const tile = (id: string, mm = m) => mm.tiles.find((t) => t.id === id);
  it("cards: SKU jual hari ini, Rp risiko turun ke frozen, SKU dengan stok bebas, approval menunggu", () => {
    expect(m.tiles.slice(0, 4).map((t) => t.id)).toEqual(["c-hari-ini", "c-risiko", "c-bebas", "c-approval"]);
    expect(text(tile("c-hari-ini"))).toContain("tanpa order hari ini 1");
    expect(text(tile("c-risiko"))).toContain("1,9");
    expect(text(tile("c-approval"))).toContain("2");
  });
  it("ranking: floor and MA that are missing read 'belum diisi', never 0; a negative margin uses U+2212", () => {
    const v = text(tile("t-ranking"));
    expect(v).toContain("Karkas Fresh");
    expect(v).toContain("30.850");
    expect(v).toContain("belum diisi");
    expect(v).toContain("−350");
    expect(v).not.toMatch(/(^|\s)-\d/);
  });
  it("sales never sees the lot cost; with sales_sees_cost off not the MA either; no assignment = nothing (S2)", () => {
    const rows = commercialView(mart, { role: "sales", salesSeesCost: false, assignedKeys: new Set(["Karkas Fresh"]) });
    const s = komersialModel(base({ role: "sales", rows }));
    const v = text(tile("t-ranking", s));
    expect(v).not.toContain("29.110");
    expect(v).not.toContain("29.850");
    expect(v).not.toContain("Paha Atas");
    const none = komersialModel(base({ role: "sales", rows: commercialView(mart, { role: "sales", salesSeesCost: true, assignedKeys: new Set() }), unassigned: true }));
    expect(tile("t-ranking", none)!.note).toContain("Minta penugasan");
    expect(text(tile("t-ranking", none))).not.toContain("Karkas");
  });
  it("spot (K8): the jual-hari-ini fresh SKU before the cut-off; after it the action says why", () => {
    expect(m.spotKeys.map((k) => k.key)).toEqual(["Karkas Fresh"]);
    expect(m.actions.find((a) => a.action === "spot")!.disabledReason).toBeNull();
    const late = komersialModel(base({ spot: { enabled: true, cutOffTime: "14:00:00", now: "14:05", canRecord: true } }));
    expect(late.actions.find((a) => a.action === "spot")!.disabledReason).toBe("cut-off 14:00 sudah lewat");
    const off = komersialModel(base({ spot: { enabled: false, cutOffTime: "14:00:00", now: "10:00", canRecord: true } }));
    expect(tile("t-spot", off)!.note).toContain("belum diaktifkan");
  });
  it("approval: no deciding one's own request; the approved one of the requester becomes an order", () => {
    const own = m.actions.find((a) => a.action === "decide" && a.id === "a1")!;
    expect(own.disabledReason).toBe("pengaju tidak memutuskan sendiri");
    expect(m.actions.find((a) => a.action === "decide" && a.id === "a2")!.disabledReason).toBeNull();
    expect(m.actions.some((a) => a.action === "order" && a.id === "a3")).toBe(true);
    expect(text(tile("t-approval"))).toContain("disetujui, belum jadi order");
  });
});
