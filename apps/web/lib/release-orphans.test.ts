/**
 * Review v5.3 V7: `releaseWeek` stores the JSON and the PDF before `public.release_week` runs (the release row names the
 * PDF path). When the RPC refuses the release — the in-transaction check (PRD v4 §7.2) can still say no after the
 * pre-check passed — or the PDF upload fails after the JSON, the files stored so far are removed; on success nothing is
 * removed. The removal uses the service client (storage.objects has no delete policy for a session); without the key the
 * session client is tried and what stays is logged by path. Collaborators are mocked; the storage calls are the evidence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@kgr/engine", async (orig) => ({
  ...(await orig<typeof import("@kgr/engine")>()),
  computeWeek: () => ({ controls: { controls: [], overall: "LULUS" } }),
  snapshotJsonV3: () => "{}",
}));
vi.mock("./data", () => ({ WORKER_PAGES: {}, loadWeek: async () => ({ week: { id: "w1", update_date: "2026-08-27" }, inputs: { sales_lines: [], receipt_lines: [], batches: [], opening_stock: [] } }) }));
vi.mock("./pdf", () => ({ outlookPdf: async () => new Uint8Array([1, 2, 3]) }));
vi.mock("./modules", () => ({ moduleSettings: async () => ({}) }));
vi.mock("./rebuild", () => ({ moduleSettingsGlobal: () => ({}) }));
vi.mock("./v3/week", () => ({ v3ForWeek: async () => ({ snapshot: {} }) }));
vi.mock("./schema", () => ({ assertSchemaCurrent: async () => {} }));
vi.mock("./v5/input-data", () => ({ v5InputOn: async () => false, buildInputDay: async () => "ok" }));

type Removed = { who: string; paths: string[] };
const removed: Removed[] = [];
let serviceRemoves: (paths: string[]) => { data: { name: string }[] | null; error: { message: string } | null } = (paths) => ({ data: paths.map((name) => ({ name })), error: null });
const storageOf = (who: string, removeFn: (paths: string[]) => unknown) => ({ from: () => ({ upload: uploadFn, remove: async (paths: string[]) => { removed.push({ who, paths }); return removeFn(paths); } }) });
let uploadFn: (path: string) => Promise<{ error: { message: string } | null }> = async () => ({ error: null });
let service: unknown = null;
vi.mock("./supabase-service", () => ({ supabaseService: () => service }));

const { releaseWeek } = await import("./release");

const mem = () => ({
  release_override: [] as Record<string, unknown>[], rebuild_queue: [] as Record<string, unknown>[], release_override_policy: [] as Record<string, unknown>[], app_setting: [] as Record<string, unknown>[],
  release: [] as Record<string, unknown>[],
});
/** What the `release` table answers when asked for the PDF path: rows, or an error (the reconcile read of removeReleaseFiles). */
let releaseRows: Record<string, unknown>[] | { error: string } = [];
const releaseReads: string[] = [];
/** A session client whose reads are empty, whose RPC answers as told, with the session's own (RLS-bound) storage. */
function sb(rpc: () => { data: unknown; error: { message: string } | null }, sessionRemoves: (paths: string[]) => unknown = (paths) => ({ data: paths.map((name) => ({ name })), error: null })) {
  const t = mem();
  const q = (rows: unknown, table?: string) => {
    const o: Record<string, unknown> = {}; const self = () => o; for (const k of ["select", "is", "in", "gte", "lte", "limit"]) o[k] = self;
    o.eq = (c: string, v: unknown) => { if (table === "release" && c === "pdf_path") releaseReads.push(String(v)); return o; };
    o.maybeSingle = async () => ({ data: null, error: null });
    o.then = (ok: (v: unknown) => unknown) => Promise.resolve(table === "release" && !Array.isArray(releaseRows) ? { data: null, error: { message: releaseRows.error } } : { data: table === "release" ? releaseRows : rows, error: null }).then(ok);
    return o;
  };
  return { from: (n: keyof ReturnType<typeof mem>) => q(t[n] ?? [], n), rpc: async () => rpc(), storage: storageOf("session", sessionRemoves) };
}
const uploaded: string[] = [];

beforeEach(() => {
  removed.length = 0; uploaded.length = 0; releaseRows = []; releaseReads.length = 0;
  uploadFn = async (path: string) => { uploaded.push(path); return { error: null }; };
  service = { storage: storageOf("service", (p) => serviceRemoves(p)) };
  serviceRemoves = (paths) => ({ data: paths.map((name) => ({ name })), error: null });
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("KGR_TEST_NOW", "2026-08-28T16:00:00+07:00");
});

describe("V7: a refused release leaves no file behind", () => {
  it("success: JSON and PDF stored, the RPC writes the row, nothing removed", async () => {
    const r = await releaseWeek(sb(() => ({ data: "rel1", error: null })) as never, "2026-08-24", "finance@e2e.test");
    expect(r.id).toBe("rel1");
    expect(uploaded.map((p) => p.replace(/^.*(\.json|\.pdf)$/, "$1"))).toEqual([".json", ".pdf"]);
    expect(removed).toEqual([]);
  });
  it("the RPC refuses (the in-transaction check): both files are removed with the service client, the RPC's message is the error", async () => {
    await expect(releaseWeek(sb(() => ({ data: null, error: { message: "Rilis ditolak — C7 BELUM DIISI" } })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/Rilis ditolak — C7 BELUM DIISI/);
    expect(uploaded).toHaveLength(2);
    expect(removed).toEqual([{ who: "service", paths: uploaded }]);
  });
  it("the PDF upload fails after the JSON: only the JSON is removed, the upload error is the error", async () => {
    uploadFn = async (path: string) => { if (path.endsWith(".pdf")) return { error: { message: "Payload too large" } }; uploaded.push(path); return { error: null }; };
    await expect(releaseWeek(sb(() => ({ data: "never", error: null })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/Simpan PDF: Payload too large/);
    expect(removed).toEqual([{ who: "service", paths: [uploaded[0]] }]);
    expect(removed[0].paths[0]).toMatch(/\.json$/);
  });
  it("the JSON upload fails: nothing stored, nothing to remove", async () => {
    uploadFn = async () => ({ error: { message: "Bucket not found" } });
    await expect(releaseWeek(sb(() => ({ data: "never", error: null })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/Simpan snapshot: Bucket not found/);
    expect(removed).toEqual([]);
  });
  it("without the service key the session client is tried; files RLS keeps (no delete policy) are logged by path, the user still sees the RPC's error", async () => {
    service = null;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // PostgREST/Storage under RLS answers 200 with an empty list when the policy hides the rows
    await expect(releaseWeek(sb(() => ({ data: null, error: { message: "Rilis ditolak — STALE" } }), () => ({ data: [], error: null })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/Rilis ditolak — STALE/);
    expect(removed).toEqual([{ who: "session", paths: uploaded }]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("berkas yatim"));
    expect(log.mock.calls[0][0]).toContain(uploaded[1]);
    log.mockRestore();
  });
  it("the RPC answered an error but the release row exists (answer lost after commit): nothing is removed, the user still sees the error", async () => {
    releaseRows = [{ id: "rel-x" }];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(releaseWeek(sb(() => ({ data: null, error: { message: "TypeError: fetch failed" } })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/fetch failed/);
    expect(releaseReads).toEqual([uploaded[1]]);
    expect(removed).toEqual([]);
    expect(log.mock.calls[0][0]).toMatch(/berkas tidak dihapus.*tercatat/);
    log.mockRestore();
  });
  it("the reconcile read itself fails: nothing is removed (a release without its files is worse than orphans), the path is logged", async () => {
    releaseRows = { error: "connection reset" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(releaseWeek(sb(() => ({ data: null, error: { message: "Rilis ditolak — C7" } })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/Rilis ditolak — C7/);
    expect(removed).toEqual([]);
    expect(log.mock.calls[0][0]).toMatch(/tidak bisa memastikan.*connection reset/);
    log.mockRestore();
  });
  it("a failing remove never hides the release error", async () => {
    serviceRemoves = () => { throw new Error("storage down"); };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(releaseWeek(sb(() => ({ data: null, error: { message: "Rilis ditolak — K35" } })) as never, "2026-08-24", "finance@e2e.test")).rejects.toThrow(/Rilis ditolak — K35/);
    expect(log.mock.calls[0][0]).toMatch(/berkas yatim.*storage down/);
    log.mockRestore();
  });
});
