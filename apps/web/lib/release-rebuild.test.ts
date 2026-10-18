/**
 * PRD v5.2 R79 (B-REL-8): releaseWeek rebuilds the completeness grid of that week (the seven days) before the K35 pre-check, so a
 * cell that went green (or red) since the last build is not judged stale. With v5_input off nothing is rebuilt. Collaborators
 * are mocked; the order of the calls is the evidence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memSb } from "./mem-sb";

const calls: string[] = [];
let inputOn = true;
let cells: Record<string, unknown>[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@kgr/engine", async (orig) => ({
  ...(await orig<typeof import("@kgr/engine")>()),
  computeWeek: () => ({ controls: { controls: [], overall: "LULUS" } }),
  snapshotJsonV3: () => "{}",
}));
vi.mock("./data", () => ({ loadWeek: async () => ({ week: { id: "w1", update_date: "2026-08-27" }, inputs: { sales_lines: [], sales_line: [], receipt_lines: [], batches: [], opening_stock: [] } }) }));
vi.mock("./pdf", () => ({ outlookPdf: async () => new Uint8Array() }));
vi.mock("./modules", () => ({ moduleSettings: async () => ({}) }));
vi.mock("./rebuild", () => ({ moduleSettingsGlobal: () => ({}) }));
vi.mock("./v3/week", () => ({ v3ForWeek: async () => ({ snapshot: {} }) }));
vi.mock("./schema", () => ({ assertSchemaCurrent: async () => { calls.push("schema"); } }));
vi.mock("./v5/input-data", () => ({
  v5InputOn: async () => inputOn,
  buildInputDay: async (_sb: unknown, d: string) => { calls.push(`build ${d}`); return "ok"; },
}));

const { releaseWeek } = await import("./release");

/** memSb that notes the moment the K35 pre-check reads the grid. */
function sb() {
  const m = memSb({ input_completeness_daily: cells });
  return { from: (t: string) => { if (t === "input_completeness_daily") calls.push("read grid"); return (m.from as (t: string) => unknown)(t); }, rpc: async () => ({ data: "rel1", error: null }), storage: { from: () => ({ upload: async () => ({ error: null }) }) } };
}

beforeEach(() => { calls.length = 0; inputOn = true; cells = []; vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("KGR_TEST_NOW", "2026-08-28T16:00:00+07:00"); });

describe("R79: rilis membangun ulang grid minggu itu sebelum pre-check K35", () => {
  it("7 hari (Sen–Min) dibangun, baru grid dibaca; sel merah yang tersisa menahan rilis", async () => {
    cells = [{ date: "2026-08-27", kind: "costing_wp", owner_role: "cost_accounting", status: "late", due_at: "2026-08-27T12:00:00+07:00", note: "126/PO/KGR/08/2026" }];
    await expect(releaseWeek(sb() as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/K35 kelengkapan data merah: costing_wp 27\/08/);
    const builds = calls.filter((c) => c.startsWith("build "));
    expect(builds).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"].map((d) => `build ${d}`));
    expect(calls.indexOf("read grid")).toBeGreaterThan(calls.lastIndexOf(builds[6]));
    expect(calls.indexOf("schema")).toBe(0);
  });
  it("tanpa sel sama sekali (grid belum dibangun) tetap ditolak K45 sesudah dibangun ulang", async () => {
    await expect(releaseWeek(sb() as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/K35: grid kelengkapan belum dibangun/);
    expect(calls.filter((c) => c.startsWith("build ")).length).toBe(7);
  });
  it("v5_input mati: tidak ada yang dibangun ulang dan grid tidak dibaca", async () => {
    inputOn = false;
    await releaseWeek(sb() as never, "2026-08-24", "finance@e2e.test").catch(() => {});
    expect(calls.filter((c) => c.startsWith("build "))).toEqual([]);
    expect(calls).not.toContain("read grid");
  });
});
