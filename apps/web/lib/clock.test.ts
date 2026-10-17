/** PRD v5.1 K38 (R10): the data date and the wall clock; replaces data-today.test.ts (Q-v5-54). */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { clock, dataToday, taskWindow, wallNow } = await import("./clock");

/** The one query of dataToday: week.update_date ≤ today, latest first, one row; `fail` = a PostgREST error. */
function fakeSb(updates: string[], fail?: string) {
  let max: string | null = null;
  const q = {
    select: () => q,
    lte: (_c: string, v: string) => { max = v; return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => {
      if (fail) return { data: null, error: { message: fail } };
      const ok = updates.filter((u) => max === null || u <= max).sort().reverse();
      return { data: ok.length ? { update_date: ok[0] } : null, error: null };
    },
  };
  return { from: () => q } as never;
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("dataToday", () => {
  it("data that stops on 27 Aug reads as of 27 Aug in October", async () => {
    expect(await dataToday(fakeSb(["2026-08-27"]), "2026-10-16")).toBe("2026-08-27");
  });
  it("a week created ahead (update date = week start, after today) does not make old data current", async () => {
    expect(await dataToday(fakeSb(["2026-08-27", "2026-10-19"]), "2026-10-16")).toBe("2026-08-27");
  });
  it("current data: today; no week yet: today", async () => {
    expect(await dataToday(fakeSb(["2026-10-16"]), "2026-10-16")).toBe("2026-10-16");
    expect(await dataToday(fakeSb([]), "2026-10-16")).toBe("2026-10-16");
  });
  it("K41 whitelist: a failing week query falls back to the wall date and is logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await dataToday(fakeSb(["2026-08-27"], "column week.update_date does not exist"), "2026-10-17")).toBe("2026-10-17");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("column week.update_date does not exist"));
  });
});

describe("clock()", () => {
  it("data = update date, wall and now from the WIB clock (KGR_TEST_NOW under NODE_ENV=test)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("KGR_TEST_NOW", "2026-10-17T09:30:00+07:00");
    expect(await clock(fakeSb(["2026-08-27"]))).toEqual({ data: "2026-08-27", wall: "2026-10-17", now: "2026-10-17T09:30:00+07:00" });
  });
  it("a UTC test time is turned into WIB: 17 Oct 20.00Z is 18 Oct 03.00 WIB", () => {
    expect(wallNow(new Date("2026-10-17T20:00:00Z"))).toEqual({ date: "2026-10-18", time: "03:00", now: "2026-10-18T03:00:00+07:00" });
  });
  it("KGR_TEST_NOW is ignored outside NODE_ENV=test", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KGR_TEST_NOW", "2020-01-01T00:00:00+07:00");
    expect(wallNow().date).not.toBe("2020-01-01");
  });
  it("task window: wall − 13 … wall + 7", () => {
    expect(taskWindow({ wall: "2026-10-17" })).toEqual({ from: "2026-10-04", to: "2026-10-24" });
  });
});
