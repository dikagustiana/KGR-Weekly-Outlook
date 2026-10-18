/**
 * Q-v5.2-52: PPIC drains the rebuild queue up to the date of the allocation screen when C45 is STALE — oldest dates first, at most
 * the dates up to that screen date, through the same processRebuildQueue as Finance (service client). The role is checked in the
 * action; the schema must be current. Collaborators are mocked; the arguments of processRebuildQueue are the evidence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memSb } from "../test-support/mem-sb";

const run = vi.fn(async (_s: unknown, o: { limit?: number }) => ({ done: o.limit ?? 0, failed: 0, notes: [] as string[] }));
let behind: string | null = null;
vi.mock("server-only", () => ({}));
vi.mock("./rebuild", () => ({ processRebuildQueue: (s: unknown, o: { limit?: number }) => run(s, o), moduleSettingsGlobal: (s: unknown) => s }));
vi.mock("./schema", () => ({ assertSchemaCurrent: async () => { if (behind) throw new Error(behind); } }));

const { rebuildQueueUntil, REBUILD_UNTIL_MAX_DATES } = await import("./rebuild-until");
const q = (...dates: string[]) => dates.map((date, i) => ({ id: `q${i}`, date, status: "queued" }));
beforeEach(() => { run.mockClear(); behind = null; });

describe("Q-v5.2-52: bangun ulang antrean sampai tanggal layar", () => {
  it("antrean 10 tanggal (lebih dari batas inline 7): semua tanggal sampai hari ini dalam satu proses, tanggal berikutnya tidak", async () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-08-${String(18 + i).padStart(2, "0")}`); // 18 … 27 Aug
    const sb = memSb({ rebuild_queue: [...q(...days), ...q("2026-08-28", "2026-08-31"), { id: "x", date: "2026-08-19", status: "done" }] }) as never;
    const r = await rebuildQueueUntil(sb, {}, "2026-08-27");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({ limit: 10 });
    expect(r).toMatchObject({ queued: 10, done: 10, failed: 0, left: 0 });
  });
  it("tanggal ganda di antrean dihitung sekali", async () => {
    const sb = memSb({ rebuild_queue: q("2026-08-26", "2026-08-26", "2026-08-27") }) as never;
    await rebuildQueueUntil(sb, {}, "2026-08-27");
    expect(run.mock.calls[0][1]).toMatchObject({ limit: 2 });
  });
  it(`satu tekan paling banyak ${REBUILD_UNTIL_MAX_DATES} tanggal; sisanya dilaporkan`, async () => {
    const dates = Array.from({ length: 70 }, (_, i) => new Date(Date.UTC(2026, 5, 20 + i)).toISOString().slice(0, 10));
    const sb = memSb({ rebuild_queue: q(...dates) }) as never;
    const r = await rebuildQueueUntil(sb, {}, "2026-09-30");
    expect(run.mock.calls[0][1]).toMatchObject({ limit: REBUILD_UNTIL_MAX_DATES });
    expect(r).toMatchObject({ queued: 70, left: 70 - REBUILD_UNTIL_MAX_DATES });
  });
  it("antrean kosong sampai tanggal itu: tidak ada yang dijalankan", async () => {
    const sb = memSb({ rebuild_queue: q("2026-08-28") }) as never;
    expect(await rebuildQueueUntil(sb, {}, "2026-08-27")).toMatchObject({ queued: 0, done: 0 });
    expect(run).not.toHaveBeenCalled();
  });
  it("skema database tertinggal: berhenti sebelum menyentuh antrean (K57)", async () => {
    behind = "Skema database belum diperbarui ke v5.2.0; hubungi Admin (schema_version())";
    const sb = memSb({ rebuild_queue: q("2026-08-27") }) as never;
    await expect(rebuildQueueUntil(sb, {}, "2026-08-27")).rejects.toThrow(/Skema database belum diperbarui/);
    expect(run).not.toHaveBeenCalled();
  });
});
