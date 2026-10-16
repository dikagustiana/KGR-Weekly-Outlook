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

/** Idle capacity per day of [from, to] (P&L sign) for every overhead rate with a basis that overlaps it. */
export async function idleCostRows(sb: Supa, from: string, to: string): Promise<{ date: string; amount: string }[]> {
  const rates = await fetchAll<Row>((a, b) => sb.from("overhead_rate").select("period_start, period_end, basis_kg, rate_per_kg_lb")
    .is("deleted_at", null).not("basis_kg", "is", null).lte("period_start", to).gte("period_end", from).range(a, b));
  if (!rates.length) return [];
  const lo = rates.map((r) => String(r.period_start)).sort()[0], hi = rates.map((r) => String(r.period_end)).sort().reverse()[0];
  const batches = await fetchAll<Row>((a, b) => sb.from("batch").select("date, status, lb_kg").eq("cost_mode", "own")
    .is("deleted_at", null).is("superseded_at", null).gte("date", lo).lte("date", hi).range(a, b));
  // kg LB per day: the Aktual batches of the day, else its plan (Rencana)
  const kg = new Map<string, { aktual: Decimal; rencana: Decimal; hasAktual: boolean }>();
  for (const b of batches) {
    const d = String(b.date), o = kg.get(d) ?? { aktual: D(0), rencana: D(0), hasAktual: false };
    if (b.status === "Aktual") { o.aktual = o.aktual.plus(D(s(b.lb_kg) ?? "0")); o.hasAktual = true; } else o.rencana = o.rencana.plus(D(s(b.lb_kg) ?? "0"));
    kg.set(d, o);
  }
  const byDate = new Map([...kg].map(([d, o]) => [d, (o.hasAktual ? o.aktual : o.rencana).toFixed(2)]));
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return rates.flatMap((r) => idleCostDaily({
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
