import "server-only";
/**
 * "Salin ke batch rencana" (PRD v5.2-A R51, R52, K58): ONE gate and ONE copy for every way in. `copyPlanToBatches` itself
 * calls `copyGate` before it writes anything; copyPlanAction (v4) and copyClassPlanAction (v5) only call it, and the two
 * Rencana pages read the same `copyGate`, so no path can skip a check and the screen never says what the action will not.
 *
 * The gate: C42, C45, C46, C47 (v4 §6.4) · C57 for each cut date × class the copy would create (no reason opens it, §7) ·
 * C58 unless a written reason of THIS plan version exists (v5_ppic_class on for the caller only — the v4 path is never
 * held by C58) · the downgrade approval. The batches come from the SAVED plan_week_class of the version (R52 stage 1: heads
 * and kg LB per class, the yield of the class with the STD fallback labelled); a v4 plan without class rows copies its
 * plan_day rows as before. The LB price of a batch = the decision of its class, else the decision for all classes (C57
 * when none while v5_costing is on).
 *
 * Not here (DB objects that do not exist yet, PRD v5.2-B B-R85): the reason bound to the plan version by a column
 * (plan_check_reason.plan_week_id — until then a C58 reason counts only when written after the plan version was saved),
 * the LB price provenance (batch.lb_price_source — the copy message names it instead), the date split saved in
 * plan_week_class (K27 stage 2 — until then the saved week totals are split over the cut dates by the demand profile).
 */
import {
  D, addDays, c57, lbDecisionFor, planBatchRow, splitClassPlan,
  type ControlV3, type Decimal,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll, type WeekRow } from "../data";
import { WriteError } from "../write";
import { stockMartControl } from "../v3/stale";
import { loadPlanning, ppicWeekControls, proposePlan, type PlanningSources } from "../v3/planning";
import type { Row } from "../v3/uploads";
import { copyBlockersOf, loadClassDemand } from "./ppic-data";
import { v5CostingOn } from "./costing";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const FALLBACK = "STD";

export interface CopyCtx {
  sb: Supa;
  week: WeekRow;
  /** The saved plan version to copy; null = none saved yet (the screen before "Simpan rencana": the proposal is judged). */
  planId: string | null;
  /** v5_ppic_class is on for the caller: C58 judges the class need. Off (the v4 screen) = C58 never holds the copy. */
  classOn: boolean;
  src?: PlanningSources;
  c45?: ControlV3;
}

/** A batch the copy would write: a cut date × class (class null = a v4 plan day without one). */
export interface PlannedBatch { date: string; weight_class: string | null; cut_pattern: string | null; heads: number; kg_lb: string | null; supplier: string | null }
export interface LbDecision { date: string; weight_class: string | null; price: string; decided_at: string | null }

export interface CopyGate {
  /** Why the copy cannot run now ("C57 BELUM DIISI (2026-08-29 K)", "Persetujuan downgrade belum diberikan"…); empty = it can. */
  blockers: string[];
  /** The written reason that opened C58 (of this plan version); null = none. */
  c58Reason: string | null;
  plan: Row | null;
  src: PlanningSources;
  batches: PlannedBatch[];
  /** The batches come from saved plan_week_class rows of the plan version. */
  classPlan: boolean;
  controls: ControlV3[];
  c57: ControlV3 | null;
  decisions: LbDecision[];
  /** Things the copy does not stop for but says (a class of today's demand that the saved plan does not have). */
  notes: string[];
}

/** A C58 reason counts for the plan version it was written after (no column to bind it yet, B-R85); a reason without a stamp always counts. */
export function reasonsFor(reasons: { code: string; reason: string; created_at?: string | null }[], plan: Row | null): { code: string; reason: string }[] {
  const saved = plan ? s(plan.created_at) : null;
  return reasons.filter((r) => r.code !== "C58" || !saved || !r.created_at || Date.parse(r.created_at) >= Date.parse(saved));
}

export async function copyGate(ctx: CopyCtx): Promise<CopyGate> {
  const { sb, week } = ctx;
  const ws = week.week_start;
  const src = ctx.src ?? await loadPlanning(sb, week);
  const plan = ctx.planId ? src.plans.find((x) => String(x.id) === ctx.planId) ?? null : src.plans[0] ?? null;
  if (ctx.planId && !plan) throw new WriteError("Rencana tidak ditemukan");
  const c45 = ctx.c45 ?? await stockMartControl(sb, addDays(ws, -1));
  const p = proposePlan(src, { classCode: plan ? s(plan.weight_class) : ctx.classOn ? FALLBACK : null });
  const v4 = [...ppicWeekControls(src, p, week.update_date), c45];

  // the batches the copy would write: the saved class rows of this version, else its plan days, else (no plan yet) the proposal
  const saved = plan ? await fetchAll<Row>((a, b) => sb.from("plan_week_class").select("weight_class, cut_pattern, kg_lb, heads").eq("plan_week_id", String(plan.id)).order("plan_week_id").order("weight_class").range(a, b)) : [];
  const classPlan = saved.length > 0;
  const cs = classPlan || ctx.classOn ? await loadClassDemand(sb, src) : null;
  const notes: string[] = [];
  const blockers: string[] = [];
  let batches: PlannedBatch[];
  const supplier = (date: string, cls: string | null) => {
    const rows = src.lbSupply.filter((x) => String(x.date) === date && (x.status === "confirmed" || x.status === "received"));
    return s((rows.find((x) => s(x.weight_class) === cls) ?? (cls === null ? rows[0] : undefined))?.supplier);
  };
  if (classPlan && cs) {
    const split = splitClassPlan({
      saved: saved.map((r) => ({ weight_class: String(r.weight_class), kg_lb: s(r.kg_lb), heads: r.heads === null || r.heads === undefined ? null : Number(r.heads) })),
      profile: cs.daily.flatMap((d) => d.byClass.map((c) => ({ cut_date: d.cut_date, weight_class: c.weight_class, kg_lb: c.kg_lb }))),
    });
    for (const c of split.unplaced) blockers.push(`Kelas ${c} tersimpan tanpa kebutuhan per tanggal: simpan rencana ulang`);
    batches = split.cuts.map((c) => ({ date: c.cut_date, weight_class: c.weight_class, cut_pattern: "karkas", heads: c.heads, kg_lb: c.kg_lb.toFixed(2), supplier: supplier(c.cut_date, c.weight_class) }));
    const savedCls = new Set(saved.map((r) => String(r.weight_class)));
    const extra = [...new Set(cs.daily.flatMap((d) => d.byClass.filter((c) => c.kg_lb.gt(0)).map((c) => c.weight_class)))].filter((c) => !savedCls.has(c));
    if (extra.length) notes.push(`kebutuhan kelas ${extra.join(", ")} belum ada di rencana tersimpan`);
  } else if (plan) {
    const days = await fetchAll<Row>((a, b) => sb.from("plan_day").select("date, head_count, weight_class, cut_pattern, supplier").eq("plan_week_id", String(plan.id)).gt("head_count", 0).order("plan_week_id").order("date").range(a, b));
    batches = days.map((d) => ({ date: String(d.date), weight_class: s(d.weight_class), cut_pattern: s(d.cut_pattern), heads: Number(d.head_count), kg_lb: null, supplier: s(d.supplier) }));
  } else {
    batches = p.days.rows.filter((r) => r.head_count > 0).map((r) => ({ date: r.date, weight_class: p.cls?.code ?? null, cut_pattern: null, heads: r.head_count, kg_lb: null, supplier: null }));
  }

  // the LB price decisions of the cut dates (the price of a batch: class → all classes), and C57 (K25, §7): each upcoming
  // cut date × class needs the operations director's decision while v5_costing is on
  const dates = batches.map((b) => b.date).sort();
  const decisions: LbDecision[] = dates.length ? (await fetchAll<Row>((a, b) => sb.from("lb_price_decision").select("date, weight_class, price, decided_at").gte("date", dates[0]).lte("date", dates[dates.length - 1]).order("decided_at", { ascending: false }).order("id").range(a, b)))
    .map((d) => ({ date: String(d.date), weight_class: s(d.weight_class), price: String(d.price), decided_at: s(d.decided_at) })) : [];
  const c57c: ControlV3 | null = (await v5CostingOn(sb)) ? c57({ cutDates: [], decisions, cuts: batches.filter((b) => b.date >= week.update_date).map((b) => ({ date: b.date, weight_class: b.weight_class })) }) : null;
  // C58 only for the caller whose v5_ppic_class is on; a reason counts for the plan version it was written after
  const reasons = reasonsFor(src.reasons, plan);
  const controls: ControlV3[] = [...v4, ...(ctx.classOn && cs ? cs.controls : [])];
  const held = copyBlockersOf(controls, c57c, reasons);
  if (c57c && c57c.status !== "LULUS" && c57c.status !== "N/A") {
    const i = held.findIndex((h) => h.startsWith("C57 "));
    if (i >= 0 && c57c.detail.length) held[i] = `${held[i]} (${c57c.detail.join(", ")})`;
  }
  blockers.unshift(...held);
  if (plan && plan.needs_approval && !plan.approved_by) blockers.push("Persetujuan downgrade belum diberikan");
  return { blockers, c58Reason: ctx.classOn ? src.reasons.find((r) => r.code === "C58" && reasons.includes(r))?.reason ?? null : null, plan, src, batches, classPlan, controls, c57: c57c, decisions, notes };
}

/** The yield units of a v1 planned batch, and the key of each in the yield matrix. */
const UNITS = [["karkas", "Karkas"], ["kepala", "Kepala"], ["ceker", "Ceker"], ["usus", "Usus"], ["hja", "HJA (Hati/Jantung/Ampela)"], ["lemak", "Lemak"]] as const;

/**
 * Yields of a class for planBatchRow, which applies them to the processed kg (kg LB × (1 − shrink)): the yield matrix is a
 * share of kg LB, so each is divided by (1 − shrink) and the batch output = kg LB × yield. A unit the class has no yield for
 * takes the STD one (named in `fallback`), then the v1 parameter (named too).
 */
function classYields(src: PlanningSources, cls: string): { yields: Record<(typeof UNITS)[number][0], string>; std: string[]; v1: string[] } {
  const shrink = D(src.v1.shrink);
  const pick = (c: string, unit: string) => src.yieldRows.find((y) => y.weight_class === c && y.cut_pattern === "karkas" && y.key === unit)?.yield_pct ?? null;
  const std: string[] = [], v1: string[] = [];
  const out = {} as Record<(typeof UNITS)[number][0], string>;
  for (const [name, unit] of UNITS) {
    const own = pick(cls, unit);
    if (own !== null) { out[name] = D(own).div(D(1).minus(shrink)).toFixed(8); continue; }
    const fb = cls === FALLBACK ? null : pick(FALLBACK, unit);
    if (fb !== null) { std.push(unit); out[name] = D(fb).div(D(1).minus(shrink)).toFixed(8); continue; }
    v1.push(unit);
    out[name] = src.v1.yields[name];
  }
  return { yields: out, std, v1 };
}

/**
 * "Salin ke batch rencana": the batches of the gate become planned batches of the week (status Rencana) with the v1
 * planning rules, replacing the ones an earlier copy wrote. Never automatic. Every read and the whole gate come before the
 * first write; the new batches are written first and the earlier copy is retired only when they are in.
 */
export async function copyPlanToBatches(sb: Supa, week: WeekRow, planId: string, opts: { classOn: boolean }): Promise<string> {
  const gate = await copyGate({ sb, week, planId, classOn: opts.classOn });
  if (gate.blockers.length) throw new WriteError(`Belum bisa disalin ke batch: ${gate.blockers.join(", ")}`);
  const { src, plan } = gate;
  if (!plan) throw new WriteError("Rencana tidak ditemukan");
  const clsInfo = (c: string | null) => src.weightClasses.find((w) => w.code === c) ?? src.weightClasses[0] ?? null;
  const ref = (b: PlannedBatch) => `PLAN-${week.week_start}-v${plan.version}-${b.date}${gate.classPlan && b.weight_class ? `-${b.weight_class}` : ""}`;
  const labels = new Set<string>();
  const priceSource = new Map<string, number>();
  const rows = gate.batches.map((b, i) => {
    const cls = b.weight_class;
    const decided = lbDecisionFor(gate.decisions, b.date, cls);
    const lbSupply = src.lbSupply.find((x) => String(x.date) === b.date && s(x.price_per_kg) !== null && (x.status === "confirmed" || x.status === "received") && (s(x.weight_class) === cls || !s(x.weight_class)));
    const price = decided?.price ?? s(lbSupply?.price_per_kg) ?? src.v1.lbPriceToday;
    const source = decided ? (decided.weight_class ? `keputusan kelas ${decided.weight_class}` : "keputusan semua kelas") : lbSupply ? "harga supply" : "harga hari ini (parameter)";
    priceSource.set(source, (priceSource.get(source) ?? 0) + 1);
    let yields = src.v1.yields;
    if (gate.classPlan && cls) {
      const y = classYields(src, cls);
      yields = y.yields;
      if (y.std.length) labels.add(`${cls} yield STD untuk ${y.std.join("/")}`);
      if (y.v1.length) labels.add(`${cls} yield v1 untuk ${y.v1.join("/")}`);
    }
    const avg = gate.classPlan && b.kg_lb && b.heads > 0 ? D(b.kg_lb).div(b.heads).toFixed(6) : clsInfo(cls)?.avg_kg ?? "2";
    const r = planBatchRow({ date: b.date, heads: b.heads, avgLbKg: avg, lbPrice: price, shrink: src.v1.shrink, freightPerKgLb: src.v1.freight, maklonPerKgProcessed: src.v1.maklon, yields });
    return {
      week_id: week.id, seq: 900 + i, date: r.date, status: "Rencana", batch_ref: ref(b), supplier: b.supplier, lb_kg: r.lb_kg, lb_price: r.lb_price,
      freight: r.freight, maklon: r.maklon, processed_kg: r.processed_kg, out_karkas_fresh: r.out_karkas_fresh, out_kepala: r.out_kepala, out_ceker: r.out_ceker,
      out_usus: r.out_usus, out_hja: r.out_hja, out_lemak: r.out_lemak, source: "Manual", document_ref: `plan_week:${planId}`,
      head_count: r.head_count, avg_lb_kg: gate.classPlan && b.kg_lb && b.heads > 0 ? D(b.kg_lb).div(b.heads).toFixed(4) : clsInfo(cls)?.avg_kg ?? null, weight_class: cls, cut_pattern: b.cut_pattern,
    };
  });
  const old = await fetchAll<Row>((a, b) => sb.from("batch").select("id, batch_ref").eq("week_id", week.id).eq("status", "Rencana").like("batch_ref", `PLAN-${week.week_start}-%`).is("deleted_at", null).order("id").range(a, b));
  if (rows.length) {
    const ins = await sb.from("batch").insert(rows);
    if (ins.error) throw new WriteError(`batch: ${ins.error.message}`);
  }
  const ids = old.map((o) => String(o.id));
  for (let i = 0; i < ids.length; i += 200) {
    const e = await sb.from("batch").update({ deleted_at: new Date().toISOString() }).in("id", ids.slice(i, i + 200));
    if (e.error) throw new WriteError(`batch: ${e.error.message}`);
  }
  const e3 = await sb.from("plan_week").update({ copied_to_batch_at: new Date().toISOString() }).eq("id", planId);
  if (e3.error) throw new WriteError(e3.error.message);
  const totalLb = rows.reduce<Decimal>((a, r) => a.plus(D(r.lb_kg)), D(0));
  const order = src.weightClasses.map((c) => c.code);
  const classes = [...new Set(gate.batches.map((b) => b.weight_class ?? "—"))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const byClass = gate.classPlan ? ` (${classes.join(" / ")}; ${totalLb.toFixed(0)} kg LB, ${gate.batches.reduce((a, b) => a + b.heads, 0)} ekor)` : "";
  const price = [...priceSource].map(([k, n]) => `${k} ${n}`).join(", ");
  return `${rows.length} batch rencana ditulis${byClass}${old.length ? ` (${old.length} salinan lama dihapus)` : ""}; harga LB: ${price || "—"}${labels.size ? `; yield pengganti: ${[...labels].join(", ")}` : ""}${gate.notes.length ? `; catatan: ${gate.notes.join("; ")}` : ""}`;
}
