import "server-only";
/**
 * PRD v6 R120: the input rows an input page edits, read from its own table (docs/v6/loaded-map.md) instead of
 * `computed.loaded.db` — the request path no longer loads the whole week. The same filters and order as loadWeek, so
 * the rows and the computed columns (from the result, by row id) line up as before.
 */
import type { Supa } from "./supabase";
import { fetchAll } from "./data";
import { must } from "./loader";

type Row = Record<string, unknown>;
export type WeekInputTable = "sales_line" | "receipt_line" | "batch" | "opening_stock" | "cash_plan";

/** Active rows of a week input table (not deleted, not superseded where the table supersedes), in loadWeek's order. */
export async function weekInputRows(sb: Supa, table: WeekInputTable, weekId: string): Promise<Row[]> {
  const superseding = table !== "cash_plan";
  return fetchAll<Row>((from, to) => {
    let q = sb.from(table).select("*").eq("week_id", weekId).is("deleted_at", null);
    if (superseding) q = q.is("superseded_at", null);
    return q.order("seq").order("created_at").order("id").range(from, to);
  });
}

/** The week's parameter row (the Parameter page edits it). */
export async function weekParameter(sb: Supa, weekId: string): Promise<Row> {
  const p = must(await sb.from("parameter").select("*").eq("week_id", weekId).maybeSingle(), "parameter") as Row | null;
  if (!p) throw new Error("Parameter minggu ini belum ada");
  return p;
}
