import "server-only";
/**
 * PRD v5 §4.1 (K20–K25) on the server: the cost status and cost per SKU of every RPA batch that has no posted M1
 * allocation yet, from @kgr/engine planCost — estimasi (kg LB × standard yield) from the cut date, sementara once the
 * WP is in (H+1, K21) — plus C53 / C54 / C57. The ledger takes these costs as the lots' specific cost and status, so
 * the commercial mart and every screen read one cost with its label (K17). Flag v5_costing: off = nothing here runs.
 */
import {
  D, ZERO, addDays, c53, jakartaToday, c54, c57, costStatusOf, planCost, tariffPerKgLb,
  type ControlV3, type CostStatus, type Decimal, type PlanCostResult, type PlanOutput,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll, type WeekRow } from "../data";
import { inChunks, must, mustRows } from "../loader";
import type { Row } from "../v3/uploads";
import { parseSetting, type ModuleSetting } from "../modules-core";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
/** WIB date of a timestamp. */
const jakartaDate = (at: string) => jakartaToday(new Date(at));

/** R40: the start date of v5 costing from app_setting v5_costing value.since (YYYY-MM-DD); null when not filled. */
export const sinceOf = (value: unknown): string | null => {
  const v = s((value as { since?: string } | null | undefined)?.since)?.slice(0, 10) ?? null;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

/** Is v5 costing on (app_setting v5_costing)? Builders read it themselves (they run without a session). */
export async function v5CostingOn(sb: Supa): Promise<boolean> {
  return (await v5CostingSetting(sb)).enabled;
}

/** The v5_costing flag with its role list (K53: screens read the v5 columns only for the roles it lists). */
export async function v5CostingSetting(sb: Supa): Promise<ModuleSetting> {
  const data = must(await sb.from("app_setting").select("value").eq("key", "v5_costing").maybeSingle(), "app_setting v5_costing");
  return parseSetting((data as Row | null)?.value);
}

export interface V5BatchCost {
  batch_id: string;
  batch_ref: string;
  date: string | null;
  week_id: string;
  status: CostStatus;
  dueAt: string | null;
  wpReceivedAt: string | null;
  /** Where the LB price came from (label, K36); "belum ada" = no decision, no batch price, no price today (K50). */
  lbPriceSource: "keputusan" | "batch" | "parameter" | "belum ada";
  /**
   * Why this batch is not (yet) final or has no cost, in words, null when nothing is wrong: "yield/tarif belum diisi: …"
   * (R62), "harga acuan kosong: <key>" (K50/R61), "faktur tie, alokasi belum diposting" (K59/R60); several are joined by "; ".
   */
  costCheck: string | null;
  priceSource: "price list terkunci" | "harga acuan minggu ini";
  result: PlanCostResult | null;
  costByKey: Map<string, Decimal>;
  /** Final batches only: the WIB date the M1 allocation was posted, and the provisional cost it replaces (K22). */
  finalDate: string | null;
  provisional: PlanCostResult | null;
  /** K59: the M1 allocation of this batch is posted. */
  posted: boolean;
  /** K59: posted AND every allocation line has a reference price — the only way to "final". */
  m1Final: boolean;
  /** R61/R62: false when a yield / rate / reference price is missing (or the posted allocation has an unpriced SKU). */
  canBeFinal: boolean;
  /** R62: the yield / rate inputs that are missing (the cost is then null, never Rp 0); C54 and C42 name the batch. */
  missingInputs: string[];
  /** R63: where the yield of an estimasi cost came from: "kelas K" or "yield STD dipakai"; null when the WP outputs are used. */
  yieldSource: string | null;
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

/** A price from the database or a price list: a missing or zero price is no price (R61). */
export const priced = (v: string | null | undefined): string | null => (v !== null && v !== undefined && v !== "" && !D(v).isZero() ? v : null);

/**
 * R63: the LB price decision of a cut date for a batch class — the decision of that class first, else the decision for
 * every class (weight_class null, O2); the latest of each (rows are newest first). null = no decision for this batch.
 */
export function lbDecisionOf<T extends Row>(decisions: T[], date: string | null, cls: string | null): T | null {
  if (!date) return null;
  const day = decisions.filter((d) => String(d.date) === date);
  return (cls ? day.find((d) => s(d.weight_class) === cls) : undefined) ?? day.find((d) => s(d.weight_class) === null) ?? null;
}

/**
 * R63: the yield (karkas pattern) of a key for a batch class on a date — the class's own row, else the STD row (the
 * rows are seeded with STD until PPIC fills K/S/B); of each, the latest `effective_from` on or before the date.
 */
export function yieldOfClass(yields: Row[], key: string, cls: string | null, date: string | null): { value: string | null; source: "kelas" | "STD" } {
  const pick = (c: string): Row | undefined => yields
    .filter((y) => String(y.key) === key && String(y.weight_class) === c && (s(y.effective_from) === null || !date || String(y.effective_from) <= date))
    .sort((x, z) => String(s(z.effective_from)).localeCompare(String(s(x.effective_from))))[0];
  const own = cls && cls !== "STD" ? pick(cls) : undefined;
  const row = own ?? pick("STD");
  return { value: s(row?.yield_pct), source: own ? "kelas" : "STD" };
}

/**
 * Costs of the RPA batches cut on or after `from`. estimasi: kg LB × the yield of the batch's class (STD when the class
 * has none, labelled), karkas split fresh / frozen as the batch header; sementara: the WP rows (batch_output_sku) with
 * the batch's actual freight and slaughter fee. final (K59): the M1 allocation is posted and every allocation line has
 * a reference price; such a batch keeps the M1 cost. A missing yield, rate or LB price is "belum diisi": the batch has
 * no cost (null), never Rp 0 (R62, K50).
 */
export async function loadV5BatchCosts(sb: Supa, from: string, today: string): Promise<V5BatchCost[]> {
  const batches = await fetchAll<Row>((a, b) => sb.from("batch").select("id, week_id, date, status, batch_ref, lb_kg, lb_price, freight, maklon, out_karkas_fresh, out_karkas_frozen, wp_received_at, invoice_status, weight_class")
    .is("deleted_at", null).is("superseded_at", null).gte("date", from).order("date").order("id").range(a, b));
  if (!batches.length) return [];
  const ids = batches.map((b) => String(b.id));
  const weekIds = [...new Set(batches.map((b) => String(b.week_id)))];
  const [posted, wp, params, decisions, yields, weeks] = await Promise.all([
    // K42: batch and week ids in chunks of 200 (URL length); every row page by page
    inChunks(ids, (part) => fetchAll<Row>((a, b) => sb.from("allocation_run").select("id, batch_id, posted_at, run_at").in("batch_id", part).eq("status", "posted").order("id").range(a, b))),
    inChunks(ids, (part) => fetchAll<Row>((a, b) => sb.from("batch_output_sku").select("batch_id, key, kg, price_ref").in("batch_id", part).is("deleted_at", null).order("id").range(a, b))),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("parameter").select("week_id, freight_plan_per_kg_lb, maklon_per_kg_processed, target_shrink, lb_price_today, wp_due_hours, wp_due_time").in("week_id", part).order("week_id").range(a, b))),
    fetchAll<Row>((a, b) => sb.from("lb_price_decision").select("date, weight_class, price, decided_at").gte("date", from).order("decided_at", { ascending: false }).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("yield_matrix").select("weight_class, cut_pattern, key, yield_pct, effective_from").eq("cut_pattern", "karkas").is("deleted_at", null).order("id").range(a, b)),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("week").select("id, week_start").in("id", part).order("id").range(a, b))),
  ]);
  // K59: the lines of each batch's latest posted allocation — "final" needs every one of them priced
  const runOf = new Map<string, Row>();
  for (const r of posted) {
    const cur = runOf.get(String(r.batch_id)), at = s(r.posted_at) ?? s(r.run_at) ?? "";
    if (!cur || at > (s(cur.posted_at) ?? s(cur.run_at) ?? "")) runOf.set(String(r.batch_id), r);
  }
  const runIds = [...runOf.values()].map((r) => String(r.id));
  const allocLines = runIds.length ? await inChunks(runIds, (part) => fetchAll<Row>((a, b) => sb.from("allocation_line").select("allocation_run_id, key, kg, price_ref").in("allocation_run_id", part).order("id").range(a, b))) : [];
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
    inChunks(prevWeeks, (part) => fetchAll<Row>((a, b) => sb.from("price_list_week").select("week_start, key, price_fresh, price_frozen").in("week_start", part).not("locked_at", "is", null).is("deleted_at", null).order("key").order("week_start").range(a, b))),
    inChunks(weekIds, (part) => fetchAll<Row>((a, b) => sb.from("sku_price").select("week_id, key, ref_sell_price").in("week_id", part).order("key").order("week_id").range(a, b))),
  ]);
  const hasKg = (v: unknown) => s(v) !== null && D(String(v)).gt(0);
  const out: V5BatchCost[] = [];
  for (const b of batches) {
    const id = String(b.id), ref = s(b.batch_ref) ?? id, ws = weekStart.get(String(b.week_id)) ?? "", cls = s(b.weight_class), date = s(b.date);
    const p = params.find((x) => String(x.week_id) === String(b.week_id)) ?? null;
    const dueAt = wpDueAt(date, Number(p?.wp_due_hours ?? 24), String(p?.wp_due_time ?? "12:00"));
    const wpRows = wp.filter((r) => String(r.batch_id) === id);
    const run = runOf.get(id) ?? null;
    const runLines = run ? allocLines.filter((l) => String(l.allocation_run_id) === String(run.id)) : [];
    const unpricedKeys = new Set(runLines.filter((l) => hasKg(l.kg) && priced(s(l.price_ref)) === null).map((l) => String(l.key)));
    const m1Final = run !== null && runLines.length > 0 && unpricedKeys.size === 0;
    const status = costStatusOf({ date, wpReceivedAt: s(b.wp_received_at) ?? (wpRows.length ? "wp" : null), allocationPosted: run !== null, allPriced: m1Final }, today);
    const priceKeys = new Set(unpricedKeys);
    const base = { batch_id: id, batch_ref: ref, date, week_id: String(b.week_id), status, dueAt, wpReceivedAt: s(b.wp_received_at), finalDate: m1Final ? postedOn.get(id) ?? null : null, posted: run !== null, m1Final };
    // the label of what keeps the batch below final (R60 tie without posting, K50/R61 unpriced SKU, R62 missing inputs)
    const check = (missingInputs: string[]) => {
      const notes = [
        ...(missingInputs.length ? [`yield/tarif belum diisi: ${missingInputs.join(", ")}`] : []),
        ...(priceKeys.size ? [`harga acuan kosong: ${[...priceKeys].join(", ")}`] : []),
        ...(run === null && s(b.invoice_status) === "tied" ? ["faktur tie, alokasi belum diposting"] : []),
        ...(run !== null && !runLines.length ? ["alokasi diposting tanpa baris"] : []),
      ];
      return notes.length ? notes.join("; ") : null;
    };
    const list = priceListToKeys(lists.filter((l) => String(l.week_start) === addDays(ws, -7)).map((l) => ({ key: String(l.key), price_fresh: s(l.price_fresh), price_frozen: s(l.price_frozen) })));
    const weekPrices = new Map(refPrices.filter((r) => String(r.week_id) === String(b.week_id)).map((r) => [String(r.key), s(r.ref_sell_price)]));
    const priceOf = (k: string) => priced(list.get(k)) ?? priced(weekPrices.get(k));
    // R61: what the M1 allocation will price the SKU with — the WP's price_ref, else the week's sku_price (canBeFinal reads this source)
    const m1PriceOf = (k: string) => priced(s(wpRows.find((r) => String(r.key) === k)?.price_ref)) ?? priced(weekPrices.get(k));
    const empty = { result: null, provisional: null, costByKey: new Map<string, Decimal>(), yieldSource: null as string | null };
    const priceSource = list.size ? "price list terkunci" as const : "harga acuan minggu ini" as const;
    if (!b.lb_kg) { out.push({ ...base, ...empty, lbPriceSource: "batch", priceSource: "harga acuan minggu ini", costCheck: check([]), canBeFinal: m1Final, missingInputs: [] }); continue; }
    // R63: the decision of the batch's class, else the decision for every class
    const decision = lbDecisionOf(decisions, date, cls);
    // K50: no LB price anywhere = no plan cost (never Rp 0 per kg LB); the batch shows in C57
    const lbPrice = priced(s(decision?.price)) ?? priced(s(b.lb_price)) ?? priced(s(p?.lb_price_today));
    const lbPriceSource = priced(s(decision?.price)) ? "keputusan" as const : priced(s(b.lb_price)) ? "batch" as const : "parameter" as const;
    if (lbPrice === null) { out.push({ ...base, ...empty, lbPriceSource: "belum ada", priceSource, costCheck: check([]), canBeFinal: m1Final, missingInputs: [] }); continue; }
    const kgLb = D(String(b.lb_kg));
    // a final batch keeps the M1 cost; its provisional cost (what the ledger carried before the posting) is recomputed
    const use: CostStatus = status !== "final" ? status : wpRows.length ? "sementara" : "estimasi";
    const fromWp = use === "sementara" && wpRows.length > 0;
    const missingInputs: string[] = [];
    let outputs: PlanOutput[] = [];
    let yieldSource: string | null = null;
    if (fromWp) {
      outputs = wpRows.filter((r) => r.key).map((r) => ({ key: String(r.key), kg: String(r.kg), priceRef: priceOf(String(r.key)) }));
    } else {
      const units = ["Karkas", ...STD_UNITS.map(([u]) => u)];
      const ys = new Map(units.map((u) => [u, yieldOfClass(yields, u, cls, date)]));
      missingInputs.push(...units.filter((u) => ys.get(u)!.value === null).map((u) => `yield ${u}`));
      yieldSource = [...ys.values()].some((y) => y.source === "STD") ? "yield STD dipakai" : `kelas ${cls}`;
      if (!missingInputs.length) {
        const y = (u: string) => D(ys.get(u)!.value!);
        const karkas = y("Karkas").times(kgLb);
        // the batch header's fresh / frozen karkas split; no split recorded = all fresh
        const fz = s(b.out_karkas_fresh), zz = s(b.out_karkas_frozen);
        const tot = (fz === null ? ZERO : D(fz)).plus(zz === null ? ZERO : D(zz));
        const share = tot.isZero() ? D(1) : (fz === null ? ZERO : D(fz)).div(tot);
        outputs = [
          { key: "RPA|Karkas|Fresh", kg: karkas.times(share).toFixed(2), priceRef: priceOf("RPA|Karkas|Fresh") },
          { key: "RPA|Karkas|Frozen", kg: karkas.minus(karkas.times(share)).toFixed(2), priceRef: priceOf("RPA|Karkas|Frozen") },
          ...STD_UNITS.map(([unit, sku]) => ({ key: `RPA|${sku}|Fresh`, kg: y(unit).times(kgLb).toFixed(2), priceRef: priceOf(`RPA|${sku}|Fresh`) })),
        ];
      }
    }
    // R62: a rate is needed only where the cost uses it — an actual freight / slaughter fee (from the WP on) replaces the planned rate
    const fAct = use === "sementara" ? s(b.freight) : null, mAct = use === "sementara" ? s(b.maklon) : null;
    const fRate = s(p?.freight_plan_per_kg_lb), mRate = s(p?.maklon_per_kg_processed), shrink = s(p?.target_shrink);
    if (fAct === null && fRate === null) missingInputs.push("tarif freight");
    if (mAct === null && mRate === null) missingInputs.push("tarif maklon");
    else if (mAct === null && shrink === null) missingInputs.push("target susut");
    if (missingInputs.length) {
      // a final batch only loses its provisional cost (no revaluation); any other batch has no cost until the inputs are filled
      out.push({ ...base, ...empty, lbPriceSource, priceSource, costCheck: m1Final ? check([]) : check(missingInputs), canBeFinal: m1Final, missingInputs: m1Final ? [] : missingInputs, yieldSource });
      continue;
    }
    const tariff = fAct === null && mAct === null
      ? { tariffPerKgLb: tariffPerKgLb({ freightPerKgLb: fRate!, maklonPerKgProcessed: mRate!, shrink: shrink! }).toFixed(4), directCost: null }
      : { tariffPerKgLb: null, directCost: (fAct !== null ? D(fAct) : kgLb.times(D(fRate!))).plus(mAct !== null ? D(mAct) : kgLb.times(D(mRate!)).times(D(1).minus(D(shrink!)))).toFixed(2) };
    const plan = planCost({ status: use, kgLb: kgLb.toFixed(2), lbPrice, ...tariff, outputs });
    // K50 / R61: a SKU with output and no reference price (the plan's price list, or the price M1 will allocate with) keeps the batch below final
    for (const o of outputs) if (hasKg(o.kg) && m1PriceOf(o.key) === null) priceKeys.add(o.key);
    for (const k of plan.missingPrice) priceKeys.add(k);
    const canBeFinal = m1Final || (plan.canBeFinal && priceKeys.size === 0);
    out.push({
      ...base, status, result: m1Final ? null : plan, provisional: m1Final ? plan : null,
      costByKey: new Map(m1Final ? [] : plan.lines.filter((l) => l.costPerKg !== null).map((l) => [l.key, l.costPerKg!])),
      lbPriceSource, priceSource, costCheck: m1Final ? null : check([]), canBeFinal, missingInputs: [], yieldSource: fromWp ? null : yieldSource,
    });
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
   * First day v5 costing ran (app_setting v5_costing value.since): a batch posted before it never carried a provisional
   * cost in the ledger, so it is not revalued (K22). PRD v5.1 R40 (B.3): null = not filled — no revaluation runs (the
   * date the flag was last changed is not a start date), and the Costing page says so.
   */
  since: string | null;
}

export async function v5LedgerCosts(sb: Supa, from: string, today: string, latestWeekId: string): Promise<V5LedgerCosts> {
  const [batches, par, flag] = await Promise.all([
    loadV5BatchCosts(sb, from, today),
    sb.from("parameter").select("revaluation_sold_mode").eq("week_id", latestWeekId).maybeSingle(),
    sb.from("app_setting").select("value").eq("key", "v5_costing").maybeSingle(),
  ]);
  const mode = s((must(par, "v5LedgerCosts.parameter") as Row | null)?.revaluation_sold_mode) === "restate_sale_date" ? "restate_sale_date" : "cogs_line";
  const f = (must(flag, "app_setting v5_costing") ?? {}) as Row;
  const since = sinceOf(f.value);
  return { batches, statusByBatch: new Map(batches.map((b) => [b.batch_ref, b.status])), mode, since };
}

/**
 * C53, C54 (on the batches' costing lines) and C57 (upcoming cut dates without an LB price decision) for a week.
 * R62: a batch without a cost because its yield / rate is not filled is "periksa biaya" in C54 (never a cost of 0) and
 * "belum diisi" in C42 (named by batch); C42 is returned only when such a batch exists (the PPIC page owns the plain C42).
 */
export async function v5CostingControls(sb: Supa, week: WeekRow, today: string, nowIso: string, loaded?: V5BatchCost[]): Promise<ControlV3[]> {
  const costs = loaded ?? await loadV5BatchCosts(sb, week.week_start, today);
  const inWeek = costs.filter((c) => c.date && c.date >= week.week_start && c.date <= week.week_end);
  const bs = mustRows<Row>(await sb.from("batch").select("batch_ref, status, date").eq("week_id", week.id).is("deleted_at", null), "C53 batch");
  const statusOf = new Map(bs.map((b) => [String(b.batch_ref), s(b.status)]));
  const par = must(await sb.from("parameter").select("cost_anomaly_ratio").eq("week_id", week.id).maybeSingle(), "C54 parameter");
  const decisions = mustRows<Row>(await sb.from("lb_price_decision").select("date, weight_class").gte("date", week.week_start).lte("date", week.week_end), "C57 lb_price_decision");
  const ratio = s((par as Row | null)?.cost_anomaly_ratio);
  const noInputs = inWeek.filter((c) => c.missingInputs.length > 0);
  const controls: ControlV3[] = [
    c53({ now: nowIso, batches: inWeek.map((c) => ({ ref: c.batch_ref, status: statusOf.get(c.batch_ref) ?? null, dueAt: c.dueAt, wpReceivedAt: c.wpReceivedAt })) }),
    c54({
      ratio: ratio ?? "3",
      rows: [
        ...inWeek.flatMap((c) => (c.result?.lines ?? []).map((l) => ({ key: `${l.key} (${c.batch_ref})`, costPerKg: l.costPerKg?.toFixed(2) ?? null, priceRef: l.priceRef?.toFixed(2) ?? null }))),
        ...noInputs.map((c) => ({ key: `batch ${c.batch_ref}`, costPerKg: null, priceRef: null, missing: `yield/tarif belum diisi: ${c.missingInputs.join(", ")}` })),
      ],
    }),
    c57({
      cutDates: inWeek.filter((c) => c.date && c.date >= today).map((c) => c.date!), decisions: decisions.map((d) => ({ date: String(d.date), weight_class: s(d.weight_class) })),
      batchesWithoutPrice: inWeek.filter((c) => c.lbPriceSource === "belum ada" && c.status !== "final").map((c) => c.batch_ref),
    }),
  ];
  if (noInputs.length) {
    controls.push({
      code: "C42", module: "M1", name: "Yield dan tarif batch terisi (biaya batch dihitung)", value: D(noInputs.length), comparator: ZERO, difference: D(noInputs.length),
      status: "BELUM DIISI", action: "PPIC mengisi yield kelas / STD dan Finance mengisi tarif freight dan maklon minggu ini; biaya batch belum dihitung, bukan Rp 0",
      detail: noInputs.map((c) => `batch ${c.batch_ref}: ${c.missingInputs.join(", ")}`),
    });
  }
  return controls;
}
