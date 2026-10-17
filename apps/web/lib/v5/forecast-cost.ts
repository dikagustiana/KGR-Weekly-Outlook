import "server-only";
/**
 * R67 (F14, Q-v5-25): the cost per kg of a forecast order (PO day) of the month P&L is the standard plan cost of its cut
 * date — planCost on a 1 kg LB basis (class yield × the LB price decided for that date + freight and slaughter fee), shared
 * over the SKUs by reference price (PRD v5 §4.7) — while v5_costing and v5_pl are on. Without a decision, yield, rate or
 * reference price the order keeps the MA cost of the weekly engine, and the page says so ("biaya MA", with the reason).
 * `computeWeek` is not touched: the orders it returns are re-costed here, only for the month's forecast rows.
 */
import { addDays, blendClassCosts, forecastPlanCost, tariffPerKgLb, type Decimal } from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import { inChunks } from "../loader";
import type { Row } from "../v3/uploads";
import { lbDecisionOf, priceListToKeys, priced, yieldOfClass } from "./costing";
import { normKey, type ForecastCosts } from "./forecast-cost-core";

export { applyForecastCosts, forecastCostText, normKey, type ForecastCostLabel, type ForecastCosts } from "./forecast-cost-core";

const STD_UNITS = ["Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"];
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** date → plan cost per kg per SKU for the cut dates in [from, to] that have an LB price decision. */
export async function forecastCostsOf(sb: Supa, from: string, to: string): Promise<ForecastCosts> {
  const [decisions, yields, weeks] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("lb_price_decision").select("date, weight_class, price, volume_kg_lb, decided_at").gte("date", from).lte("date", to)
      .order("decided_at", { ascending: false }).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("yield_matrix").select("weight_class, cut_pattern, key, yield_pct, effective_from").eq("cut_pattern", "karkas").is("deleted_at", null).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("week").select("id, week_start, week_end").lte("week_start", to).gte("week_end", from).order("id").range(a, b)),
  ]);
  const out: ForecastCosts = { byDate: new Map(), reasons: new Map(), notes: new Map() };
  const dates = [...new Set(decisions.map((d) => String(d.date)))].sort();
  if (!dates.length) return out;
  const weekIds = weeks.map((w) => String(w.id));
  const [params, prices, lists] = await Promise.all([
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("parameter").select("week_id, freight_plan_per_kg_lb, maklon_per_kg_processed, target_shrink").in("week_id", part).order("week_id").range(a, b))),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("sku_price").select("week_id, key, ref_sell_price").in("week_id", part).order("key").order("week_id").range(a, b))),
    inChunks([...new Set(weeks.map((w) => addDays(String(w.week_start), -7)))], (part) => fetchAll<Row>((a, b) => sb.from("price_list_week").select("week_start, key, price_fresh, price_frozen").in("week_start", part).not("locked_at", "is", null).is("deleted_at", null).order("key").order("week_start").range(a, b))),
  ]);
  for (const date of dates) {
    const week = weeks.find((w) => String(w.week_start) <= date && date <= String(w.week_end));
    if (!week) { out.reasons.set(date, "minggu belum ada"); continue; }
    const par = params.find((p) => String(p.week_id) === String(week.id));
    const [fr, mk, sh] = [s(par?.freight_plan_per_kg_lb), s(par?.maklon_per_kg_processed), s(par?.target_shrink)];
    if (fr === null || mk === null || sh === null) { out.reasons.set(date, "tarif freight/maklon belum diisi"); continue; }
    const tariff = tariffPerKgLb({ freightPerKgLb: fr, maklonPerKgProcessed: mk, shrink: sh }).toFixed(4);
    const list = priceListToKeys(lists.filter((l) => String(l.week_start) === addDays(String(week.week_start), -7)).map((l) => ({ key: String(l.key), price_fresh: s(l.price_fresh), price_frozen: s(l.price_frozen) })));
    const weekPrices = new Map(prices.filter((p) => String(p.week_id) === String(week.id)).map((p) => [String(p.key), s(p.ref_sell_price)]));
    const priceOf = (k: string) => priced(list.get(k)) ?? priced(weekPrices.get(k) ?? null);
    // the latest decision of each class decided for the date (rows are newest first); weight_class null = every class
    const classes = [...new Set(decisions.filter((d) => String(d.date) === date).map((d) => s(d.weight_class)))];
    const parts: Parameters<typeof blendClassCosts>[0] = [];
    let reason: string | null = null;
    for (const cls of classes) {
      const d = lbDecisionOf(decisions, date, cls);
      const lbPrice = priced(s(d?.price));
      if (!d || lbPrice === null) { reason = "harga LB keputusan kosong"; break; }
      const ys = new Map(["Karkas", ...STD_UNITS].map((u) => [u, yieldOfClass(yields, u, cls, date)]));
      const lacking = [...ys].filter(([, y]) => y.value === null).map(([u]) => u);
      if (lacking.length) { reason = `yield belum diisi: ${lacking.join(", ")}`; break; }
      const y = (u: string) => ys.get(u)!.value!;
      const outputs = [
        { key: "RPA|Karkas|Fresh", kg: y("Karkas"), priceRef: priceOf("RPA|Karkas|Fresh") },
        { key: "RPA|Karkas|Frozen", kg: "0", priceRef: priceOf("RPA|Karkas|Frozen") },
        ...STD_UNITS.map((u) => ({ key: `RPA|${u}|Fresh`, kg: y(u), priceRef: priceOf(`RPA|${u}|Fresh`) })),
      ];
      parts.push({
        volume: s(d.volume_kg_lb), costs: forecastPlanCost({ lbPrice, tariffPerKgLb: tariff, outputs }),
        yields: new Map([["RPA|Karkas|Fresh", y("Karkas")], ["RPA|Karkas|Frozen", y("Karkas")], ...STD_UNITS.map((u) => [`RPA|${u}|Fresh`, y(u)] as [string, string])]),
      });
    }
    if (reason !== null || !parts.length) { out.reasons.set(date, reason ?? "keputusan LB kosong"); continue; }
    const blended = blendClassCosts(parts);
    out.byDate.set(date, new Map([...blended.costs].filter((e): e is [string, Decimal] => e[1] !== null).map(([k, v]) => [normKey(k), v])));
    if (parts.length > 1 && blended.equalWeights) out.notes.set(date, `${date}: kelas dirata-rata sama rata (volume LB keputusan belum diisi)`);
  }
  return out;
}

