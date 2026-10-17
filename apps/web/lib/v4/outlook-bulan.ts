/**
 * Model of the management page "Outlook bulan" (PRD v4 §6.2). Pure: the month's rows of the data mart pl_daily_v4
 * (or the rows frozen in a locked version), the register, the budget, the versions and the accuracy in; one tile list
 * out. Every number is decided by @kgr/engine (monthSummaryV4, vsBudget, versionDaysV4, bridgeV4, accuracyV4); this
 * file places and labels it (K16 Rp jt, U+2212). A tile whose data does not exist says so in words, never as 0.
 * The fixture harness (scripts/v4-fixture.tsx) builds the same model from fixtures/month-2026-08.
 */
import {
  D, Decimal, addDays, bridgeV4, dayName, daysInMonth, isRevenueLine, monthEnd, monthSummaryV4, versionDaysV4, vsBudget,
  type AccuracyLineV4, type BridgeMetric, type BudgetRow, type PlRowV4, type RegisterRow, type VersionDayV4,
} from "@kgr/engine";
import { jtV4, num, pctV4, tgl, tglShort } from "../fmt";
import type { ChartPoint, LinePlot, WaterfallStep } from "@/components/v4/Chart";
import type { Col, TRow } from "@/components/v4/Table";
import { monthsToNegative, type TileModel } from "./minggu-ini";
import type { TilePos } from "@/components/v4/Tile";
import { outlookBulanV5, type OutlookBulanV5 } from "../v5/pl-tiles";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const monthName = (first: string) => `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`;

export interface VersionRow {
  version: string;
  cutOff: string;
  revenue: string | null;
  gp: string | null;
  nibt: string | null;
  lockedAt: string | null;
  sha: string | null;
  /** Days frozen in the snapshot (V1 → V2 bridge). */
  days: VersionDayV4[] | null;
}

export interface AccuracyInput {
  month: string;
  version: string;
  lines: AccuracyLineV4[];
  /** FINAL minus the closing adjustments, per metric (the "before adjustment" columns). */
  poDays: { n: number; diff: string } | null;
  runrateDays: { n: number; diff: string } | null;
  /** PRD v5.1 R38 (§6.5): the fixed-cost estimate the version carried (P&L sign); null = the version had none. */
  fixedOfVersion?: string | null;
}

export interface OutlookBulanInput {
  first: string;
  today: string;
  cutOff: string;
  tolerance: string;
  windowDays: number;
  /** Rows of the month: the live mart, or the rows of the selected locked version. null = not built yet. */
  rows: PlRowV4[] | null;
  base: string;
  months: { first: string; href: string }[];
  budget: BudgetRow[];
  register: RegisterRow[];
  versions: VersionRow[];
  /** Selected version (?versi=); null = the live draft. */
  selected: string | null;
  accuracy: AccuracyInput | null;
  solvency: { label: string; equity: string; paidIn: string; affiliate: string | null; months: string | null; basis?: string | null; cash: string | null } | null;
  on: { m6: boolean };
  pdfHref: string | null;
  /** PRD v5 §4.7 (flag v5_pl): rows with the fixed-cost estimate and the chosen views; absent = the v4 page. */
  v5?: OutlookBulanV5 | null;
}

export interface OutlookBulanModel { title: string; tiles: TileModel[]; hidden: string[] }

const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const tone = (v: Decimal | null | undefined): "neg" | undefined => (v !== null && v !== undefined && v.lt(0) ? "neg" : undefined);
const deltaTone = (v: Decimal | null | undefined): "better" | "worse" | undefined => (v === null || v === undefined || v.isZero() ? undefined : v.gt(0) ? "better" : "worse");
const jtText = (v: Decimal) => `${jtV4(v)} jt`;
const sumRev = (rows: PlRowV4[], date: string, pick: "actual" | "forecast", seg?: (s: string) => boolean) =>
  rows.filter((r) => r.date === date && isRevenueLine(r.pl_line) && (!seg || seg(r.segment))).reduce((a, r) => a.plus(r[pick] ?? 0), D(0));

/** Short name of an assumption for the register tile (the long name stays in the drawer and the PDF). */
function registerLabel(r: RegisterRow, windowDays: number): string {
  if (r.code.startsWith("anomaly_")) return `${tglShort(r.code.slice(8))} anomali`;
  switch (r.code) {
    case "cut_off": return "Cut-off";
    case "runrate_revenue": return `Run-rate ${windowDays} hari`;
    case "runrate_offday": return "Faktor Minggu";
    case "margin_ref": return "Margin acuan";
    case "tolerance": return "Toleransi";
    case "v1_lock": return "Kunci V1";
    case "po_volume": return "Volume PO";
    default: return r.name;
  }
}

function registerValue(r: RegisterRow): string {
  if (r.code.startsWith("anomaly_")) return "anomali";
  const n = r.value_num === null ? null : D(r.value_num);
  switch (r.code) {
    case "cut_off": case "v1_lock": return r.value_text ? tglShort(r.value_text) : "belum diisi";
    case "runrate_revenue": return n ? `${jtV4(n)} jt` : "belum diisi";
    case "runrate_offday": case "margin_ref": return n ? pctV4(n, r.code === "margin_ref" ? 1 : 0) : "belum diisi";
    case "tolerance": return n ? pctV4(n, 0) : "belum diisi";
    case "po_volume": return n ? `${num(n, 0)} kg` : "belum diisi";
    default: return n ? num(n, 2) : r.value_text ?? "belum diisi";
  }
}

const SEG_LABEL = (seg: string) => (seg === "Trading" ? "Trading" : "RPA");

export function outlookBulanModel(x: OutlookBulanInput): OutlookBulanModel {
  const tiles: TileModel[] = [];
  const hidden: string[] = [];
  const first = x.first;
  const name = monthName(first);
  const monthWord = MONTHS[Number(first.slice(5, 7)) - 1];
  const locked = x.versions.filter((v) => v.lockedAt);
  const rank = (v: string) => (v === "FINAL" ? 3 : v === "V2" ? 2 : 1);
  const latest = [...locked].sort((a, b) => rank(b.version) - rank(a.version))[0] ?? null;
  const sel = x.selected ? x.versions.find((v) => v.version === x.selected) ?? null : null;
  const draft = !sel;

  // ---------------------------------------------------------------- row 0: slicer, release
  const label = sel
    ? `${sel.version} dikunci ${tgl(sel.lockedAt?.slice(0, 10))} · cut-off ${tglShort(sel.cutOff)}`
    : latest
      ? `draft terkini · ${latest.version} dikunci ${tgl(latest.lockedAt?.slice(0, 10))}`
      : `belum ada versi terkunci · cut-off ${tglShort(x.cutOff)}`;
  tiles.push({
    id: "slicer-bulan", pos: P(0, 0, 6, 1), kind: "bare",
    content: { type: "slicer", label: "Bulan", current: first, extra: label, options: x.months.map((m) => ({ value: m.first, label: monthName(m.first), href: m.href })) },
  });
  tiles.push({ id: "rilis", pos: P(9, 0, 3, 1), kind: "bare", content: { type: "release", text: `versi aktif: ${sel ? sel.version : "draft"}`, pdfHref: x.pdfHref } });

  if (!x.rows || !x.rows.length) {
    tiles.push({ id: "headline", pos: P(0, 1, 12, 1), kind: "bare", content: { type: "headline", text: `Outlook ${name} belum dibangun: tidak ada baris di data mart untuk bulan ini.` } });
    return { title: `Outlook ${name}`, tiles, hidden: ["c-actual", "c-forecast", "c-outlook", "c-po", "c-budget", "ch-harian", "t-sisa", "ch-kumulatif", "register", "ch-bridge", "t-versi", "akurasi", "solvabilitas"] };
  }

  const rows = x.rows;
  const last = monthEnd(first);
  const cutOff = sel ? sel.cutOff : x.cutOff;
  const sm = monthSummaryV4(rows, first, x.tolerance);
  const gpPct = sm.outlook.revenue.isZero() ? null : sm.outlook.gp.div(sm.outlook.revenue);
  const days = versionDaysV4(rows, first, cutOff);
  const anomalyDates = [...new Set(rows.filter((r) => r.anomaly).map((r) => r.date))].sort();
  const hasOpex = rows.some((r) => !isRevenueLine(r.pl_line) && !r.pl_line.startsWith("COGS") && !r.pl_line.startsWith("Other COGS") && r.forecast !== null);
  const status = sel ? "locked" : "draft";

  // ---------------------------------------------------------------- row 1: headline
  tiles.push({
    id: "headline", pos: P(0, 1, 12, 1), kind: "bare",
    content: {
      type: "headline",
      text: `Revenue ${monthWord} diproyeksikan Rp ${jtV4(sm.outlook.revenue)} jt, GP P&L Rp ${jtV4(sm.outlook.gp)} jt${gpPct ? ` (${pctV4(gpPct)})` : ""}${sm.poShare === null ? "; bulan sudah lengkap" : `; sisa bulan ${pctV4(sm.poShare, 0)} ber-PO`}.`,
    },
  });

  // ---------------------------------------------------------------- rows 2–3: cards
  tiles.push({
    id: "c-actual", pos: P(0, 2, 2, 2), kind: "card", title: `Actual s.d. ${tglShort(cutOff)}`,
    cara: {
      title: "Actual bulan berjalan", fn: "monthSummaryV4 (pl_daily_v4, kolom actual)", rule: "Jurnal harian s.d. cut-off, ditambah DO yang belum difaktur (K11); GP P&L memakai semua akun COGS yang dipetakan (K5).",
      period: `${tgl(first)} s.d. ${tgl(cutOff)}`, basis: "journal, do_unbilled", status, sources: [{ label: "Tabel", value: "pl_daily_v4" }],
    },
    content: { type: "card", value: jtV4(sm.actual.revenue), unit: "Rp jt", compare: [{ label: "GP P&L", value: jtText(sm.actual.gp), tone: tone(sm.actual.gp) }] },
  });
  tiles.push({
    id: "c-forecast", pos: P(2, 2, 2, 2), kind: "card", title: "Forecast sisa bulan",
    cara: {
      title: "Forecast sisa bulan", fn: "monthPlanV4 → monthSummaryV4 (kolom forecast)", rule: "Hari dengan PO: PO berbobot (Confirmed 100%). Hari kerja tanpa PO: run-rate rata-rata revenue hari kerja dalam jendela, tanpa hari anomali (K3). Minggu tanpa pengiriman: 0.",
      period: `${tgl(addDays(cutOff, 1))} s.d. ${tgl(last)}`, basis: "po, runrate", status, sources: [{ label: "Tabel", value: "pl_daily_v4" }],
    },
    content: sm.forecast.revenue.isZero() && sm.remainingDays === 0
      ? { type: "card", value: null, missing: "bulan sudah lengkap", compare: [] }
      : { type: "card", value: jtV4(sm.forecast.revenue), unit: "Rp jt", compare: [{ label: "GP P&L", value: jtText(sm.forecast.gp), tone: tone(sm.forecast.gp) }, { label: "porsi run-rate", value: sm.runrateShare === null ? "tidak ada" : pctV4(sm.runrateShare, 0) }] },
  });
  tiles.push({
    id: "c-outlook", pos: P(4, 2, 3, 2), kind: "card", title: `Outlook ${monthWord}`,
    cara: {
      title: `Outlook ${monthWord}`, fn: "monthSummaryV4", rule: `Actual + forecast. Rentang = ± ${pctV4(x.tolerance, 0)} hanya pada porsi forecast revenue (K9); NIBT = GP P&L dikurangi biaya (tetap, variabel, run-rate, event).`,
      period: `${tgl(first)} s.d. ${tgl(last)}`, basis: "journal, do_unbilled, po, runrate, fixed, variable, event", status, sources: [{ label: "Tabel", value: "pl_daily_v4" }],
    },
    content: {
      type: "card", value: jtV4(sm.outlook.revenue), unit: "Rp jt",
      compare: [
        { label: "rentang", value: `${jtV4(sm.range.revenueLow)}–${jtV4(sm.range.revenueHigh)}` },
        { label: "GP P&L", value: `${jtText(sm.outlook.gp)}${gpPct ? ` (${pctV4(gpPct)})` : ""}`, tone: tone(sm.outlook.gp) },
        { label: "NIBT", value: hasOpex ? jtText(sm.outlook.nibt) : "belum diisi", tone: hasOpex ? tone(sm.outlook.nibt) : undefined },
      ],
    },
  });
  tiles.push({
    id: "c-po", pos: P(7, 2, 2, 2), kind: "card", title: "Sisa bulan ber-PO",
    cara: { title: "Sisa bulan ber-PO", fn: "monthSummaryV4.poShare", rule: "Revenue forecast dari PO ÷ revenue forecast seluruhnya; kg = PO pasti sisa bulan.", period: `${tgl(addDays(cutOff, 1))} s.d. ${tgl(last)}`, basis: "po", status, sources: [{ label: "Tabel", value: "pl_daily_v4" }] },
    content: sm.poShare === null
      ? { type: "card", value: null, missing: "tidak ada sisa bulan", compare: [] }
      : { type: "card", value: pctV4(sm.poShare, 0), compare: [{ label: "kg", value: num(sm.poKg, 0) }] },
  });

  const bud = vsBudget({ outlook: sm.outlook, actual: sm.actual, budget: x.budget, remainingWorkingDays: sm.remainingWorkingDays });
  const line = (m: string) => bud?.lines.find((l) => l.metric === m) ?? null;
  const bRev = line("revenue"), bGp = line("gp"), bNibt = line("nibt");
  tiles.push({
    id: "c-budget", pos: P(9, 2, 3, 2), kind: "card", title: "vs Budget",
    cara: bud ? { title: "vs Budget", fn: "vsBudget", rule: "Selisih = outlook − budget; butuh per hari = (budget − actual) ÷ hari kerja tersisa.", period: tgl(first), basis: "budget", status: "approved", sources: [{ label: "Tabel", value: "budget (versi terbaru)" }] } : undefined,
    content: bud && bRev
      ? {
          type: "card", value: jtV4(bRev.diff), unit: "Rp jt", negative: bRev.diff.lt(0),
          compare: [
            ...(bGp ? [{ label: "selisih GP", value: jtText(bGp.diff), tone: deltaTone(bGp.diff) }] : []),
            ...(bNibt ? [{ label: "selisih NIBT", value: jtText(bNibt.diff), tone: deltaTone(bNibt.diff) }] : []),
            ...(bRev.needPerDay ? [{ label: "butuh per hari", value: jtText(bRev.needPerDay) }] : []),
          ].slice(0, 3),
        }
      : { type: "card", value: null, missing: "budget belum diisi", compare: [] },
  });

  // ---------------------------------------------------------------- rows 4–7: daily chart, remaining days
  const sliceFrom = (() => { const f = addDays(cutOff, 1 - x.windowDays); return f < first ? first : f; })();
  const shown = days.filter((d) => d.date >= sliceFrom);
  const dayBasis = (d: VersionDayV4) => (d.kind === "actual" ? "jurnal" : d.kind === "po" ? "PO" : d.kind === "runrate" ? `run-rate ${x.windowDays} hari` : "tidak ada pengiriman");
  const points: ChartPoint[] = shown.map((d) => {
    const an = anomalyDates.includes(d.date);
    return {
      key: d.date, label: String(Number(d.date.slice(8, 10))), bar: Number(D(d.revenue).div(1e6).toFixed(1)), barText: jtV4(d.revenue),
      barTone: d.kind === "actual" ? "s1" : d.kind === "runrate" ? "s3" : "s2",
      marker: d.date === cutOff ? "cut-off" : undefined,
      title: `${dayName(d.date)} ${tgl(d.date)} · revenue Rp ${jtV4(d.revenue)} jt · basis ${dayBasis(d)}${an ? " · anomali: tanpa jurnal penjualan, dibaca sebagai data hilang, bukan nol" : ""}`,
    };
  });
  tiles.push({
    id: "ch-harian", pos: P(0, 4, 7, 4), kind: "tall", title: `Revenue per hari ${monthWord}: aktual, PO, run-rate`,
    note: anomalyDates.length ? `${anomalyDates.map(tglShort).join(", ")} tanpa jurnal dan tanpa baris penjualan; dikeluarkan dari run-rate sebagai hari anomali.` : undefined,
    content: { type: "combo", points, legend: [{ tone: "s1", label: "aktual (jurnal)" }, { tone: "s2", label: "PO" }, { tone: "s3", label: "run-rate" }] },
  });

  const remaining = days.filter((d) => d.date > cutOff);
  const tCols: Col[] = [{ key: "d", label: "Tanggal", kind: "key" }, { key: "b", label: "Dasar", kind: "sup" }, { key: "r", label: "Revenue", num: true }, { key: "s", label: "Rincian segmen", kind: "sup" }];
  const tRows: TRow[] = remaining.map((d) => {
    const bySeg = new Map<string, Decimal>();
    for (const r of rows.filter((q) => q.date === d.date && isRevenueLine(q.pl_line) && q.forecast !== null)) bySeg.set(SEG_LABEL(r.segment), (bySeg.get(SEG_LABEL(r.segment)) ?? D(0)).plus(r.forecast!));
    return {
      id: d.date,
      cells: { d: `${dayName(d.date).slice(0, 3)} ${Number(d.date.slice(8, 10))} ${tglShort(d.date).split(" ")[1]}`, b: dayBasis(d), r: jtV4(d.revenue), s: [...bySeg].filter(([, v]) => !v.isZero()).map(([k, v]) => `${k} ${jtV4(v)}`).join(" · ") },
    };
  });
  if (tRows.length) tRows.push({ id: "total", kind: "total", cells: { d: "Total", b: "", r: jtV4(sm.forecast.revenue), s: "" } });
  tiles.push({
    id: "t-sisa", pos: P(7, 4, 5, 4), kind: "tall", title: "Hari sisa bulan (Rp jt)",
    content: { type: "table", cols: tCols, rows: tRows, limit: 12 },
  });

  // ---------------------------------------------------------------- rows 8–11: cumulative, register
  const n = daysInMonth(first);
  let cumA = D(0), cumF = D(0);
  const actualCum: (number | null)[] = [], outlookCum: (number | null)[] = [], lowCum: (number | null)[] = [], highCum: (number | null)[] = [], budgetCum: (number | null)[] = [];
  const tol = D(x.tolerance);
  const budgetRev = bud ? x.budget.filter((b) => b.metric === "revenue").reduce((a, b) => a.plus(D(b.value)), D(0)) : null;
  const wdays = days.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() !== 0).length || 1;
  let wdSeen = 0;
  days.forEach((d, i) => {
    const r = D(d.revenue).div(1e6);
    if (new Date(`${d.date}T00:00:00Z`).getUTCDay() !== 0) wdSeen += 1;
    if (d.date <= cutOff) { cumA = cumA.plus(r); actualCum.push(Number(cumA.toFixed(1))); outlookCum.push(i === days.filter((q) => q.date <= cutOff).length - 1 ? Number(cumA.toFixed(1)) : null); lowCum.push(null); highCum.push(null); }
    else {
      cumF = cumF.plus(r); actualCum.push(null);
      const o = cumA.plus(cumF);
      outlookCum.push(Number(o.toFixed(1)));
      lowCum.push(Number(o.minus(cumF.times(tol)).toFixed(1))); highCum.push(Number(o.plus(cumF.times(tol)).toFixed(1)));
    }
    budgetCum.push(budgetRev ? Number(budgetRev.div(1e6).times(wdSeen).div(wdays).toFixed(1)) : null);
  });
  const cutIdx = days.filter((d) => d.date <= cutOff).length - 1;
  const plot: LinePlot = {
    xLabels: days.map((d) => String(Number(d.date.slice(8, 10)))),
    series: [
      { key: "a", tone: "a", points: actualCum },
      { key: "o", tone: "o", dash: true, points: outlookCum },
      ...(budgetRev ? [{ key: "b", tone: "b" as const, dash: true, points: budgetCum }] : []),
    ],
    band: sm.remainingDays > 0 ? { low: lowCum, high: highCum, title: `Band ± ${pctV4(x.tolerance, 0)} pada porsi forecast` } : undefined,
    marks: [
      ...(cutIdx >= 0 ? [{ series: "a", i: cutIdx, text: `MTD ${jtV4(sm.actual.revenue)}`, place: "above" as const }] : []),
      { series: "o", i: n - 1, text: `Outlook ${jtV4(sm.outlook.revenue)}`, place: "above" as const },
      ...(sm.remainingDays > 0 ? [{ series: "o", i: n - 1, text: `${jtV4(sm.range.revenueLow)}–${jtV4(sm.range.revenueHigh)}`, place: "below" as const }] : []),
    ],
    cutIndex: cutIdx >= 0 && cutIdx < n - 1 ? cutIdx : null,
  };
  tiles.push({
    id: "ch-kumulatif", pos: P(0, 8, 8, 4), kind: "tall", title: `Revenue kumulatif ${monthWord}: actual dan outlook`,
    note: sm.remainingDays > 0 ? `Band ±${pctV4(x.tolerance, 0)} hanya pada porsi forecast: ${jtV4(sm.range.revenueLow)}–${jtV4(sm.range.revenueHigh)} jt.${budgetRev ? " Garis budget dibagi rata per hari kerja." : ""}` : undefined,
    cara: {
      title: "Revenue kumulatif", fn: "versionDaysV4 + monthSummaryV4.range", rule: "Jumlah berjalan revenue harian: jurnal s.d. cut-off, sesudahnya PO atau run-rate. Band = ± toleransi × jumlah forecast berjalan.",
      period: `${tgl(first)} s.d. ${tgl(last)}`, basis: "journal, do_unbilled, po, runrate", status, sources: [{ label: "Tabel", value: "pl_daily_v4" }, ...(budgetRev ? [{ label: "Budget", value: "tabel budget, dibagi rata per hari kerja" }] : [])],
    },
    content: { type: "line", plot, legend: [{ tone: "s1", label: "actual" }, { tone: "s2", label: "outlook" }, ...(budgetRev ? [{ tone: "s3" as const, label: "budget" }] : [])] },
  });

  const reg = x.register.filter((r) => r.status !== "superseded");
  const open = reg.filter((r) => r.status !== "agreed" || !r.agreed_at);
  const openFirst = [...reg].sort((a, b) => Number(b.status !== "agreed") - Number(a.status !== "agreed"));
  const rCols: Col[] = [{ key: "a", label: "Asumsi", kind: "key", wrap: true }, { key: "v", label: "Nilai", num: true }, { key: "o", label: "Pemilik", kind: "sup", wrap: true }, { key: "s", label: "Disepakati", kind: "sup" }];
  tiles.push({
    id: "register", pos: P(8, 8, 4, 4), kind: "tall", title: "Register asumsi",
    note: open.length ? `${open.length} dari ${reg.length} belum disepakati; versi tidak bisa dikunci sebelum disepakati.` : undefined,
    content: {
      type: "table", cols: rCols, limit: 5,
      rows: openFirst.map((r) => ({ id: r.code, cells: { a: registerLabel(r, x.windowDays), v: registerValue(r), o: r.owner ?? "belum diisi", s: r.status === "agreed" && r.agreed_at ? tglShort(r.agreed_at.slice(0, 10)) : "belum" } })),
    },
  });

  // ---------------------------------------------------------------- rows 12–15: bridge, versions
  const v1 = x.versions.find((v) => v.version === "V1"), v2 = x.versions.find((v) => v.version === "V2");
  if (v1?.days && v2?.days) {
    const b = bridgeV4(v1.days, v2.days);
    const g = b.gp;
    const STEP = (code: string, label: string, v: Decimal, kind: "total" | "delta", title: string): WaterfallStep => ({ key: code, label, value: Number(v.div(1e6).toFixed(1)), valueText: jtV4(v), kind, title });
    const steps: WaterfallStep[] = [
      STEP("v1", "GP V1", g.from, "total", "GP P&L V1"),
      STEP("actual", "Δ actual", g.dActual, "delta", "hari forecast V1 yang sudah terjadi, menurut jurnal"),
      STEP("volume", "Δ volume", g.dVolume, "delta", "kg PO berubah, pada harga V1"),
      STEP("price", "Δ harga", g.dPrice, "delta", "harga per kg berubah"),
      STEP("cost", "Δ cost", g.dCost, "delta", "HPP dan biaya berubah"),
      STEP("event", "Δ event", g.dEvent, "delta", "asumsi berubah (cost_event, run-rate)"),
      STEP("v2", "GP V2", g.to, "total", "GP P&L V2"),
    ].filter((s) => s.kind === "total" || !D(s.value).isZero() || s.key === "actual");
    const rv: BridgeMetric = b.revenue;
    tiles.push({
      id: "ch-bridge", pos: P(0, 12, 7, 4), kind: "tall", title: "Dari V1 ke V2: GP P&L",
      note: `Revenue V1 ${jtV4(rv.from)} → V2 ${jtV4(rv.to)} jt; selisih tak terjelaskan ${jtV4(g.residual)} jt.`,
      cara: { title: "Dari V1 ke V2", fn: "bridgeV4", rule: "V2 − V1 dipecah menjadi Δ actual (hari yang sudah terjadi), volume, harga, cost dan event; sisa harus 0 (C32).", period: monthName(first), basis: "snapshot V1, V2", status: "locked", sources: [{ label: "Tabel", value: "month_outlook_version" }] },
      content: { type: "waterfall", steps },
    });
  } else {
    tiles.push({ id: "ch-bridge", pos: P(0, 12, 7, 4), kind: "tall", title: "Dari V1 ke V2", content: { type: "list", items: ["V2 belum ada."] } });
  }

  const vCols: Col[] = [{ key: "v", label: "Versi", kind: "key" }, { key: "c", label: "Cut-off" }, { key: "r", label: "Revenue", num: true }, { key: "g", label: "GP", num: true }, { key: "n", label: "NIBT", num: true }, { key: "l", label: "Dikunci", kind: "sup" }];
  const vRows: TRow[] = x.versions.length
    ? x.versions.map((v) => ({
        id: v.version, on: sel?.version === v.version, href: `${x.base}?versi=${v.version}`,
        cells: { v: v.version, c: tglShort(v.cutOff), r: v.revenue === null ? "belum diisi" : jtV4(v.revenue), g: v.gp === null ? "belum diisi" : jtV4(v.gp), n: v.nibt === null ? "belum diisi" : jtV4(v.nibt), l: v.lockedAt ? tglShort(v.lockedAt.slice(0, 10)) : "" },
      }))
    : [{ id: "none", cells: { v: "belum ada versi terkunci", c: "", r: "", g: "", n: "", l: "" } }];
  tiles.push({
    id: "t-versi", pos: P(7, 12, 5, 4), kind: "tall", title: "Versi",
    note: sel ? `Menampilkan ${sel.version}. Pilih draft di bawah untuk angka terkini.` : undefined,
    content: { type: "table", cols: vCols, rows: vRows },
  });

  // ---------------------------------------------------------------- rows 16–18: accuracy, solvency
  if (x.accuracy) {
    const a = x.accuracy;
    const rev = a.lines.find((l) => l.metric === "revenue") ?? null;
    const diff = (l: AccuracyLineV4) => `${jtV4(l.absError)}${l.pctOfVersion ? ` (${pctV4(l.pctOfVersion.abs())})` : ""}`;
    const aCols: Col[] = [{ key: "k", label: "", kind: "key" }, { key: "v", label: a.version, num: true }, { key: "f", label: "FINAL", num: true }, { key: "d", label: "Selisih", num: true }];
    // PRD v5.1 R38 (§6.5, flag v5_pl): NIBT by the journal and NIBT with the fixed-cost estimate of the version, both
    // against the FINAL (the closed statements carry every fixed cost)
    const LBL: Record<string, string> = { revenue: "Revenue", gp: "GP P&L", nibt: x.v5 ? "NIBT jurnal" : "NIBT" };
    const nibtLine = a.lines.find((l) => l.metric === "nibt") ?? null;
    const withFixed = x.v5 && nibtLine ? (() => {
      if (a.fixedOfVersion === null || a.fixedOfVersion === undefined) return { id: "nibt-fixed", cells: { k: "NIBT + beban tetap", v: "belum ada", f: jtV4(nibtLine.final), d: "" } };
      const v = nibtLine.value.plus(D(a.fixedOfVersion)), e = v.minus(nibtLine.final);
      return { id: "nibt-fixed", cells: { k: "NIBT + beban tetap", v: jtV4(v), f: jtV4(nibtLine.final), d: `${jtV4(e.abs())}${v.isZero() ? "" : ` (${pctV4(nibtLine.final.minus(v).div(v.abs()).abs())})`}` } };
    })() : null;
    const aRows: TRow[] = [
      // a metric the version did not carry (e.g. NIBT of a version locked without the cost plan) is left out, not shown as 0
      ...(["revenue", "gp", "nibt"] as const).map((m) => a.lines.find((l) => l.metric === m)).filter((l): l is AccuracyLineV4 => !!l)
        .map((l) => ({ id: l.metric, cells: { k: LBL[l.metric], v: jtV4(l.value), f: jtV4(l.final), d: diff(l) } })),
      ...(withFixed ? [withFixed] : []),
      ...(rev ? [{ id: "mape", cells: { k: "MAPE revenue", v: "", f: "", d: rev.mape ? pctV4(rev.mape) : "tidak berlaku" } }] : []),
      ...(rev ? [{ id: "pre", cells: { k: "Selisih revenue sebelum penyesuaian", v: "", f: "", d: jtV4(rev.absErrorPre) } }] : []),
      ...(a.poDays || a.runrateDays ? [{ id: "kind", cells: { k: "Hari PO / hari run-rate", v: "", f: "", d: `${a.poDays ? jtV4(a.poDays.diff) : "belum ada"} / ${a.runrateDays ? jtV4(a.runrateDays.diff) : "belum ada"}` } }] : []),
    ];
    tiles.push({
      id: "akurasi", pos: P(0, 16, 6, 3), title: "Akurasi bulan terakhir yang FINAL",
      note: `${monthName(a.month)}, ${a.version} terhadap FINAL; persen di kolom selisih terhadap ${a.version}.`,
      cara: { title: "Akurasi", fn: "accuracyV4", rule: "Selisih mutlak versi terhadap FINAL; MAPE = |selisih| ÷ FINAL (hanya revenue); sebelum penyesuaian = FINAL dikurangi penyesuaian tutup buku. Persen di kolom selisih terhadap versi.", period: monthName(a.month), basis: "snapshot versi, FINAL", status: "locked", sources: [{ label: "Tabel", value: "month_outlook_version, closing_adjustment" }] },
      content: { type: "table", cols: aCols, rows: aRows },
    });
  } else {
    tiles.push({ id: "akurasi", pos: P(0, 16, 6, 3), title: "Akurasi bulan terakhir yang FINAL", content: { type: "list", items: ["Belum ada bulan yang FINAL."] } });
  }

  if (x.on.m6 && x.solvency) {
    const s = x.solvency;
    const interest = rows.filter((r) => r.pl_line === "Interest Expense").reduce((a, r) => a.plus(r.actual ?? 0).plus(r.forecast ?? 0), D(0));
    const hasInterest = rows.some((r) => r.pl_line === "Interest Expense");
    const sCols: Col[] = [{ key: "k", label: "", kind: "key" }, { key: "v", label: "Rp jt", num: true }];
    const sRows: TRow[] = [
      { id: "eq", cells: { k: `Ekuitas (${pctV4(D(s.equity).div(D(s.paidIn)), 0)} modal disetor)`, v: jtV4(s.equity) } },
      { id: "af", cells: { k: "Utang pihak berelasi", v: s.affiliate === null ? "belum ada" : jtV4(s.affiliate) } },
      { id: "bg", cells: { k: `Bunga ${monthWord}`, v: hasInterest ? jtV4(interest.neg()) : "belum diisi" } },
      { id: "kas", cells: { k: "Kas", v: s.cash === null ? "belum diisi" : jtV4(s.cash) } },
      { id: "bn", cells: { k: "Bulan sampai ekuitas negatif", v: monthsToNegative(s.months, s.basis) } },
    ];
    tiles.push({ id: "solvabilitas", pos: P(6, 16, 6, 3), title: `Solvabilitas ${s.label}`, content: { type: "table", cols: sCols, rows: sRows } });
  } else hidden.push("solvabilitas");

  return { title: `Outlook ${name}`, tiles: x.v5 ? outlookBulanV5(tiles, { first, cutOff, tolerance: x.tolerance, budget: x.budget, status, v5: x.v5 }) : tiles, hidden };
}
