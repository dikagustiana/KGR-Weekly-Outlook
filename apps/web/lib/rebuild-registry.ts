import "server-only";
/** Data mart builders per module (PRD v3 §3). Kept apart from rebuild.ts so builders can register without an import cycle. */
import type { Supa } from "./supabase";
import type { ModuleKey } from "./modules-core";
import { WriteError } from "./write";

export interface Builder {
  module: ModuleKey;
  /** Skipped while this other module is on (it writes the same mart scope with more information, e.g. the month builder over the week builder). */
  unless?: ModuleKey;
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


/** Write one scope of a data mart table (rows = engine output, already plain JSON). */
export async function martReplace(sb: Supa, table: string, scope: string, rows: Record<string, unknown>[]): Promise<{ written: number; deleted: number }> {
  const { data, error } = await sb.rpc("mart_replace", { p_table: table, p_scope: scope, p_rows: rows });
  if (error) throw new WriteError(`${table} ${scope}: ${error.message}`);
  return data as { written: number; deleted: number };
}

