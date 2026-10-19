/**
 * SETUP (BACKTEST-SEP §3 langkah 2): an in-memory stand-in for the PostgREST client, just enough of the query builder for
 * the costing_wp commit, loadCostingWeek and allocateWeek of apps/web/lib/v3/costing.ts. It does not emulate RLS, triggers
 * (tg_batch_cost_mode, allocation_run_c48) or numeric rounding beyond what the app already sends as fixed strings; the
 * two generated columns the costing reads (allocation_run.diff, cost_pool.tie_out_diff) are computed like the migration.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

const isNull = (v: unknown) => v === null || v === undefined;
const same = (a: unknown, b: unknown) => (isNull(a) && isNull(b)) || (!isNull(a) && !isNull(b) && String(a) === String(b));

export class FakeDb {
  tables = new Map<string, Row[]>();
  private seq = 0;
  private clock = Date.UTC(2026, 9, 18, 0, 0, 0);
  rows(t: string): Row[] {
    if (!this.tables.has(t)) this.tables.set(t, []);
    return this.tables.get(t)!;
  }
  nextId(): string {
    this.seq++;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }
  now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  /** Defaults and generated columns per table (only those the costing path reads). */
  complete(t: string, r: Row): Row {
    const out: Row = { id: this.nextId(), deleted_at: null, superseded_at: null, created_at: this.now(), ...r };
    if (t === "allocation_run") out.run_at = out.run_at ?? this.now();
    return this.generated(t, out);
  }
  generated(t: string, r: Row): Row {
    if (t === "allocation_run") r.diff = (Number(r.total_cost) - Number(r.total_allocated)).toFixed(2);
    if (t === "cost_pool") r.tie_out_diff = isNull(r.total_gl) ? null : (Number(r.total_pi) - Number(r.total_gl)).toFixed(2);
    return r;
  }
  client() {
    return { from: (t: string) => new Query(this, t) } as unknown;
  }
}

class Query implements PromiseLike<{ data: unknown; error: null | { message: string; code?: string }; count?: number }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict: string[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private from = 0;
  private to = Number.MAX_SAFE_INTEGER;
  private one: "single" | "maybe" | null = null;
  private head = false;
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.head = true; return this; }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  upsert(rows: Row | Row[], o?: { onConflict?: string }) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = (o?.onConflict ?? "id").split(",").map((s) => s.trim()); return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => same(r[c], v)); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => !same(r[c], v)); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? isNull(r[c]) : r[c] === v)); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.some((v) => same(r[c], v))); return this; }
  lte(c: string, v: unknown) { this.filters.push((r) => !isNull(r[c]) && String(r[c]) <= String(v)); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => !isNull(r[c]) && String(r[c]) >= String(v)); return this; }
  contains(c: string, v: Record<string, unknown[]>) {
    this.filters.push((r) => {
      const x = r[c] as Record<string, unknown[]> | null;
      return !!x && Object.entries(v).every(([k, arr]) => arr.every((a) => (x[k] ?? []).includes(a)));
    });
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this; }
  range(f: number, t: number) { this.from = f; this.to = t; return this; }
  limit(n: number) { this.to = this.from + n - 1; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }
  private run(): { data: unknown; error: null | { message: string }; count?: number } {
    let out: Row[];
    if (this.op === "insert") {
      out = this.payload.map((p) => this.db.complete(this.table, p));
      this.db.rows(this.table).push(...out);
    } else if (this.op === "update") {
      out = this.matching();
      for (const r of out) this.db.generated(this.table, Object.assign(r, this.patch));
    } else if (this.op === "upsert") {
      out = [];
      const touched = new Set<Row>();
      for (const p of this.payload) {
        const hit = this.db.rows(this.table).find((r) => this.conflict.every((c) => same(r[c], p[c])));
        if (hit && touched.has(hit)) return { data: null, error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
        if (hit) { Object.assign(hit, p); touched.add(hit); out.push(hit); }
        else { const n = this.db.complete(this.table, p); this.db.rows(this.table).push(n); touched.add(n); out.push(n); }
      }
    } else {
      out = this.matching();
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[o.col], y = b[o.col];
          const nx = Number(x), ny = Number(y);
          const c = isNull(x) ? (isNull(y) ? 0 : 1) : isNull(y) ? -1 : !Number.isNaN(nx) && !Number.isNaN(ny) && typeof x !== "string" ? nx - ny
            : !Number.isNaN(nx) && !Number.isNaN(ny) && /^-?\d+(\.\d+)?$/.test(String(x)) && /^-?\d+(\.\d+)?$/.test(String(y)) ? nx - ny : String(x).localeCompare(String(y));
          return o.asc ? c : -c;
        });
      }
    }
    const count = out.length;
    if (this.head) return { data: null, error: null, count };
    const page = this.op === "select" ? out.slice(this.from, this.to + 1) : out;
    const copy = page.map((r) => ({ ...r }));
    if (this.one) {
      if (copy.length > 1 && this.one === "single") return { data: null, error: { message: "more than one row" } };
      if (!copy.length) return this.one === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: copy[0], error: null };
    }
    return { data: copy, error: null, count };
  }
  then<A, B>(ok?: ((v: { data: unknown; error: null | { message: string }; count?: number }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}
