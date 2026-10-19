/** PRD v6 R119 / R122 / K77: week_snapshot written once per input state, read back as the computed result. */
import { describe, expect, it, vi } from "vitest";
import { computeWeek, snapshotJson } from "@kgr/engine";
import { loadFixtureWeek } from "@kgr/engine/fixtures";
import { memSb } from "../test-support/mem-sb";

vi.mock("server-only", () => ({}));
const { inputsHash, readSnapshot, writeSnapshot, builtAtLabel } = await import("./snapshot");
const { snapshotForDate } = await import("./snapshot-builder");

const inputs = loadFixtureWeek("2026-08-24", "2026-08-27");
const result = computeWeek(inputs);

describe("week_snapshot", () => {
  it("writes version 1, then nothing while the inputs stay the same (R122 done unchanged)", async () => {
    const sb = memSb({ week_snapshot: [] });
    const h = inputsHash(inputs);
    const a = await writeSnapshot(sb as never, "w1", result, { inputsHash: h, builtBy: "test" });
    expect(a.status).toBe("written");
    expect(a.meta.version).toBe(1);
    const b = await writeSnapshot(sb as never, "w1", result, { inputsHash: h, builtBy: "test" });
    expect(b.status).toBe("unchanged");
    expect(sb.tables.week_snapshot.length).toBe(1);
    const c = await writeSnapshot(sb as never, "w1", result, { inputsHash: "other", builtBy: "test" });
    expect(c.status).toBe("written");
    expect(c.meta.version).toBe(2);
  });

  it("reads the latest version back as the same result (T29)", async () => {
    const sb = memSb({ week_snapshot: [] });
    await writeSnapshot(sb as never, "w1", result, { inputsHash: "a", builtBy: "test" });
    // stored as JSON text by PostgREST: round-trip through JSON like jsonb
    sb.tables.week_snapshot = JSON.parse(JSON.stringify(sb.tables.week_snapshot));
    const s = await readSnapshot(sb as never, "w1");
    expect(s?.meta.version).toBe(1);
    expect(snapshotJson(s!.result)).toBe(snapshotJson(result));
  });

  it("no snapshot → null; a database without the table → null (K80 falls back), other errors throw", async () => {
    expect(await readSnapshot(memSb({ week_snapshot: [] }) as never, "w1")).toBeNull();
    expect(await readSnapshot(memSb({}, { fail: { week_snapshot: { message: "relation does not exist", code: "42P01" } } }) as never, "w1")).toBeNull();
    await expect(readSnapshot(memSb({}, { fail: { week_snapshot: "boom" } }) as never, "w1")).rejects.toThrow("boom");
  });

  it("inputs_hash is stable and changes with any input", () => {
    expect(inputsHash(inputs)).toBe(inputsHash(loadFixtureWeek("2026-08-24", "2026-08-27")));
    expect(inputsHash({ ...inputs, week: { ...inputs.week, update_date: "2026-08-28" } })).not.toBe(inputsHash(inputs));
  });

  it("a released or closed week is never computed again (K77)", async () => {
    const sb = memSb({ week: [{ id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", status: "released" }], week_snapshot: [] });
    expect(await snapshotForDate(sb as never, "2026-08-26")).toMatch(/released: tidak dihitung ulang/);
    expect(sb.tables.week_snapshot.length).toBe(0);
    expect(await snapshotForDate(sb as never, "2026-09-26")).toBe("tidak ada minggu");
  });

  it("built_at label in WIB (K79)", () => {
    expect(builtAtLabel("2026-08-28T10:05:00Z")).toBe("dihitung 28 Agu 17.05");
  });
});
