/** PRD v6 R123: worker pagination — larger pages, parallel rounds, a server cap below the asked size is not the end. */
import { describe, expect, it } from "vitest";
import { fetchAll } from "./data";

const table = (n: number, cap: number) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { rows, calls, page };
};

describe("fetchAll (R123)", () => {
  it("default: pages of 1000 one after the other, as before v6", async () => {
    const t = table(2500, 1000);
    expect((await fetchAll(t.page)).length).toBe(2500);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("worker: 5000 asked, server capped at 1000 → every row, in order", async () => {
    const t = table(6211, 1000);
    const got = await fetchAll(t.page, 1000, { size: 5000, parallel: 4 });
    expect(got).toEqual(t.rows);
    expect(t.calls.length).toBe(9); // first + two rounds of four
  });
  it("worker: max-rows 5000 → two requests for 6211 rows", async () => {
    const t = table(6211, 5000);
    expect((await fetchAll(t.page, 1000, { size: 5000, parallel: 1 })).length).toBe(6211);
    expect(t.calls.length).toBe(2);
  });
  it("worker: a small table is one request", async () => {
    const t = table(37, 5000);
    expect((await fetchAll(t.page, 1000, { size: 5000, parallel: 4 })).length).toBe(37);
    expect(t.calls.length).toBe(1);
  });
  it("worker: exactly 1000 rows under a 1000 cap ends at the first empty page", async () => {
    const t = table(1000, 1000);
    expect((await fetchAll(t.page, 1000, { size: 5000, parallel: 2 })).length).toBe(1000);
  });
  it("an error throws", async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: "x" } }), 1000, { size: 5000 })).rejects.toThrow("x");
  });
});
