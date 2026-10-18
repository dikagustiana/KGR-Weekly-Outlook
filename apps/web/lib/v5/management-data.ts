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
import { fetchAll, type WeekRow } from "../data";
import { clock, taskWindow, type Clock } from "../clock";
import { must, mustRows, tileData } from "../loader";
import { fail, type Failed } from "../v4/tile-errors";
import type { Role } from "../roles";
import { isModuleOn, parseSetting } from "../modules-core";
import { v5CostingSetting } from "./costing";
import type { Row } from "../v3/uploads";
import { commercialMart } from "../v3/commercial";
import { loadPlanning } from "../v3/planning";
import { stockMartControl } from "../v3/stale";
import { loadPpicV5 } from "./ppic-data";
import { LOOP_MODULE, decisionLines, loopLines, simPrices, sourceLabel, type LoopRow, type ManagementV5Input, type SimBasis, type SourceLabel } from "./management";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export async function loadManagementV5(sb: Supa, w: WeekRow, r: WeekResult, sp: Record<string, string | undefined>, cash: { date: string; closing: string | null }[] | null, role: Role): Promise<ManagementV5Input> {
  // PRD v5.1 K38: marts are read as of the data date; the cut date of the LB decision is tomorrow on the wall clock,
  // "late" is against now, and the task window is the one of Input (wall − 13 … wall + 7)
  const c = await clock(sb);
  const now = c.now, today = c.data, cutDate = addDays(c.wall, 1);
  const failed: Failed = {};
  const ppic = fail(failed, ["sim-lb"], await tileData("manajemen: basis simulasi (PPIC v5)", async () =>
    loadPpicV5(sb, { src: await loadPlanning(sb, w), result: r, base: "", versi: "batch", canPlan: false, c45: await stockMartControl(sb, addDays(w.week_start, -1)) })), null);
  const lbToday = r.block2.lbPriceToday;
  const todayPrice = lbToday !== null && lbToday !== undefined && D(lbToday).gt(0) ? D(lbToday) : null;
  const dec = fail(failed, ["sim-lb", "keputusan"], await tileData("manajemen: keputusan harga LB", async () =>
    must(await sb.from("lb_price_decision").select("date, price, decided_by, decided_at").eq("date", cutDate).order("decided_at", { ascending: false }).limit(1).maybeSingle(), "lb_price_decision") as Row | null), null);
  const decided = dec ? { date: cutDate, price: D(String(dec.price)), by: s(dec.decided_by) } : null;

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
  // PRD v5.1 R30: STD is not a weight class
  const nClasses = ppic ? new Set(ppic.demand.byClass.map((x) => x.weight_class).filter((c) => c !== "STD")).size : 0;
  const labels: Partial<Record<SimBasis, string>> = {
    ...(bases.need ? { need: `Kebutuhan PO: ${bases.need.kgLb.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kg LB (${nClasses ? `${nClasses} kelas` : "STD"})` } : {}),
    ...(bases.batch ? { batch: `Batch rencana di input: ${bases.batch.kgLb.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kg LB` } : {}),
  };

  // ------------------------------------------------------------ decisions waiting
  const ap = fail(failed, ["keputusan"], await tileData("manajemen: permintaan diskon", async () =>
    mustRows<Row>(await sb.from("discount_approval").select("key, kg, requested_price, floor_price, total_below").eq("status", "pending").order("total_below", { ascending: false }), "discount_approval").slice(0, 20)), []);
  const future = (cash ?? []).filter((x) => x.date >= today && x.closing !== null);
  const low = future.length ? future.reduce((m, x) => (D(x.closing!).lt(D(m.closing!)) ? x : m)) : null;
  const decisions = decisionLines({
    lb: { cutDate, decided: !!decided, today: todayPrice, breakevenNeed: need?.breakeven ?? null },
    batch: ppic?.batch && bases.need ? { kgLb: ppic.batch.kgLb, needKgLb: bases.need.kgLb, surplusKg: ppic.batch.surplusKg, downgrade: ppic.batch.downgrade, threshold: ppic.batch.threshold } : null,
    belowFloor: { count: ap.length, top: ap[0] ? { key: String(ap[0].key), kg: D(String(ap[0].kg)), price: D(String(ap[0].requested_price)), floor: D(String(ap[0].floor_price)), totalBelow: D(String(ap[0].total_below)) } : null },
    cash: low ? { min: D(low.closing!), date: low.date } : null,
  });

  // ------------------------------------------------------------ loop status (§3.2)
  const next = addDays(w.week_start, 7);
  const win = taskWindow(c);
  const reads = await tileData("manajemen: status putaran", async () => {
    const [commits, par, plan, bs, tasks] = await Promise.all([
      sb.from("sales_commitment").select("status").eq("week_start", next).is("deleted_at", null).neq("status", "superseded"),
      sb.from("parameter").select("commitment_lock_dow, commitment_lock_time").eq("week_id", w.id).maybeSingle(),
      sb.from("plan_week").select("version").eq("week_start", next).order("version", { ascending: false }).limit(1).maybeSingle(),
      sb.from("batch").select("batch_ref, wp_received_at, invoice_status, costing_status").eq("status", "Aktual").is("deleted_at", null).is("superseded_at", null).gte("date", w.week_start).lte("date", w.week_end),
      fetchAll<Row>((a, b) => sb.from("input_task").select("rule_kind, ref, status, due_at, done_at").gte("due_date", win.from).lte("due_date", win.to).order("due_date").order("ref").order("rule_kind").range(a, b)),
    ]);
    return {
      commits: mustRows<Row>(commits, "sales_commitment"), par: (must(par, "parameter") ?? {}) as Row, plan: must(plan, "plan_week") as Row | null,
      batches: mustRows<Row>(bs, "batch"), tasks,
    };
  });
  const lr = fail(failed, ["keputusan"], reads, { commits: [] as Row[], par: {} as Row, plan: null as Row | null, batches: [] as Row[], tasks: [] as Row[] });
  const deadline = commitmentDeadline(next, Number(lr.par.commitment_lock_dow ?? 5), String(lr.par.commitment_lock_time ?? "17:00"));
  const dl = deadline.slice(0, 10);
  const ts = lr.tasks.map((t) => ({ kind: String(t.rule_kind), ref: String(t.ref), st: effectiveStatus({ status: String(t.status) as TaskStatus, due_at: s(t.due_at) }, now) }));
  const lateOf = (k: string) => ts.filter((t) => t.kind === k && t.st === "late").map((t) => t.ref);
  const free = await tileData("manajemen: stok bebas (mart Commercial)", async () => {
    // K53: the v5 cost of the stock only where v5_costing is on for this role (else the MA cost, as v4)
    const mart = await commercialMart(sb, today, false, isModuleOn(await v5CostingSetting(sb), role));
    if (!mart.rows.length) return null;
    const sum = stockSummary(stockSellRows(mart.rows.map((m) => ({
      key: String(m.key), form: s(m.form), free_kg: D(String(m.free_fresh_kg)).plus(D(String(m.free_frozen_kg))).toFixed(2), oldest_age_days: m.oldest_age_days === null || m.oldest_age_days === undefined ? null : Number(m.oldest_age_days), // commercial_daily.free_*_kg NOT NULL
      over_age_kg: null, urgency: s(m.urgency), cost_per_kg: s(m.cost_per_kg) ?? s(m.cost_per_kg_ma), cost_status: s(m.cost_status), price_ref: s(m.price_list),
    })), null));
    return { kg: sum.kg, value: sum.value };
  });
  // R28: a row whose module is not enabled says so instead of "late" (the flags, not the viewer's role: the process runs or not)
  const flagsT = await tileData("manajemen: flag modul", async () =>
    mustRows<Row>(await sb.from("app_setting").select("key, value").in("key", Object.values(LOOP_MODULE)), "app_setting"));
  const flags = fail(failed, ["keputusan"], flagsT, [] as Row[]);
  const enabled = (k: string) => parseSetting(flags.find((f) => String(f.key) === k)?.value).enabled;
  const off = "error" in flagsT ? {} : Object.fromEntries((Object.keys(LOOP_MODULE) as LoopRow[]).map((r) => [r, !enabled(LOOP_MODULE[r])]));
  const loop = loopLines({
    off,
    commitment: { locked: lr.commits.some((x) => x.status === "locked"), drafts: lr.commits.filter((x) => x.status === "draft").length, deadline: `${DAYS[new Date(`${dl}T00:00:00Z`).getUTCDay()]} ${Number(dl.slice(8, 10))}/${dl.slice(5, 7)} ${deadline.slice(11, 16).replace(":", ".")}`, late: Date.parse(now) >= Date.parse(deadline) },
    planNext: { version: lr.plan ? Number(lr.plan.version) : null },
    // K59: final = the allocation is posted (batch.costing_status 'posted'), not a tied invoice
    costing: { sementara: lr.batches.filter((b) => b.wp_received_at && b.costing_status !== "posted").length, final: lr.batches.filter((b) => b.costing_status === "posted").length, wpLate: lateOf("costing_wp") },
    lb: { cutDate, price: decided?.price ?? null },
    freeStock: "error" in free ? { error: free.error } : free.ok,
  });

  const src = await tileData("manajemen: label sumber", () => loadSources(sb, c, ts));
  const sources = "ok" in src ? sourcesFor("manajemen", src.ok) : sourcesFailed("manajemen", src.error);

  return {
    sim: { basis, available, labels, price, todayPrice, prices, result, decided, cutDate, dataDate: c.data, href },
    decisions, loop, sources, failed,
  };
}

/** A Manajemen v5 read that failed as a whole: both tiles in place, with the message (K41). */
export function managementFailed(message: string): ManagementV5Input {
  return {
    sim: { basis: "need", available: [], labels: {}, price: D(0), todayPrice: null, prices: [], result: null, decided: null, cutDate: "", dataDate: "", href: () => "" },
    decisions: [], loop: [], sources: {}, failed: { "sim-lb": message, keputusan: message },
  };
}

// ------------------------------------------------------------------------------------------------ K36 source labels

export type SourceKey = "jurnal" | "stok" | "kas" | "beban_tetap" | "wp" | "po" | "lb" | "supply";
type TaskRef = { kind: string; ref: string; st: TaskStatus };

/** K36 per main screen: which tile carries which source. */
const SCREEN_SOURCES: Record<"manajemen" | "commercial" | "ppic", Record<string, SourceKey>> = {
  manajemen: { "c-outlook": "jurnal", "c-stok": "stok", "c-kas": "kas", "c-bulan": "beban_tetap", "sim-lb": "lb" },
  commercial: { "c-stok": "wp", "t-komitmen": "po" },
  ppic: { "c-po": "po", "c-biaya": "lb", "c-batch": "supply" },
};
export function sourcesFor(screen: keyof typeof SCREEN_SOURCES, src: Record<SourceKey, SourceLabel>): Record<string, SourceLabel> {
  return Object.fromEntries(Object.entries(SCREEN_SOURCES[screen]).map(([tile, key]) => [tile, src[key]]));
}

/** K36 labels of one screen on the wall clock, or the failure on each label (K41). */
export async function sourcesOf(screen: keyof typeof SCREEN_SOURCES, sb: Supa): Promise<Record<string, SourceLabel>> {
  const src = await tileData(`${screen}: label sumber`, async () => loadSources(sb, await clock(sb)));
  return "ok" in src ? sourcesFor(screen, src.ok) : sourcesFailed(screen, src.error);
}

/** K41: the labels could not be read; each tile says so instead of a source. */
export function sourcesFailed(screen: keyof typeof SCREEN_SOURCES, message: string): Record<string, SourceLabel> {
  return Object.fromEntries(Object.keys(SCREEN_SOURCES[screen]).map((tile) => [tile, { text: `gagal dimuat (${message})`, late: true }]));
}

/** "WP sementara · Cost Accounting · 26 Agu 09.12" for each input behind a main number; late from input_task (§4.9). */
export async function loadSources(sb: Supa, c: Clock, tasks?: TaskRef[]): Promise<Record<SourceKey, SourceLabel>> {
  // K38: the task window and "late" of Input (wall − 13 … wall + 7, against now)
  const win = taskWindow(c);
  const ts = tasks ?? (await fetchAll<Row>((a, b) => sb.from("input_task").select("rule_kind, ref, status, due_at").gte("due_date", win.from).lte("due_date", win.to).order("due_date").order("ref").order("rule_kind").range(a, b)))
    .map((t: Row) => ({ kind: String(t.rule_kind), ref: String(t.ref), st: effectiveStatus({ status: String(t.status) as TaskStatus, due_at: s(t.due_at) }, c.now) }));
  const late = (k: string) => ts.some((t) => t.kind === k && t.st === "late");
  const first = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>, where: string) => must(await q, `label sumber ${where}`) as Row | null;
  const [gl, st, ca, fx, wp, po, lb, sup, tied] = await Promise.all([
    first(sb.from("gl_line").select("date, created_at").is("deleted_at", null).order("date", { ascending: false }).limit(1).maybeSingle(), "jurnal"),
    first(sb.from("stock_card_snapshot").select("date, created_at").is("deleted_at", null).order("date", { ascending: false }).limit(1).maybeSingle(), "kartu stok"),
    first(sb.from("cash_daily").select("date, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(), "kas"),
    first(sb.from("fixed_cost_schedule").select("updated_at").is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(), "beban tetap"),
    first(sb.from("batch_output_sku").select("created_at").is("deleted_at", null).eq("source", "WP").order("created_at", { ascending: false }).limit(1).maybeSingle(), "WP"),
    first(sb.from("sales_line").select("created_at").eq("status", "Order").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(), "PO"),
    first(sb.from("lb_price_decision").select("date, decided_at").order("decided_at", { ascending: false }).limit(1).maybeSingle(), "harga LB"),
    first(sb.from("lb_supply").select("date, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(), "supply LB"),
    first(sb.from("batch").select("updated_at").eq("invoice_status", "tied").is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(), "faktur"),
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
