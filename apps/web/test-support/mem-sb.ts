/**
 * An in-memory Supabase client for action and loader tests (no network, no server): tables are arrays of rows, the
 * PostgREST filters the app uses are applied (eq neq gt gte lt lte in is not or like contains, order, range, limit,
 * single / maybeSingle) and writes mutate the tables (insert, update, upsert by `onConflict`, delete), so a test can run an
 * action and read the result back. Every request is logged in `log` ("table:op" plus its payload and filters).
 * It is not PostgREST: no RLS, no triggers, no constraints — what those do is proved on PostgreSQL (tests/e2e, test:rls).
 * `fail` makes a table (or "table:op") answer with a PostgREST-style error; `rpc` holds handlers by function name.
 */
export type MemRow = Record<string, unknown>;
type Err = { message: string; code?: string };
type Fail = string | Err;
type Filter = (r: MemRow) => boolean;

export interface MemLog { call: string; table: string; op: string; payload?: unknown; filters: string[]; options?: unknown }
export interface MemSb {
  from: (table: string) => unknown;
  rpc: (name: string, args: MemRow) => Promise<{ data: unknown; error: Err | null }>;
  tables: Record<string, MemRow[]>;
  log: MemLog[];
  rpcCalls: { name: string; args: MemRow }[];
  /** The column list of every read (`select("a, b")`), to prove a loader asks for a column: the client itself returns whole rows. */
  selects: { table: string; columns: string }[];
  /** The requests of one kind, e.g. `calls("sales_commitment:upsert")`. */
  calls: (call: string) => MemLog[];
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
const cmp = (a: unknown, b: unknown): number => {
  const x = num(a), y = num(b);
  if (x !== null && y !== null) return x - y;
  return String(a ?? "").localeCompare(String(b ?? ""));
};
const same = (a: unknown, b: unknown) => (a === null || a === undefined ? b === null || b === undefined : b === null || b === undefined ? false : cmp(a, b) === 0 && String(a).length > -1);

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function opFilter(col: string, op: string, raw: string): Filter {
  const v = raw === "null" ? null : raw;
  switch (op) {
    case "eq": return (r) => same(r[col], v);
    case "neq": return (r) => !same(r[col], v);
    case "gt": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], v) > 0;
    case "gte": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], v) >= 0;
    case "lt": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], v) < 0;
    case "lte": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], v) <= 0;
    case "is": return (r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === (raw === "true"));
    default: throw new Error(`memSb: filter .${op}. tidak didukung`);
  }
}

/** or("and(a.gte.1,a.lte.2),and(a.is.null,b.gte.1)") → one predicate. */
function parseOr(expr: string): Filter {
  const part = (p: string): Filter => {
    const m = /^and\((.*)\)$/.exec(p.trim());
    if (m) { const fs = splitTop(m[1]).map(part); return (r) => fs.every((f) => f(r)); }
    const [col, op, ...rest] = p.trim().split(".");
    return opFilter(col, op, rest.join("."));
  };
  const fs = splitTop(expr).map(part);
  return (r) => fs.some((f) => f(r));
}

const like = (pattern: string) => { const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`); return (v: unknown) => typeof v === "string" && re.test(v); };
const subset = (big: unknown, small: unknown): boolean => {
  if (small === null || typeof small !== "object") return big === small;
  if (Array.isArray(small)) return Array.isArray(big) && small.every((s) => big.some((b) => subset(b, s)));
  return big !== null && typeof big === "object" && Object.entries(small as MemRow).every(([k, v]) => subset((big as MemRow)[k], v));
};

export function memSb(seed: Record<string, MemRow[]> = {}, opts: { fail?: Record<string, Fail>; rpc?: Record<string, (args: MemRow, db: MemSb) => { data?: unknown; error?: Err | null }> } = {}): MemSb {
  const tables: Record<string, MemRow[]> = Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  const log: MemLog[] = [], rpcCalls: { name: string; args: MemRow }[] = [], selects: { table: string; columns: string }[] = [];
  let seq = 0;
  const err = (f: Fail): Err => (typeof f === "string" ? { message: f } : f);
  const failOf = (table: string, op: string): Err | null => { const f = opts.fail?.[`${table}:${op}`] ?? opts.fail?.[table]; return f ? err(f) : null; };
  const db: MemSb = {
    tables, log, rpcCalls, selects, calls: (call) => log.filter((l) => l.call === call),
    from(table: string) {
      let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
      let payload: unknown, wopts: { onConflict?: string; count?: string } | undefined, head = false, count = false, one: "single" | "maybe" | null = null;
      const filters: Filter[] = [], labels: string[] = [];
      let orders: { col: string; asc: boolean }[] = [], lo = 0, hi = Infinity, lim = Infinity, returning = false;
      const q: Record<string, unknown> = {};
      const add = (label: string, f: Filter) => { labels.push(label); filters.push(f); return q; };
      q.select = (cols?: string, o?: { head?: boolean; count?: string }) => { if (op === "select") { head = !!o?.head; count = !!o?.count; selects.push({ table, columns: cols ?? "*" }); } else returning = true; return q; };
      q.eq = (c: string, v: unknown) => add(`eq ${c} ${String(v)}`, (r) => same(r[c], v));
      q.neq = (c: string, v: unknown) => add(`neq ${c} ${String(v)}`, (r) => !same(r[c], v));
      for (const o of ["gt", "gte", "lt", "lte"] as const) q[o] = (c: string, v: unknown) => add(`${o} ${c} ${String(v)}`, opFilter(c, o, String(v)));
      q.in = (c: string, vs: unknown[]) => add(`in ${c} [${vs.map(String).join(",")}]`, (r) => vs.some((v) => same(r[c], v)));
      q.is = (c: string, v: unknown) => add(`is ${c} ${String(v)}`, (r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v));
      q.not = (c: string, o: string, v: unknown) => {
        const f: Filter = o === "is" ? (r) => (v === null ? r[c] !== null && r[c] !== undefined : r[c] !== v) : o === "eq" ? (r) => !same(r[c], v) : (() => { throw new Error(`memSb: not .${o} tidak didukung`); })();
        return add(`not ${c} ${o} ${String(v)}`, f);
      };
      q.or = (e: string) => add(`or ${e}`, parseOr(e));
      q.like = (c: string, p: string) => add(`like ${c} ${p}`, (r) => like(p)(r[c]));
      q.contains = (c: string, v: unknown) => add(`contains ${c}`, (r) => subset(r[c], v));
      q.order = (c: string, o?: { ascending?: boolean }) => { orders = [...orders, { col: c, asc: o?.ascending !== false }]; return q; };
      q.range = (a: number, b: number) => { lo = a; hi = b; return q; };
      q.limit = (n: number) => { lim = n; return q; };
      q.insert = (rows: MemRow | MemRow[]) => { op = "insert"; payload = rows; return q; };
      q.update = (patch: MemRow, o?: { count?: string }) => { op = "update"; payload = patch; wopts = o; return q; };
      q.upsert = (rows: MemRow | MemRow[], o?: { onConflict?: string }) => { op = "upsert"; payload = rows; wopts = o; return q; };
      q.delete = () => { op = "delete"; return q; };
      q.single = () => { one = "single"; return q; };
      q.maybeSingle = () => { one = "maybe"; return q; };
      const run = (): { data: unknown; error: Err | null; count: number | null } => {
        log.push({ call: `${table}:${op}`, table, op, payload, filters: labels, options: wopts });
        const f = failOf(table, op);
        if (f) return { data: null, count: null, error: f };
        const rows = (tables[table] ??= []);
        const match = () => rows.filter((r) => filters.every((fn) => fn(r)));
        let out: MemRow[] = [];
        if (op === "insert" || op === "upsert") {
          for (const r of Array.isArray(payload) ? (payload as MemRow[]) : [payload as MemRow]) {
            const keys = (wopts?.onConflict ?? "").split(",").map((k) => k.trim()).filter(Boolean);
            const hit = op === "upsert" && keys.length && keys.every((k) => r[k] !== undefined) ? rows.find((e) => keys.every((k) => same(e[k], r[k]))) : undefined;
            if (hit) { Object.assign(hit, r); out.push(hit); } else { const n = { id: `mem-${++seq}`, ...r }; rows.push(n); out.push(n); }
          }
        } else if (op === "update") { out = match(); for (const r of out) Object.assign(r, payload as MemRow); }
        else if (op === "delete") { out = match(); tables[table] = rows.filter((r) => !out.includes(r)); }
        else {
          out = match();
          for (const { col, asc } of [...orders].reverse()) out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
          out = out.slice(lo, hi === Infinity ? undefined : hi + 1).slice(0, lim);
          if (head) return { data: null, count: match().length, error: null };
        }
        const result = op === "select" || returning || one ? out.map((r) => ({ ...r })) : null;
        const cnt = count || wopts?.count ? out.length : null;
        if (one) {
          if (one === "single" && result?.length !== 1) return { data: null, count: cnt, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
          if (one === "maybe" && (result?.length ?? 0) > 1) return { data: null, count: cnt, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
          return { data: result?.[0] ?? null, count: cnt, error: null };
        }
        return { data: result, count: cnt, error: null };
      };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko);
      return q;
    },
    async rpc(name: string, args: MemRow) {
      rpcCalls.push({ name, args });
      log.push({ call: `rpc:${name}`, table: "", op: "rpc", payload: args, filters: [] });
      const f = opts.fail?.[`rpc:${name}`];
      if (f) return { data: null, error: err(f) };
      const h = opts.rpc?.[name]?.(args, db);
      return { data: h?.data ?? null, error: h?.error ?? null };
    },
  };
  return db;
}
