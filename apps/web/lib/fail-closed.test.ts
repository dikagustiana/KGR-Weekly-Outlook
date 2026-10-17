/**
 * PRD v5.2-A irisan A1 — the evidence the PRD asks for: R41 (flags fail closed), R42 (release context), R44 (schema
 * banner + early refusal), R45 (builder order, stuck rows), R46 (cron route), R47 (paging without duplicates).
 * F19 (rebuild one date twice → identical solvency_monthly) needs a real database: tests/e2e (A5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSb, type FakeSb } from "./fake-sb";
import { LoaderError } from "./loader";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
let sb: FakeSb = fakeSb();
let svc: FakeSb | null = null;
vi.mock("./supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("./supabase-service", () => ({ supabaseService: () => svc }));
vi.mock("./session", () => ({ requireViewer: async () => ({ email: "fin@x.test", role: "finance" }) }));

const { moduleSettingsOf, requireModuleAction } = await import("./modules");
const { releaseContext, k35State } = await import("./release");
const { classifySchemaError, schemaStatusOf, EXPECTED_SCHEMA } = await import("./schema");
const { fetchAll } = await import("./data");
const { processRebuildQueue } = await import("./rebuild");
const { BUILDERS, orderedBuilders, registerBuilder } = await import("./rebuild-registry");

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => { sb = fakeSb(); svc = null; vi.restoreAllMocks(); });

describe("R41 (K56): the module flags never fail open", () => {
  it("a failing read of app_setting throws (no module looks off, so K25/C53 stay)", async () => {
    sb = fakeSb({ fail: { app_setting: { message: "permission denied for table app_setting", code: "42501" } } });
    await expect(moduleSettingsOf(sb as never)).rejects.toThrow(LoaderError);
    await expect(moduleSettingsOf(sb as never)).rejects.toThrow("permission denied for table app_setting");
  });
  it("only a missing table (42P01) is 'no modules yet', logged", async () => {
    const log = quiet();
    sb = fakeSb({ fail: { app_setting: { message: 'relation "app_setting" does not exist', code: "42P01" } } });
    expect(await moduleSettingsOf(sb as never)).toEqual({});
    expect(log).toHaveBeenCalledWith(expect.stringContaining("42P01"));
  });
  it("the Outlook page stops with the loader error instead of rendering the v1 recommendation", async () => {
    vi.doMock("@/lib/page", () => ({ weekContext: async () => ({ computed: { result: {} }, view: "management", viewer: { role: "finance" }, week: {} }) }));
    sb = fakeSb({ fail: { app_setting: { message: "permission denied for table app_setting", code: "42501" } } });
    const { default: OutlookPage } = await import("@/app/w/[week]/outlook/page");
    await expect(OutlookPage({ params: Promise.resolve({ week: "2026-08-24" }) } as never)).rejects.toThrow(LoaderError);
    vi.doUnmock("@/lib/page");
  });
});

describe("R42 (K56): the release context fails closed", () => {
  it("an error on the v4_release flag read rejects (never 'not strict')", async () => {
    sb = fakeSb({ fail: { app_setting: "permission denied for table app_setting" } });
    await expect(releaseContext(sb as never, "week", "2026-08-24", "2026-08-24", "2026-08-30")).rejects.toThrow("releaseContext.app_setting: permission denied");
  });
  it("an error on rebuild_queue rejects (never 'no stale dates')", async () => {
    sb = fakeSb({ fail: { rebuild_queue: "canceling statement due to statement timeout" } });
    await expect(releaseContext(sb as never, "week", "2026-08-24", "2026-08-24", "2026-08-30")).rejects.toThrow("releaseContext.rebuild_queue: canceling statement");
  });
  it("an error on the grid gives the PostgREST message, not the K45 'grid belum dibangun'", async () => {
    sb = fakeSb({ rows: { app_setting: [{ key: "v5_input", value: { enabled: true } }] }, fail: { input_completeness_daily: "permission denied for table input_completeness_daily" } });
    const e = await k35State(sb as never, "2026-08-24", []).catch((x: Error) => x);
    expect(e).toBeInstanceOf(LoaderError);
    expect((e as Error).message).toContain("permission denied for table input_completeness_daily");
    expect((e as Error).message).not.toContain("grid kelengkapan belum dibangun");
  });
});

describe("R44 (K57): a schema behind the code is one message, and writes stop early", () => {
  it("classifySchemaError knows the K57 codes and names the object", () => {
    expect(classifySchemaError({ code: "42703", message: "column price_list_week.deleted_at does not exist" })).toEqual({ schema: true, object: "price_list_week.deleted_at" });
    expect(classifySchemaError({ code: "PGRST202", message: "Could not find the function public.lock_commitments(p_price_frozen, p_week_start) in the schema cache" }).schema).toBe(true);
    expect(classifySchemaError({ code: "42501", message: "permission denied for table week" })).toEqual({ schema: false });
  });
  it("the probe returns the banner for a schema error, null for anything else (tiles still fail per tile)", async () => {
    const log = quiet();
    sb = fakeSb({ fail: { price_list_week: { code: "42703", message: "column price_list_week.deleted_at does not exist" } } });
    expect(await schemaStatusOf(sb as never)).toBe(`Skema database belum diperbarui ke v${EXPECTED_SCHEMA}; hubungi Admin (price_list_week.deleted_at)`);
    sb = fakeSb({ fail: { parameter: { code: "42501", message: "permission denied" } } });
    expect(await schemaStatusOf(sb as never)).toBeNull();
    expect(log).toHaveBeenCalled();
  });
  it("a module write action is refused with the banner's message", async () => {
    quiet();
    sb = fakeSb({ rows: { app_setting: [{ key: "v5_commercial", value: { enabled: true } }] }, fail: { parameter: { code: "42703", message: "column parameter.po_unsized_mode does not exist" } } });
    await expect(requireModuleAction("v5_commercial", ["finance"])).rejects.toThrow(/Skema database belum diperbarui ke v.*parameter\.po_unsized_mode/);
  });
  it("the rebuild leaves the queue alone with the banner's message", async () => {
    quiet();
    svc = fakeSb({ rows: { rebuild_queue: [{ id: "q1", date: "2026-08-24" }] }, fail: { price_list_week: { code: "42703", message: "column price_list_week.deleted_at does not exist" } } });
    const r = await processRebuildQueue({ m1_costing: { enabled: true } });
    expect(r).toEqual({ done: 0, failed: 0, notes: [expect.stringContaining("Skema database belum diperbarui")] });
    expect(svc.calls.filter((c) => c === "rebuild_queue:update")).toEqual([]);
  });
});

describe("R45 (K60, K61): builder order and stuck rows", () => {
  it("the registered builders put cash after monthly v4 and accuracy v4 (F19), whatever the import order", () => {
    const names = orderedBuilders().map((b) => b.name);
    expect(names.indexOf("cash")).toBeGreaterThan(names.indexOf("monthly v4"));
    expect(names.indexOf("cash")).toBeGreaterThan(names.indexOf("accuracy v4"));
  });
  it("running rows older than 15 minutes are reset first; dates beyond the wall clock + 7 are marked done", async () => {
    const saved = BUILDERS.splice(0);
    const built: string[] = [];
    registerBuilder({ module: "m1_costing", name: "probe", build: async (_s, d) => { built.push(d); return "ok"; } });
    svc = fakeSb({ rows: { rebuild_queue: [{ id: "q1", date: "2026-08-24" }, { id: "q2", date: "2026-08-25" }] } });
    const r = await processRebuildQueue({ m1_costing: { enabled: true } });
    BUILDERS.splice(0, BUILDERS.length, ...saved);
    expect(built).toEqual(["2026-08-24", "2026-08-25"]);
    expect(r.done).toBe(2);
    const updates = svc.args.filter((a) => a.call === "rebuild_queue:update").map((a) => a.args[0] as Record<string, unknown>);
    expect(updates[0]).toEqual({ status: "queued", error: "direset: running > 15 menit" });
    const reset = svc.args.findIndex((a) => a.call === "rebuild_queue:lt" && a.args[0] === "started_at");
    expect(reset).toBeGreaterThan(-1);
    expect(updates[1]).toMatchObject({ status: "done", error: "di luar jendela data (jam dinding + 7); tidak dibangun" });
  });
});

const { GET } = await import("@/app/api/cron/rebuild/route");

describe("R46 (K61): the cron route", () => {
  const req = (auth?: string) => new Request("https://x/api/cron/rebuild", { headers: auth ? { authorization: auth } : {} });
  it("401 without the secret, or with a wrong one", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.unstubAllEnvs();
  });
  it("401 when the server has no CRON_SECRET at all", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    vi.unstubAllEnvs();
  });
  it("with the secret: flags and queue read with the service client, two queued dates built", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const saved = BUILDERS.splice(0);
    const built: string[] = [];
    registerBuilder({ module: "m1_costing", name: "probe", build: async (_s, d) => { built.push(d); return "ok"; } });
    svc = fakeSb({ rows: { app_setting: [{ key: "m1_costing", value: { enabled: true } }], rebuild_queue: [{ id: "q1", date: "2026-08-24" }, { id: "q2", date: "2026-08-25" }] } });
    // the anon client of the request has no session: it must not be used for the flags
    sb = fakeSb({ fail: { app_setting: "should not be read" } });
    const res = await GET(req("Bearer s3cret"));
    BUILDERS.splice(0, BUILDERS.length, ...saved);
    vi.unstubAllEnvs();
    expect(res.status).toBe(200);
    expect((await res.json()).drained).toMatchObject({ done: 2, failed: 0 });
    expect(built).toEqual(["2026-08-24", "2026-08-25"]);
  });
  it("503 without SUPABASE_SERVICE_ROLE_KEY", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    svc = null;
    expect((await GET(req("Bearer s3cret"))).status).toBe(503);
    vi.unstubAllEnvs();
  });
});

describe("R47 (K42): fetchAll pages through everything without duplicates", () => {
  it("2.450 rows in 3 pages of 1.000, ordered by id: every row once", async () => {
    const all = Array.from({ length: 2450 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}` }));
    const ranges: [number, number][] = [];
    const rows = await fetchAll<{ id: string }>(async (from, to) => { ranges.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(rows.length).toBe(2450);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2450);
  });
  it("an error on a later page throws with its PostgREST code (no partial list)", async () => {
    const e = await fetchAll(async (from) => (from === 0 ? { data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null } : { data: null, error: { message: "column x does not exist", code: "42703" } })).catch((x) => x);
    expect(e).toBeInstanceOf(LoaderError);
    expect((e as LoaderError).code).toBe("42703");
    expect((e as LoaderError).schema).toBe(true);
  });
});
