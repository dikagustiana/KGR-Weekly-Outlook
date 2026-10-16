import "server-only";
/**
 * M7 commercial view (PRD v3 §4.8): SKU balances (M2 data mart) + list prices + realised prices + rules → engine
 * commercialRows → data mart commercial_daily. Reads for /komersial go through commercialView (role filter).
 */
import {
  D, addDays, commercialControls, commercialRows, frozenKeyOf, keyResolver, realizedPrice,
  type CommercialRow, type Decimal, type ControlV3, type PriceFloorRule, type UrgencyRule,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll, listWeeks, type WeekRow } from "../data";
import { martReplace, registerBuilder } from "../rebuild-registry";
import type { Row } from "./uploads";
import { v5CostingOn } from "../v5/costing";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export interface CommercialState {
  date: string;
  stockDate: string | null;
  week: WeekRow | null;
  rows: CommercialRow[];
  params: { salesSeesCost: boolean; discountLimit: string; blastCostPerKg: string };
  reps: string[];
  assigned: Row[];
  controls: ControlV3[];
  /** v5_costing on: rows carry the costing engine's cost per kg, its status and C54. */
  v5: boolean;
}

export async function computeCommercial(sb: Supa, date: string): Promise<CommercialState> {
  const weeks = await listWeeks(sb);
  const week = weeks.find((w) => date >= w.week_start && date <= w.week_end) ?? weeks.filter((w) => w.week_start <= date).sort((a, b) => b.week_start.localeCompare(a.week_start))[0] ?? null;
  const { data: sd } = await sb.from("sku_balance_daily").select("date").lte("date", date).order("date", { ascending: false }).limit(1).maybeSingle();
  const stockDate = sd ? String((sd as Row).date) : null;
  const [bal, lots, keys, prices, items, sales, orders, urg, floors, assigned, fcReps, param] = await Promise.all([
    stockDate ? fetchAll<Row>((a, b) => sb.from("sku_balance_daily").select("*").eq("date", stockDate).range(a, b)) : Promise.resolve([] as Row[]),
    stockDate ? fetchAll<Row>((a, b) => sb.from("lot_balance_daily").select("key, form, hours_to_cutoff, free_kg").eq("date", stockDate).eq("form", "fresh").gt("free_kg", 0).range(a, b)) : Promise.resolve([] as Row[]),
    fetchAll<Row>((a, b) => sb.from("sku_key").select("key, group_code, storage_cost_per_kg_day, fresh_window_hours, frozen_age_limit_days").range(a, b)),
    week ? fetchAll<Row>((a, b) => sb.from("sku_price").select("key, ref_sell_price").eq("week_id", week.id).range(a, b)) : Promise.resolve([] as Row[]),
    fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, kg, price, sales_rep").eq("status", "Aktual").is("deleted_at", null).is("superseded_at", null).gte("date", addDays(date, -7)).lte("date", addDays(date, -1)).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, kg, sales_rep, delivery_date, date").eq("status", "Order").is("deleted_at", null).is("superseded_at", null).gte("date", addDays(date, -30)).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("urgency_rule").select("form, age_from, age_to, status").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("price_floor_rule").select("key, group_code, markup_rp_per_kg, markup_pct, effective_from").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_assignment").select("*").eq("active", true).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("forecast_line").select("sales_rep").is("deleted_at", null).gte("week_start", addDays(date, -35)).range(a, b)),
    week ? sb.from("parameter").select("*").eq("week_id", week.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // v5 §4.1 / §4.6 (K17): the cost per kg of the stock is the ledger's lot cost (costing engine), with its status
  const v5 = await v5CostingOn(sb);
  const keyOf = keyResolver(items.map((i) => ({ item_code: s(i.item_code), key: String(i.key) })));
  const info = new Map(keys.map((k) => [String(k.key), k]));
  const price = new Map(prices.map((p) => [String(p.key), s(p.ref_sell_price)]));
  const real = realizedPrice(sales.map((x) => ({ key: keyOf(s(x.key_manual), s(x.item_code)), kg: s(x.kg) ?? "0", price: s(x.price) ?? "0" })));
  // kg ordered for delivery today per key (C39: urgent SKUs without an order today)
  const today = new Map<string, Decimal>();
  for (const o of orders) if ((s(o.delivery_date) ?? s(o.date)) === date) {
    const k = keyOf(s(o.key_manual), s(o.item_code));
    today.set(k, (today.get(k) ?? D(0)).plus(D(s(o.kg) ?? "0")));
  }
  const hours = new Map<string, number>();
  for (const l of lots) if (l.hours_to_cutoff !== null) hours.set(String(l.key), Math.min(hours.get(String(l.key)) ?? Infinity, Number(l.hours_to_cutoff)));
  const p = (param.data ?? {}) as Row;
  const blast = s(p.blast_cost_per_kg) ?? "0";
  const rows = commercialRows({
    date, blastCostPerKg: blast, costAnomalyRatio: s(p.cost_anomaly_ratio) ?? "3",
    urgencyRules: urg.map((u) => ({ form: u.form === "fresh" ? "fresh" : "frozen", age_from: Number(u.age_from), age_to: u.age_to === null ? null : Number(u.age_to), status: String(u.status) as UrgencyRule["status"] })),
    floorRules: floors.map((f): PriceFloorRule => ({ key: s(f.key), group_code: s(f.group_code), markup_rp_per_kg: String(f.markup_rp_per_kg ?? 0), markup_pct: String(f.markup_pct ?? 0), effective_from: String(f.effective_from) })),
    items: bal.map((b) => {
      const key = String(b.key);
      const k = info.get(key);
      return {
        key, group_code: s(b.group_code) ?? s(k?.group_code), form: b.form === "fresh" ? "fresh" : "frozen", free_kg: s(b.free_kg) ?? "0",
        oldest_age_days: b.oldest_age_days === null ? null : Number(b.oldest_age_days), hours_to_cutoff: hours.has(key) ? hours.get(key)! : null,
        cost_per_kg_ma: s(b.cost_per_kg_ma), cost_per_kg_si: s(b.cost_per_kg_si), price_list: price.get(key) ?? null, price_frozen: price.get(frozenKeyOf(key)) ?? null,
        realized_price_7d: real.has(key) ? real.get(key)!.toFixed(4) : null, storage_per_kg_day: s(k?.storage_cost_per_kg_day), ordered_today_kg: today.get(key) ?? "0",
        ...(v5 ? { cost_per_kg: s(b.cost_per_kg_si), cost_status: s(b.cost_status) } : {}),
      };
    }),
  });
  const reps = [...orders.map((o) => s(o.sales_rep)), ...fcReps.map((f) => s(f.sales_rep))].filter((x): x is string => !!x);
  const controls = commercialControls({ rows, reps, assigned: assigned.map((a) => String(a.sales_rep)) });
  return {
    date, stockDate, week, rows,
    params: { salesSeesCost: p.sales_sees_cost !== false, discountLimit: s(p.discount_limit_rp_per_kg) ?? "500", blastCostPerKg: blast },
    reps: [...new Set(reps)].sort(), assigned, controls, v5,
  };
}

const f = (x: { toFixed(n: number): string } | null | undefined, dp: number) => (x === null || x === undefined ? null : x.toFixed(dp));

export function martRows(st: CommercialState): Row[] {
  return st.rows.map((r) => ({
    date: st.date, key: r.key, group_code: r.group_code, form: r.form, free_fresh_kg: f(r.free_fresh_kg, 2), free_frozen_kg: f(r.free_frozen_kg, 2),
    oldest_age_days: r.oldest_age_days, hours_to_cutoff: r.hours_to_cutoff, cost_per_kg_ma: f(r.cost_per_kg_ma, 4), cost_per_kg_si: f(r.cost_per_kg_si, 4),
    price_floor: f(r.price_floor, 4), price_list: f(r.price_list, 4), margin_per_kg_list: f(r.margin_per_kg_list, 4), realized_price_7d: f(r.realized_price_7d, 4),
    margin_per_kg_realized: f(r.margin_per_kg_realized, 4), holding_loss_per_day: f(r.holding_loss_per_day, 2), downgrade_risk_rp: f(r.downgrade_risk_rp, 2),
    urgency: r.urgency, priority_score: f(r.priority_score, 2), rank: r.rank, ordered_today_kg: f(r.ordered_today_kg, 2),
    ...(st.v5 ? { cost_per_kg: f(r.cost_per_kg, 4), cost_status: r.cost_status ?? null, cost_check: r.cost_check ?? false } : {}),
  }));
}

export async function buildCommercialDay(sb: Supa, date: string): Promise<string> {
  const st = await computeCommercial(sb, date);
  const w = await martReplace(sb, "commercial_daily", date, martRows(st));
  return `${st.rows.length} SKU (stok per ${st.stockDate ?? "—"}; ${w.written} ditulis, ${w.deleted} dihapus)`;
}

registerBuilder({ module: "m7_commercial", name: "commercial", build: buildCommercialDay });

/**
 * Reads for /komersial: the latest built day ≤ date (sales through the view without the SI cost; with v5_costing on,
 * the v5 view that adds the cost per SKU, its status and C54).
 */
export async function commercialMart(sb: Supa, date: string, sales: boolean): Promise<{ date: string | null; rows: Row[] }> {
  const table = !sales ? "commercial_daily" : (await v5CostingOn(sb)) ? "commercial_daily_sales_v5" : "commercial_daily_sales";
  const { data } = await sb.from(table).select("date").lte("date", date).order("date", { ascending: false }).limit(1).maybeSingle();
  const d = data ? String((data as Row).date) : null;
  if (!d) return { date: null, rows: [] };
  return { date: d, rows: await fetchAll<Row>((a, b) => sb.from(table).select("*").eq("date", d).order("rank").range(a, b)) };
}
