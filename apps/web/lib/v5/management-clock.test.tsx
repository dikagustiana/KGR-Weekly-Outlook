/**
 * PRD v5.1 R10 (K38) and R25 (K41) on the Manajemen v5 loader with a fake database: data stopping on 27 Aug opened on
 * 17 Oct decides the LB price for 18 Oct (wall + 1) and names both dates; a read that fails shows on its tile only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
vi.mock("../v3/planning", () => ({ loadPlanning: async () => ({}) }));
vi.mock("../v3/stale", () => ({ stockMartControl: async () => ({ code: "C45", status: "LULUS" }) }));
vi.mock("../v3/commercial", () => ({ commercialMart: async () => ({ date: null, rows: [] }) }));
vi.mock("./ppic-data", () => ({ loadPpicV5: async () => ({ sim: null, demand: { byClass: [] }, batch: null }) }));

const { loadManagementV5 } = await import("./management-data");
const { managementV5 } = await import("./management");
const { TilePage } = await import("@/components/v4/TilePage");

const week = { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", tb_opening_date: "2026-08-23", status: "open" } as never;
const r = { block2: { lbPriceToday: "24600" } } as never;

beforeEach(() => { vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("KGR_TEST_NOW", "2026-10-17T09:00:00+07:00"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Manajemen v5 on the wall clock (K38)", () => {
  it("data 27 Aug, wall 17 Oct: the decision is for 18 Oct and the simulation names both dates", async () => {
    const sb = fakeSb({ rows: { week: [{ update_date: "2026-08-27" }] } });
    const m = await loadManagementV5(sb as never, week, r, {}, null);
    expect(m.sim.cutDate).toBe("2026-10-18");
    expect(m.sim.dataDate).toBe("2026-08-27");
    expect(m.decisions[0]?.title).toBe("Harga live bird untuk potong Min 18/10");
    const sim = managementV5([], m, { at: 8 }).find((t) => t.id === "sim-lb")!;
    expect(sim.note).toMatch(/^Data per 27 Agu · potong Min 18\/10\. /);
    // the loop status and the source labels read the task window of Input around the wall date
    expect(sb.calls).toContain("input_task:gte");
  });
  it("current data: one date, no double label", async () => {
    const sb = fakeSb({ rows: { week: [{ update_date: "2026-10-17" }] } });
    const m = await loadManagementV5(sb as never, week, r, {}, null);
    expect(m.sim.cutDate).toBe("2026-10-18");
    expect(managementV5([], m, { at: 8 }).find((t) => t.id === "sim-lb")!.note).not.toMatch(/^Data per/);
  });
});

describe("a failing read shows on its tile (K41)", () => {
  it("discount_approval refused: 'Perlu keputusan' is in state error, the simulation is not", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = fakeSb({ rows: { week: [{ update_date: "2026-08-27" }] }, fail: { discount_approval: "permission denied for table discount_approval" } });
    const m = await loadManagementV5(sb as never, week, r, {}, null);
    const tiles = managementV5([], m, { at: 8 });
    expect(tiles.find((t) => t.id === "keputusan")?.error).toContain("permission denied for table discount_approval");
    expect(tiles.find((t) => t.id === "sim-lb")?.error).toBeUndefined();
    const html = renderToStaticMarkup(<TilePage tiles={tiles} label="Minggu ini" />).replace(/<!-- -->/g, "");
    expect(html).toContain('data-tile-error=""');
    expect(html).toContain("Gagal memuat data tile ini: manajemen: permintaan diskon — discount_approval: permission denied for table discount_approval");
    expect(html.match(/data-tile-error/g)).toHaveLength(1);
  });
  it("the source labels refused: each label says so (never an empty 'belum ada')", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = fakeSb({ rows: { week: [{ update_date: "2026-08-27" }] }, fail: { gl_line: "column gl_line.created_at does not exist" } });
    const m = await loadManagementV5(sb as never, week, r, {}, null);
    expect(m.sources["c-outlook"]).toEqual({ text: expect.stringMatching(/^gagal dimuat \(manajemen: label sumber — label sumber jurnal: column gl_line.created_at does not exist\)$/), late: true });
  });
  it("the whole loader failing keeps both tiles in place with the message", async () => {
    const { managementFailed } = await import("./management-data");
    const tiles = managementV5([], managementFailed("minggu ini: manajemen v5: boom"), { at: 8 });
    expect(tiles.map((t) => [t.id, t.error])).toEqual([["sim-lb", "minggu ini: manajemen v5: boom"], ["keputusan", "minggu ini: manajemen v5: boom"]]);
  });
});
