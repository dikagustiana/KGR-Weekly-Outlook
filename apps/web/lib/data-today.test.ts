/** dataToday (docs/v5/QUESTIONS.md Q-v5-54): the date the data stands on, from the weeks' update dates. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabaseServer: async () => null }));
const { dataToday } = await import("./data");

/** The one query dataToday makes: week.update_date ≤ today, latest first, one row. */
function fakeSb(updates: string[]) {
  let max: string | null = null;
  const q = {
    select: () => q,
    lte: (_c: string, v: string) => { max = v; return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => {
      const ok = updates.filter((u) => max === null || u <= max).sort().reverse();
      return { data: ok.length ? { update_date: ok[0] } : null, error: null };
    },
  };
  return { from: () => q } as never;
}

describe("dataToday", () => {
  it("data that stops on 27 Aug reads as of 27 Aug in October", async () => {
    expect(await dataToday(fakeSb(["2026-08-27"]), "2026-10-16")).toBe("2026-08-27");
  });
  it("a week created ahead (rollover before Monday: update date = week start) does not make old data current", async () => {
    expect(await dataToday(fakeSb(["2026-08-27", "2026-10-19"]), "2026-10-16")).toBe("2026-08-27");
  });
  it("current data: today; no week yet: today", async () => {
    expect(await dataToday(fakeSb(["2026-10-16"]), "2026-10-16")).toBe("2026-10-16");
    expect(await dataToday(fakeSb([]), "2026-10-16")).toBe("2026-10-16");
  });
});
