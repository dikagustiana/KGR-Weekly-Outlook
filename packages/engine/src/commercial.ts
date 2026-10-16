/**
 * M7 — commercial view (PRD v3 §4.8). Pure functions, decimal.js.
 *
 * Per SKU key and day: free kg (fresh / frozen), age, MA cost, price floor = MA + markup (rule per key / group; default
 * storage per kg-day × 7 + blast cost per kg), list price and margin, realised price of the last 7 days and margin,
 * holding loss per day = storage × free kg, downgrade risk (fresh) = (fresh − frozen price) × free fresh kg,
 * urgency from the age rules (Q18), priority = holding loss + downgrade risk / max(1, hours to cut-off / 24), ranked.
 */
import { D, Decimal, ZERO, div, max, sum, type Num } from "./decimal";
import type { ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";

export type Urgency = "aman" | "jual_minggu_ini" | "jual_hari_ini" | "di_atas_umur";
export const URGENCY_ORDER: Urgency[] = ["di_atas_umur", "jual_hari_ini", "jual_minggu_ini", "aman"];

export interface UrgencyRule {
  form: "fresh" | "frozen";
  age_from: number;
  age_to: number | null;
  status: Urgency;
}

export function urgency(rules: UrgencyRule[], ageDays: number | null, form: "fresh" | "frozen"): Urgency {
  if (ageDays === null) return "aman";
  const r = rules.filter((x) => x.form === form && ageDays >= x.age_from && (x.age_to === null || ageDays <= x.age_to))
    .sort((a, b) => b.age_from - a.age_from)[0];
  return r?.status ?? "aman";
}

export interface PriceFloorRule {
  key: string | null;
  group_code: string | null;
  markup_rp_per_kg: Num;
  markup_pct: Num;
  effective_from: ISODate;
}

/** Floor = MA cost + markup of the most specific rule in force (key, then group); default storage × 7 + blast. */
export function priceFloor(x: { key: string; group_code: string | null; costPerKgMa: Num | null; rules: PriceFloorRule[]; date: ISODate; storagePerKgDay: Num | null; blastCostPerKg: Num }): Decimal | null {
  if (x.costPerKgMa === null || x.costPerKgMa === undefined || x.costPerKgMa === "") return null;
  const cost = D(x.costPerKgMa);
  const inForce = x.rules.filter((r) => r.effective_from <= x.date).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const rule = inForce.find((r) => r.key === x.key) ?? inForce.find((r) => r.key === null && r.group_code !== null && r.group_code === x.group_code) ?? inForce.find((r) => r.key === null && r.group_code === null);
  if (rule) return cost.plus(D(rule.markup_rp_per_kg)).plus(cost.times(D(rule.markup_pct)));
  return cost.plus(D(x.storagePerKgDay ?? 0).times(7)).plus(D(x.blastCostPerKg));
}

export interface CommercialInput {
  key: string;
  group_code: string | null;
  form: "fresh" | "frozen";
  free_kg: Num;
  oldest_age_days: number | null;
  hours_to_cutoff: number | null;
  cost_per_kg_ma: Num | null;
  cost_per_kg_si: Num | null;
  price_list: Num | null;
  /** List price of the frozen key the fresh one blasts to (downgrade). */
  price_frozen: Num | null;
  realized_price_7d: Num | null;
  storage_per_kg_day: Num | null;
  ordered_today_kg?: Num;
}

export interface CommercialRow {
  key: string;
  group_code: string | null;
  form: "fresh" | "frozen";
  free_fresh_kg: Decimal;
  free_frozen_kg: Decimal;
  oldest_age_days: number | null;
  hours_to_cutoff: number | null;
  cost_per_kg_ma: Decimal | null;
  cost_per_kg_si: Decimal | null;
  price_floor: Decimal | null;
  price_list: Decimal | null;
  margin_per_kg_list: Decimal | null;
  realized_price_7d: Decimal | null;
  margin_per_kg_realized: Decimal | null;
  holding_loss_per_day: Decimal;
  downgrade_risk_rp: Decimal;
  urgency: Urgency;
  priority_score: Decimal;
  rank: number;
  ordered_today_kg: Decimal;
}

const dn = (v: Num | null | undefined) => (v === null || v === undefined || v === "" ? null : D(v));

export function commercialRows(x: { date: ISODate; items: CommercialInput[]; urgencyRules: UrgencyRule[]; floorRules: PriceFloorRule[]; blastCostPerKg: Num }): CommercialRow[] {
  const rows = x.items.filter((i) => D(i.free_kg).gt(0)).map((i): CommercialRow => {
    const free = D(i.free_kg);
    const ma = dn(i.cost_per_kg_ma), list = dn(i.price_list), real = dn(i.realized_price_7d);
    const floor = priceFloor({ key: i.key, group_code: i.group_code, costPerKgMa: i.cost_per_kg_ma, rules: x.floorRules, date: x.date, storagePerKgDay: i.storage_per_kg_day, blastCostPerKg: x.blastCostPerKg });
    const holding = D(i.storage_per_kg_day ?? 0).times(free);
    const pz = dn(i.price_frozen);
    const downgrade = i.form === "fresh" && list !== null && pz !== null ? max(ZERO, list.minus(pz)).times(free) : ZERO;
    const hours = i.hours_to_cutoff;
    const priority = holding.plus(downgrade.div(Math.max(1, (hours ?? 24) / 24)));
    return {
      key: i.key, group_code: i.group_code, form: i.form, free_fresh_kg: i.form === "fresh" ? free : ZERO, free_frozen_kg: i.form === "frozen" ? free : ZERO,
      oldest_age_days: i.oldest_age_days, hours_to_cutoff: hours, cost_per_kg_ma: ma, cost_per_kg_si: dn(i.cost_per_kg_si), price_floor: floor, price_list: list,
      margin_per_kg_list: list !== null && ma !== null ? list.minus(ma) : null, realized_price_7d: real, margin_per_kg_realized: real !== null && ma !== null ? real.minus(ma) : null,
      holding_loss_per_day: holding, downgrade_risk_rp: downgrade, urgency: urgency(x.urgencyRules, i.oldest_age_days, i.form), priority_score: priority, rank: 0,
      ordered_today_kg: D(i.ordered_today_kg ?? 0),
    };
  });
  rows.sort((a, b) => URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency) || b.priority_score.cmp(a.priority_score) || a.key.localeCompare(b.key));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Realised price per key over the given sales (Σ value / Σ kg). */
export function realizedPrice(sales: { key: string; kg: Num; price: Num }[]): Map<string, Decimal> {
  const m = new Map<string, { kg: Decimal; v: Decimal }>();
  for (const s of sales) {
    const a = m.get(s.key) ?? { kg: ZERO, v: ZERO };
    m.set(s.key, { kg: a.kg.plus(D(s.kg)), v: a.v.plus(D(s.kg).times(D(s.price))) });
  }
  return new Map([...m].filter(([, a]) => a.kg.gt(0)).map(([k, a]) => [k, a.v.div(a.kg)]));
}

/** Price below the floor: Rp/kg below and total; who approves (commercial_lead up to the limit, finance above). */
export function belowFloor(x: { price: Num; floor: Num | null; kg: Num; limitRpPerKg: Num }): { below: boolean; rpPerKg: Decimal; total: Decimal; approver: "commercial_lead" | "finance" | null } {
  if (x.floor === null || x.floor === undefined || x.floor === "") return { below: false, rpPerKg: ZERO, total: ZERO, approver: null };
  const gap = D(x.floor).minus(D(x.price));
  if (!gap.gt(0)) return { below: false, rpPerKg: ZERO, total: ZERO, approver: null };
  return { below: true, rpPerKg: gap, total: gap.times(D(x.kg)), approver: gap.gt(D(x.limitRpPerKg)) ? "finance" : "commercial_lead" };
}

/**
 * C38: order lines priced under the floor without an approved discount (GAGAL).
 * C39: SKU urgency "jual hari ini" / "di atas umur" without an order today (PERIKSA).
 * C40: sales reps on orders / forecasts without a sales_assignment (BELUM DIISI).
 */
export function commercialControls(x: { belowFloorUnapproved?: { ref: string; key: string; rpPerKg: Decimal }[]; rows?: CommercialRow[]; reps?: string[]; assigned?: string[] }): ControlV3[] {
  const n = (v: number) => D(v);
  const out: ControlV3[] = [];
  if (x.belowFloorUnapproved !== undefined) {
    const b = x.belowFloorUnapproved;
    out.push({
      code: "C38", module: "M7", name: "Order di bawah harga lantai tanpa approval", value: n(b.length), comparator: n(0), difference: sum(b.map((q) => q.rpPerKg)),
      status: b.length ? "GAGAL" : "LULUS", action: b.length ? "Ajukan approval diskon atau naikkan harga" : "", detail: b.map((q) => `${q.ref.slice(0, 8)} ${q.key}: ${q.rpPerKg.toFixed(0)}/kg di bawah lantai`),
    });
  }
  if (x.rows !== undefined) {
    const urgent = x.rows.filter((r) => (r.urgency === "jual_hari_ini" || r.urgency === "di_atas_umur") && !r.ordered_today_kg.gt(0));
    out.push({
      code: "C39", module: "M7", name: "SKU jual hari ini tanpa order hari ini", value: n(urgent.length), comparator: n(0), difference: sum(urgent.map((r) => r.free_fresh_kg.plus(r.free_frozen_kg))),
      status: urgent.length ? "PERIKSA" : "LULUS", action: urgent.length ? "Tawarkan SKU berikut hari ini" : "", detail: urgent.map((r) => `#${r.rank} ${r.key}: ${r.free_fresh_kg.plus(r.free_frozen_kg).toFixed(0)} kg, umur ${r.oldest_age_days ?? "—"} hari`),
    });
  }
  if (x.reps !== undefined) {
    const have = new Set((x.assigned ?? []).map((a) => a.trim().toLowerCase()));
    const miss = [...new Set(x.reps.map((r) => r.trim()).filter(Boolean))].filter((r) => !have.has(r.toLowerCase())).sort();
    out.push({
      code: "C40", module: "M7", name: "Sales tanpa penugasan (sales_assignment)", value: n(miss.length), comparator: n(0), difference: n(miss.length),
      status: miss.length ? "BELUM DIISI" : "LULUS", action: miss.length ? "Isi penugasan sales (commercial_lead)" : "", detail: miss,
    });
  }
  return out;
}

export interface ScorecardRow {
  sales_rep: string;
  target_kg: Decimal | null;
  actual_kg: Decimal;
  pct: Decimal | null;
  target_rp: Decimal | null;
  actual_rp: Decimal;
  kg_to_frozen_unsold: Decimal;
  rp_downgrade: Decimal;
  forecast_mape: Decimal | null;
  discount_count: number;
  discount_rp: Decimal;
  /** kg sold through the spot channel (K8, P3.9). */
  kg_spot: Decimal;
}

/**
 * Weekly scorecard per sales rep (computed Monday for the week before): target vs actual kg / Rp, kg of the rep's SKUs
 * that went to frozen unsold (cut-off blasts) and its downgrade, forecast error (|actual − forecast| / forecast), approved
 * discounts (count, Rp below the floor).
 */
export function scorecard(x: {
  targets: { sales_rep: string; target_kg: Num | null; target_rp: Num | null }[];
  actuals: { sales_rep: string; kg: Num; value: Num }[];
  forecasts: { sales_rep: string; kg: Num }[];
  blasts: { sales_rep: string; kg: Num; rp_downgrade: Num }[];
  discounts: { sales_rep: string; total_below: Num }[];
  /** Spot sales of the week (sales_line channel 'spot'), any status. */
  spot?: { sales_rep: string; kg: Num }[];
}): ScorecardRow[] {
  const spot = x.spot ?? [];
  const reps = [...new Set([...x.targets, ...x.actuals, ...x.forecasts, ...x.blasts, ...x.discounts, ...spot].map((r) => r.sales_rep).filter(Boolean))].sort();
  return reps.map((rep) => {
    const t = x.targets.filter((r) => r.sales_rep === rep);
    const tk = t.some((r) => r.target_kg !== null && r.target_kg !== undefined && r.target_kg !== "") ? sum(t.map((r) => D(r.target_kg ?? 0))) : null;
    const tr = t.some((r) => r.target_rp !== null && r.target_rp !== undefined && r.target_rp !== "") ? sum(t.map((r) => D(r.target_rp ?? 0))) : null;
    const ak = sum(x.actuals.filter((r) => r.sales_rep === rep).map((r) => D(r.kg)));
    const ar = sum(x.actuals.filter((r) => r.sales_rep === rep).map((r) => D(r.value)));
    const fk = sum(x.forecasts.filter((r) => r.sales_rep === rep).map((r) => D(r.kg)));
    const ds = x.discounts.filter((r) => r.sales_rep === rep);
    return {
      sales_rep: rep, target_kg: tk, actual_kg: ak, pct: tk === null ? null : div(ak, tk), target_rp: tr, actual_rp: ar,
      kg_to_frozen_unsold: sum(x.blasts.filter((r) => r.sales_rep === rep).map((r) => D(r.kg))), rp_downgrade: sum(x.blasts.filter((r) => r.sales_rep === rep).map((r) => D(r.rp_downgrade))),
      forecast_mape: fk.isZero() ? null : ak.minus(fk).abs().div(fk), discount_count: ds.length, discount_rp: sum(ds.map((r) => D(r.total_below))),
      kg_spot: sum(spot.filter((r) => r.sales_rep === rep).map((r) => D(r.kg))),
    };
  });
}

export interface GuardLine { key: string; customer: string | null; price: Num | null; kg: Num | null }
export interface DiscountRequest { id: string; key: string; customer: string | null; requested_price: Num; kg: Num; status: string; sales_line_id?: string | null }

/**
 * Order guard (PRD v3 §4.8): a line under the floor passes only when an approved, unused request covers it (same key
 * and customer, requested price ≤ line price, kg ≥ line kg); otherwise it is refused and a pending request is proposed
 * (unless an identical one is already pending). One approval covers one line.
 */
export function guardOrders(x: { lines: GuardLine[]; floors: Map<string, Num>; requests: DiscountRequest[]; limitRpPerKg: Num }): {
  covered: string[];
  refused: { line: GuardLine; floor: Decimal; rpPerKg: Decimal; total: Decimal; approver: "commercial_lead" | "finance" }[];
  newRequests: { key: string; customer: string | null; requested_price: Decimal; floor_price: Decimal; rp_per_kg_below: Decimal; kg: Decimal; total_below: Decimal }[];
} {
  const covered: string[] = [];
  const refused: ReturnType<typeof guardOrders>["refused"] = [];
  const newRequests: ReturnType<typeof guardOrders>["newRequests"] = [];
  const fits = (r: DiscountRequest, l: GuardLine) => r.key === l.key && (r.customer ?? "") === (l.customer ?? "") && !D(r.requested_price).gt(D(l.price!)) && !D(r.kg).lt(D(l.kg!));
  for (const l of x.lines) {
    if (l.price === null || l.price === undefined || l.price === "" || l.kg === null || l.kg === undefined || l.kg === "") continue;
    const floor = x.floors.get(l.key) ?? null;
    const b = belowFloor({ price: l.price, floor, kg: l.kg, limitRpPerKg: x.limitRpPerKg });
    if (!b.below) continue;
    const ok = x.requests.find((r) => r.status === "approved" && !r.sales_line_id && fits(r, l) && !covered.includes(r.id));
    if (ok) { covered.push(ok.id); continue; }
    refused.push({ line: l, floor: D(floor!), rpPerKg: b.rpPerKg, total: b.total, approver: b.approver! });
    const dup = x.requests.some((r) => r.status === "pending" && fits(r, l) && D(r.requested_price).eq(D(l.price!))) || newRequests.some((r) => r.key === l.key && (r.customer ?? "") === (l.customer ?? "") && r.requested_price.eq(D(l.price!)) && r.kg.eq(D(l.kg!)));
    if (!dup) newRequests.push({ key: l.key, customer: l.customer, requested_price: D(l.price), floor_price: D(floor!), rp_per_kg_below: b.rpPerKg, kg: D(l.kg), total_below: b.total });
  }
  return { covered, refused, newRequests };
}

/**
 * Spot sale (K8, P3.9): the same rule public.tg_spot_guard applies, so the page can say why before anyone presses the
 * button. Allowed for today only, before the cut-off time, with the week's spot_enabled on, for a key whose commercial
 * status is "jual hari ini", up to its free fresh kg, without a PO number. Returns the reasons it is refused.
 */
export function spotCheck(x: {
  spotEnabled: boolean; today: ISODate; date: ISODate; now: string; cutOffTime: string;
  urgency: string | null; freeFreshKg: Num | null; kg: Num | null; poRef?: string | null;
}): string[] {
  const out: string[] = [];
  if (!x.spotEnabled) out.push("jalur spot belum diaktifkan untuk minggu ini");
  if (x.date !== x.today) out.push("penjualan spot hanya untuk hari ini");
  if (x.now.slice(0, 5) >= x.cutOffTime.slice(0, 5)) out.push(`cut-off ${x.cutOffTime.slice(0, 5)} sudah lewat`);
  if (x.urgency !== "jual_hari_ini") out.push("SKU tidak berstatus jual hari ini");
  if (x.poRef && x.poRef.trim()) out.push("penjualan spot tanpa nomor PO");
  if (x.kg !== null && x.kg !== undefined && x.kg !== "") {
    const kg = D(x.kg), free = D(x.freeFreshKg ?? 0);
    if (!kg.gt(0)) out.push("kg harus lebih dari 0");
    else if (kg.gt(free)) out.push(`melebihi stok fresh bebas ${free.toFixed(0)} kg`);
  }
  return out;
}
