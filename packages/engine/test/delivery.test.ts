/** K7 partial deliveries (PRD v4 §3.1 P3.8, §9.2 fixture delivery-partial) and C45 STALE (§7.1). */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
import { deliveryCheck, outstandingKg } from "../src/delivery";
import { allocateFEFO } from "../src/allocation";
import { blocking, planningControls, staleControl, summarizeV3 } from "../src/controls-v3";

type Step = { action: "deliver" | "cancel"; kg: string; expect: { ok?: boolean; outstanding: string; closes?: boolean } };
const fx = loadV3Fixture<{ order: { kg: string; fulfilled_kg: string; cancelled_kg: string }; steps: Step[] }>("delivery-partial", "case.json");

describe("delivery-partial: PO 1.800 kg, delivered 600 kg, outstanding 1.200 kg", () => {
  it("every step of the fixture", () => {
    const o = { ...fx.order };
    for (const s of fx.steps) {
      if (s.action === "cancel") {
        o.cancelled_kg = D(o.cancelled_kg).plus(D(s.kg)).toFixed(2);
        expect(outstandingKg(o).toFixed(2)).toBe(s.expect.outstanding);
        continue;
      }
      const c = deliveryCheck(o, s.kg);
      expect(c.ok).toBe(s.expect.ok);
      if (c.ok) o.fulfilled_kg = D(o.fulfilled_kg).plus(D(s.kg)).toFixed(2);
      expect(outstandingKg(o).toFixed(2)).toBe(s.expect.outstanding);
      if (s.expect.closes !== undefined) expect(c.closes).toBe(s.expect.closes);
    }
  });
  it("kg missing, zero or negative is refused with a message", () => {
    for (const kg of [null, "", "0", "-5"]) expect(deliveryCheck({ kg: "1800" }, kg).ok).toBe(false);
  });
  it("allocation and C28 use the outstanding kg (cancelled kg no longer needs stock)", () => {
    const lot = { lot_ref: "L1", key: "K", form: "fresh" as const, origin_date: "2026-08-27", kg: "5000" };
    const r = allocateFEFO({ date: "2026-08-27", orders: [{ ref: "a", key: "K", delivery_date: "2026-08-27", demand_status: "Confirmed", kg: "1800", fulfilled_kg: "600", cancelled_kg: "200", price: "1" }], lots: [lot], windows: { freshHours: () => 48, frozenDays: () => 30 } });
    expect(r.allocations.reduce((a, x) => a.plus(x.kg), D(0)).toFixed(2)).toBe("1000.00");
    const c28 = planningControls({ today: "2026-08-28", orders: [{ ref: "a", key: "K", delivery_date: "2026-08-27", demand_status: "Confirmed", kg: "1800", fulfilled_kg: "600", cancelled_kg: "1200" }] })[0];
    expect(c28.status).toBe("LULUS");
  });
});

describe("C45 STALE", () => {
  it("queued rebuild on or before the date = STALE; later = LULUS; no mart = BELUM DIISI", () => {
    expect(staleControl({ date: "2026-08-23", staleFrom: "2026-08-20", built: true }).status).toBe("STALE");
    expect(staleControl({ date: "2026-08-23", staleFrom: "2026-08-23", built: true }).status).toBe("STALE");
    expect(staleControl({ date: "2026-08-23", staleFrom: "2026-08-24", built: true }).status).toBe("LULUS");
    expect(staleControl({ date: "2026-08-23", staleFrom: null, built: true }).status).toBe("LULUS");
    expect(staleControl({ date: "2026-08-23", staleFrom: null, built: false }).status).toBe("BELUM DIISI");
  });
  it("STALE blocks and is counted; N/A is neutral", () => {
    const st = staleControl({ date: "2026-08-23", staleFrom: "2026-08-01", built: true });
    expect(blocking([st], ["C45"]).map((c) => c.code)).toEqual(["C45"]);
    const sum = summarizeV3([st, { ...st, code: "C1x", status: "N/A" }]);
    expect(sum.counts.STALE).toBe(1);
    expect(sum.counts["N/A"]).toBe(1);
    expect(sum.overall).toBe("PERIKSA");
  });
});
