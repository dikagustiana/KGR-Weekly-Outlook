/** PRD v5.1 K41 / K42 (R25, R26): errors are not rows; `.in()` in chunks of 200. */
import { describe, expect, it, vi } from "vitest";
import { LoaderError, inChunks, isSchemaError, must, mustRows, orMissingTable, tileData, tileError, tileValue } from "./loader";
import { fakeSb } from "./fake-sb";

describe("must / mustRows", () => {
  it("a PostgREST error throws LoaderError naming the loader", () => {
    expect(() => must({ data: null, error: { message: "column week.x does not exist" } }, "minggu ini: stok")).toThrow(LoaderError);
    expect(() => mustRows({ data: null, error: { message: "permission denied for table batch" } }, "costing")).toThrow("costing: permission denied for table batch");
  });
  it("no row is null (maybeSingle), an empty list is []", () => {
    expect(must({ data: null, error: null }, "x")).toBeNull();
    expect(mustRows({ data: [], error: null }, "x")).toEqual([]);
  });
});

describe("schema errors (R43 K56 / R44 K57)", () => {
  it("must / mustRows flag a PostgREST schema code as schema: true", () => {
    try { must({ data: null, error: { message: "column price_list_week.deleted_at does not exist", code: "42703" } }, "probe"); } catch (e) {
      expect(e).toBeInstanceOf(LoaderError);
      expect((e as LoaderError).schema).toBe(true);
    }
    try { mustRows({ data: null, error: { message: "relation allocation does not exist", code: "42P01" } }, "ledger"); } catch (e) {
      expect((e as LoaderError).schema).toBe(true);
    }
  });
  it("isSchemaError knows the K57 codes only", () => {
    expect(isSchemaError("42P01")).toBe(true);
    expect(isSchemaError("42703")).toBe(true);
    expect(isSchemaError("PGRST204")).toBe(true);
    expect(isSchemaError("42501")).toBe(false);
    expect(isSchemaError(undefined)).toBe(false);
  });
  it("orMissingTable returns [] only for 42P01; any other error throws", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(orMissingTable({ data: null, error: { message: "relation allocation does not exist", code: "42P01" } }, "ledger.allocation")).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ledger.allocation"));
    expect(() => orMissingTable({ data: null, error: { message: "permission denied", code: "42501" } }, "ledger.allocation")).toThrow(LoaderError);
    log.mockRestore();
  });
});

describe("tileData", () => {
  it("returns the value, or the error for that tile only, logged with the loader name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await tileData("a", async () => 5)).toEqual({ ok: 5 });
    const t = await tileData("minggu ini: kas", async () => must({ data: null, error: { message: "relation cash_position_daily does not exist" } }, "cash_position_daily"));
    expect(tileError(t)).toBe("minggu ini: kas — cash_position_daily: relation cash_position_daily does not exist");
    expect(tileValue(t, [] as unknown[])).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("relation cash_position_daily does not exist"));
    log.mockRestore();
  });
});

describe("inChunks (K42)", () => {
  it("450 ids → 3 requests of 200, 200 and 50, results in order", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const sizes: number[] = [];
    const out = await inChunks(ids, async (part) => { sizes.push(part.length); return part.map((p) => p.toUpperCase()); });
    expect(sizes).toEqual([200, 200, 50]);
    expect(out).toHaveLength(450);
    expect(out[0]).toBe("ID-0");
    expect(out[449]).toBe("ID-449");
  });
  it("through a client: one .in() per chunk", async () => {
    const sb = fakeSb({ rows: { sales_line: [{ id: "a" }] } });
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    await inChunks(ids, async (part) => mustRows(await (sb.from("sales_line") as never as { select: (c: string) => { in: (c: string, v: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } }).select("id").in("id", part), "x"));
    expect(sb.calls.filter((c) => c === "sales_line:in")).toHaveLength(3);
  });
  it("no ids: no request", async () => {
    const q = vi.fn();
    expect(await inChunks([], q)).toEqual([]);
    expect(q).not.toHaveBeenCalled();
  });
});
