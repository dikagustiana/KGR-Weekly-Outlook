/**
 * PRD v5.1 R22 (K55): mart_replace takes its column list from the first row of the payload, so a payload without the
 * v5 cost columns would leave what a build with v5_costing on wrote. With the flag off the keys are there, null.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { martRows, v5CostCols } = await import("./commercial");

const row = { key: "RPA|Karkas", cost_per_kg: null, cost_status: null, cost_check: null } as never;
const state = (v5: boolean, r: Record<string, unknown>) => ({ date: "2026-08-27", stockDate: null, week: null, rows: [{ ...(row as object), ...r }], params: {}, reps: [], assigned: [], controls: [], v5 }) as never;

describe("commercial_daily payload (K55)", () => {
  it("flag off: cost_per_kg, cost_status, cost_check are in the payload, null", () => {
    const [r] = martRows(state(false, { cost_per_kg: "34196.0000", cost_status: "estimasi", cost_check: true }));
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["cost_per_kg", "cost_status", "cost_check"]));
    expect([r.cost_per_kg, r.cost_status, r.cost_check]).toEqual([null, null, null]);
  });
  it("flag on: the values of the costing engine", async () => {
    const { D } = await import("@kgr/engine");
    const [r] = martRows(state(true, { cost_per_kg: D("34196"), cost_status: "estimasi", cost_check: null }));
    expect([r.cost_per_kg, r.cost_status, r.cost_check]).toEqual(["34196.0000", "estimasi", false]);
    expect(v5CostCols(false, row)).toEqual({ cost_per_kg: null, cost_status: null, cost_check: null });
  });
});
