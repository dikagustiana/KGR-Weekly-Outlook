import "server-only";
/** Data mart builders per module (PRD v3 §3). Kept apart from rebuild.ts so builders can register without an import cycle. */
import type { Supa } from "./supabase";
import type { ModuleKey } from "./modules-core";
import { WriteError } from "./write";

export interface Builder {
  module: ModuleKey;
  /** Skipped while this other module is on (it writes the same mart scope with more information, e.g. the month builder over the week builder). */
  unless?: ModuleKey;
  /** K60 (R45): these builders (by name, or every builder of a module key) run before this one, whatever the import order. */
  after?: string[];
  name: string;
  /** Load and compute once per rebuild run (e.g. the whole ledger), before the dates are written. */
  begin?: (sb: Supa) => Promise<void>;
  /** Build one date; returns a short summary for the queue row. */
  build: (sb: Supa, date: string) => Promise<string>;
}

/** Registered per module (later phases add theirs here). */
export const BUILDERS: Builder[] = [];

export function registerBuilder(b: Builder): void {
  if (!BUILDERS.some((x) => x.module === b.module && x.name === b.name)) BUILDERS.push(b);
}

/** K60 (R45): the builders in topological order (by `after`), independent of import order; a cycle errors at startup. */
export function orderedBuilders(): Builder[] {
  const out: Builder[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const key = (b: Builder) => `${b.module}:${b.name}`;
  const visit = (b: Builder): void => {
    const k = key(b);
    if (done.has(k)) return;
    if (visiting.has(k)) throw new Error(`siklus dependensi builder: ${b.name}`);
    visiting.add(k);
    for (const a of b.after ?? []) {
      const deps = BUILDERS.filter((d) => d.name === a || d.module === a);
      if (!deps.length) throw new Error(`builder ${b.name}: dependensi "${a}" tidak terdaftar`);
      deps.forEach(visit);
    }
    visiting.delete(k);
    done.add(k);
    out.push(b);
  };
  for (const b of BUILDERS) visit(b);
  return out;
}


/** Write one scope of a data mart table (rows = engine output, already plain JSON). */
export async function martReplace(sb: Supa, table: string, scope: string, rows: Record<string, unknown>[]): Promise<{ written: number; deleted: number }> {
  const { data, error } = await sb.rpc("mart_replace", { p_table: table, p_scope: scope, p_rows: rows });
  if (error) throw new WriteError(`${table} ${scope}: ${error.message}`);
  return data as { written: number; deleted: number };
}

