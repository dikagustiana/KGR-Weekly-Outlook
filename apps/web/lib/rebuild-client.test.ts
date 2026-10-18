/**
 * PRD v5.2-A irisan A1d — Q-v5.2-51: the data builders and the cron use the client the caller gives (the service client
 * in the cron, the signed-in user's client in the app), and never `supabaseServer()` inside a builder.
 *
 * The finding (A5, F19): `computeForWeek` opened the session client itself. In the cron there is no session, so a builder
 * that read a week through it saw an empty week (RLS: anon) and wrote a degraded mart; the same date rebuilt by Finance
 * gave another one. Here:
 *  1. static: no module a builder (or the cron route) imports at runtime reaches `supabaseServer`, cookies or a viewer;
 *     every call of `computeForWeek` passes a client first;
 *  2. `computeForWeek(sb, week)` answers from the client it is given and is memoised per client;
 *  3. the cron (service client given, no session) writes the same mart rows as the Finance rebuild, whatever the
 *     session client holds (the Finance data, or nothing as anon), and the session client is never opened.
 * It runs on the in-memory client with the engine's golden week; PostgreSQL itself is proved by tests/e2e (F19).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memSb, type MemRow, type MemSb } from "../test-support/mem-sb";
import { weekRows } from "../test-support/week-rows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));

let session: MemSb = memSb();
let sessionOpened = 0;
let service: MemSb | null = null;
vi.mock("./supabase", () => ({ supabaseServer: async () => { sessionOpened += 1; return session; } }));
vi.mock("./supabase-service", () => ({ supabaseService: () => service }));

const { computeForWeek } = await import("./data");
const { processRebuildQueue } = await import("./rebuild");
const { EXPECTED_SCHEMA } = await import("./schema");

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------------------------- 1. static

/** The files `entry` imports at runtime (type-only imports are erased), through relative and "@/" specifiers. */
function runtimeClosure(entry: string): string[] {
  const seen = new Set<string>();
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(WEB, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((c) => existsSync(c)) ?? null;
  };
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    const re = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const target = resolveSpec(file, m[1] ?? m[2]);
      if (target) visit(target);
    }
  };
  visit(entry);
  return [...seen].sort();
}

/** What only the app edge may touch: the session client, the request's cookies and the signed-in viewer. */
const SESSION_BOUND = /\bsupabaseServer\b|next\/headers|\bcookies\(|\bgetViewer\b|\brequireViewer\b|\bmoduleSettings\(\)|\bschemaStatus\(\)|\bweeksCached\b/;
/** Comments do not count: a doc line may name what the module must not do. */
const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("A1d static: no builder and no cron reaches the session client", () => {
  const builders = runtimeClosure(join(WEB, "lib/rebuild.ts"));
  const cron = runtimeClosure(join(WEB, "app/api/cron/rebuild/route.ts"));

  it("the closure is the real one (every registered builder is in it)", () => {
    const rel = builders.map((f) => relative(WEB, f));
    for (const f of ["lib/v3/ledger.ts", "lib/v3/cash.ts", "lib/v3/monthly.ts", "lib/v4/month.ts", "lib/v4/close.ts", "lib/v5/ppic-data.ts", "lib/v5/input-data.ts", "lib/data.ts", "lib/schema.ts"]) {
      expect(rel, f).toContain(f);
    }
    expect(builders.length).toBeGreaterThan(30);
  });
  it("no module of the builders' closure uses supabaseServer, cookies, the viewer or a request-cached helper", () => {
    const bad = builders.filter((f) => SESSION_BOUND.test(code(f))).map((f) => relative(WEB, f));
    expect(bad).toEqual([]);
  });
  it("the cron route and what it imports are free of them too, and it hands its service client to the rebuild", () => {
    const bad = cron.filter((f) => SESSION_BOUND.test(code(f))).map((f) => relative(WEB, f));
    expect(bad).toEqual([]);
    expect(code(join(WEB, "app/api/cron/rebuild/route.ts"))).toMatch(/processRebuildQueue\(settings,\s*\{[^}]*client:\s*svc/);
  });
  it("every call of computeForWeek passes a client first (sb in lib, the page's own client at the app edge)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(p);
      }
    };
    for (const d of ["lib", "app", "components"]) walk(join(WEB, d));
    const calls = files.flatMap((f) => [...code(f).matchAll(/(?<!function\s)\bcomputeForWeek\(([^\n]{0,40})/g)].map((m) => ({ file: relative(WEB, f), call: m[1] })));
    expect(calls.length).toBeGreaterThan(8);
    const bad = calls.filter((c) => !/^\s*(sb,|await supabaseServer\(\),)/.test(c.call));
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- 2. computeForWeek

const table = () => weekRows("2026-08-24", "2026-08-27").rows;
const reads = (sb: MemSb) => sb.calls("week:select").length;

describe("A1d: computeForWeek(sb, week) answers from the client it is given", () => {
  it("loads and computes the golden week with the given client, once per client", async () => {
    const sb = memSb(table());
    const a = await computeForWeek(sb as never, "2026-08-24");
    const b = await computeForWeek(sb as never, "2026-08-24");
    expect(a).not.toBeNull();
    expect(b).toBe(a); // memoised per client: one request / one rebuild run loads a week once
    expect(reads(sb)).toBe(1);
    expect(sessionOpened).toBe(0);
  });
  it("another client is another read: an empty (anon) client sees no week, the full one still does", async () => {
    const full = memSb(table());
    const anon = memSb({});
    expect(await computeForWeek(anon as never, "2026-08-24")).toBeNull();
    expect(await computeForWeek(full as never, "2026-08-24")).not.toBeNull();
    expect(sessionOpened).toBe(0);
  });
  it("a failed load is not remembered: the next caller reads again", async () => {
    let failing = true;
    const rows = table();
    const sb = memSb(rows);
    const real = sb.from.bind(sb);
    (sb as { from: (t: string) => unknown }).from = (t: string) => (failing && t === "parameter" ? real("parameter_missing_table") : real(t));
    await expect(computeForWeek(sb as never, "2026-08-24")).rejects.toThrow(/Parameter minggu/);
    failing = false;
    expect(await computeForWeek(sb as never, "2026-08-24")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------- 3. cron = Finance

const DATES = ["2026-08-26", "2026-08-27"];
const settings = { m4_monthly: { enabled: true, roles: null }, m6_cash: { enabled: true, roles: null } } as never;

/** The database of the test: the golden week, both flags on, and the dates queued. */
function database(): MemSb {
  return memSb({
    ...table(),
    app_setting: [{ key: "m4_monthly", value: { enabled: true } }, { key: "m6_cash", value: { enabled: true } }],
    rebuild_queue: DATES.map((date, i): MemRow => ({ id: `q${i}`, date, status: "queued" })),
  }, {
    rpc: {
      schema_version: () => ({ data: EXPECTED_SCHEMA }),
      mart_replace: (a) => ({ data: { written: (a.p_rows as unknown[]).length, deleted: 0 } }),
    },
  });
}
const marts = (sb: MemSb) => sb.rpcCalls.filter((c) => c.name === "mart_replace").map((c) => ({ table: c.args.p_table, scope: c.args.p_scope, rows: c.args.p_rows }));

beforeEach(() => {
  vi.stubEnv("KGR_TEST_NOW", "2026-08-28T08:00:00+07:00");
  sessionOpened = 0;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); service = null; session = memSb(); });

describe("A1d: the cron writes the mart the Finance rebuild writes (F19)", () => {
  it("cron: service client handed in, no session — builds the month, the P&L and the solvency from the real week", async () => {
    const svc = database();
    service = svc; // supabaseService() in production hands the same client; the route passes the one it holds
    session = memSb(); // nothing readable: what an anon (cookie-less) client sees
    const r = await processRebuildQueue(settings, { limit: 30, client: svc as never });
    expect(r.notes.filter((n) => /GAGAL/.test(n))).toEqual([]);
    expect(r).toMatchObject({ done: 2, failed: 0 });
    const written = marts(svc);
    const tables = new Set(written.map((m) => m.table));
    expect(tables).toContain("pl_daily_v4");
    expect(tables).toContain("solvency_monthly");
    // the P&L rows carry the week's numbers, not an empty week's (the degraded mart of the finding)
    const pl = written.filter((m) => m.table === "pl_daily_v4").flatMap((m) => m.rows as { actual: string | null }[]);
    expect(pl.some((x) => x.actual !== null && Number(x.actual) !== 0)).toBe(true);
    expect(sessionOpened).toBe(0);
  });

  it("the same rows as the Finance rebuild, whatever the session client holds (Finance's data, or nothing)", async () => {
    const cronDb = database();
    service = cronDb;
    session = memSb();
    await processRebuildQueue(settings, { limit: 30, client: cronDb as never });
    const expected = JSON.stringify(marts(cronDb));
    expect(marts(cronDb).length).toBeGreaterThan(0);

    // the app's rebuild: the service client is built by the rebuild itself; the session client is Finance's, with all the data
    for (const sessionDb of [database(), memSb()]) {
      const svc = database();
      service = svc;
      session = sessionDb;
      await processRebuildQueue(settings, { limit: 30 });
      expect(JSON.stringify(marts(svc))).toBe(expected);
      expect(sessionDb.log.length).toBe(0); // the builders never read through the session client
    }
    expect(sessionOpened).toBe(0);
  });

  it("without a service key nothing is built and the session client is still not used", async () => {
    session = database();
    service = null;
    const r = await processRebuildQueue(settings, { limit: 30 });
    expect(r).toMatchObject({ done: 0, failed: 0 });
    expect(r.notes.length).toBe(1);
    expect(sessionOpened).toBe(0);
  });
});
