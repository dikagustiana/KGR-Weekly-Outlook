/** M7 in v4 (PRD v4 §3.8, K8, P3.9): the spot rule and kg spot in the scorecard. */
import { describe, expect, it } from "vitest";
import { scorecard, spotCheck } from "../src/commercial";

describe("spot sale (K8, P3.9): same rule as public.tg_spot_guard", () => {
  const ok = { spotEnabled: true, today: "2026-08-26", date: "2026-08-26", now: "10:30", cutOffTime: "14:00:00", urgency: "jual_hari_ini", freeFreshKg: "480", kg: "300" };
  it("today, before the cut-off, a jual-hari-ini key, within the free fresh kg: allowed", () => {
    expect(spotCheck(ok)).toEqual([]);
  });
  it("each condition refuses on its own, with its reason", () => {
    expect(spotCheck({ ...ok, spotEnabled: false })).toEqual(["jalur spot belum diaktifkan untuk minggu ini"]);
    expect(spotCheck({ ...ok, now: "14:00" })).toEqual(["cut-off 14:00 sudah lewat"]);
    expect(spotCheck({ ...ok, date: "2026-08-27" })).toEqual(["penjualan spot hanya untuk hari ini"]);
    expect(spotCheck({ ...ok, urgency: "jual_minggu_ini" })).toEqual(["SKU tidak berstatus jual hari ini"]);
    expect(spotCheck({ ...ok, kg: "481" })).toEqual(["melebihi stok fresh bebas 480 kg"]);
    expect(spotCheck({ ...ok, poRef: "PO-1" })).toEqual(["penjualan spot tanpa nomor PO"]);
  });
  it("a key without a commercial row (no urgency, no stock) is refused, never treated as free 0", () => {
    expect(spotCheck({ ...ok, urgency: null, freeFreshKg: null })).toEqual(["SKU tidak berstatus jual hari ini", "melebihi stok fresh bebas 0 kg"]);
  });
});

describe("scorecard: kg spot per sales rep", () => {
  it("spot kg counted apart from the actual kg; a rep with only spot sales appears", () => {
    const rows = scorecard({
      targets: [{ sales_rep: "Andi", target_kg: "1000", target_rp: null }],
      actuals: [{ sales_rep: "Andi", kg: "800", value: "24000000" }],
      forecasts: [], blasts: [], discounts: [],
      spot: [{ sales_rep: "Andi", kg: "120" }, { sales_rep: "Budi", kg: "50" }, { sales_rep: "Andi", kg: "30" }],
    });
    expect(rows.map((r) => [r.sales_rep, r.actual_kg.toFixed(0), r.kg_spot.toFixed(0)])).toEqual([["Andi", "800", "150"], ["Budi", "0", "50"]]);
  });
  it("without spot input every rep has 0 kg spot (the v3 scorecard is unchanged otherwise)", () => {
    const rows = scorecard({ targets: [], actuals: [{ sales_rep: "Andi", kg: "1", value: "1" }], forecasts: [], blasts: [], discounts: [] });
    expect(rows[0].kg_spot.toFixed(0)).toBe("0");
  });
});
