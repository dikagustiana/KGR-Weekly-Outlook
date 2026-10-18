/**
 * PRD v5.2-A irisan A2, R48–R50 on the loader: the class demand of a week from the PO lines, the locked commitments and the
 * forecasts, read through the in-memory client. Probes of the review: DEMAND_tentative_70pct → 70,
 * DEMAND_confirmed_fulfilled60 → 40, forecast-only → need > 0, C58_UNSIZED → PERIKSA.
 */
import { describe, expect, it, vi } from "vitest";
import { memSb } from "../../test-support/mem-sb";
import { WEEK, flag, planSeed, po } from "../../test-support/plan-seed";

vi.mock("server-only", () => ({}));
const { loadPlanning } = await import("../v3/planning");
const { loadClassDemand } = await import("./ppic-data");

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const demandOf = async (tables: Parameters<typeof planSeed>[0]) => {
  const sb = memSb(planSeed(tables));
  const cs = await loadClassDemand(sb as never, await loadPlanning(sb as never, WEEK as never));
  return { cs, sb };
};

describe("R48 — a locked commitment above the PO (A-UI-2)", () => {
  const tables = {
    app_setting: [flag("v5_commercial")],
    sales_line: [po(A, "JLB0829", "100", "2026-08-24")],
    sales_commitment: [{ id: "c1", week_start: "2026-08-24", key: "RPA|Karkas", size_kg: "1.30", fresh_kg: "300", frozen_kg: "0", price: "36000", status: "locked", version: 1, deleted_at: null }],
  };
  it("commitment 300 kg > PO 100 kg → the class demand holds 200 kg more (300 kg), in class S", async () => {
    const { cs } = await demandOf(tables);
    expect(cs.demand.total.po_kg.toFixed(0)).toBe("300");
    expect(cs.demand.byClass.map((c) => [c.weight_class, c.net_kg.toFixed(0)])).toEqual([["S", "300"]]);
  });
  it("no sales_line query for the synthetic id: only the real PO line id goes to the size lookup (no 22P02 on a UUID column)", async () => {
    const { sb } = await demandOf(tables);
    const bySize = sb.calls("sales_line:select").filter((c) => c.filters.some((f) => f.startsWith("in id")));
    expect(bySize).toHaveLength(1);
    expect(bySize[0].filters).toContain(`in id [${A}]`);
    expect(JSON.stringify(sb.log)).not.toMatch(/in id \[[^\]]*commitment:/);
  });
  it("a commitment with no PO at all is synthetic only: no size lookup query for it, the demand is its kg", async () => {
    const { cs, sb } = await demandOf({ ...tables, sales_line: [] });
    expect(cs.demand.total.po_kg.toFixed(0)).toBe("300");
    expect(sb.calls("sales_line:select").filter((c) => c.filters.some((f) => f.startsWith("in id")))).toHaveLength(0);
  });
});

describe("R49 — the open kg × status weight, forecast per date, netting after (A-UI-9)", () => {
  it("DEMAND_tentative_70pct: a Tentative 100 kg line is 70 kg of class need", async () => {
    const { cs } = await demandOf({ sales_line: [po(A, "JLB0829", "100", "2026-08-25", { demand_status: "Tentative" })] });
    expect(cs.demand.total.net_kg.toFixed(2)).toBe("70.00");
  });
  it("DEMAND_confirmed_fulfilled60: a Confirmed 100 kg line with 60 kg delivered is 40 kg", async () => {
    const { cs } = await demandOf({ sales_line: [po(A, "JLB0829", "100", "2026-08-25", { fulfilled_kg: "60" })] });
    expect(cs.demand.total.net_kg.toFixed(2)).toBe("40.00");
  });
  it("a fulfilled-and-cancelled line is never negative; frozen karkas is not live-bird need", async () => {
    const { cs } = await demandOf({ sales_line: [po(A, "JLB0829", "100", "2026-08-25", { fulfilled_kg: "70", cancelled_kg: "50" }), po(B, "JLB0300", "500", "2026-08-25")] });
    expect(cs.demand.total.net_kg.toFixed(2)).toBe("0.00");
    expect(cs.demand.rows).toEqual([]);
  });
  it("forecast-only week: the need is above 0 on STD, spread over the seven dates at forecast_weight (0,5)", async () => {
    const { cs } = await demandOf({ forecast_line: [{ id: "f1", week_start: "2026-08-24", key: "RPA|Karkas|Fresh", kg: "2800", price_expected: null, sales_rep: null, customer: null, forecast_source: "sales", deleted_at: null }] });
    expect(cs.demand.total.net_kg.toFixed(2)).toBe("1400.00");
    expect(cs.demand.byClass.map((c) => c.weight_class)).toEqual(["STD"]);
    expect(cs.daily.map((d) => d.ship_date)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]);
    expect(cs.daily.every((d) => d.kg_lb.gt(0))).toBe(true);
    // not PO lines without a size: C50 stays LULUS
    expect(cs.controls.find((c) => c.code === "C50")?.status).toBe("LULUS");
  });
  it("K2: a Sales forecast of a key ignores the statistical forecast of that key", async () => {
    const hist = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 20 + i)).toISOString().slice(0, 10), item_code: "JLB0829", key_manual: null, kg: "1000", status: "Aktual", deleted_at: null, superseded_at: null }));
    const withSales = await demandOf({ sales_line: hist, forecast_line: [{ id: "f1", week_start: "2026-08-24", key: "RPA|Karkas|Fresh", kg: "700", forecast_source: "sales", deleted_at: null }] });
    expect(withSales.cs.demand.total.net_kg.toFixed(2)).toBe("350.00");
    const statOnly = await demandOf({ sales_line: hist });
    expect(statOnly.cs.demand.total.net_kg.gt(350)).toBe(true);
  });
});

describe("R50 — STD is in C58 (A-UI-10)", () => {
  it("C58_UNSIZED: PO lines with no size are STD need; a supply of class S only does not cover it → C58 PERIKSA", async () => {
    const { cs } = await demandOf({
      sales_line: [po(A, "JLB0829", "1000", "2026-08-27"), po(B, "NOSIZE", "500", "2026-08-27")],
      item_map: [{ item_code: "JLB0829", item_name: "Karkas Uk 1.3 Fresh", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null }, { item_code: "NOSIZE", item_name: "Karkas Mix", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null }],
      lb_supply: [{ date: "2026-08-26", weight_class: "S", kg: "99999", status: "confirmed", supplier: "CV X", deleted_at: null }],
    });
    expect(cs.demand.byClass.map((c) => c.weight_class).sort()).toEqual(["S", "STD"]);
    const c = cs.controls.find((x) => x.code === "C58")!;
    expect(c.status).toBe("PERIKSA");
    expect(c.detail.some((d) => d.startsWith("2026-08-26 STD: supply 0 <"))).toBe(true);
    expect(cs.controls.find((x) => x.code === "C50")?.status).toBe("PERIKSA");
  });
});
