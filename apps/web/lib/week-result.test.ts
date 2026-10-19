/** PRD v6 R120 / K80: with v6_snapshot_read a page reads one snapshot row; without one it computes and says so. */
import { describe, expect, it, vi } from "vitest";
import { computeWeek, encodeResult, snapshotJson } from "@kgr/engine";
import { loadFixtureWeek } from "@kgr/engine/fixtures";
import { memSb } from "../test-support/mem-sb";

vi.mock("server-only", () => ({}));
const result = computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27"));
let computed = 0;
vi.mock("./data", async (orig) => ({ ...(await orig<typeof import("./data")>()), computeForWeek: async () => { computed++; return { result, loaded: {}, computeMs: 1 }; } }));
vi.mock("./supabase-service", () => ({ supabaseService: () => null }));
vi.mock("./request-context", () => ({ getRequestContext: async () => ({}) }));
vi.mock("./supabase", () => ({ supabaseServer: async () => null }));

const { weekResultFor, SNAPSHOT_MISSING } = await import("./week-result");
const week = { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", status: "open" } as never;
const on = { v6_snapshot_read: { enabled: true, roles: ["finance"] } } as never;

describe("weekResultFor", () => {
  it("flag on + snapshot: one read of week_snapshot, nothing computed", async () => {
    computed = 0;
    const sb = memSb({ week_snapshot: [{ id: "s1", week_id: "w1", version: 1, engine_version: result.engineVersion, inputs_hash: "h", built_at: "2026-08-28T10:05:00Z", built_by: "rebuild", result: JSON.parse(JSON.stringify(encodeResult(result))) }] });
    const c = await weekResultFor(sb as never, week, on, "finance");
    expect(c?.source).toBe("snapshot");
    expect(c?.builtLabel).toBe("dihitung 28 Agu 17.05");
    expect(snapshotJson(c!.result)).toBe(snapshotJson(result));
    expect(computed).toBe(0);
    expect(new Set(sb.log.map((l) => l.table))).toEqual(new Set(["week_snapshot"]));
  });
  it("flag on, no snapshot (K80): computed once, the source line says so", async () => {
    computed = 0;
    const c = await weekResultFor(memSb({ week_snapshot: [] }) as never, week, on, "finance");
    expect(c?.source).toBe("live");
    expect(c?.note).toBe(SNAPSHOT_MISSING);
    expect(computed).toBe(1);
  });
  it("a snapshot of an older update date is not used", async () => {
    computed = 0;
    const old = { ...encodeResult(result) as object };
    const sb = memSb({ week_snapshot: [{ id: "s1", week_id: "w1", version: 1, engine_version: "x", inputs_hash: "h", built_at: "2026-08-27T10:00:00Z", built_by: "r", result: old }] });
    const c = await weekResultFor(sb as never, { ...(week as object), update_date: "2026-08-28" } as never, on, "finance");
    expect(c?.source).toBe("live");
    expect(computed).toBe(1);
  });
  it("flag off for the role: computed as before v6, no snapshot read", async () => {
    computed = 0;
    const sb = memSb({ week_snapshot: [] });
    const c = await weekResultFor(sb as never, week, on, "sales");
    expect(c?.source).toBe("live");
    expect(c?.note).toBeNull();
    expect(sb.log.length).toBe(0);
  });
});
