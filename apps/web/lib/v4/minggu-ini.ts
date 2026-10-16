/**
 * Model of the management page "Minggu ini" (PRD v4 §6.1). Pure: the computed week (weekly engine, blocks 1/3/4/6/7,
 * P&L, cash flow), the data mart rows the loader read, and the page state in; one tile list out. Every number is
 * decided by @kgr/engine (weekOutlook, gpBridge, weekHeadline, weekCash, stockOverAge …); this file only places and
 * labels it (K16 Rp jt, U+2212). A tile whose module is off is left out (not "tidak tersedia"); t-input and t-cogs
 * always come from the weekly engine. The fixture harness (scripts/v4-fixture.tsx) builds the same model.
 */
import {
  D, Decimal, addDays, cogsBySegment, dayName, gpBridge, inputSummary, stockAgeBuckets, stockOverAge, weekCash, weekHeadline, weekOutlook,
  type AgeBucketRow, type ControlV3, type PlRowV4, type RollForward, type WeekOutlook, type WeekResult,
} from "@kgr/engine";
import { jtV4, num, pctV4, rpJt, tgl, tglShort } from "../fmt";
import type { CardCompare } from "@/components/v4/Card";
import type { ChartPoint, LinePlot, PairGroup, StackRow, WaterfallStep } from "@/components/v4/Chart";
import type { Col, TRow } from "@/components/v4/Table";
import type { SlicerOption, StepDef } from "@/components/v4/Controls";
import type { CaraHitungContent } from "@/components/v4/CaraHitung";
import type { TilePos } from "@/components/v4/Tile";
import { mingguIniV5, type MingguIniV5Pl } from "../v5/pl-tiles";
import { managementV5, type ManagementV5Input } from "../v5/management";

export type TileContent =
  | { type: "slicer"; label: string; options: SlicerOption[]; current: string | null; extra?: string }
  | { type: "mode"; label: string; options: [SlicerOption, SlicerOption]; current: string }
  | { type: "release"; text: string; pdfHref: string | null }
  | { type: "headline"; text: string }
  | { type: "card"; value: string | null; unit?: string; negative?: boolean; missing?: string; compare: CardCompare[]; href?: string; maxCompare?: number }
  | { type: "combo"; points: ChartPoint[]; labelMax?: number; legend: { tone: "s1" | "s2" | "s3" | "ln"; label: string }[] }
  | { type: "line"; plot: LinePlot; legend: { tone: "s1" | "s2" | "s3" | "ln"; label: string }[] }
  | { type: "waterfall"; steps: WaterfallStep[] }
  | { type: "paired"; groups: PairGroup[]; legend: { tone: "s1" | "s2" | "s3" | "ln"; label: string }[] }
  | { type: "stacked"; rows: StackRow[]; legend: { tone: "s1" | "s2" | "s3" | "ln"; label: string }[]; table: { cols: Col[]; rows: TRow[] } }
  | { type: "table"; cols: Col[]; rows: TRow[]; limit?: number; form?: TileForm; sections?: { title: string; cols: Col[]; rows: TRow[] }[] }
  | { type: "chart+table"; points: ChartPoint[]; legend: { tone: "s1" | "s2" | "s3" | "ln"; label: string }[]; cols: Col[]; rows: TRow[] }
  | { type: "list"; items: string[]; ordered?: boolean; empty?: string }
  | { type: "stepper"; steps: StepDef[]; current: number }
  /** The body comes from the page (TilePage `extras`), e.g. a client component. */
  | { type: "slot" }
  /** Small figures over a table (PRD v5 §6.1 live-bird simulation): choices as links, four values, rows, a closing line. */
  | { type: "kpis"; controls?: { label: string; options: SlicerOption[]; current: string }[]; items: { label: string; value: string; sub: string; negative?: boolean }[]; cols?: Col[]; rows?: TRow[]; foot?: string };

/** A plain GET form inside a tile (what-if inputs): no client code, the page reads the query string. */
export interface TileForm { method: "get"; action: string; submit: string; fields: { name: string; label: string; value: string; size?: number }[] }

export interface TileModel {
  id: string;
  pos: TilePos;
  title?: string;
  note?: string;
  /** K36: source label of the main number, after the note; in the negative colour when its input is past its deadline. */
  source?: { text: string; late: boolean };
  kind?: "card" | "tall" | "bare";
  cara?: CaraHitungContent;
  /** Choices in the tile header (links; the page reads the query string), e.g. "Actual vs run-rate / Per minggu". */
  views?: { label: string; options: SlicerOption[]; current: string }[];
  content: TileContent;
}

export interface MingguIniModel {
  title: string;
  week: string;
  tiles: TileModel[];
  /** Tiles left out because their module is off (for the evidence, never rendered). */
  hidden: string[];
}

export interface StockMart {
  date: string;
  keys: { key: string; over_age_kg: string | null; cost_per_kg_ma: string | null }[];
  lots: { key: string; kg: string; age_days: number | null; cost_per_kg_ma: string | null }[];
  /** Extra columns for the 7-SKU table (orders rest of week, reference price), by key. */
  info?: Record<string, { ordersRest?: string | null; refPrice?: string | null }>;
}

export interface MingguIniInput {
  r: WeekResult;
  week: { start: string; end: string; update: string; status: string };
  weeks: { start: string; end: string; status: string }[];
  base: string;
  release: { releasedAt: string | null; counts: Partial<Record<string, number>> | null } | null;
  mode: "aktual" | "proyeksi";
  hari: string | null;
  segmen: string | null;
  sku: string | null;
  on: { m1: boolean; m2: boolean; m3: boolean; m4: boolean; m6: boolean };
  /** pl_daily_v4 rows of the week (flag v4_design); null = not built yet. */
  plRows: PlRowV4[] | null;
  lastWeek: WeekOutlook["lastWeek"];
  stock: StockMart | null;
  /** cash_position_daily (M6) for the 7 days; null = use the weekly cash flow. */
  cashMart: { date: string; closing: string | null; planned: boolean }[] | null;
  month: { label: string; revenue: string; gp: string; gpPct: string | null; budgetRevenue: string | null; budgetGp: string | null } | null;
  solvency: { label: string; equity: string; paidIn: string; affiliate: string; months: string | null; interest: string | null } | null;
  demand: { confirmed: string; tentative: string; forecast: string; weighted: string; fromStock: string; net: string; heads: number | null; planHeads: number | null; variance: string | null } | null;
  groups: { group: string; cogsPerKg: string | null }[] | null;
  roll: RollForward | null;
  controlsV3: ControlV3[];
  pdfHref: string | null;
  /** PRD v5 §4.7 (flag v5_pl): the month's rows with the fixed-cost estimate for the P&L tile; absent = v4. */
  v5Pl?: MingguIniV5Pl | null;
  /** PRD v5 §6.1 (flag v5_management): LB simulation, decisions, loop status, source labels; absent = v4 / v5_pl. */
  v5Mgmt?: ManagementV5Input | null;
}

const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const jtOrNull = (v: Decimal | string | null | undefined) => (v === null || v === undefined ? null : `Rp ${jtV4(v)} jt`);
const tone = (v: Decimal | string | null | undefined): "neg" | undefined => (v !== null && v !== undefined && D(v).lt(0) ? "neg" : undefined);
const deltaTone = (v: Decimal | null | undefined): "better" | "worse" | undefined => (v === null || v === undefined || v.isZero() ? undefined : v.gt(0) ? "better" : "worse");
const cell = (v: Decimal | string | null | undefined, missing = "belum diisi") => (v === null || v === undefined ? missing : jtV4(v));
const rpkg = (v: Decimal | string | null | undefined) => (v === null || v === undefined ? "belum diisi" : num(v, 0));
const ddmm = (d: string) => `${dayName(d).slice(0, 3)} ${Number(d.slice(8, 10))}`;

export function mingguIniModel(x: MingguIniInput): MingguIniModel {
  const r = x.r;
  const today = r.week.today;
  const tiles: TileModel[] = [];
  const hidden: string[] = [];
  const q = (patch: Record<string, string | null>) => {
    const cur: Record<string, string | null> = { mode: x.mode === "proyeksi" ? null : x.mode, hari: x.hari, segmen: x.segmen, sku: x.sku };
    const all = { ...cur, ...patch };
    const s = Object.entries(all).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
    return `${x.base}${s ? `?${s}` : ""}`;
  };
  const weekLabel = (s: string, e: string) => `${Number(s.slice(8, 10))}–${tglShort(e)}`;

  // ---------------------------------------------------------------- row 0: slicer, mode, release
  tiles.push({
    id: "slicer-minggu", pos: P(0, 0, 6, 1), kind: "bare",
    content: { type: "slicer", label: "Minggu", current: x.week.start, options: x.weeks.slice(0, 6).map((w) => ({ value: w.start, label: weekLabel(w.start, w.end), href: x.base.replace(x.week.start, w.start) })) },
  });
  tiles.push({
    id: "mode", pos: P(6, 0, 3, 1), kind: "bare",
    content: { type: "mode", label: "Tampilan", current: x.mode, options: [{ value: "aktual", label: "Aktual s.d. kemarin", href: q({ mode: "aktual" }) }, { value: "proyeksi", label: "Proyeksi minggu", href: q({ mode: null }) }] },
  });
  const c = r.controls;
  const counts = x.release?.counts ?? c.counts;
  const total = Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
  const relText = x.release?.releasedAt
    ? `Rilis ${tgl(x.release.releasedAt.slice(0, 10))} · ${counts.LULUS ?? 0}/${total} kontrol lulus${counts["BELUM DIISI"] ? ` · ${counts["BELUM DIISI"]} belum diisi` : ""}`
    : `Belum dirilis, angka draft · ${counts.LULUS ?? 0}/${total} kontrol lulus${counts["BELUM DIISI"] ? ` · ${counts["BELUM DIISI"]} belum diisi` : ""}`;
  tiles.push({ id: "rilis", pos: P(9, 0, 3, 1), kind: "bare", content: { type: "release", text: relText, pdfHref: x.pdfHref } });

  // ---------------------------------------------------------------- engine numbers
  const wo = x.plRows ? weekOutlook(x.plRows, { weekStart: r.week.weekStart, today }, x.lastWeek) : null;
  const total1 = r.block1.find((b) => b.segment === "TOTAL KGR")!;
  const cash = weekCash(r);
  const stockFallback = r.block4.find((b) => b.status === "PERHATIAN") ?? null;
  const over = x.on.m2 && x.stock ? stockOverAge(x.stock.keys) : null;
  const stockValue = over ? over.value : stockFallback ? stockFallback.value : null;
  const cashLowest = x.on.m6 && x.cashMart ? lowestOf(x.cashMart) : { date: cash.lowest.date, balance: cash.lowest.balance, average: cash.average };

  const headline = weekHeadline({
    outlook: wo, segments: r.block1.map((s) => ({ segment: s.segment, gpProjection: s.gpProjection })),
    stockOverAge: stockValue, cash: cashLowest ? { lowest: cashLowest.balance, lowestDate: cashLowest.date, average: cashLowest.average } : null,
  });
  if (headline) tiles.push({ id: "headline", pos: P(0, 1, 12, 1), kind: "bare", content: { type: "headline", text: headline } });
  else hidden.push("headline");

  // ---------------------------------------------------------------- row 2–3: five cards
  if (wo) {
    tiles.push({
      id: "c-outlook", pos: P(0, 2, 3, 2), kind: "card", title: "Outlook minggu",
      cara: {
        title: "Outlook minggu", fn: "weekOutlook(pl_daily_v4, minggu)",
        rule: "Revenue dan GP P&L = jurnal s.d. kemarin + PO sisa minggu + run-rate biaya; GP P&L memakai semua akun COGS yang dipetakan (K5).",
        period: `${tgl(r.week.weekStart)} s.d. ${tgl(r.week.weekEnd)}, cut-off ${tgl(addDays(today, -1))}`, basis: "journal, po, runrate",
        status: x.release?.releasedAt ? "released" : "draft",
        sources: [{ label: "Tabel", value: "pl_daily_v4 (7 hari)" }, { label: "Minggu lalu", value: x.lastWeek ? (x.lastWeek.basis === "rilis" ? "snapshot rilis minggu lalu" : "jurnal minggu lalu") : "belum ada" }],
      },
      content: {
        type: "card", value: jtV4(wo.projection.revenue), unit: "Rp jt",
        compare: [
          { label: "GP P&L", value: `${jtV4(wo.projection.gp)} jt (${pctV4(wo.gpPct)})`, tone: tone(wo.projection.gp) },
          { label: "Sisa minggu ber-PO", value: wo.poShare === null ? "tidak ada forecast" : pctV4(wo.poShare, 0) },
          { label: "Δ GP vs minggu lalu", value: wo.deltaGp === null ? "minggu lalu belum ada" : `${jtV4(wo.deltaGp)} jt`, tone: deltaTone(wo.deltaGp) },
        ],
      },
    });
  } else hidden.push("c-outlook");

  if (stockValue !== null) {
    const kg = over ? over.kg : stockFallback!.kgToday;
    const skus = over ? over.skus : stockFallback!.keys;
    tiles.push({
      id: "c-stok", pos: P(3, 2, 2, 2), kind: "card", title: "Stok di atas batas umur",
      cara: {
        title: "Stok di atas batas umur", fn: over ? "stockOverAge(sku_balance_daily)" : "stockActions (blok 4 PERHATIAN)",
        rule: over ? "kg di atas batas umur × biaya rata-rata (MA) per SKU" : "stok hari ini dengan umur rata-rata di atas batas umur parameter × biaya rata-rata stok",
        period: tgl(over ? x.stock!.date : addDays(today, -1)), basis: "stok", sources: [{ label: "Tabel", value: over ? "sku_balance_daily" : "engine mingguan (stok per key)" }],
      },
      content: { type: "card", value: jtV4(stockValue), unit: "Rp jt", compare: [{ label: "kg", value: num(kg, 1) }, { label: "SKU", value: String(skus) }], href: x.on.m2 ? "/sku" : `/w/${x.week.start}/stok` },
    });
  } else hidden.push("c-stok");

  tiles.push({
    id: "c-kas", pos: P(5, 2, 2, 2), kind: "card", title: "Kas terendah minggu ini",
    cara: {
      title: "Kas terendah minggu ini", fn: x.on.m6 && x.cashMart ? "cash_position_daily" : "weekCash (arus kas langsung mingguan)",
      rule: "saldo akhir hari terendah dari tujuh hari minggu ini; tanpa pinjaman afiliasi = saldo itu dikurangi pinjaman afiliasi yang masuk sampai hari itu",
      period: `${tgl(r.week.weekStart)} s.d. ${tgl(r.week.weekEnd)}`, basis: "aktual s.d. kemarin, rencana sesudahnya",
      sources: [{ label: "Tabel", value: x.on.m6 && x.cashMart ? "cash_position_daily" : "arus kas mingguan (rencana kas, jurnal kas)" }],
    },
    content: {
      type: "card", value: cashLowest ? jtV4(cashLowest.balance) : null, unit: "Rp jt", negative: cashLowest ? cashLowest.balance.lt(0) : false,
      compare: cashLowest ? [
        { label: "hari", value: `${dayName(cashLowest.date)} ${tglShort(cashLowest.date)}` },
        ...(x.on.m6 && x.cashMart ? [] : [{ label: "tanpa afiliasi", value: `${jtV4(cash.lowestWithoutAffiliate)} jt`, tone: tone(cash.lowestWithoutAffiliate) } as CardCompare]),
      ] : [],
      href: x.on.m6 ? "/kas" : `/w/${x.week.start}/arus-kas`,
    },
  });

  if (x.on.m4 && x.month) {
    tiles.push({
      id: "c-bulan", pos: P(7, 2, 2, 2), kind: "card", title: `Outlook ${x.month.label}`,
      content: {
        type: "card", value: jtV4(x.month.revenue), unit: "Rp jt",
        compare: [
          { label: "GP P&L", value: `${jtV4(x.month.gp)} jt${x.month.gpPct ? ` (${pctV4(x.month.gpPct)})` : ""}`, tone: tone(x.month.gp) },
          { label: "vs budget", value: x.month.budgetRevenue === null ? "belum diisi" : `${jtV4(D(x.month.revenue).minus(D(x.month.budgetRevenue)))} jt`, tone: x.month.budgetRevenue === null ? undefined : deltaTone(D(x.month.revenue).minus(D(x.month.budgetRevenue))) },
        ],
        href: `/m/${x.week.update.slice(0, 7)}`,
      },
    });
  } else hidden.push("c-bulan");

  if (x.on.m6 && x.solvency) {
    const s = x.solvency;
    tiles.push({
      id: "c-solvabilitas", pos: P(9, 2, 3, 2), kind: "card", title: "Solvabilitas",
      content: {
        type: "card", value: jtV4(s.equity), unit: "Rp jt", negative: D(s.equity).lt(0),
        compare: [
          { label: "ekuitas / modal disetor", value: pctV4(D(s.equity).div(D(s.paidIn)), 0) },
          { label: "utang pihak berelasi", value: `${jtV4(s.affiliate)} jt` },
          { label: "bulan sampai ekuitas negatif", value: s.months === null ? "tidak berlaku (laba)" : num(s.months, 1) },
        ],
        href: "/kas",
      },
    });
  } else hidden.push("c-solvabilitas");

  // ---------------------------------------------------------------- rows 4–7: daily chart, bridge
  if (wo) {
    const showActualOnly = x.mode === "aktual";
    const points: ChartPoint[] = wo.days.map((d) => {
      const forecast = d.kind !== "actual";
      const hide = showActualOnly && forecast;
      const basis = d.kind === "actual" ? "jurnal" : d.kind === "po" ? "PO" : d.kind === "runrate" ? "run-rate" : "tidak ada pengiriman";
      return {
        key: d.date, label: ddmm(d.date), bar: hide ? null : Number(d.revenue.div(1e6).toFixed(1)), barText: hide ? undefined : jtV4(d.revenue),
        barTone: forecast ? "s2" : "s1", line: hide || (d.kind === "none" && d.gp.isZero()) ? null : Number(d.gp.div(1e6).toFixed(1)), lineText: hide ? undefined : jtV4(d.gp),
        href: q({ hari: x.hari === d.date ? null : d.date }), selected: x.hari === d.date,
        title: `${dayName(d.date)} ${tgl(d.date)} · revenue Rp ${jtV4(d.revenue)} jt · GP P&L Rp ${jtV4(d.gp)} jt · basis ${basis}`,
      };
    });
    const missingDays = wo.days.filter((d) => d.kind === "actual" && d.revenue.isZero() && dayName(d.date) !== "Minggu");
    tiles.push({
      id: "ch-harian", pos: P(0, 4, 7, 4), kind: "tall", title: "Revenue dan GP P&L per hari Sen–Min",
      note: missingDays.length ? `${missingDays.map((d) => `${dayName(d.date)} ${tglShort(d.date)}`).join(", ")} tanpa jurnal penjualan; dibaca sebagai data hilang, bukan nol, sampai Sales dan Finance memastikan.` : undefined,
      content: { type: "combo", points, legend: [{ tone: "s1", label: "aktual (jurnal)" }, { tone: "s2", label: "PO / run-rate" }, { tone: "ln", label: "GP P&L" }] },
    });
    const b = gpBridge({ revenueProduk: total1.revenueProjection, gpProduk: total1.gpProjection, rows: x.plRows!, week: { weekStart: r.week.weekStart, today } });
    const steps = b.steps.filter((s) => s.code !== "cogs_other" || !s.value.isZero()).filter((s) => s.code !== "residual" || s.value.abs().gt(1));
    const SHORT: Record<string, string> = { gp_produk: "GP produk", timing: "Timing faktur", cogs_mapping: "COGS vs HPP", expedition: "Ekspedisi", blasting: "Blasting", cogs_other: "COGS lain", residual: "Belum terjelaskan", gp_pl: "GP P&L" };
    tiles.push({
      id: "ch-bridge", pos: P(7, 4, 5, 4), kind: "tall", title: "Dari GP produk ke GP P&L",
      note: b.reconciled ? `Selisih ${jtV4(b.steps.find((s) => s.code === "timing")!.value)} jt dari timing faktur; ekspedisi dan blasting tidak ada di HPP per key.` : `Belum rekonsiliasi: sisa ${jtV4(b.residual)} jt tidak terjelaskan.`,
      cara: { title: "GP produk ke GP P&L", fn: "gpBridge", rule: b.steps.map((s) => `${s.label}: ${s.rule}`).join(". "), sources: [{ label: "Tabel", value: "blok 1 (TOTAL KGR), pl_daily_v4" }], period: `${tgl(r.week.weekStart)} s.d. ${tgl(r.week.weekEnd)}` },
      content: { type: "waterfall", steps: steps.map((s) => ({ key: s.code, label: SHORT[s.code] ?? s.label, value: Number(s.value.div(1e6).toFixed(1)), valueText: jtV4(s.value), kind: s.code === "gp_produk" || s.code === "gp_pl" ? "total" : "delta", title: s.rule })) },
    });
  } else hidden.push("ch-harian", "ch-bridge");

  // ---------------------------------------------------------------- rows 8–11: segment table, COGS/kg
  const segs = r.block1;
  const b6 = r.block6.rows.find((x) => x.status === "Aktual") ?? null;
  const dayRows = x.hari && x.plRows ? daySegments(x.plRows, x.hari, today) : null;
  const segCols: Col[] = x.mode === "aktual"
    ? [{ key: "seg", label: "Segmen", kind: "key" }, { key: "kg", label: "kg aktual", num: true }, { key: "rev", label: "Revenue aktual", num: true }, { key: "gp", label: "GP aktual", num: true, kind: "key" }, { key: "pct", label: "GP %", num: true }, { key: "lw", label: "GP/kg lalu", num: true, kind: "sup" }]
    : [{ key: "seg", label: "Segmen", kind: "key" }, { key: "kg", label: "kg", num: true }, { key: "rev", label: "Revenue", num: true }, { key: "gpa", label: "GP aktual", num: true, kind: "sup" }, { key: "gpo", label: "GP order", num: true, kind: "sup" }, { key: "gp", label: "GP produk", num: true, kind: "key" }, { key: "pct", label: "GP %", num: true }, { key: "lw", label: "GP/kg lalu", num: true, kind: "sup" }, { key: "d", label: "Δ GP/kg", num: true }];
  const segRows: TRow[] = [];
  for (const s of segs) {
    const isTot = s.segment === "TOTAL KGR";
    const cells = x.mode === "aktual"
      ? { seg: s.segment === "TOTAL KGR" ? "Total" : s.segment, kg: num(s.kgActual, 0), rev: jtV4(s.revenueActual), gp: jtV4(s.gpActual), pct: s.revenueActual.isZero() ? "—" : pctV4(s.gpActual.div(s.revenueActual)), lw: rpkg(s.gpPerKgLastWeek) }
      : { seg: s.segment === "TOTAL KGR" ? "Total" : s.segment, kg: num(s.kgProjection, 0), rev: jtV4(s.revenueProjection), gpa: jtV4(s.gpActual), gpo: jtV4(s.gpOrder), gp: jtV4(s.gpProjection), pct: pctV4(s.gpPct), lw: rpkg(s.gpPerKgLastWeek), d: num(s.deltaGpPerKg, 0) };
    segRows.push({ id: s.segment, cells, kind: isTot ? "total" : undefined, href: isTot ? undefined : q({ segmen: x.segmen === s.segment ? null : s.segment }), on: x.segmen === s.segment });
    if (s.segment === "RPA" && b6) segRows.push({ id: "rpa-trigger", kind: "sub", span: true, cells: { seg: `harga LB rata-rata ${rpkg(b6.avgLbPrice)} vs breakeven ${rpkg(b6.breakevenLb)} Rp/kg` } });
  }
  tiles.push({
    id: "t-segmen", pos: P(0, 8, 7, 4), kind: "tall", title: dayRows ? `Segmen pada ${dayName(x.hari!)} ${tglShort(x.hari!)} (Rp jt)` : x.mode === "aktual" ? "GP produk per segmen, aktual s.d. kemarin (Rp jt)" : "GP produk per segmen, proyeksi minggu (Rp jt)",
    note: dayRows ? undefined : worstSegmentNote(segs),
    content: dayRows
      ? { type: "table", cols: [{ key: "seg", label: "Segmen", kind: "key" }, { key: "rev", label: "Revenue", num: true }, { key: "gp", label: "GP P&L", num: true, kind: "key" }], rows: dayRows.map((d) => ({ id: d.segment, cells: { seg: d.segment, rev: jtV4(d.revenue), gp: jtV4(d.gp) } })) }
      : { type: "table", cols: segCols, rows: segRows },
  });

  const cogs = cogsBySegment(r).filter((s) => s.segment === "RPA" || s.segment === "Trading").filter((s) => !x.segmen || s.segment === x.segmen);
  tiles.push({
    id: "ch-cogs", pos: P(7, 8, 5, 4), kind: "tall", title: "COGS/kg vs revenue/kg per segmen (Rp/kg)",
    note: cogs.filter((s) => s.cogsPerKg && s.revenuePerKg && s.cogsPerKg.gt(s.revenuePerKg)).map((s) => `${s.segment}: COGS/kg ${num(s.cogsPerKg!, 0)} di atas revenue/kg ${num(s.revenuePerKg!, 0)}.`).join(" ") || undefined,
    content: {
      type: "paired", legend: [{ tone: "s1", label: "revenue/kg" }, { tone: "s3", label: "COGS/kg" }],
      groups: cogs.map((s) => ({ key: s.segment, label: s.segment, a: s.revenuePerKg ? Number(s.revenuePerKg.toFixed(0)) : null, aText: s.revenuePerKg ? num(s.revenuePerKg, 0) : "belum diisi", b: s.cogsPerKg ? Number(s.cogsPerKg.toFixed(0)) : null, bText: s.cogsPerKg ? num(s.cogsPerKg, 0) : "belum diisi" })),
    },
  });

  // ---------------------------------------------------------------- rows 12–15: input, COGS (always)
  const inp = inputSummary(r);
  const above = b6?.breakevenLb && inp.lb.avgPriceActual && inp.lb.avgPriceActual.gt(b6.breakevenLb) ? "di atas breakeven" : "";
  const trading = tradingBySku(r);
  const inputRows: TRow[] = [
    { id: "lb-a", cells: { what: "Live bird aktual", kg: num(inp.lb.actualKg, 0), price: inp.lb.avgPriceActual ? num(inp.lb.avgPriceActual, 0) : "—", value: jtV4(inp.lb.actualValue), note: above } },
    { id: "lb-p", cells: { what: "Live bird rencana", kg: num(inp.lb.plannedKg, 0), price: inp.lb.plannedKg.isZero() ? "—" : num(inp.lb.plannedValue.div(inp.lb.plannedKg), 0), value: jtV4(inp.lb.plannedValue), note: "" } },
    ...trading.map((t) => ({ id: `tr-${t.key}`, cells: { what: `Trading ${t.label}`, kg: num(t.kg, 0), price: num(t.unitCost, 0), value: jtV4(t.value), note: t.note } })),
    { id: "freight", cells: { what: "Ekspedisi LB", kg: "", price: "", value: jtV4(inp.batchCost.freight), note: "" } },
    { id: "maklon", cells: { what: "Maklon / TKL", kg: "", price: "", value: jtV4(inp.batchCost.maklon), note: "" } },
    { id: "overhead", cells: { what: "Overhead", kg: "", price: "", value: inp.batchCost.overhead === null ? "belum diisi" : jtV4(inp.batchCost.overhead), note: "" } },
  ];
  tiles.push({
    id: "t-input", pos: P(0, 12, 6, 4), kind: "tall", title: "Input minggu ini",
    content: { type: "table", cols: [{ key: "what", label: "Input", kind: "key" }, { key: "kg", label: "kg", num: true }, { key: "price", label: "Rp/kg", num: true }, { key: "value", label: "Rp jt", num: true }, { key: "note", label: "Catatan", kind: "sup" }], rows: inputRows },
  });

  const pnl = r.statements.pnl;
  const cogsLines = ["COGS - Live Bird", "COGS - Trading", "Other COGS - Expedition", "COGS - Blasting", "TOTAL COST OF SALES"];
  const label: Record<string, string> = { "COGS - Live Bird": "COGS live bird", "COGS - Trading": "COGS trading", "Other COGS - Expedition": "Ekspedisi", "COGS - Blasting": "Blasting", "TOTAL COST OF SALES": "Total COGS" };
  const basis: Record<string, string> = { "COGS - Live Bird": "order × biaya rata-rata", "COGS - Trading": "order × biaya rata-rata", "Other COGS - Expedition": "run-rate", "COGS - Blasting": "run-rate", "TOTAL COST OF SALES": "" };
  const sections: { title: string; cols: Col[]; rows: TRow[] }[] = [];
  if (x.on.m1 && x.groups?.length) sections.push({ title: "COGS/kg per grup SKU", cols: [{ key: "g", label: "Grup", kind: "key" }, { key: "v", label: "Rp/kg", num: true }], rows: x.groups.map((g) => ({ id: g.group, cells: { g: g.group, v: rpkg(g.cogsPerKg) } })) });
  if (x.on.m2 && x.roll) {
    const rf = x.roll;
    sections.push({
      title: "Mutasi persediaan (Rp jt)", cols: [{ key: "a", label: "", kind: "key" }, { key: "kg", label: "kg", num: true }, { key: "rp", label: "Rp jt", num: true }],
      rows: [
        { id: "o", cells: { a: "Awal", kg: num(rf.opening.kg, 0), rp: jtV4(rf.opening.value) } },
        { id: "i", cells: { a: "Masuk", kg: num(rf.in.kg, 0), rp: jtV4(rf.in.value) } },
        { id: "x", cells: { a: "Keluar", kg: num(rf.out.kg.neg(), 0), rp: jtV4(rf.out.value.neg()) } },
        { id: "b", cells: { a: "Blast", kg: num(rf.blast.kg.neg(), 0), rp: jtV4(rf.blast.value.neg()) } },
        { id: "adj", cells: { a: "Penyesuaian", kg: num(rf.adjust.kg, 0), rp: jtV4(rf.adjust.value) } },
        { id: "c", kind: "total", cells: { a: "Akhir", kg: num(rf.closing.kg, 0), rp: jtV4(rf.closing.value) } },
        ...(rf.vsBalanceSheet === null ? [] : [{ id: "bs", cells: { a: "Selisih vs neraca", kg: "", rp: jtV4(rf.vsBalanceSheet) } }]),
      ],
    });
  }
  tiles.push({
    id: "t-cogs", pos: P(6, 12, 6, 4), kind: "tall", title: "COGS dan mutasi persediaan (Rp jt)",
    content: {
      type: "table",
      cols: [{ key: "l", label: "Baris", kind: "key" }, { key: "lw", label: "Minggu lalu", num: true, kind: "sup" }, { key: "a", label: "Aktual", num: true }, { key: "o", label: "Sisa", num: true }, { key: "p", label: "Proyeksi", num: true, kind: "key" }, { key: "d", label: "Δ", num: true }, { key: "b", label: "Basis sisa", kind: "sup" }],
      rows: cogsLines.map((l) => {
        const v = pnl.get(l).values;
        return { id: l, kind: l === "TOTAL COST OF SALES" ? "total" : undefined, cells: { l: label[l], lw: jtV4(v.lastWeek), a: jtV4(v.actual), o: jtV4(v.outlook), p: jtV4(v.projection), d: jtV4(v.delta), b: basis[l] } } as TRow;
      }),
      sections,
    },
  });

  // ---------------------------------------------------------------- rows 16–19: stock per age, cash
  if (x.on.m2 && x.stock && x.stock.lots.length) {
    const lots = x.stock.lots.filter((l) => !x.segmen || l.key.startsWith(`${x.segmen === "RPA" ? "RPA" : "Trading"}|`));
    const ages: AgeBucketRow[] = stockAgeBuckets(lots, 7);
    tiles.push({
      id: "ch-stok-umur", pos: P(0, 16, 6, 4), kind: "tall", title: "Stok per umur, 7 SKU dengan nilai terbesar",
      content: {
        type: "stacked", legend: [{ tone: "s1", label: "0–7 hari" }, { tone: "s2", label: "8–30 hari" }, { tone: "s3", label: "> 30 hari" }],
        rows: ages.map((a) => ({ key: a.key, label: a.key.replace(/^(RPA|Trading)\|/, "").replace("|", " "), parts: a.buckets.map((b) => Number(b.toFixed(0))), totalText: `${num(a.kg, 0)} kg`, href: q({ sku: x.sku === a.key ? null : a.key }), selected: x.sku === a.key, title: `${a.key}: ${num(a.kg, 0)} kg, ${a.value ? `Rp ${jtV4(a.value)} jt` : "nilai belum diisi"}, umur tertua ${a.maxAge ?? "—"} hari` })),
        table: {
          cols: [{ key: "k", label: "SKU", kind: "key" }, { key: "kg", label: "kg", num: true }, { key: "rp", label: "Rp jt", num: true }, { key: "age", label: "Umur", num: true }, { key: "ord", label: "Order sisa kg", num: true }, { key: "c", label: "Biaya/kg", num: true, kind: "sup" }, { key: "ref", label: "Harga acuan", num: true, kind: "sup" }],
          rows: ages.filter((a) => !x.sku || a.key === x.sku).map((a) => {
            const info = x.stock!.info?.[a.key];
            return { id: a.key, cells: { k: a.key.replace(/^(RPA|Trading)\|/, "").replace(/\|/g, " "), kg: num(a.kg, 0), rp: a.value ? jtV4(a.value) : "belum diisi", age: a.maxAge === null ? "—" : String(a.maxAge), ord: info?.ordersRest ? num(info.ordersRest, 0) : "0", c: a.value && !a.kg.isZero() ? num(a.value.div(a.kg), 0) : "belum diisi", ref: info?.refPrice ? num(info.refPrice, 0) : "belum diisi" } };
          }),
        },
      },
    });
  } else hidden.push("ch-stok-umur");

  const cashPoints: ChartPoint[] = (x.on.m6 && x.cashMart ? x.cashMart.map((d) => ({ date: d.date, closing: d.closing === null ? null : D(d.closing), planned: d.planned })) : cash.days.map((d) => ({ date: d.date, closing: d.closing as Decimal | null, planned: d.basis === "rencana" })))
    .map((d) => ({
      key: d.date, label: ddmm(d.date), bar: d.closing === null ? null : Number(d.closing.div(1e6).toFixed(1)), barText: d.closing === null ? "belum diisi" : jtV4(d.closing),
      barTone: d.planned ? "s2" : "s1", title: `${dayName(d.date)} ${tgl(d.date)} · saldo Rp ${d.closing === null ? "belum diisi" : `${jtV4(d.closing)} jt`} · ${d.planned ? "rencana" : "aktual"}`,
    }));
  tiles.push({
    id: "kas", pos: P(6, 16, 6, 4), kind: "tall", title: "Kas harian aktual vs rencana (Rp jt)",
    note: `Saldo awal minggu Rp ${jtV4(cash.opening)} jt.`,
    content: {
      type: "chart+table", points: cashPoints, legend: [{ tone: "s1", label: "aktual" }, { tone: "s2", label: "rencana" }],
      cols: [{ key: "l", label: "Arus kas", kind: "key" }, { key: "lw", label: "Minggu lalu", num: true, kind: "sup" }, { key: "p", label: "Proyeksi", num: true }],
      rows: cash.flows.map((f) => ({ id: f.label, kind: f.total ? "total" : undefined, cells: { l: f.label, lw: jtV4(f.lastWeek), p: jtV4(f.projection) } })),
    },
  });

  // ---------------------------------------------------------------- rows 20–22: trading spread, demand, alerts
  const trRows = r.block3.filter((t) => t.ordersRestOfWeek.gt(0)).map((t) => {
    const spread = t.sellPrice.minus(t.avgStockCost);
    return { id: t.key, cells: { k: t.label.replace("|", " "), sell: num(t.sellPrice, 0), cost: num(t.avgStockCost, 0), sp: num(spread, 0), gp: jtV4(spread.times(t.ordersRestOfWeek)) } };
  });
  const jual = r.block4.find((b) => b.status === "JUAL");
  tiles.push({
    id: "t-trading", pos: P(0, 20, 6, 3), title: "Spread trading per SKU dengan order sisa minggu",
    note: jual && jual.keys ? `${jual.keys} SKU tanpa order minggu ini sebaiknya dijual (stok Rp ${jtV4(jual.value)} jt).` : undefined,
    content: { type: "table", cols: [{ key: "k", label: "SKU", kind: "key" }, { key: "sell", label: "Harga jual", num: true }, { key: "cost", label: "Biaya stok", num: true, kind: "sup" }, { key: "sp", label: "Selisih/kg", num: true }, { key: "gp", label: "GP order Rp jt", num: true, kind: "key" }], rows: trRows },
  });

  if (x.on.m3 && x.demand) {
    const d = x.demand;
    tiles.push({
      id: "demand", pos: P(6, 20, 3, 3), title: "Demand dan rencana potong",
      content: {
        type: "table", cols: [{ key: "a", label: "", kind: "key" }, { key: "v", label: "kg / ekor", num: true }],
        rows: [
          { id: "c", cells: { a: "PO pasti", v: num(d.confirmed, 0) } }, { id: "t", cells: { a: "PO tentatif", v: num(d.tentative, 0) } },
          { id: "f", cells: { a: "Forecast", v: num(d.forecast, 0) } }, { id: "w", cells: { a: "Berbobot", v: num(d.weighted, 0) } },
          { id: "s", cells: { a: "Dari stok", v: num(d.fromStock, 0) } }, { id: "n", cells: { a: "Kebutuhan potong", v: num(d.net, 0) } },
          { id: "h", kind: "total", cells: { a: "Rencana potong (ekor)", v: d.planHeads === null ? "belum ada rencana" : num(d.planHeads, 0) } },
          ...(d.variance === null ? [] : [{ id: "var", cells: { a: "Varian aktual vs rencana", v: num(d.variance, 0) } }]),
        ],
      },
    });
  } else hidden.push("demand");

  const alerts = r.block7.filter((a) => a.audience === "management" && a.code !== "LB_DI_ATAS_BREAKEVEN").map((a) => `Peringatan: ${a.text}`);
  const unfilled = x.controlsV3.filter((k) => k.status === "BELUM DIISI" || k.status === "STALE").map((k) => `${k.code} ${k.status === "STALE" ? "data belum dibangun ulang" : "belum diisi"}: ${k.name}`);
  tiles.push({ id: "peringatan", pos: P(9, 20, 3, 3), title: "Peringatan", content: { type: "list", items: [...alerts, ...unfilled], empty: "Tidak ada peringatan untuk minggu ini." } });

  tiles.push({
    id: "catatan", pos: P(0, 23, 12, 1), kind: "bare",
    content: {
      type: "list", ordered: true, items: [
        "GP produk = revenue DO dan order dikurangi HPP per key. GP P&L = revenue jurnal dikurangi semua akun COGS yang dipetakan, termasuk ekspedisi dan blasting.",
        "Stok di atas batas umur memakai batas umur per SKU; nilai pada biaya rata-rata.",
        "Kas rencana mengikuti termin pembayaran di parameter minggu ini.",
      ],
    },
  });

  const withPl = x.v5Pl ? mingguIniV5(tiles, { v5: x.v5Pl, weekStart: x.week.start, split: x.mode === "aktual" }) : tiles;
  // v5/6: the simulation and the decisions take the three rows after the P&L tile (rows 9–11 of the mockup)
  return { title: "Minggu ini", week: x.week.start, tiles: x.v5Mgmt ? managementV5(withPl, x.v5Mgmt, { at: x.v5Pl ? 8 : 4 }) : withPl, hidden };
}

function lowestOf(days: { date: string; closing: string | null }[]): { date: string; balance: Decimal; average: Decimal } | null {
  const v = days.filter((d) => d.closing !== null).map((d) => ({ date: d.date, b: D(d.closing!) }));
  if (!v.length) return null;
  const lo = v.reduce((a, b) => (b.b.lt(a.b) ? b : a));
  return { date: lo.date, balance: lo.b, average: v.reduce((a, b) => a.plus(b.b), D(0)).div(v.length) };
}

function daySegments(rows: PlRowV4[], day: string, today: string) {
  // one day as a one-day "week": actual when the day is before the update date, forecast from it
  const wo = weekOutlook(rows.filter((r) => r.date === day), { weekStart: day, today: day < today ? addDays(day, 1) : day });
  return wo.bySegment.filter((s) => !s.revenue.isZero() || !s.gp.isZero());
}

function worstSegmentNote(segs: WeekResult["block1"]): string | undefined {
  const s = segs.filter((x) => x.segment !== "TOTAL KGR");
  if (!s.length) return undefined;
  const w = s.reduce((a, b) => (b.gpProjection.lt(a.gpProjection) ? b : a));
  return w.gpProjection.lt(0) ? `${w.segment} menanggung GP produk Rp ${jtV4(w.gpProjection)} jt; GP order ${jtV4(w.gpOrder)} jt dari sisa minggu.` : undefined;
}

/** Trading purchases of the week per SKU (receipts "Beli Trading"), with the unit cost against the reference price. */
function tradingBySku(r: WeekResult): { key: string; label: string; kg: Decimal; value: Decimal; unitCost: Decimal; note: string }[] {
  const p = r.prepared;
  const m = new Map<string, { kg: Decimal; value: Decimal }>();
  for (const x of p.receipts) {
    if (!x.counted || x.source !== "Beli Trading") continue;
    const k = x.key;
    const a = m.get(k) ?? { kg: D(0), value: D(0) };
    m.set(k, { kg: a.kg.plus(x.kg), value: a.value.plus(x.value) });
  }
  const price = new Map(p.master.map((k) => [k.key.trim().toUpperCase(), k.refPrice]));
  return [...m.entries()].filter(([, v]) => v.kg.gt(0)).map(([key, v]) => {
    const unit = v.value.div(v.kg);
    const ref = price.get(key.trim().toUpperCase()) ?? null;
    return { key, label: key.replace(/^Trading\|/, "").replace("|", " "), kg: v.kg, value: v.value, unitCost: unit, note: ref && unit.gt(ref) ? "di atas harga jual" : "" };
  }).sort((a, b) => b.value.cmp(a.value)).slice(0, 5);
}
