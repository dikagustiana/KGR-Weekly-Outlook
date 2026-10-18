import "server-only";
/**
 * M3 allocation per day (PRD v3 §4.4 step 7): PO lines delivering on a date take lots FEFO; at the cut-off the fresh
 * kg nobody will take while it is fresh is blasted to frozen. The numbers come from @kgr/engine (lotsForAllocation,
 * allocateFEFO, cutoffBlasts, planningControls) on the M2 ledger; this file loads rows and writes the results.
 */
import {
  addDays, allocateFEFO, sum, computeLedger, cutoffBlasts, frozenKeyOf, lotsForAllocation, planningControls, toFixedString,
  type AllocOrder, type ControlV3, type CutoffBlast, type Decimal, type FefoResult, type LedgerResult,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { fetchAll, listWeeks, type WeekRow } from "../data";
import { WriteError } from "../write";
import { stockMartControl } from "./stale";
import { loadLedgerSources, type LedgerSources } from "./ledger";
import type { Row } from "./uploads";
import { must } from "@/lib/loader";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export interface DayOrder extends AllocOrder {
  id: string;
  status: string;
  customer: string | null;
  po_ref: string | null;
  sales_rep: string | null;
  document_ref: string | null;
}

export interface DayAllocation {
  date: string;
  week: WeekRow | null;
  src: LedgerSources;
  led: LedgerResult;
  /** PO lines delivering on the date (open Orders and the lines already delivered that day). */
  orders: DayOrder[];
  allocations: Row[];
  /** Lots available on the date (before this day's allocations). */
  lots: ReturnType<typeof lotsForAllocation>;
  /** Engine run with every current allocation held and no new one: what is left per lot. */
  current: FefoResult;
  /** What "Alokasikan hari ini" would write for the lines not yet delivered. */
  proposal: FefoResult;
  futureOrders: { key: string; delivery_date: string; kg: string; fulfilled_kg: string | null; cancelled_kg: string | null }[];
  cutoff: CutoffBlast[];
  cutoffKg: Decimal;
  cutoffDone: Row[];
  cutOffTime: string;
  prices: Map<string, string | null>;
  blastCostPerKg: string;
}

const windowsOf = (src: LedgerSources) => {
  const info = new Map(src.inputs.keys.map((k) => [k.key, k]));
  return {
    freshHours: (k: string) => info.get(k)?.fresh_window_hours ?? src.inputs.params.defaultFreshWindowHours,
    frozenDays: (k: string) => info.get(k)?.frozen_age_limit_days ?? src.inputs.params.defaultFrozenAgeLimitDays,
  };
};

export async function loadDayAllocation(sb: Supa, date: string): Promise<DayAllocation | null> {
  const src = await loadLedgerSources(sb);
  if (!src) return null;
  const led = computeLedger(src.inputs);
  const weeks = await listWeeks(sb);
  const week = weeks.find((w) => date >= w.week_start && date <= w.week_end) ?? null;
  const keyOf = new Map(src.inputs.sales.map((x) => [x.ref, x.key ?? ""]));
  const horizon = addDays(date, 7);
  const [lines, allocations, blasts, param, prices] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("sales_line").select("id, status, date, delivery_date, demand_status, kg, fulfilled_kg, cancelled_kg, price, customer, po_ref, sales_rep, document_ref, item_code, key_manual")
      .is("deleted_at", null).is("superseded_at", null).or(`delivery_date.eq.${date},and(delivery_date.is.null,date.eq.${date}),and(status.eq.Order,delivery_date.gt.${date},delivery_date.lte.${horizon})`).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("allocation").select("*").eq("date", date).is("deleted_at", null).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("blast_event").select("*").eq("date", date).eq("reason", "cutoff").is("deleted_at", null).order("id").range(a, b)),
    week ? sb.from("parameter").select("cut_off_time, blast_cost_per_kg").eq("week_id", week.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    week ? fetchAll<Row>((a, b) => sb.from("sku_price").select("key, ref_sell_price").eq("week_id", week.id).order("key").order("week_id").range(a, b)) : Promise.resolve([] as Row[]),
  ]);
  const keyFor = (r: Row) => keyOf.get(String(r.id)) ?? s(r.key_manual) ?? "";
  const toOrder = (r: Row): DayOrder => ({
    id: String(r.id), ref: String(r.id), key: keyFor(r), delivery_date: s(r.delivery_date) ?? s(r.date), demand_status: s(r.demand_status) ?? "Confirmed",
    kg: s(r.kg) ?? "0", fulfilled_kg: r.status === "Aktual" ? (s(r.fulfilled_kg) ?? s(r.kg)) : s(r.fulfilled_kg), cancelled_kg: s(r.cancelled_kg), price: s(r.price),
    status: String(r.status), customer: s(r.customer), po_ref: s(r.po_ref), sales_rep: s(r.sales_rep), document_ref: s(r.document_ref),
  });
  const today = lines.filter((r) => (s(r.delivery_date) ?? s(r.date)) === date).map(toOrder);
  // an Aktual line that day counts as delivered only when it was a PO line (or carries allocations)
  const allocatedIds = new Set(allocations.map((a) => String(a.sales_line_id)));
  const orders = today.filter((o) => o.status === "Order" || allocatedIds.has(o.id) || o.po_ref !== null);
  const lots = lotsForAllocation(led, date, allocatedIds);
  const W = windowsOf(src);
  const held = allocations.map((a) => ({ sales_ref: String(a.sales_line_id), lot_ref: String(a.lot_ref), kg: String(a.kg) }));
  const current = allocateFEFO({ date, orders: [], lots, existing: held, windows: W });
  // re-allocation keeps manual allocations and those of delivered lines; FEFO lines of open orders are recomputed
  const delivered = new Set(orders.filter((o) => o.status !== "Order").map((o) => o.id));
  const keep = allocations.filter((a) => a.method === "manual" || delivered.has(String(a.sales_line_id)));
  const proposal = allocateFEFO({
    date, orders: orders.filter((o) => o.status === "Order"), lots, windows: W,
    existing: keep.map((a) => ({ sales_ref: String(a.sales_line_id), lot_ref: String(a.lot_ref), kg: String(a.kg) })),
  });
  const futureOrders = lines.filter((r) => r.status === "Order" && (s(r.delivery_date) ?? "") > date)
    .map((r) => ({ key: keyFor(r), delivery_date: String(r.delivery_date), kg: s(r.kg) ?? "0", fulfilled_kg: s(r.fulfilled_kg), cancelled_kg: s(r.cancelled_kg) }));
  const p = (must(param, "allocation.parameter") ?? {}) as Row;
  const priceMap = new Map(prices.map((x) => [String(x.key), s(x.ref_sell_price)]));
  const info = new Map(src.inputs.keys.map((k) => [k.key, k]));
  // the week's parameter, else the latest week's (the ledger's, which stops when it has none): a stated cost, never a default of 0
  const blastCostPerKg = s(p.blast_cost_per_kg) ?? String(src.inputs.params.blastCostPerKg);
  const cutoff = cutoffBlasts({
    date, lotsLeft: current.lotsLeft, futureOrders, windows: W, frozenKeyOf: (k) => frozenKeyOf(k, info.get(k)),
    price: (k) => priceMap.get(k) ?? null, blastCostPerKg,
  });
  return { date, week, src, led, orders, allocations, lots, current, proposal, futureOrders, cutoff, cutoffKg: sum(cutoff.map((b) => b.kg)), cutoffDone: blasts, cutOffTime: s(p.cut_off_time) ?? "14:00:00", prices: priceMap, blastCostPerKg };
}

/** "Alokasikan hari ini": write the FEFO allocations of the open PO lines (upsert on line × lot; stale FEFO rows soft-deleted). */
export async function allocateDay(sb: Supa, viewer: Viewer, date: string): Promise<string> {
  // C45 (PRD v4 §7.1): no allocation on a stock mart older than its inputs
  const c45 = await stockMartControl(sb, date);
  if (c45.status === "STALE") throw new WriteError(`C45 STALE: ${c45.action}`);
  const d = await loadDayAllocation(sb, date);
  if (!d) throw new WriteError("Ledger stok (M2) belum ada — alokasi butuh lot");
  const open = new Set(d.orders.filter((o) => o.status === "Order").map((o) => o.id));
  const stale = d.allocations.filter((a) => a.method !== "manual" && open.has(String(a.sales_line_id))
    && !d.proposal.allocations.some((n) => n.sales_ref === String(a.sales_line_id) && n.lot_ref === String(a.lot_ref)));
  const rows = d.proposal.allocations.map((a) => ({
    date, sales_line_id: a.sales_ref, lot_ref: a.lot_ref, kg: toFixedString(a.kg, 2), method: "FEFO", deleted_at: null, deleted_by: null, note: null,
  }));
  if (rows.length) {
    const e = await sb.from("allocation").upsert(rows, { onConflict: "sales_line_id,lot_ref" });
    if (e.error) throw new WriteError(`allocation: ${e.error.message}`);
  }
  if (stale.length) {
    const ids = stale.map((a) => String(a.id));
    for (let i = 0; i < ids.length; i += 200) {
      const e = await sb.from("allocation").update({ deleted_at: new Date().toISOString(), deleted_by: viewer.email }).in("id", ids.slice(i, i + 200));
      if (e.error) throw new WriteError(`allocation: ${e.error.message}`);
    }
  }
  const un = d.proposal.unallocated.length;
  return `${rows.length} alokasi FEFO ditulis${stale.length ? `, ${stale.length} alokasi lama dilepas` : ""}${un ? ` — ${un} baris PO belum tertutup stok` : ""}`;
}

/** Jakarta wall clock (HH:MM) and date now. */
export function jakartaNow(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}

/** K8: the cut-off of a day opens at the cut-off time of that day (a past day is open, a future day is not). */
export function cutoffOpen(date: string, cutOffTime: string, now = jakartaNow()): { ok: boolean; reason: string | null } {
  const t = cutOffTime.slice(0, 5);
  if (date < now.date) return { ok: true, reason: null };
  if (date > now.date || now.time < t) return { ok: false, reason: `Cut-off ${date} baru bisa setelah pukul ${t} WIB; sebelum itu sisa fresh dijual spot dulu (K8)` };
  return { ok: true, reason: null };
}

/** "Cut-off": blast the fresh kg left (engine cutoffBlasts) to frozen — once per day. */
export async function cutoffDay(sb: Supa, viewer: Viewer, date: string): Promise<string> {
  const d = await loadDayAllocation(sb, date);
  if (!d) throw new WriteError("Ledger stok (M2) belum ada");
  if (d.cutoffDone.length) throw new WriteError(`Cut-off ${date} sudah dicatat (${d.cutoffDone.length} blast)`);
  // K8: until the cut-off time the fresh rest is sold spot first; blasting is only possible after it
  const open = cutoffOpen(date, d.cutOffTime);
  if (!open.ok) throw new WriteError(open.reason!);
  if (!d.cutoff.length) return "Tidak ada sisa fresh yang perlu di-blast";
  const rows = d.cutoff.map((b) => ({
    date, time: d.cutOffTime, lot_ref_from: b.lot_ref, key_from: b.key_from, key_to: b.key_to, kg: toFixedString(b.kg, 2), reason: "cutoff",
    rp_downgrade: toFixedString(b.rp_downgrade, 2), note: `cut-off oleh ${viewer.email}; biaya blast ${toFixedString(b.blast_cost, 0)}`,
  }));
  const e = await sb.from("blast_event").insert(rows);
  if (e.error) throw new WriteError(`blast_event: ${e.error.message}`);
  return `${rows.length} lot fresh di-blast ke frozen`;
}

/** C29 (Σ allocation per line ≤ kg) and C31 (blast without frozen lot) for the date. */
export function dayControls(d: DayAllocation): ControlV3[] {
  const lineKg = new Map(d.orders.map((o) => [o.id, String(o.kg)]));
  const all = planningControls({
    today: d.date, orders: [],
    allocated: d.allocations.map((a) => ({ sales_ref: String(a.sales_line_id), kg: String(a.kg), line_kg: lineKg.get(String(a.sales_line_id)) ?? String(a.kg) })),
    // the frozen lot of a blast is the ledger's conversion lot blast:<id>
    blasts: d.cutoffDone.map((b) => ({ ref: String(b.id), lot_ref_to: s(b.lot_ref_to) ?? (d.led.lots.some((l) => l.ref === `blast:${b.id}`) ? `blast:${b.id}` : null) })),
  });
  return all.filter((c) => c.code === "C29" || c.code === "C31");
}
