/**
 * Review v5.3 V8 (PRD v5.3 "Kesiapan pilot"): the claim of a queued date is one conditional update
 * (`status = 'queued'` → `running`, returning the ids). Before, `processRebuildQueue` read the queued rows and then
 * marked them `running` in a second, unconditional update: two runs that read the same queue — the cron at 22.00 UTC and
 * the "Bangun ulang" button, or two uploads saving at the same time — both built the same date and both wrote the mart.
 * Here, on the in-memory client (no RLS, no triggers): (1) two runs started on the same queue build every date exactly once;
 * (2) a date another process took between the read and the claim is left to it, with a note, and its status is not
 * overwritten. PostgreSQL itself is proved by tests/e2e (F19: the cron and the Finance rebuild write the same mart).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memSb, type MemRow, type MemSb } from "../test-support/mem-sb";
import { weekRows } from "../test-support/week-rows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("./supabase", () => ({ supabaseServer: async () => { throw new Error("session client must not be opened by the rebuild"); } }));
vi.mock("./supabase-service", () => ({ supabaseService: () => null }));

const { processRebuildQueue } = await import("./rebuild");
const { EXPECTED_SCHEMA } = await import("./schema");

const DATES = ["2026-08-26", "2026-08-27"];
const settings = { m4_monthly: { enabled: true, roles: null }, m6_cash: { enabled: true, roles: null } } as never;

/** The golden week, both flags on, the two dates queued (one row each, as queueRebuild writes them). */
function database(): MemSb {
  return memSb({
    ...weekRows("2026-08-24", "2026-08-27").rows,
    app_setting: [{ key: "m4_monthly", value: { enabled: true } }, { key: "m6_cash", value: { enabled: true } }],
    rebuild_queue: DATES.map((date, i): MemRow => ({ id: `q${i}`, date, status: "queued" })),
  }, {
    rpc: {
      schema_version: () => ({ data: EXPECTED_SCHEMA }),
      mart_replace: (a) => ({ data: { written: (a.p_rows as unknown[]).length, deleted: 0 } }),
    },
  });
}
const marts = (sb: MemSb) => sb.rpcCalls.filter((c) => c.name === "mart_replace").map((c) => `${String(c.args.p_table)}@${String(c.args.p_scope)}`);
const queue = (sb: MemSb) => Object.fromEntries(sb.tables.rebuild_queue.map((r) => [String(r.id), String(r.status)]));

beforeEach(() => { vi.stubEnv("KGR_TEST_NOW", "2026-08-28T08:00:00+07:00"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("V8: the claim of a queued date is conditional (status = 'queued' → 'running', returning the ids)", () => {
  it("the claim is one update filtered on status = 'queued' that returns the rows it took", async () => {
    const db = database();
    await processRebuildQueue(settings, { limit: 30, client: db as never });
    const claims = db.calls("rebuild_queue:update").filter((l) => (l.payload as MemRow).status === "running");
    expect(claims.length).toBe(DATES.length);
    for (const c of claims) expect(c.filters).toEqual(expect.arrayContaining([expect.stringMatching(/^eq status queued$/), expect.stringMatching(/^in id \[/)]));
    expect(queue(db)).toEqual({ q0: "done", q1: "done" });
  });

  it("two runs on the same queue (cron + tombol 'Bangun ulang'): every date is built once, the loser says so", async () => {
    const db = database();
    const [a, b] = await Promise.all([
      processRebuildQueue(settings, { limit: 30, client: db as never }),
      processRebuildQueue(settings, { limit: 30, client: db as never }),
    ]);
    expect([...a.notes, ...b.notes].filter((n) => /GAGAL/.test(n))).toEqual([]);
    expect(a.done + b.done).toBe(DATES.length);
    expect(a.failed + b.failed).toBe(0);
    // the two runs together write exactly what one run writes alone (before V8 both runs built every date: double writes)
    const alone = database();
    await processRebuildQueue(settings, { limit: 30, client: alone as never });
    expect(marts(alone).length).toBeGreaterThan(0);
    expect(marts(db).sort()).toEqual(marts(alone).sort());
    // the run that lost a date says it (not "done", not silent)
    expect([...a.notes, ...b.notes].some((n) => /sedang dibangun proses lain/.test(n))).toBe(true);
    expect(queue(db)).toEqual({ q0: "done", q1: "done" });
  });

  it("a date another process took between the read and the claim is left to it: not built, not marked, named in the notes", async () => {
    const db = database();
    const from = db.from.bind(db);
    // the other process: right after this run reads the queued rows, it has already claimed them
    db.from = (t: string) => {
      const q = from(t) as Record<string, unknown> & { then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise<unknown> };
      if (t !== "rebuild_queue") return q;
      const then = q.then.bind(q);
      q.then = (ok, ko) => then((v) => {
        const read = db.log[db.log.length - 1];
        if (read.op === "select" && read.filters.includes("eq status queued")) for (const r of db.tables.rebuild_queue) r.status = "running";
        return ok(v);
      }, ko);
      return q;
    };
    const r = await processRebuildQueue(settings, { limit: 30, client: db as never });
    expect(r).toMatchObject({ done: 0, failed: 0 });
    expect(marts(db)).toEqual([]);
    expect(r.notes).toEqual([`${DATES.length} tanggal sedang dibangun proses lain (cron atau tombol); tidak dibangun dua kali`]);
    expect(queue(db)).toEqual({ q0: "running", q1: "running" });
  });
});
