/**
 * PRD v5.1 R23: the PI upload (cost_pool_pi) attaches a line to an actual batch only; a batch ref without one rejects
 * the commit before any cost_pool_line is written.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeSb } from "../fake-sb";

vi.mock("server-only", () => ({}));
await import("./costing");
const { v3Kind } = await import("./uploads");

const line = { document_ref: "PI-0827-01", date: "2026-08-27", component: "maklon", amount: "1500000", supplier: "Maklon A", batch_ref: "B-0827-1" };
const commit = (sb: ReturnType<typeof fakeSb>) => v3Kind("cost_pool_pi")!.commit!({ sb: sb as never, uploadId: "u1", rows: [{ target: "pi", data: line }] } as never);

describe("cost_pool_pi takes an actual batch only (R23)", () => {
  it("no actual batch B-0827-1 (only a Rencana one, filtered out): rejected, nothing written", async () => {
    const sb = fakeSb({ rows: { batch: [] } });
    await expect(commit(sb)).rejects.toThrow("batch aktual B-0827-1 belum ada");
    expect(sb.calls.filter((c) => c === "batch:eq")).toHaveLength(1);
    expect(sb.calls.some((c) => c.startsWith("cost_pool_line:"))).toBe(false);
  });
  it("an actual batch: the line carries its id", async () => {
    const inserted: unknown[] = [];
    const sb = fakeSb({ rows: { batch: [{ id: "b-aktual", batch_ref: "B-0827-1" }], cost_pool: [{ id: "pool-1" }] } });
    const from = sb.from.bind(sb);
    sb.from = (t: string) => {
      const q = from(t) as Record<string, (...a: unknown[]) => unknown>;
      if (t === "cost_pool_line") { const ins = q.insert; q.insert = (r: unknown) => { inserted.push(r); return ins(r); }; }
      return q;
    };
    await commit(sb).catch(() => undefined);
    expect(inserted).toEqual([expect.objectContaining({ batch_id: "b-aktual", document_ref: "PI-0827-01" })]);
  });
});
