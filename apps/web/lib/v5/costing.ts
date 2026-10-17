import "server-only";
/**
 * PRD v5 §4.1 (K20–K25) on the server: the cost status and cost per SKU of every RPA batch that has no posted M1
 * allocation yet, from @kgr/engine planCost — estimasi (kg LB × standard yield) from the cut date, sementara once the
 * WP is in (H+1, K21) — plus C53 / C54 / C57. The ledger takes these costs as the lots' specific cost and status, so
 * the commercial mart and every screen read one cost with its label (K17). Flag v5_costing: off = nothing here runs.
 */
import {
  D, addDays, c53, jakartaToday, c54, c57, costStatusOf, planCost, tariffPerKgLb,
  type ControlV3, type CostStatus, type Decimal, type PlanCostResult, type PlanOutput,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll, type WeekRow } from "../data";
import { inChunks, must, mustRows } from "../loader";
import type { Row } from "../v3/uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
/** WIB date of a timestamp. */
const jakartaDate = (at: string) => jakartaToday(new Date(at));

/** Is v5 costing on (app_setting v5_costing)? Builders read it themselves (they run without a session). */
export async function v5CostingOn(sb: Supa): Promise<boolean> {
  const { data } = await sb.from("app_setting").select("value").eq("key", "v5_costing").maybeSingle();
  return ((data as Row | null)?.value as { enabled?: boolean } | undefined)?.enabled === true;
}

export interface V5BatchCost {
  batch_id: string;
  batch_ref: string;
  date: string | null;
  week_id: string;
  status: CostStatus;
  dueAt: string | null;
  wpReceivedAt: string | null;
  /** Where the LB price came from (label, K36). */
  lbPriceSource: "keputusan" | "batch" | "parameter";
  priceSource: "price list terkunci" | "harga acuan minggu ini";
  result: PlanCostResult | null;
  costByKey: Map<string, Decimal>;
  /** Posted batches (final): the WIB date the M1 allocation was posted, and the provisional cost it replaces (K22). */
  finalDate: string | null;
  provisional: PlanCostResult | null;
}

/** Reference prices per SKU key from a locked weekly price list (K24): base key + fresh / frozen price. */
export function priceListToKeys(rows: { key: string; price_fresh: string | null; price_frozen: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const base = r.key.replace(/\|(Fresh|Frozen|n\/a)$/, "");
    if (r.price_fresh) { out.set(`${base}|Fresh`, r.price_fresh); out.set(`${base}|n/a`, r.price_fresh); }
    if (r.price_frozen) out.set(`${base}|Frozen`, r.price_frozen);
  }
  return out;
}

/** WP deadline of a batch: cut date + wp_due_hours (rounded to days) at wp_due_time, WIB (K21). */
export function wpDueAt(date: string | null, hours: number, time: string): string | null {
  if (!date) return null;
  return `${addDays(date, Math.max(1, Math.round(hours / 24)))}T${time.slice(0, 5)}:00+07:00`;
}

const STD_UNITS: [string, string][] = [["Kepala", "Kepala"], ["Ceker", "Ceker"], ["Usus", "Usus"], ["HJA (Hati/Jantung/Ampela)", "HJA (Hati/Jantung/Ampela)"], ["Lemak", "Lemak"]];

/**
 * Costs of the RPA batches cut on or after `from` that have no posted allocation (those keep the M1 cost, final).
 * estimasi: kg LB × the standard yield of the batch's class (STD until PPIC fills K/S/B), karkas split fresh / frozen
 * as the batch header; sementara: the WP rows (batch_output_sku) with the batch's actual freight + slaughter fee.
 */
export async function loadV5BatchCosts(sb: Supa, from: string, today: string): Promise<V5BatchCost[]> {
  const batches = await fetchAll<Row>((a, b) => sb.from("batch").select("id, week_id, date, status, batch_ref, lb_kg, lb_price, freight, maklon, out_karkas_fresh, out_karkas_frozen, wp_received_at, invoice_status")
    .is("deleted_at", null).is("superseded_at", null).gte("date", from).order("date").range(a, b));
  if (!batches.length) return [];
  const ids = batches.map((b) => String(b.id));
  const weekIds = [...new Set(batches.map((b) => String(b.week_id)))];
  const [posted, wp, params, decisions, yields, weeks] = await Promise.all([
    // K42: batch and week ids in chunks of 200 (URL length); every row page by page
    inChunks(ids, (part) => fetchAll<Row>((a, b) => sb.from("allocation_run").select("batch_id, posted_at, run_at").in("batch_id", part).eq("status", "posted").order("id").range(a, b))),
    inChunks(ids, (part) => fetchAll<Row>((a, b) => sb.from("batch_output_sku").select("batch_id, key, kg").in("batch_id", part).is("deleted_at", null).order("id").range(a, b))),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("parameter").select("week_id, freight_plan_per_kg_lb, maklon_per_kg_processed, target_shrink, lb_price_today, wp_due_hours, wp_due_time").in("week_id", part).range(a, b))),
    fetchAll<Row>((a, b) => sb.from("lb_price_decision").select("date, weight_class, price, decided_at").gte("date", from).order("decided_at", { ascending: false }).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("yield_matrix").select("weight_class, cut_pattern, key, yield_pct").eq("weight_class", "STD").eq("cut_pattern", "karkas").is("deleted_at", null).range(a, b)),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("week").select("id, week_start").in("id", part).range(a, b))),
  ]);
  const postedIds = new Set(posted.map((r) => String(r.batch_id)));
  // the WIB date of the (latest) posting = the date the cost becomes final (K22)
  const postedOn = new Map<string, string>();
  for (const r of posted) {
    const at = s(r.posted_at) ?? s(r.run_at);
    if (!at) continue;
    const d = jakartaDate(at), id = String(r.batch_id);
    if (!postedOn.has(id) || d > postedOn.get(id)!) postedOn.set(id, d);
  }
  const weekStart = new Map(weeks.map((w) => [String(w.id), String(w.week_start)]));
  // reference prices: last week's locked price list (K24), else the batch week's reference prices
  const prevWeeks = [...new Set([...weekStart.values()].map((w) => addDays(w, -7)))];
  const [lists, refPrices] = await Promise.all([
    inChunks(prevWeeks, (part) => fetchAll<Row>((a, b) => sb.from("price_list_week").select("week_start, key, price_fresh, price_frozen").in("week_start", part).not("locked_at", "is", null).range(a, b))),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("sku_price").select("week_id, key, ref_sell_price").in("week_id", part).range(a, b))),
  ]);
  const yieldOf = (k: string) => s(yields.find((y) => String(y.key) === k)?.yield_pct);
  const out: V5BatchCost[] = [];
  for (const b of batches) {
    const id = String(b.id), ref = s(b.batch_ref) ?? id, ws = weekStart.get(String(b.week_id)) ?? "";
    const p = params.find((x) => String(x.week_id) === String(b.week_id)) ?? {};
    const dueAt = wpDueAt(s(b.date), Number(p.wp_due_hours ?? 24), String(p.wp_due_time ?? "12:00"));
    const wpRows = wp.filter((r) => String(r.batch_id) === id);
    const status = costStatusOf({ date: s(b.date), wpReceivedAt: s(b.wp_received_at) ?? (wpRows.length ? "wp" : null), allocationPosted: postedIds.has(id), invoiceStatus: s(b.invoice_status) }, today);
    const base = { batch_id: id, batch_ref: ref, date: s(b.date), week_id: String(b.week_id), status, dueAt, wpReceivedAt: s(b.wp_received_at), finalDate: postedOn.get(id) ?? null };
    if (!b.lb_kg) { out.push({ ...base, result: null, provisional: null, costByKey: new Map(), lbPriceSource: "batch", priceSource: "harga acuan minggu ini" }); continue; }
    const list = priceListToKeys(lists.filter((l) => String(l.week_start) === addDays(ws, -7)).map((l) => ({ key: String(l.key), price_fresh: s(l.price_fresh), price_frozen: s(l.price_frozen) })));
    const weekPrices = new Map(refPrices.filter((r) => String(r.week_id) === String(b.week_id)).map((r) => [String(r.key), s(r.ref_sell_price)]));
    const priceOf = (k: string) => list.get(k) ?? weekPrices.get(k) ?? null;
    const decision = decisions.find((d) => String(d.date) === s(b.date));
    const lbPrice = s(decision?.price) ?? s(b.lb_price) ?? s(p.lb_price_today) ?? "0";
    const kgLb = D(String(b.lb_kg));
    // a final batch keeps the M1 cost; its provisional cost (what the ledger carried before the posting) is recomputed
    const use: CostStatus = status !== "final" ? status : wpRows.length ? "sementara" : "estimasi";
    let outputs: PlanOutput[];
    if (use === "sementara" && wpRows.length) {
      outputs = wpRows.filter((r) => r.key).map((r) => ({ key: String(r.key), kg: String(r.kg), priceRef: priceOf(String(r.key)) }));
    } else {
      const karkas = D(yieldOf("Karkas") ?? "0").times(kgLb);
      const f = D(s(b.out_karkas_fresh) ?? "0"), z = D(s(b.out_karkas_frozen) ?? "0");
      const share = f.plus(z).isZero() ? D(1) : f.div(f.plus(z));
      outputs = [
        { key: "RPA|Karkas|Fresh", kg: karkas.times(share).toFixed(2), priceRef: priceOf("RPA|Karkas|Fresh") },
        { key: "RPA|Karkas|Frozen", kg: karkas.minus(karkas.times(share)).toFixed(2), priceRef: priceOf("RPA|Karkas|Frozen") },
        ...STD_UNITS.map(([unit, sku]) => ({ key: `RPA|${sku}|Fresh`, kg: D(yieldOf(unit) ?? "0").times(kgLb).toFixed(2), priceRef: priceOf(`RPA|${sku}|Fresh`) })),
      ];
    }
    const direct = use === "sementara" && (s(b.freight) || s(b.maklon)) ? D(s(b.freight) ?? "0").plus(D(s(b.maklon) ?? "0")).toFixed(2) : null;
    const tariff = tariffPerKgLb({ freightPerKgLb: s(p.freight_plan_per_kg_lb) ?? "0", maklonPerKgProcessed: s(p.maklon_per_kg_processed) ?? "0", shrink: s(p.target_shrink) ?? "0" });
    const plan = planCost({ status: use, kgLb: kgLb.toFixed(2), lbPrice, tariffPerKgLb: tariff.toFixed(4), directCost: direct, outputs });
    const final = status === "final";
    const result = final ? null : plan;
    const costByKey = new Map(final ? [] : plan.lines.filter((l) => l.costPerKg !== null).map((l) => [l.key, l.costPerKg!]));
    out.push({ ...base, result, provisional: final ? plan : null, costByKey, lbPriceSource: decision ? "keputusan" : s(b.lb_price) ? "batch" : "parameter", priceSource: list.size ? "price list terkunci" : "harga acuan minggu ini" });
  }
  return out;
}

/** Cost per kg of a key in a cost map; a receipt keyed `|n/a` (karkas without form) takes the fresh cost. */
export function costOfKey(m: Map<string, Decimal>, key: string): Decimal | undefined {
  return m.get(key) ?? (key.endsWith("|n/a") ? m.get(key.replace(/\|n\/a$/, "|Fresh")) : undefined);
}

export type RevaluationMode = "cogs_line" | "restate_sale_date";

/** What the ledger takes from v5 costing (flag on): specific cost + status per batch, and the batches turned final. */
export interface V5LedgerCosts {
  batches: V5BatchCost[];
  statusByBatch: Map<string, CostStatus>;
  mode: RevaluationMode;
  /**
   * First day v5 costing ran (app_setting v5_costing value.since, else the date the flag was last changed): a batch
   * posted before it never carried a provisional cost in the ledger, so it is not revalued (K22).
   */
  since: string;
}

export async function v5LedgerCosts(sb: Supa, from: string, today: string, latestWeekId: string): Promise<V5LedgerCosts> {
  const [batches, par, flag] = await Promise.all([
    loadV5BatchCosts(sb, from, today),
    sb.from("parameter").select("revaluation_sold_mode").eq("week_id", latestWeekId).maybeSingle(),
    sb.from("app_setting").select("value, updated_at").eq("key", "v5_costing").maybeSingle(),
  ]);
  const mode = s((par.data as Row | null)?.revaluation_sold_mode) === "restate_sale_date" ? "restate_sale_date" : "cogs_line";
  const f = (flag.data ?? {}) as Row;
  const since = s((f.value as { since?: string } | undefined)?.since)?.slice(0, 10) ?? (s(f.updated_at) ? jakartaDate(String(f.updated_at)) : today);
  return { batches, statusByBatch: new Map(batches.map((b) => [b.batch_ref, b.status])), mode, since };
}

/** C53, C54 (on the batches' costing lines) and C57 (upcoming cut dates without an LB price decision) for a week. */
export async function v5CostingControls(sb: Supa, week: WeekRow, today: string, nowIso: string): Promise<ControlV3[]> {
  const costs = await loadV5BatchCosts(sb, week.week_start, today);
  const inWeek = costs.filter((c) => c.date && c.date >= week.week_start && c.date <= week.week_end);
  const bs = mustRows<Row>(await sb.from("batch").select("batch_ref, status, date").eq("week_id", week.id).is("deleted_at", null), "C53 batch");
  const statusOf = new Map(bs.map((b) => [String(b.batch_ref), s(b.status)]));
  const par = must(await sb.from("parameter").select("cost_anomaly_ratio").eq("week_id", week.id).maybeSingle(), "C54 parameter");
  const decisions = mustRows<Row>(await sb.from("lb_price_decision").select("date, weight_class").gte("date", week.week_start).lte("date", week.week_end), "C57 lb_price_decision");
  return [
    c53({ now: nowIso, batches: inWeek.map((c) => ({ ref: c.batch_ref, status: statusOf.get(c.batch_ref) ?? null, dueAt: c.dueAt, wpReceivedAt: c.wpReceivedAt })) }),
    c54({ ratio: s((par as Row | null)?.cost_anomaly_ratio) ?? "3", rows: inWeek.flatMap((c) => (c.result?.lines ?? []).map((l) => ({ key: `${l.key} (${c.batch_ref})`, costPerKg: l.costPerKg?.toFixed(2) ?? null, priceRef: l.priceRef?.toFixed(2) ?? null }))) }),
    c57({ cutDates: inWeek.filter((c) => c.date && c.date >= today).map((c) => c.date!), decisions: decisions.map((d) => ({ date: String(d.date), weight_class: s(d.weight_class) })) }),
  ];
}
