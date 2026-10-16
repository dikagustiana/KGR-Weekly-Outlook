import "server-only";
/**
 * Reads of the Manajemen v5 tiles (flag v5_management, PRD v5 §6.1): the two bases of the LB simulation from the PPIC
 * v5 loader (one number with the PPIC screen), the decisions waiting (LB price, batch vs need, below-floor orders, cash),
 * the loop status (§3.2) and the source labels of the main numbers (K36). The simulation itself is @kgr/engine.
 */
import {
  D, addDays, commitmentDeadline, effectiveStatus, simulateLivebird, stockSellRows, stockSummary,
  type Decimal, type TaskStatus, type WeekResult,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { dataToday, type WeekRow } from "../data";
import type { Role } from "../roles";
import type { Row } from "../v3/uploads";
import { jakartaNow } from "../v3/allocation";
import { commercialMart } from "../v3/commercial";
import { loadPlanning } from "../v3/planning";
import { stockMartControl } from "../v3/stale";
import { loadPpicV5 } from "./ppic-data";
import { decisionLines, loopLines, simPrices, sourceLabel, type ManagementV5Input, type SimBasis, type SourceLabel } from "./management";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export async function loadManagementV5(sb: Supa, w: WeekRow, r: WeekResult, sp: Record<string, string | undefined>, cash: { date: string; closing: string | null }[] | null): Promise<ManagementV5Input> {
  // the decisions and the loop read as of the date the data stands on (the week's update date); "late" keeps the clock
  const n = jakartaNow(), now = `${n.date}T${n.time}:00+07:00`;
  const today = await dataToday(sb, n.date), tomorrow = addDays(today, 1);
  let ppic: Awaited<ReturnType<typeof loadPpicV5>> | null = null;
  try {
    ppic = await loadPpicV5(sb, { src: await loadPlanning(sb, w), result: r, base: "", versi: "batch", canPlan: false, c45: await stockMartControl(sb, addDays(w.week_start, -1)) });
  } catch { ppic = null; }
  const todayPrice = D(r.block2.lbPriceToday ?? 0).gt(0) ? D(r.block2.lbPriceToday) : null;
  const { data: dec } = await sb.from("lb_price_decision").select("date, price, decided_by, decided_at").eq("date", tomorrow).order("decided_at", { ascending: false }).limit(1).maybeSingle();
  const decided = dec ? { date: tomorrow, price: D(String((dec as Row).price)), by: s((dec as Row).decided_by) } : null;

  // ------------------------------------------------------------ simulation (K25)
  const bases = { need: ppic?.sim?.need ?? null, batch: ppic?.sim?.batch ?? null };
  const available = (["need", "batch"] as SimBasis[]).filter((b) => bases[b]);
  const basis: SimBasis = sp.sim === "batch" && bases.batch ? "batch" : bases.need ? "need" : "batch";
  const prices = simPrices(todayPrice);
  if (decided && !prices.some((p) => p.eq(decided.price))) prices.push(decided.price), prices.sort((a, b) => a.cmp(b));
  const asked = sp.lb && /^\d{4,6}$/.test(sp.lb) ? prices.find((p) => p.eq(D(sp.lb!))) : undefined;
  const price = asked ?? decided?.price ?? todayPrice ?? prices[0];
  const run = (b: SimBasis) => {
    const x = bases[b];
    if (!x || !ppic?.sim) return null;
    return simulateLivebird({ basis: b, kgLb: x.kgLb, outputs: x.outputs, extraValue: "extraValue" in x ? x.extraValue : null, tariffPerKgLb: ppic.sim.tariff, prices });
  };
  const result = available.includes(basis) ? run(basis) : null;
  const need = basis === "need" ? result : run("need");
  const keep = Object.entries(sp).filter((e): e is [string, string] => !!e[1] && !["sim", "lb"].includes(e[0]));
  const href = (b: SimBasis, p: Decimal) => {
    const q = new URLSearchParams([...keep, ...(b === "need" ? [] : [["sim", b]]), ["lb", p.toFixed(0)]]).toString();
    return `/minggu-ini/${w.week_start}?${q}`;
  };
  const nClasses = ppic ? new Set(ppic.demand.byClass.map((c) => c.weight_class)).size : 0;
  const labels: Partial<Record<SimBasis, string>> = {
    ...(bases.need ? { need: `Kebutuhan PO: ${bases.need.kgLb.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kg LB (${nClasses} kelas)` } : {}),
    ...(bases.batch ? { batch: `Batch rencana di input: ${bases.batch.kgLb.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kg LB` } : {}),
  };

  // ------------------------------------------------------------ decisions waiting
  const { data: appr } = await sb.from("discount_approval").select("key, kg, requested_price, floor_price, total_below").eq("status", "pending").order("total_below", { ascending: false }).limit(20);
  const ap = (appr ?? []) as Row[];
  const future = (cash ?? []).filter((c) => c.date >= today && c.closing !== null);
  const low = future.length ? future.reduce((m, c) => (D(c.closing!).lt(D(m.closing!)) ? c : m)) : null;
  const decisions = decisionLines({
    lb: { cutDate: tomorrow, decided: !!decided, today: todayPrice, breakevenNeed: need?.breakeven ?? null },
    batch: ppic?.batch && bases.need ? { kgLb: ppic.batch.kgLb, needKgLb: bases.need.kgLb, surplusKg: ppic.batch.surplusKg, downgrade: ppic.batch.downgrade, threshold: ppic.batch.threshold } : null,
    belowFloor: { count: ap.length, top: ap[0] ? { key: String(ap[0].key), kg: D(String(ap[0].kg)), price: D(String(ap[0].requested_price)), floor: D(String(ap[0].floor_price)), totalBelow: D(String(ap[0].total_below ?? 0)) } : null },
    cash: low ? { min: D(low.closing!), date: low.date } : null,
  });

  // ------------------------------------------------------------ loop status (§3.2)
  const next = addDays(w.week_start, 7);
  const [{ data: commits }, { data: par }, { data: plan }, { data: bs }, { data: tasks }] = await Promise.all([
    sb.from("sales_commitment").select("status").eq("week_start", next).is("deleted_at", null).neq("status", "superseded"),
    sb.from("parameter").select("commitment_lock_dow, commitment_lock_time").eq("week_id", w.id).maybeSingle(),
    sb.from("plan_week").select("version").eq("week_start", next).order("version", { ascending: false }).limit(1).maybeSingle(),
    sb.from("batch").select("batch_ref, wp_received_at, invoice_status").eq("status", "Aktual").is("deleted_at", null).is("superseded_at", null).gte("date", w.week_start).lte("date", w.week_end),
    sb.from("input_task").select("rule_kind, ref, status, due_at, done_at").gte("due_date", addDays(today, -7)).lte("due_date", today),
  ]);
  const cs = (commits ?? []) as Row[], p = (par ?? {}) as Row;
  const deadline = commitmentDeadline(next, Number(p.commitment_lock_dow ?? 5), String(p.commitment_lock_time ?? "17:00"));
  const dl = deadline.slice(0, 10);
  const batches = (bs ?? []) as Row[];
  const ts = ((tasks ?? []) as Row[]).map((t) => ({ kind: String(t.rule_kind), ref: String(t.ref), st: effectiveStatus({ status: String(t.status) as TaskStatus, due_at: s(t.due_at) }, now) }));
  const lateOf = (k: string) => ts.filter((t) => t.kind === k && t.st === "late").map((t) => t.ref);
  let freeStock: { kg: Decimal; value: Decimal } | null = null;
  try {
    const mart = await commercialMart(sb, today, false);
    if (mart.rows.length) {
      const sum = stockSummary(stockSellRows(mart.rows.map((m) => ({
        key: String(m.key), form: s(m.form), free_kg: D(s(m.free_fresh_kg) ?? "0").plus(D(s(m.free_frozen_kg) ?? "0")).toFixed(2), oldest_age_days: m.oldest_age_days === null || m.oldest_age_days === undefined ? null : Number(m.oldest_age_days),
        over_age_kg: "0", urgency: s(m.urgency), cost_per_kg: s(m.cost_per_kg) ?? s(m.cost_per_kg_ma), cost_status: s(m.cost_status), price_ref: s(m.price_list),
      })), null));
      freeStock = { kg: sum.kg, value: sum.value };
    }
  } catch { freeStock = null; }
  const loop = loopLines({
    commitment: { locked: cs.some((c) => c.status === "locked"), drafts: cs.filter((c) => c.status === "draft").length, deadline: `${DAYS[new Date(`${dl}T00:00:00Z`).getUTCDay()]} ${Number(dl.slice(8, 10))}/${dl.slice(5, 7)} ${deadline.slice(11, 16).replace(":", ".")}`, late: Date.parse(now) >= Date.parse(deadline) },
    planNext: { version: plan ? Number((plan as Row).version) : null },
    costing: { sementara: batches.filter((b) => b.wp_received_at && b.invoice_status !== "tied").length, final: batches.filter((b) => b.invoice_status === "tied").length, wpLate: lateOf("costing_wp") },
    lb: { cutDate: tomorrow, price: decided?.price ?? null },
    freeStock,
  });

  const src = await loadSources(sb, now, ts);
  const sources = sourcesFor("manajemen", src);

  return {
    sim: { basis, available, labels, price, todayPrice, prices, result, decided, cutDate: tomorrow, href },
    decisions, loop, sources,
  };
}

// ------------------------------------------------------------------------------------------------ K36 source labels

export type SourceKey = "jurnal" | "stok" | "kas" | "beban_tetap" | "wp" | "po" | "lb" | "supply";
type TaskRef = { kind: string; ref: string; st: TaskStatus };

/** K36 per main screen: which tile carries which source. */
const SCREEN_SOURCES: Record<"manajemen" | "commercial" | "ppic", Record<string, SourceKey>> = {
  manajemen: { "c-outlook": "jurnal", "c-stok": "stok", "c-kas": "kas", "c-bulan": "beban_tetap", "sim-lb": "wp" },
  commercial: { "c-stok": "wp", "t-komitmen": "po" },
  ppic: { "c-po": "po", "c-biaya": "lb", "c-batch": "supply" },
};
export function sourcesFor(screen: keyof typeof SCREEN_SOURCES, src: Record<SourceKey, SourceLabel>): Record<string, SourceLabel> {
  return Object.fromEntries(Object.entries(SCREEN_SOURCES[screen]).map(([tile, key]) => [tile, src[key]]));
}

/** "WP sementara · Cost Accounting · 26 Agu 09.12" for each input behind a main number; late from input_task (§4.9). */
export async function loadSources(sb: Supa, now: string, tasks?: TaskRef[]): Promise<Record<SourceKey, SourceLabel>> {
  const today = now.slice(0, 10);
  const ts = tasks ?? ((await sb.from("input_task").select("rule_kind, ref, status, due_at").gte("due_date", addDays(today, -7)).lte("due_date", today)).data ?? [] as Row[])
    .map((t: Row) => ({ kind: String(t.rule_kind), ref: String(t.ref), st: effectiveStatus({ status: String(t.status) as TaskStatus, due_at: s(t.due_at) }, now) }));
  const late = (k: string) => ts.some((t) => t.kind === k && t.st === "late");
  const first = (q: PromiseLike<{ data: unknown }>) => Promise.resolve(q).then((r) => (r.data ?? null) as Row | null);
  const [gl, st, ca, fx, wp, po, lb, sup, tied] = await Promise.all([
    first(sb.from("gl_line").select("date, created_at").is("deleted_at", null).order("date", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("stock_card_snapshot").select("date, created_at").is("deleted_at", null).order("date", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("cash_daily").select("date, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("fixed_cost_schedule").select("updated_at").is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("batch_output_sku").select("created_at").is("deleted_at", null).eq("source", "WP").order("created_at", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("sales_line").select("created_at").eq("status", "Order").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("lb_price_decision").select("date, decided_at").order("decided_at", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("lb_supply").select("date, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle()),
    first(sb.from("batch").select("updated_at").eq("invoice_status", "tied").is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle()),
  ]);
  const wib = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") : null);
  const dmOf = (d: string | null) => (d ? `${Number(d.slice(8, 10))}/${d.slice(5, 7)}` : "—");
  const lab = (what: string, role: Role, at: string | null, isLate: boolean): SourceLabel => sourceLabel({ what, role, at, late: isLate });
  const at = (r: Row | null, c: string) => wib(s(r?.[c]));
  return {
    jurnal: lab(gl ? `jurnal s.d. ${dmOf(s(gl.date))} + PO` : "jurnal + PO", "inventory_accounting", at(gl, "created_at"), late("gl_daily")),
    stok: lab(st ? `kartu stok ${dmOf(s(st.date))}` : "kartu stok", "inventory_accounting", at(st, "created_at"), late("stock_daily")),
    kas: lab("saldo dan rencana kas", "finance", at(ca, "updated_at"), false),
    beban_tetap: lab("jadwal beban tetap", "finance", at(fx, "updated_at"), late("fixed_cost")),
    wp: lab(`WP ${tied ? "sementara/final" : "sementara"}`, "cost_accounting", at(wp, "created_at"), late("costing_wp")),
    po: lab("PO", "sales", at(po, "created_at"), late("po_lines")),
    lb: lab(`harga LB ${lb ? dmOf(s(lb.date)) : "belum diputuskan"}`, "operations_director", at(lb, "decided_at"), late("lb_price_decision")),
    supply: lab("supply LB per kelas", "purchasing", at(sup, "created_at"), late("lb_supply")),
  };
}
