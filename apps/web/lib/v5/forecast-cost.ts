import "server-only";
/**
 * R67 (F14): the standard cost per kg of a forecast order — planCost on the class yield (STD until PPIC fills K/S/B),
 * 1 kg LB basis. The engine `forecastPlanCost` does the relative-sales-value split; this module builds the outputs and
 * loads the LB price decision, the tariff and the reference prices.
 */
import { D, addDays, forecastPlanCost, type Decimal } from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";

const STD_UNITS: [string, string][] = [["Kepala", "Kepala"], ["Ceker", "Ceker"], ["Usus", "Usus"], ["HJA (Hati/Jantung/Ampela)", "HJA (Hati/Jantung/Ampela)"], ["Lemak", "Lemak"]];

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** date → (key → cost/kg), null when the inputs are missing (the caller falls back to the MA cost with a label). */
export async function forecastCostsOf(sb: Supa, from: string, to: string): Promise<Map<string, Map<string, Decimal | null>>> {
  const [yields, decisions, params, prices, weeks] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("yield_matrix").select("weight_class, key, yield_pct").eq("cut_pattern", "karkas").eq("weight_class", "STD").is("deleted_at", null).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("lb_price_decision").select("date, price").gte("date", from).lte("date", to).order("decided_at", { ascending: false }).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("parameter").select("week_id, freight_plan_per_kg_lb, maklon_per_kg_processed").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sku_price").select("week_id, key, ref_sell_price").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("week").select("id, week_start").range(a, b)),
  ]);
  const yieldOf = (k: string) => s(yields.find((y) => String(y.key) === k)?.yield_pct);
  const decision = new Map(decisions.map((d) => [String(d.date), s(d.price)]));
  // date → week_id (7 days per week)
  const weekIdByDate = new Map<string, string>();
  for (const w of weeks) {
    const ws = String(w.week_start);
    for (let i = 0; i < 7; i++) weekIdByDate.set(addDays(ws, i), String(w.id));
  }
  const paramByWeek = new Map(params.map((p) => [String(p.week_id), p]));
  const priceByWeek = new Map<string, Map<string, string | null>>();
  for (const p of prices) {
    const m = priceByWeek.get(String(p.week_id)) ?? new Map();
    m.set(String(p.key), s(p.ref_sell_price));
    priceByWeek.set(String(p.week_id), m);
  }
  const out = new Map<string, Map<string, Decimal | null>>();
  for (const [date, lbPrice] of decision) {
    if (lbPrice === null) continue;
    const wid = weekIdByDate.get(date);
    const par = wid ? paramByWeek.get(wid) : undefined;
    const tariff = D(s(par?.freight_plan_per_kg_lb) ?? "0").plus(D(s(par?.maklon_per_kg_processed) ?? "0")).toFixed(4);
    const priceOf = (key: string) => (wid ? (priceByWeek.get(wid)?.get(key) ?? null) : null);
    const karkas = yieldOf("Karkas");
    const outputs = [
      { key: "RPA|Karkas|Fresh", kg: karkas ?? "0", priceRef: priceOf("RPA|Karkas|Fresh") },
      { key: "RPA|Karkas|Frozen", kg: "0", priceRef: priceOf("RPA|Karkas|Frozen") },
      ...STD_UNITS.map(([unit, sku]) => ({ key: `RPA|${sku}|Fresh`, kg: yieldOf(unit) ?? "0", priceRef: priceOf(`RPA|${sku}|Fresh`) })),
    ];
    out.set(date, forecastPlanCost({ lbPrice, tariffPerKgLb: tariff, outputs }));
  }
  return out;
}
