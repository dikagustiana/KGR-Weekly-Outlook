import "server-only";
/**
 * Q-v5.2-15 (code side, v5.2 A1c): what Sales know of PPIC's surplus come through the view `surplus_for_sales_v52` (B2), never
 * through `plan_week`, `demand_weekly`, `plan_week_class` or `demand_class_weekly`, which Sales do not read (B2 for the class
 * tables, B6 for the other two). The view lists, per saved plan version of a week and per key, the plan's surplus kg and the
 * latest answer — only the keys of the viewer's active assignments, and nothing of the plan itself (no classes, heads, cost or
 * downgrade).
 *
 * The plan lists its surplus per production unit ("Karkas") or per SKU key; the answer stores the key an assignment names
 * (`surplusKeys`: a unit is the base key of its RPA SKU, "RPA|Karkas"). The view of B2 carries the plan's key as the plan
 * wrote it, and the answer's key as stored, so a unit-keyed surplus and its answer are two rows there; B6 makes the view say
 * "RPA|Karkas" for both. This reader says it the same way whatever the view says, and joins the rows by that key, so it reads
 * the same before and after B6.
 */
import type { Supa } from "../supabase";
import { LoaderError, must, mustRows } from "../loader";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** One surplus row Sales can answer: the SKU key (as an assignment names it), the plan's surplus kg, and the latest answer if any. */
export interface SalesSurplusRow {
  key: string;
  /** The plan's surplus kg; null when the view only knows the answer (the plan no longer lists the key). */
  kg: string | null;
  response: "absorb" | "partial" | "reduce" | null;
  absorbKg: string | null;
  price: string | null;
}

export interface SalesSurplus {
  planWeekId: string;
  version: number;
  weekStart: string;
  rows: SalesSurplusRow[];
}

/** The key as an assignment and an answer name it: a unit without "|" is the base key of its RPA SKU. */
export const surplusKeyOf = (key: string): string => (key.includes("|") ? key : `RPA|${key}`);

const COLUMNS = "week_start, plan_version, plan_week_id, key, plan_surplus_kg, answered_surplus_kg, response, absorb_kg, price, responded_by, responded_at";
/** The rows of ONE plan version: its units (a handful) times the assignments of one rep. An ordered top-n; a full page is an error, never a truncation. */
const LIMIT = 500;

/** Rows of the view for one plan version → one row per normalized key (the surplus from the row that has it, the answer from the row that has one). */
export function salesSurplusRows(rows: Row[]): SalesSurplusRow[] {
  const by = new Map<string, SalesSurplusRow & { at: string | null }>();
  for (const r of rows) {
    const key = surplusKeyOf(String(r.key));
    const o = by.get(key) ?? { key, kg: null, response: null, absorbKg: null, price: null, at: null };
    if (s(r.plan_surplus_kg) !== null && o.kg === null) o.kg = String(r.plan_surplus_kg);
    const resp = s(r.response);
    if (resp === "absorb" || resp === "partial" || resp === "reduce") {
      const at = s(r.responded_at);
      // the latest answer of the key (after B6 there is one row; before it, the answer row of a unit key)
      if (o.response === null || (at !== null && (o.at === null || at > o.at))) Object.assign(o, { response: resp, absorbKg: s(r.absorb_kg), price: s(r.price), at });
    }
    by.set(key, o);
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key)).map((o) => ({ key: o.key, kg: o.kg, response: o.response, absorbKg: o.absorbKg, price: o.price }));
}

/**
 * The surplus of the latest saved plan version of `weekStart` for the signed-in Sales user (their assigned keys only).
 * null = no saved plan version with a surplus or an answer for their keys (the screen says so). An error is an error (K41).
 */
export async function loadSurplusForSales(sb: Supa, weekStart: string): Promise<SalesSurplus | null> {
  const latest = must(await sb.from("surplus_for_sales_v52").select("plan_week_id, plan_version").eq("week_start", weekStart).order("plan_version", { ascending: false }).limit(1).maybeSingle(), "komersial.surplus_for_sales_v52") as Row | null;
  if (!latest) return null;
  const planWeekId = String(latest.plan_week_id);
  const rows = mustRows<Row>(await sb.from("surplus_for_sales_v52").select(COLUMNS).eq("plan_week_id", planWeekId).order("key").limit(LIMIT), "komersial.surplus_for_sales_v52");
  if (rows.length >= LIMIT) throw new LoaderError("komersial.surplus_for_sales_v52", `lebih dari ${LIMIT - 1} baris untuk satu versi rencana; daftar surplus tidak dibaca utuh`);
  return { planWeekId, version: Number(latest.plan_version), weekStart, rows: salesSurplusRows(rows) };
}
