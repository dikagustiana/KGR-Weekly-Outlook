/**
 * A Supabase client stand-in that applies filters (loader tests, no network): `from(table)` reads `rows[table]` (a table that is
 * not given is empty) and honours eq / neq / gt / gte / lt / lte / is / in / not(col, "is", null) / or("col.op.value,…") /
 * order / limit / range / maybeSingle / single. Unlike fakeSb (which records filters and answers the same rows), the answer
 * depends on the filter, so a test can tell a read of August from a read of October. ISO dates and timestamps compare as text.
 */
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

const cmp = (a: unknown, b: unknown): number => (a === b ? 0 : (a as string | number) < (b as string | number) ? -1 : 1);
const lit = (v: string): unknown => (v === "null" ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

function condition(col: string, op: string, val: unknown): Pred {
  switch (op) {
    case "eq": return (r) => r[col] === val;
    case "neq": return (r) => r[col] !== val;
    case "gt": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) > 0;
    case "gte": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) >= 0;
    case "lt": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) < 0;
    case "lte": return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) <= 0;
    case "is": return val === null ? (r) => r[col] === null || r[col] === undefined : (r) => r[col] === val;
    default: throw new Error(`memSb: operator ${op} belum didukung`);
  }
}

export interface MemSb { from: (table: string) => unknown; calls: string[] }

export function memSb(rows: Record<string, Row[]> = {}): MemSb {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const preds: Pred[] = [];
      const orders: { col: string; asc: boolean }[] = [];
      let lim: number | null = null, from = 0, to: number | null = null;
      const run = (): Row[] => {
        let out = (rows[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (orders.length) out = [...out].sort((a, b) => { for (const o of orders) { const c = cmp(a[o.col] ?? null, b[o.col] ?? null); if (c) return o.asc ? c : -c; } return 0; });
        if (to !== null) out = out.slice(from, to + 1);
        return lim === null ? out : out.slice(0, lim);
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      for (const op of ["eq", "neq", "gt", "gte", "lt", "lte"]) q[op] = (col: string, v: unknown) => (preds.push(condition(col, op, v)), q);
      q.is = (col: string, v: unknown) => (preds.push(condition(col, "is", v)), q);
      q.in = (col: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[col])), q);
      q.not = (col: string, op: string, v: unknown) => { const p = condition(col, op, v); preds.push((r) => !p(r)); return q; };
      q.or = (expr: string) => {
        const ps = expr.split(",").map((c) => { const [col, op, ...v] = c.split("."); return condition(col, op, lit(v.join("."))); });
        preds.push((r) => ps.some((p) => p(r)));
        return q;
      };
      q.order = (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), q);
      q.limit = (n: number) => ((lim = n), q);
      q.range = (a: number, b: number) => ((from = a), (to = b), q);
      q.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
      q.single = q.maybeSingle;
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: run(), count: run().length, error: null }).then(ok, ko);
      return q;
    },
  };
}
