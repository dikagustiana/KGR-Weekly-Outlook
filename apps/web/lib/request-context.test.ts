/**
 * PRD v6 K82 / K83 / R126 / R128: one RequestContext per request — identity from getClaims (never getUser), and app_user,
 * app_setting (all keys), week and schema_version() read once each, however many wrappers a page calls.
 */
import { describe, expect, it, vi } from "vitest";
import { memSb } from "../test-support/mem-sb";

vi.mock("server-only", () => ({}));
// React `cache` memoises per request in a Server Component; here one memo per test run stands in for one request
vi.mock("react", async (orig) => {
  const r = await orig<typeof import("react")>();
  return { ...r, cache: <F extends (...a: never[]) => unknown>(f: F) => { let v: unknown, has = false; return ((...a: never[]) => (has ? v : ((has = true), (v = f(...a))))) as F; } };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }) }));
let getUserCalls = 0;
const sb = Object.assign(
  memSb({
    app_user: [{ email: "fin@x.id", role: "finance", full_name: "Fin", active: true }],
    app_setting: [{ key: "v4_design", value: { enabled: true } }, { key: "v5_costing", value: { enabled: true, roles: ["finance"] } }, { key: "v5_pl", value: { enabled: false } }],
    week: [{ id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", status: "open" }],
  }, { rpc: { schema_version: () => ({ data: "5.2.6" }) } }),
  { auth: { getClaims: async () => ({ data: { claims: { email: "Fin@X.id" } }, error: null }), getUser: async () => { getUserCalls++; return { data: { user: null }, error: null }; } } },
);
vi.mock("./supabase", () => ({ supabaseServer: async () => sb }));

const { getRequestContext } = await import("./request-context");
const { getViewer, requireViewer } = await import("./session");
const { moduleSettings } = await import("./modules");
const { weeksCached } = await import("./page");
const { schemaStatus } = await import("./schema-session");
const { v5CostingSetting } = await import("./v5/costing");
const { dataToday } = await import("./clock");

describe("RequestContext", () => {
  it("reads each source once, in one round, without GoTrue", async () => {
    const ctx = await getRequestContext();
    expect(ctx.viewer).toEqual({ email: "fin@x.id", role: "finance", fullName: "Fin" });
    expect(ctx.weeks.length).toBe(1);
    expect(ctx.schema).toBeNull();
    await getViewer(); await requireViewer(); await moduleSettings(); await weeksCached(sb as never); await schemaStatus();
    await v5CostingSetting(sb as never); await dataToday(sb as never, "2026-10-19");
    const count = (t: string) => sb.log.filter((l) => l.table === t && l.op === "select").length;
    expect(count("app_user")).toBe(1);
    expect(count("app_setting")).toBe(1);
    expect(count("week")).toBe(1);
    expect(sb.rpcCalls.filter((c) => c.name === "schema_version").length).toBe(1);
    expect(getUserCalls).toBe(0);
  });
});
