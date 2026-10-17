/**
 * A Supabase client stand-in for loader tests (no network): every query of `table` answers `rows[table]` (filters are
 * recorded, not applied), `count` for head counts, and a PostgREST-style error for the tables in `fail` (a message, or
 * { message, code } for a PostgREST code). `rpc` answers `rpc[name]`. `calls` lists each request as "table:method";
 * `args` the same with the arguments.
 */
type Row = Record<string, unknown>;

export interface FakeSb {
  from: (table: string) => unknown;
  rpc: (name: string, args: Row) => Promise<{ data: unknown; error: { message: string } | null }>;
  calls: string[];
  args: { call: string; args: unknown[] }[];
  rpcCalls: { name: string; args: Row }[];
}

type Fail = string | { message: string; code?: string };

export function fakeSb(x: { rows?: Record<string, Row[]>; fail?: Record<string, Fail>; rpc?: Record<string, unknown> } = {}): FakeSb {
  const calls: string[] = [], args: { call: string; args: unknown[] }[] = [], rpcCalls: { name: string; args: Row }[] = [];
  const error = (f: Fail) => (typeof f === "string" ? { message: f } : f);
  const answer = (table: string, one: boolean, head: boolean) => {
    const err = x.fail?.[table];
    if (err) return { data: null, count: null, error: error(err) };
    const rows = x.rows?.[table] ?? [];
    if (head) return { data: null, count: rows.length, error: null };
    return { data: one ? rows[0] ?? null : rows, count: rows.length, error: null };
  };
  return {
    calls, args, rpcCalls,
    from(table: string) {
      let head = false;
      const q: Record<string, unknown> = {};
      const chain = (name: string) => (...a: unknown[]) => {
        if (name === "select" && (a[1] as { head?: boolean } | undefined)?.head) head = true;
        calls.push(`${table}:${name}`);
        args.push({ call: `${table}:${name}`, args: a });
        return q;
      };
      for (const m of ["select", "eq", "neq", "gte", "lte", "lt", "gt", "in", "is", "not", "or", "order", "limit", "range", "contains", "insert", "update", "upsert", "delete"]) q[m] = chain(m);
      q.maybeSingle = async () => answer(table, true, false);
      q.single = async () => answer(table, true, false);
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(answer(table, false, head)).then(ok, ko);
      return q;
    },
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      const err = x.fail?.[`rpc:${name}`];
      return err ? { data: null, error: error(err) } : { data: x.rpc?.[name] ?? null, error: null };
    },
  };
}
