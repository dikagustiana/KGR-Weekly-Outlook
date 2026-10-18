/**
 * M7 view model per role (PRD v3 §4.8, Q17, §8 M7). Pure: the page renders only what this returns, so a sales viewer's
 * DOM never carries the specific cost per lot, cost pools or batch references; with `sales_sees_cost = false` the MA cost
 * per kg is dropped too (floor and margins stay).
 */
import type { Role } from "../roles";

export type Raw = Record<string, unknown>;

export interface CommercialViewRow {
  date: string | null;
  key: string;
  group_code: string | null;
  form: string | null;
  free_fresh_kg: string;
  free_frozen_kg: string;
  oldest_age_days: number | null;
  hours_to_cutoff: number | null;
  cost_per_kg_ma: string | null;
  cost_per_kg_si: string | null;
  price_floor: string | null;
  price_list: string | null;
  margin_per_kg_list: string | null;
  realized_price_7d: string | null;
  margin_per_kg_realized: string | null;
  holding_loss_per_day: string | null;
  downgrade_risk_rp: string | null;
  urgency: string | null;
  priority_score: string | null;
  rank: number | null;
  ordered_today_kg: string;
  /** v5 (flag v5_costing): the costing engine's cost per kg, its status and C54; null/false while the flag is off. */
  cost_per_kg: string | null;
  cost_status: string | null;
  cost_check: boolean;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const int = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export const URGENCY_LABEL: Record<string, string> = { di_atas_umur: "di atas batas umur", jual_hari_ini: "jual hari ini", jual_minggu_ini: "jual minggu ini", aman: "aman" };

/**
 * Keys a viewer may see (PRD v4 §8 S2): every key for roles other than sales; for sales only the assigned keys, all of
 * them when an assignment row has no key. No assignment = no key (default deny; the database view applies the same rule).
 */
export function assignedKeysFor(role: Role, own: { key: string | null }[]): Set<string> | "all" {
  if (role !== "sales") return "all";
  if (own.some((a) => a.key === null)) return "all";
  return new Set(own.map((a) => String(a.key)));
}

export function commercialView(rows: Raw[], opts: { role: Role; salesSeesCost: boolean; assignedKeys: Set<string> | "all"; keepOrder?: boolean }): CommercialViewRow[] {
  const sales = opts.role === "sales";
  const showMa = !sales || opts.salesSeesCost;
  return rows
    .filter((r) => !sales || opts.assignedKeys === "all" || opts.assignedKeys.has(String(r.key)))
    .map((r) => ({
      date: str(r.date), key: String(r.key), group_code: str(r.group_code), form: str(r.form), free_fresh_kg: String(r.free_fresh_kg), free_frozen_kg: String(r.free_frozen_kg), // commercial_daily.free_*_kg NOT NULL
      oldest_age_days: int(r.oldest_age_days), hours_to_cutoff: int(r.hours_to_cutoff),
      cost_per_kg_ma: showMa ? str(r.cost_per_kg_ma) : null, cost_per_kg_si: sales ? null : str(r.cost_per_kg_si),
      price_floor: str(r.price_floor), price_list: str(r.price_list), margin_per_kg_list: str(r.margin_per_kg_list), realized_price_7d: str(r.realized_price_7d),
      margin_per_kg_realized: str(r.margin_per_kg_realized), holding_loss_per_day: str(r.holding_loss_per_day), downgrade_risk_rp: str(r.downgrade_risk_rp),
      urgency: str(r.urgency), priority_score: str(r.priority_score), rank: int(r.rank), ordered_today_kg: String(r.ordered_today_kg), // commercial_daily.ordered_today_kg NOT NULL
      cost_per_kg: showMa ? str(r.cost_per_kg) : null, cost_status: str(r.cost_status), cost_check: r.cost_check === true,
    }))
    .sort((a, b) => (opts.keepOrder ? 0 : (a.rank ?? 9e9) - (b.rank ?? 9e9)));
}
