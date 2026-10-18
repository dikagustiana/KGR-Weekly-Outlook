import "server-only";
/**
 * v5 rows of pl_daily_v4 (flag v5_costing): "Selisih costing" — the revaluation of kg already sold when a batch cost
 * turns final (K22, O1 revaluation_sold_mode) — and "Biaya kapasitas idle" for RPA sendiri with a basis rate (Q63).
 * Both from @kgr/engine (revalueLots / idleCostDaily / costingPlRows); the month and week P&L builders append them.
 */
import { D, addDays, costingPlRows, idleCostDaily, type Decimal, type PlRowV4 } from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import type { Row } from "../v3/uploads";
import { v5SelisihCosting } from "../v3/ledger";
import { v5CostingOn } from "./costing";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** A tariff period whose idle capacity is not computed because a batch of it has no kg LB (Q-v5.2-36): the period and the batches. */
export interface IdleSkipped { period_start: string; period_end: string; batches: string[] }

/**
 * The overhead rates (with a basis) that overlap [from, to], split into those whose idle capacity can be computed and those that
 * cannot: kg LB per day is the Aktual batches of the day, else its plan (Rencana); a batch without kg LB makes its day unknown, and
 * the rate whose period holds such a day is skipped (an unknown day is not a day of 0 kg). The screen says so (Q-v5.2-36).
 */
async function idleRatePlan(sb: Supa, from: string, to: string) {
  const rates = await fetchAll<Row>((a, b) => sb.from("overhead_rate").select("period_start, period_end, basis_kg, rate_per_kg_lb")
    .is("deleted_at", null).not("basis_kg", "is", null).lte("period_start", to).gte("period_end", from).order("id").range(a, b));
  if (!rates.length) return { known: [] as Row[], skipped: [] as IdleSkipped[], byDate: new Map<string, string>() };
  const lo = rates.map((r) => String(r.period_start)).sort()[0], hi = rates.map((r) => String(r.period_end)).sort().reverse()[0];
  const batches = await fetchAll<Row>((a, b) => sb.from("batch").select("date, status, lb_kg, batch_ref").eq("cost_mode", "own")
    .is("deleted_at", null).is("superseded_at", null).gte("date", lo).lte("date", hi).order("id").range(a, b));
  const kg = new Map<string, { aktual: Decimal; rencana: Decimal; hasAktual: boolean; unkAktual: string[]; unkRencana: string[] }>();
  for (const b of batches) {
    const d = String(b.date), o = kg.get(d) ?? { aktual: D(0), rencana: D(0), hasAktual: false, unkAktual: [], unkRencana: [] };
    const lb = s(b.lb_kg), aktual = b.status === "Aktual", ref = s(b.batch_ref) ?? d;
    if (aktual) o.hasAktual = true;
    if (lb === null) (aktual ? o.unkAktual : o.unkRencana).push(ref);
    else if (aktual) o.aktual = o.aktual.plus(D(lb));
    else o.rencana = o.rencana.plus(D(lb));
    kg.set(d, o);
  }
  const unknown = new Map([...kg].map(([d, o]) => [d, o.hasAktual ? o.unkAktual : o.unkRencana] as const).filter(([, refs]) => refs.length));
  const byDate = new Map([...kg].map(([d, o]) => [d, (o.hasAktual ? o.aktual : o.rencana).toFixed(2)]));
  const inRate = (r: Row) => [...unknown].filter(([d]) => d >= String(r.period_start) && d <= String(r.period_end)).flatMap(([, refs]) => refs);
  const skipped = rates.filter((r) => inRate(r).length).map((r) => ({ period_start: String(r.period_start), period_end: String(r.period_end), batches: [...new Set(inRate(r))] }));
  return { known: rates.filter((r) => !inRate(r).length), skipped, byDate };
}

/** The tariff periods overlapping [from, to] whose idle capacity is not computed because a batch has no kg LB (Q-v5.2-36). */
export async function idleSkipped(sb: Supa, from: string, to: string): Promise<IdleSkipped[]> {
  return (await idleRatePlan(sb, from, to)).skipped;
}

/** The note the costing screen writes for a skipped tariff period (Q-v5.2-36; no control of its own). */
export const idleSkippedNote = (x: IdleSkipped) => `kapasitas idle belum dihitung: batch tanpa kg LB (${x.batches.slice(0, 3).join(", ")}${x.batches.length > 3 ? `, +${x.batches.length - 3}` : ""})`;

/** Idle capacity per day of [from, to] (P&L sign) for every overhead rate with a basis that overlaps it. */
export async function idleCostRows(sb: Supa, from: string, to: string): Promise<{ date: string; amount: string }[]> {
  const { known, byDate } = await idleRatePlan(sb, from, to);
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return known.flatMap((r) => idleCostDaily({
    rate: { period_start: String(r.period_start), period_end: String(r.period_end), basis_kg: s(r.basis_kg), rate_per_kg_lb: String(r.rate_per_kg_lb) },
    actualKgLbByDate: byDate, dates,
  }).map((x) => ({ date: x.date, amount: x.amount.toFixed(2) })));
}

/** The v5 costing rows of pl_daily_v4 for [from, to]; [] while v5_costing is off (ebe4ad8 P&L unchanged). */
export async function v5CostingPlRows(sb: Supa, from: string, to: string, cutOff: string): Promise<PlRowV4[]> {
  if (!(await v5CostingOn(sb))) return [];
  const [selisih, idle] = await Promise.all([v5SelisihCosting(sb), idleCostRows(sb, from, to)]);
  return costingPlRows({ cutOff, from, to, selisih, idle });
}
