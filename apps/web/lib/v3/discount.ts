import "server-only";
/**
 * M7 approval (PRD v3 §4.8, Q19): an order priced under the floor is refused unless an approved discount covers it;
 * the refusal files a pending request for the commercial lead (≤ limit) or Finance (above). Floors come from the
 * commercial data mart (view commercial_daily_sales); the arithmetic is @kgr/engine belowFloor / commercialControls.
 * Scorecard per sales rep per week (engine scorecard) → data mart sales_scorecard_weekly.
 */
import {
  D, addDays, belowFloor, commercialControls, guardOrders, jakartaToday, keyResolver, mondayOf, scorecard, toFixedString,
  type ControlV3, type Decimal,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import type { ModuleSettings } from "../modules-core";
import { fetchAll, type WeekRow } from "../data";
import { inChunks, must, mustRows } from "../loader";
import { WriteError } from "../write";
import { martReplace, registerBuilder } from "../rebuild-registry";
import type { Row } from "./uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export interface OrderToCheck {
  item_code?: string | null;
  key_manual?: string | null;
  key?: string | null;
  customer: string | null;
  price: string | null;
  kg: string | null;
  date: string | null;
}

async function keyFn(sb: Supa) {
  const items = await fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).order("item_code").range(a, b));
  return keyResolver(items.map((i) => ({ item_code: s(i.item_code), key: String(i.key) })));
}

/** Price floor per key: the latest commercial row on or before the date. */
async function floors(sb: Supa, keys: string[], date: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const rows = await inChunks(keys, (c) => fetchAll<Row>((a, b) => sb.from("commercial_daily_sales").select("date, key, price_floor").in("key", c).lte("date", date).gte("date", addDays(date, -14)).order("date", { ascending: false }).order("key").range(a, b)));
  for (const r of rows) if (!out.has(String(r.key)) && r.price_floor !== null) out.set(String(r.key), String(r.price_floor));
  return out;
}

async function limitRpPerKg(sb: Supa): Promise<string> {
  const data = must(await sb.rpc("discount_limit"), "discount.discount_limit") as string | null;
  return data === null || data === undefined ? "500" : String(data);
}

/** Approved request that covers an order line (same rule as guardOrders), for C38 on saved lines. */
const matches = (a: Row, key: string, customer: string | null, price: Decimal, kg: Decimal) =>
  String(a.key) === key && (s(a.customer) ?? "") === (customer ?? "") && !D(String(a.requested_price)).gt(price) && !D(String(a.kg)).lt(kg);

/**
 * Guard for new / changed Order lines (Input → Penjualan, paste, PO lines upload). Flag m7_approval off → no guard.
 * Returns the approvals that cover the lines; throws (after filing pending requests) when one is not covered.
 */
export async function floorGuard(sb: Supa, viewer: Viewer, settings: ModuleSettings, orders: OrderToCheck[]): Promise<{ covered: string[] }> {
  if (!settings.m7_approval?.enabled || !orders.length) return { covered: [] };
  const keyOf = await keyFn(sb);
  const lines = orders.map((o) => ({ key: o.key ?? keyOf(o.key_manual ?? null, o.item_code ?? null), customer: o.customer, price: o.price, kg: o.kg }));
  const fl = await floors(sb, [...new Set(lines.map((l) => l.key))], jakartaToday());
  const limit = await limitRpPerKg(sb);
  const requests = await fetchAll<Row>((a, b) => sb.from("discount_approval").select("id, key, customer, requested_price, kg, status, sales_line_id").in("status", ["approved", "pending"]).order("id").range(a, b));
  const g = guardOrders({
    lines, floors: fl, limitRpPerKg: limit,
    requests: requests.map((r) => ({ id: String(r.id), key: String(r.key), customer: s(r.customer), requested_price: String(r.requested_price), kg: String(r.kg), status: String(r.status), sales_line_id: s(r.sales_line_id) })),
  });
  for (const r of g.newRequests) {
    const e = await sb.from("discount_approval").insert({
      key: r.key, customer: r.customer, requested_price: r.requested_price.toFixed(4), floor_price: r.floor_price.toFixed(4), rp_per_kg_below: r.rp_per_kg_below.toFixed(4),
      kg: r.kg.toFixed(2), total_below: r.total_below.toFixed(2), requested_by: viewer.email, status: "pending",
    });
    if (e.error) throw new WriteError(`discount_approval: ${e.error.message}`);
  }
  if (g.refused.length) {
    throw new WriteError(`Harga di bawah lantai, order ditolak; permintaan approval dikirim: ${g.refused.map((r) => `${r.line.key}${r.line.customer ? ` (${r.line.customer})` : ""} Rp ${D(r.line.price!).toFixed(0)} < lantai ${r.floor.toFixed(0)} — perlu approval ${r.approver === "finance" ? "Finance" : "commercial lead"}`).join("; ")}`);
  }
  return { covered: g.covered };
}

/**
 * Mark the approvals a saved order used (one approval, one order). Since PRD v4 irisan 5 the database links the
 * covering approval to the line itself (floor_guard_v4); this only records it where the database did not, and never
 * unlinks one.
 */
export async function consumeApprovals(sb: Supa, approvalIds: string[], salesLineId: string | null): Promise<void> {
  if (salesLineId) {
    const data = mustRows(await sb.from("discount_approval").select("id").eq("sales_line_id", salesLineId).limit(1), "consumeApprovals.discount_approval");
    if (data.length) return;
  }
  for (const id of approvalIds) {
    const e = salesLineId
      ? await sb.from("discount_approval").update({ sales_line_id: salesLineId, reason: null }).eq("id", id).is("sales_line_id", null)
      : await sb.from("discount_approval").update({ reason: "dipakai (baris tempel / upload)" }).eq("id", id);
    if (e.error) throw new WriteError(`discount_approval: ${e.error.message}`);
  }
}

export async function decide(sb: Supa, viewer: Viewer, id: string, approve: boolean, reason: string | null): Promise<string> {
  const { error } = await sb.from("discount_approval").update({ status: approve ? "approved" : "rejected", decided_by: viewer.email, decided_at: new Date().toISOString(), reason }).eq("id", id);
  if (error) throw new WriteError(error.message);
  return approve ? "Diskon disetujui" : "Diskon ditolak";
}

/** C38 for a week: Order lines priced under the floor without an approved discount. */
export async function weekFloorControls(sb: Supa, week: WeekRow): Promise<ControlV3[]> {
  const keyOf = await keyFn(sb);
  const orders = await fetchAll<Row>((a, b) => sb.from("sales_line").select("id, item_code, key_manual, customer, price, kg, date, discount_approval_id").eq("week_id", week.id).eq("status", "Order").is("deleted_at", null).is("superseded_at", null).order("id").range(a, b));
  const lines = orders.map((o) => ({ id: String(o.id), key: keyOf(s(o.key_manual), s(o.item_code)), customer: s(o.customer), price: s(o.price), kg: s(o.kg) }));
  const fl = await floors(sb, [...new Set(lines.map((l) => l.key))], week.update_date);
  const approved = await fetchAll<Row>((a, b) => sb.from("discount_approval").select("*").eq("status", "approved").order("id").range(a, b));
  const limit = await limitRpPerKg(sb);
  const breaches = lines.filter((l) => l.price !== null && l.kg !== null).map((l) => ({ l, b: belowFloor({ price: l.price!, floor: fl.get(l.key) ?? null, kg: l.kg!, limitRpPerKg: limit }) }))
    .filter(({ l, b }) => b.below && !approved.some((a) => String(a.sales_line_id) === l.id || matches(a, l.key, l.customer, D(l.price!), D(l.kg!))))
    .map(({ l, b }) => ({ ref: l.id, key: l.key, rpPerKg: b.rpPerKg }));
  return commercialControls({ belowFloorUnapproved: breaches });
}

// ------------------------------------------------------------------------------------------------ scorecard

export async function computeScorecard(sb: Supa, weekStart: string): Promise<ReturnType<typeof scorecard>> {
  const we = addDays(weekStart, 6);
  const keyOf = await keyFn(sb);
  const [targets, sales, fc, blasts, disc, asg, spot] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("sales_target").select("*").eq("week_start", weekStart).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, customer, kg, price, sales_rep").eq("status", "Aktual").is("deleted_at", null).is("superseded_at", null).gte("date", weekStart).lte("date", we).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("forecast_line").select("sales_rep, kg").eq("week_start", weekStart).is("deleted_at", null).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("blast_event").select("key_from, kg, rp_downgrade").eq("reason", "cutoff").is("deleted_at", null).gte("date", weekStart).lte("date", we).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("discount_approval").select("requested_by, total_below").eq("status", "approved").gte("decided_at", weekStart).lte("decided_at", `${we}T23:59:59`).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_assignment").select("*").eq("active", true).order("id").range(a, b)),
    // spot sales (K8): channel 'spot', any status; a missing column (v4 not migrated) is a schema error (banner)
    fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, customer, kg, sales_rep").eq("channel", "spot").is("deleted_at", null).is("superseded_at", null).gte("date", weekStart).lte("date", we).order("id").range(a, b)),
  ]);
  // rep of a sale: the line's own rep, else the rep assigned to its customer, else to its key
  const byCustomer = new Map(asg.filter((a) => a.customer).map((a) => [String(a.customer).toLowerCase(), String(a.sales_rep)]));
  const byKey = new Map(asg.filter((a) => a.key).map((a) => [String(a.key), String(a.sales_rep)]));
  const byEmail = new Map(asg.filter((a) => a.email).map((a) => [String(a.email).toLowerCase(), String(a.sales_rep)]));
  const repOf = (r: Row, key: string) => s(r.sales_rep) ?? (r.customer ? byCustomer.get(String(r.customer).toLowerCase()) : undefined) ?? byKey.get(key) ?? "";
  return scorecard({
    targets: targets.map((t) => ({ sales_rep: String(t.sales_rep), target_kg: s(t.target_kg), target_rp: s(t.target_rp) })),
    // a sale without kg or price cannot be valued: it is left out of the realised figures, not counted at Rp 0
    actuals: sales.filter((x) => s(x.kg) !== null && s(x.price) !== null).map((x) => { const key = keyOf(s(x.key_manual), s(x.item_code)); return { sales_rep: repOf(x, key), kg: String(x.kg), value: D(String(x.kg)).times(D(String(x.price))).toFixed(2) }; }),
    forecasts: fc.map((f) => ({ sales_rep: s(f.sales_rep) ?? "", kg: String(f.kg) })),
    blasts: blasts.map((b) => ({ sales_rep: byKey.get(String(b.key_from)) ?? "", kg: String(b.kg), rp_downgrade: s(b.rp_downgrade) })),
    discounts: disc.map((d) => ({ sales_rep: byEmail.get(String(d.requested_by ?? "").toLowerCase()) ?? "", total_below: String(d.total_below) })),
    spot: spot.filter((x) => s(x.kg) !== null).map((x) => ({ sales_rep: repOf(x, keyOf(s(x.key_manual), s(x.item_code))), kg: String(x.kg) })),
  }).filter((r) => r.sales_rep !== "");
}

export async function buildScorecardWeek(sb: Supa, weekStart: string): Promise<string> {
  const rows = await computeScorecard(sb, weekStart);
  const f = (x: Decimal | null, dp: number) => (x === null ? null : toFixedString(x, dp));
  const w = await martReplace(sb, "sales_scorecard_weekly", weekStart, rows.map((r) => ({
    week_start: weekStart, sales_rep: r.sales_rep, target_kg: f(r.target_kg, 2), actual_kg: f(r.actual_kg, 2), pct: f(r.pct, 6), target_rp: f(r.target_rp, 2), actual_rp: f(r.actual_rp, 2),
    kg_to_frozen_unsold: f(r.kg_to_frozen_unsold, 2), rp_downgrade: f(r.rp_downgrade, 2), forecast_mape: f(r.forecast_mape, 6), discount_count: r.discount_count, discount_rp: f(r.discount_rp, 2),
    kg_spot: f(r.kg_spot, 2),
  })));
  return `scorecard ${weekStart}: ${rows.length} sales (${w.written} ditulis)`;
}

let builtWeeks = new Set<string>();
/** Monday rebuilds the week before (PRD v3 §4.8); other days refresh the running week's partial scorecard. */
registerBuilder({
  module: "m7_approval", name: "scorecard", begin: async () => { builtWeeks = new Set(); },
  build: async (sb, date) => {
    const ws = mondayOf(date) === date ? addDays(date, -7) : mondayOf(date);
    if (builtWeeks.has(ws)) return `scorecard ${ws} sudah dibangun`;
    builtWeeks.add(ws);
    return buildScorecardWeek(sb, ws);
  },
});
