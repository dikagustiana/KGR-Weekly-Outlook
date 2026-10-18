import "server-only";
/**
 * Tutup buku v4 (PRD v4 §6.6, P13, §7.1, §7.2): FINAL = the journal of the full month (K11 rows up to the month end)
 * plus the posted closing adjustments, locked only through public.release_month with the FINAL controls (C21–C24 when
 * M1 is on, C35–C37 when M6 is on, C48, C49); then the calibration rows go to the next month's register and the
 * accuracy per day of V1 / V2 against FINAL is written to the mart forecast_accuracy_daily by the rebuild queue
 * (service role, S1). The page reads versions, adjustments and the mart; the numbers come from @kgr/engine.
 */
import { createHash } from "node:crypto";
import {
  D, accuracyDays, accuracyV4, addDays, c48, calibrationV4, finalTotalsV4, firstOfMonth, isCogsLine, isRevenueLine, jakartaToday, monthEnd, monthMandatory,
  plLineAmounts, plRowsToMart, releaseVerdict, unbilledRevaluation, versionDaysV4, worstByCode,
  type AccuracyLineV4, type ControlV3, type PlRowV4, type VersionDayV4,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { fetchAll, listWeeks } from "../data";
import { inChunks, must, mustRows } from "../loader";
import { WriteError } from "../write";
import { martReplace, registerBuilder } from "../rebuild-registry";
import type { ModuleSettings } from "../modules-core";
import { loadCostingWeek, weekCostingControls } from "../v3/costing";
import { loadCash } from "../v3/cash";
import { fsReconJudged, inFsReconScope, type FsReconModel } from "../v5/fs-recon";
import { loadFinalSnapshotPl, loadFsRecon } from "../v5/fs-recon-data";
import { computeMonthV4, ensureOutlook, RULE_VERSION, type MonthStateV4 } from "./month";
import type { Row } from "../v3/uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const f2 = (x: { toFixed(n: number): string } | null) => (x === null ? null : x.toFixed(2));
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

/** C48 over the batches dated in the month (not the weeks around it). */
async function monthC48(sb: Supa, first: string, last: string): Promise<ControlV3> {
  const batches = await fetchAll<Row>((a, b) => sb.from("batch").select("id, batch_ref, status, date").is("deleted_at", null).gte("date", first).lte("date", last).order("id").range(a, b));
  const ids = batches.map((b) => String(b.id));
  const outs = ids.length ? await inChunks(ids, (c) => fetchAll<Row>((a, b) => sb.from("batch_output_sku").select("batch_id, kg").in("batch_id", c).is("deleted_at", null).order("id").range(a, b))) : [];
  const ref = new Map(batches.map((b) => [String(b.id), s(b.batch_ref) ?? String(b.id)]));
  return c48({
    batches: batches.map((b) => ({ ref: ref.get(String(b.id))!, status: String(b.status ?? ""), date: s(b.date) })),
    outputs: outs.map((o) => ({ batch_ref: ref.get(String(o.batch_id)) ?? String(o.batch_id), kg: String(o.kg) })), // batch_output_sku.kg NOT NULL
  });
}

/** The FINAL controls of §7.1: a module that is off and does not feed the FINAL numbers is N/A (left out). */
export async function finalControlsV4(sb: Supa, st: MonthStateV4, settings: ModuleSettings): Promise<ControlV3[]> {
  const out: ControlV3[] = [...st.controls.filter((c) => c.code === "C49"), await monthC48(sb, st.first, st.last)];
  if (settings.m1_costing?.enabled) {
    const weeks = (await listWeeks(sb)).filter((w) => w.week_end >= st.first && w.week_start <= st.last);
    const cw: ControlV3[] = [];
    for (const w of weeks) cw.push(...weekCostingControls(await loadCostingWeek(sb, w)).filter((c) => c.code !== "C48"));
    out.push(...worstByCode(cw));
  }
  if (settings.m6_cash?.enabled) {
    const c = await loadCash(sb, addDays(st.last, 1), { m4: true });
    out.push(...c.controls.filter((x) => ["C35", "C36", "C37"].includes(x.code)));
  }
  return worstByCode(out);
}

export interface FinalPreview {
  state: MonthStateV4;
  controls: ControlV3[];
  adjustments: { code: string; pl_line: string; amount: string }[];
  totals: ReturnType<typeof finalTotalsV4>;
}

/** The rows and the posted closing adjustments of the month as FINAL would take them: the journal of the whole month. */
async function finalRows(sb: Supa, first: string, settings: ModuleSettings) {
  const last = monthEnd(first);
  const st = await computeMonthV4(sb, first, addDays(last, 1), settings, { cutOff: last });
  const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "month_outlook") as Row | null;
  const moId = (mo as Row | null)?.id ? String((mo as Row).id) : null;
  const adj = moId ? mustRows<Row>(await sb.from("closing_adjustment").select("code, pl_line, amount").eq("month_outlook_id", moId).eq("posted", true).is("deleted_at", null), "closing_adjustment") : [];
  const adjustments = adj.map((a) => ({ code: String(a.code), pl_line: String(a.pl_line), amount: String(a.amount) }));
  const rows: PlRowV4[] = st.plan.rows.filter((r) => r.actual !== null);
  return { state: st, rows, adjustments };
}

/**
 * C59 (PRD v5.2-A R69, K62): the app's FINAL numbers against the FS, from August 2026 (O27) and only once an FS has been
 * imported for the month and Finance has agreed the map: the FS comes after the close in the first run (B-R91), so no
 * import (or a map still in draft) is not a rejection.
 * [] = not judged. A GAGAL holds the FINAL lock unless Finance records an override of C59 (policy B-R86).
 */
async function finalC59(sb: Supa, first: string, rows: PlRowV4[], adjustments: { pl_line: string; amount: string }[]): Promise<ControlV3[]> {
  if (!inFsReconScope(first)) return [];
  const r = await loadFsRecon(sb, first, { plLines: plLineAmounts(rows, adjustments), appSource: "berjalan", today: jakartaToday() });
  return r && fsReconJudged(r) ? [r.result.c59] : [];
}

/** The controls a FINAL lock needs: the §7.1 list, and C59 when it was judged (R69). The page and the lock read the same list. */
export const finalMandatory = (controls: { code: string }[]): string[] => [...monthMandatory("FINAL"), ...(controls.some((c) => c.code === "C59") ? ["C59"] : [])];

async function finalPreview(sb: Supa, first: string, settings: ModuleSettings): Promise<FinalPreview> {
  const { state: st, rows, adjustments } = await finalRows(sb, first, settings);
  const controls = worstByCode([...await finalControlsV4(sb, st, settings), ...await finalC59(sb, first, rows, adjustments)]);
  return { state: st, controls, adjustments, totals: finalTotalsV4({ rows, adjustments, mode: st.costingMode }) };
}

/**
 * The Rekonsiliasi page (R69): the app's month against the FS. The locked FINAL when there is one (its snapshot is the
 * reference), else the journal of the month so far. null = before August 2026.
 */
export async function loadRekonsiliasi(sb: Supa, first: string, settings: ModuleSettings): Promise<FsReconModel | null> {
  if (!inFsReconScope(first)) return null;
  const today = jakartaToday();
  const fin = await loadFinalSnapshotPl(sb, first);
  if (fin) return loadFsRecon(sb, first, { plLines: fin, appSource: "FINAL", today });
  const { rows, adjustments } = await finalRows(sb, first, settings);
  return loadFsRecon(sb, first, { plLines: plLineAmounts(rows, adjustments), appSource: "berjalan", today });
}

/**
 * Lock FINAL (P13): after the month end, every FINAL control without GAGAL / BELUM DIISI / STALE unless overridden by
 * the role the policy names; then calibration rows for the next month and the accuracy mart through the queue.
 */
export async function finalizeMonthV4(sb: Supa, viewer: Viewer, first: string, settings: ModuleSettings): Promise<{ message: string; sha: string }> {
  const last = monthEnd(first);
  const today = jakartaToday();
  if (today <= last) throw new WriteError(`FINAL dikunci setelah akhir bulan (${last})`);
  const p = await finalPreview(sb, first, settings);
  const ov = mustRows<Row>(await sb.from("release_override").select("code").eq("scope_kind", "month").eq("scope", `${first}:FINAL`).is("deleted_at", null), "release_override");
  const verdict = releaseVerdict({ controls: p.controls.map((c) => ({ code: c.code, status: c.status })), mandatory: finalMandatory(p.controls), overrides: ((ov ?? []) as { code: string }[]).map((r) => r.code), strict: true });
  if (!verdict.ok) throw new WriteError(`FINAL ditolak: ${verdict.rejections.map((r) => `${r.code} ${r.status}`).join("; ")}`);
  const st = p.state;
  const rows = st.plan.rows.filter((r) => r.actual !== null);
  const t = p.totals;
  const snapshot = {
    month: first, version: "FINAL", rule_version: RULE_VERSION, cut_off: last, time_zone: "Asia/Jakarta",
    days: versionDaysV4(rows, first, last, st.costingMode), rows: plRowsToMart(rows), adjustments: p.adjustments,
    // R66 (K63): the definition of the journal columns of this FINAL (C59 compares it with the FS), only when it is not the v5 default
    ...(st.costingMode === "memo" ? { costing_rows_mode: st.costingMode } : {}),
    controls: p.controls.map((c) => ({ code: c.code, status: c.status })),
    totals: Object.fromEntries(Object.entries(t.after).map(([k, v]) => [k, f2(v)])),
    totals_before_adjustments: Object.fromEntries(Object.entries(t.before).map(([k, v]) => [k, f2(v)])),
    margin_ref: st.plan.margin.toFixed(6), runrate: { revenue_per_day: f2(st.plan.runrate.revenue), window_from: st.plan.runrate.windowFrom, days: st.plan.runrate.days, anomalies: st.plan.runrate.anomalies },
  };
  const json = canonical(snapshot);
  const sha = createHash("sha256").update(json).digest("hex");
  const { error } = await sb.rpc("release_month", {
    p_month: first, p_version: "FINAL", p_json: json, p_sha: sha, p_cut_off: last,
    p_totals: Object.fromEntries(Object.entries(t.after).map(([k, v]) => [k, f2(v)])), p_rule_version: RULE_VERSION, p_anomaly_days: st.plan.runrate.anomalies, p_po_share: null,
  });
  if (error) throw new WriteError(error.message);

  // calibration for the next month (proposals; Finance agrees them before that month's V1)
  const mo = await ensureOutlook(sb, first);
  const v1 = must(await sb.from("month_outlook_version").select("revenue, gp").eq("month_outlook_id", String(mo.id)).eq("version", "V1").maybeSingle(), "month_outlook_version") as Row | null;
  const v1r = v1 as Row | null;
  const cal = calibrationV4({ month: first, plan: st.plan, v1Bias: v1r && v1r.revenue !== null ? { revenue: D(String(v1r.revenue)).minus(t.after.revenue).toFixed(2), gp: v1r.gp === null || v1r.gp === undefined ? null : D(String(v1r.gp)).minus(t.after.gp).toFixed(2) } : null });
  const next = await ensureOutlook(sb, addDays(last, 1));
  const have = mustRows<Row>(await sb.from("assumption_register").select("code").eq("month_outlook_id", String(next.id)).eq("source", "kalibrasi").neq("status", "superseded").is("deleted_at", null), "assumption_register");
  const fresh = cal.filter((r) => !have.some((h) => String(h.code) === r.code));
  if (fresh.length) {
    const e = await sb.from("assumption_register").insert(fresh.map((r) => ({ month_outlook_id: next.id, code: r.code, name: r.name, value_num: r.value_num, basis: r.basis, owner: r.owner, status: "proposed", source: "kalibrasi" })));
    if (e.error) throw new WriteError(`assumption_register: ${e.error.message}`);
  }
  void viewer;
  return { message: `FINAL dikunci (SHA ${sha.slice(0, 12)}…); ${fresh.length} asumsi kalibrasi untuk ${addDays(last, 1).slice(0, 7)}`, sha };
}

// ------------------------------------------------------------------------------------------------ accuracy mart (P13)

let builtAcc = new Set<string>();

/** A total over days is shown only when every day has the value: one unknown day makes it unknown, never a smaller number (R64). */
export function dailyTotal(rs: Row[], k: string): string | null {
  return rs.length && rs.every((r) => r[k] !== null && r[k] !== undefined) ? rs.reduce((a, r) => a.plus(D(String(r[k]))), D(0)).toFixed(2) : null;
}

/** forecast_accuracy_daily of a month that has FINAL: every V1 / V2 forecast day against the FINAL day. */
async function buildAccuracy(sb: Supa, first: string): Promise<string> {
  const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "month_outlook") as Row | null;
  if (!mo) return `akurasi ${first.slice(0, 7)}: belum ada outlook`;
  const id = String((mo as Row).id);
  const versions = mustRows<Row>(await sb.from("month_outlook_version").select("version, snapshot").eq("month_outlook_id", id), "month_outlook_version");
  const fin = versions.find((v) => v.version === "FINAL");
  if (!fin) return `akurasi ${first.slice(0, 7)}: FINAL belum dikunci`;
  const finDays = ((fin.snapshot as { days?: VersionDayV4[] } | null)?.days ?? []);
  const rows: Record<string, unknown>[] = [];
  for (const v of versions.filter((x) => x.version !== "FINAL")) {
    const days = ((v.snapshot as { days?: VersionDayV4[] } | null)?.days ?? []);
    for (const a of accuracyDays({ version: days, actual: finDays.map((d) => ({ date: d.date, revenue: d.revenue, kg: d.kg ?? null })) })) {
      rows.push({ month_outlook_id: id, version: String(v.version), date: a.date, segment: a.segment, forecast: f2(a.forecast), actual: f2(a.actual), diff: f2(a.diff), day_kind: a.day_kind, diff_kg: f2(a.diff_kg), diff_price: f2(a.diff_price) });
    }
  }
  let written = 0;
  for (let d = first; d <= monthEnd(first); d = addDays(d, 1)) written += (await martReplace(sb, "forecast_accuracy_daily", d, rows.filter((r) => r.date === d))).written;
  return `forecast_accuracy_daily ${first.slice(0, 7)}: ${written} baris`;
}

registerBuilder({
  module: "m4_monthly", name: "accuracy v4",
  begin: async () => { builtAcc = new Set(); },
  build: async (sb, date) => {
    const m = firstOfMonth(date);
    if (builtAcc.has(m)) return `akurasi ${m.slice(0, 7)} sudah dibangun`;
    builtAcc.add(m);
    return buildAccuracy(sb, m);
  },
});

// ------------------------------------------------------------------------------------------------ page

export interface CloseViewV4 {
  first: string;
  last: string;
  afterMonthEnd: boolean;
  adjustments: Row[];
  versions: { version: string; sha: string; lockedAt: string | null; revenue: string | null; gp: string | null; nibt: string | null }[];
  hasFinal: boolean;
  preview: { controls: { code: string; name: string; status: string; detail: string[] }[]; before: Record<string, string>; adjustments: Record<string, string>; after: Record<string, string> } | null;
  accuracy: AccuracyLineV4[];
  daily: { version: string; kind: string; days: number; diff: string | null; diffKg: string | null; diffPrice: string | null }[];
  calibration: { id: string; code: string; name: string; value: string | null; status: string }[];
  /** DI-01 from the ledger: DOs of the previous month invoiced in this month, and DOs of this month invoiced later. */
  unbilled: { month: string; dos: number; kg: string; cogsRevenue: string; cogsInvoice: string; revaluation: string }[];
}

/** DI-01 pairs from the ledger mart (lot_movement with revenue_date), for DOs delivered in `month`. */
async function unbilledOf(sb: Supa, month: string) {
  const rows = await fetchAll<Row>((a, b) => sb.from("lot_movement").select("document_ref, key, kg, date, revenue_date, cost_ma, cost_ma_revenue").eq("type", "out_sale")
    .gte("revenue_date", month).lte("revenue_date", monthEnd(month)).gt("date", monthEnd(month)).order("id").range(a, b));
  const r = unbilledRevaluation({
    month,
    pairs: rows.filter((x) => x.cost_ma_revenue !== null && x.cost_ma !== null).map((x) => ({
      document_ref: String(x.document_ref ?? ""), key: s(x.key), kg: D(String(x.kg)).abs().toFixed(2), revenue_date: String(x.revenue_date), invoice_date: String(x.date),
      cogs_revenue: D(String(x.cost_ma_revenue)).abs().toFixed(2), cogs_invoice: D(String(x.cost_ma)).abs().toFixed(2),
    })),
  });
  return { month, dos: new Set(r.rows.map((x) => x.document_ref)).size, kg: r.kg.toFixed(2), cogsRevenue: r.cogsRevenue.toFixed(2), cogsInvoice: r.cogsInvoice.toFixed(2), revaluation: r.revaluation.toFixed(2) };
}

/** Reads for the tutup-buku page: adjustments, versions, the FINAL pre-check (before FINAL), accuracy (after). */
export async function closeViewV4(sb: Supa, first: string, settings: ModuleSettings): Promise<CloseViewV4> {
  const last = monthEnd(first);
  const afterMonthEnd = jakartaToday() > last;
  const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "month_outlook") as Row | null;
  const id = (mo as Row | null)?.id ? String((mo as Row).id) : null;
  const [adjustments, vs] = id ? await Promise.all([
    fetchAll<Row>((a, b) => sb.from("closing_adjustment").select("*").eq("month_outlook_id", id).is("deleted_at", null).order("code").order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("month_outlook_version").select("version, snapshot_sha256, locked_at, revenue, gp, nibt").eq("month_outlook_id", id).order("locked_at").order("id").range(a, b)),
  ]) : [[] as Row[], [] as Row[]];
  const versions = vs.map((v) => ({ version: String(v.version), sha: String(v.snapshot_sha256 ?? ""), lockedAt: s(v.locked_at), revenue: s(v.revenue), gp: s(v.gp), nibt: s(v.nibt) }));
  const fin = versions.find((v) => v.version === "FINAL");
  let preview: CloseViewV4["preview"] = null;
  if (!fin && afterMonthEnd) {
    const p = await finalPreview(sb, first, settings);
    const fx = (t: object): Record<string, string> => Object.fromEntries(Object.entries(t as Record<string, { toFixed(n: number): string }>).map(([k, v]) => [k, v.toFixed(2)]));
    preview = { controls: p.controls.map((c) => ({ code: c.code, name: c.name, status: c.status, detail: c.detail })), before: fx(p.totals.before), adjustments: fx(p.totals.adjustments), after: fx(p.totals.after) };
  }
  let accuracy: AccuracyLineV4[] = [];
  let daily: CloseViewV4["daily"] = [];
  if (fin && id) {
    const posted = adjustments.filter((a) => a.posted === true);
    const sumAdj = (pred: (l: string) => boolean) => posted.filter((a) => pred(String(a.pl_line))).reduce((acc, a) => acc.plus(D(String(a.amount))), D(0)).toFixed(2);
    accuracy = accuracyV4({
      final: { revenue: fin.revenue, gp: fin.gp, nibt: fin.nibt },
      adjustments: { revenue: sumAdj(isRevenueLine), gp: sumAdj((l) => isRevenueLine(l) || isCogsLine(l)), nibt: sumAdj(() => true) },
      versions: versions.filter((v) => v.version !== "FINAL").map((v) => ({ version: v.version, revenue: v.revenue, gp: v.gp, nibt: v.nibt })),
    });
    const rows = await fetchAll<Row>((a, b) => sb.from("forecast_accuracy_daily").select("version, date, day_kind, diff, diff_kg, diff_price").eq("month_outlook_id", id).order("date").order("segment").order("version").range(a, b));
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = `${String(r.version)}|${String(r.day_kind)}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    const tot = dailyTotal;
    daily = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, rs]) => ({ version: k.split("|")[0], kind: k.split("|")[1], days: new Set(rs.map((r) => String(r.date))).size, diff: tot(rs, "diff"), diffKg: tot(rs, "diff_kg"), diffPrice: tot(rs, "diff_price") }));
  }
  const nextMo = must(await sb.from("month_outlook").select("id").eq("month", addDays(last, 1)).maybeSingle(), "month_outlook") as Row | null;
  const cal = nextMo?.id ? mustRows<Row>(await sb.from("assumption_register").select("id, code, name, value_num, status").eq("month_outlook_id", String(nextMo.id)).eq("source", "kalibrasi").is("deleted_at", null).order("code"), "assumption_register") : [];
  const unbilled = (await Promise.all([unbilledOf(sb, firstOfMonth(addDays(first, -1))), unbilledOf(sb, first)])).filter((u) => u.dos > 0);
  return {
    first, last, afterMonthEnd, adjustments, versions, hasFinal: !!fin, preview, accuracy, daily, unbilled,
    calibration: cal.map((r) => ({ id: String(r.id), code: String(r.code), name: String(r.name), value: s(r.value_num), status: String(r.status) })),
  };
}
