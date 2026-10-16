/**
 * Weekly outlook for the management view (PRD v4 §3.4, K5, K15, K16). Pure functions, decimal.js.
 *
 * weekPlDaily turns one computed week into P&L rows per day × segment × line × basis (the shape of the data mart
 * pl_daily_v4): journal lines before the update date (basis journal), PO lines of the rest of the week on their
 * delivery date (basis po: kg × price, cost = HPP per key), and the run-rate lines of the weekly P&L spread over the
 * remaining days (basis runrate). Σ of the rows per line = the weekly P&L (statements.ts) to the last decimal, so the
 * management view and the weekly release read the same numbers. Irisan 2 replaces the run-rate opex by the drivers
 * of template 8.3 (K6) for the weekly and monthly rows alike.
 *
 * weekOutlook sums the rows of the week (the page never sums), gpBridge explains GP produk (block 1) → GP P&L, and
 * weekHeadline fills the headline template of §6.1.
 */
import { D, Decimal, ZERO, div, sum, type Num } from "./decimal";
import { addDays, diffDays, daysInMonth, type ISODate } from "./dates";
import { PNL_COGS, PNL_DA, PNL_OPEX, PNL_OTHER, PNL_REVENUE } from "./statements";
import { isCogsLine, isRevenueLine, salesLines, type PlBasis } from "./monthly";
import { fixed } from "./format";
import type { WeekResult } from "./week";

/** v5 K29: "fixed_estimate" = fixed cost not journaled yet (never journal; skipped by every v4 total). */
export type PlBasisV4 = PlBasis | "event" | "fixed_estimate";
export type PlSegment = "LB main" | "LB by-product" | "Trading" | "Umum";
export const PL_SEGMENTS: PlSegment[] = ["LB main", "LB by-product", "Trading", "Umum"];

export interface PlRowV4 {
  date: ISODate;
  segment: PlSegment;
  pl_line: string;
  basis: PlBasisV4;
  actual: Decimal | null;
  forecast: Decimal | null;
  kg: Decimal | null;
  anomaly: boolean;
}

/** Segment of a journal line: revenue lines carry it; COGS - Live Bird is booked to LB main (no split in the journal). */
export function segmentOfLine(line: string): PlSegment {
  if (line === "Revenue - LB Main Product" || line === "COGS - Live Bird") return "LB main";
  if (line === "Revenue - LB By Product") return "LB by-product";
  if (line === "Revenue - Trading" || line === "COGS - Trading") return "Trading";
  return "Umum";
}

const ORDER_LINES = new Set<string>(["Revenue - LB Main Product", "Revenue - LB By Product", "Revenue - Trading", "COGS - Live Bird", "COGS - Trading"]);
const RUNRATE_LINES = [...PNL_COGS, ...PNL_OPEX, ...PNL_OTHER, PNL_DA].filter((l) => !ORDER_LINES.has(l));

/** P&L rows of the 7 days of a computed week (data mart pl_daily_v4, scope = date). */
export function weekPlDaily(r: WeekResult): PlRowV4[] {
  const p = r.prepared;
  const today = p.today;
  const m = new Map<string, PlRowV4>();
  const add = (date: ISODate, segment: PlSegment, line: string, basis: PlBasisV4, v: Decimal, kind: "actual" | "forecast", kg: Decimal | null = null) => {
    const k = `${date}|${segment}|${line}|${basis}`;
    const row = m.get(k) ?? { date, segment, pl_line: line, basis, actual: null, forecast: null, kg: null, anomaly: false };
    row[kind] = (row[kind] ?? ZERO).plus(v);
    if (kg !== null) row.kg = (row.kg ?? ZERO).plus(kg);
    m.set(k, row);
  };
  // journal: −(debit − credit) of the mapped lines, as the weekly P&L "actual" column
  for (const g of p.gl) {
    if (!g.plLine || g.date === null || g.date < p.weekStart || g.date >= today) continue;
    add(g.date, segmentOfLine(g.plLine), g.plLine, "journal", g.drCr.neg(), "actual");
  }
  // PO lines counted in the week (delivery today … week end)
  for (const s of r.sales) {
    if (s.status !== "Order" || !s.counted || s.date === null) continue;
    const { revenue_line, cogs_line } = salesLines(s);
    const seg: PlSegment = s.segment === "Trading" ? "Trading" : s.group === "By-product" ? "LB by-product" : "LB main";
    add(s.date, seg, revenue_line, "po", s.value, "forecast", s.kg);
    add(s.date, seg, cogs_line, "po", s.hpp.neg(), "forecast", s.kg);
  }
  // run-rate lines: monthly × remaining / days in month + the week's adjustment, spread over the remaining days so that
  // Σ = the weekly P&L exactly (cumulative differences; the adjustment on the first remaining day)
  const remaining = diffDays(p.weekEnd, today) + 1;
  const dim = daysInMonth(today);
  for (const line of RUNRATE_LINES) {
    const rr = p.runrate.find((x) => x.plLine === line);
    if (!rr || remaining <= 0) continue;
    const sign = line === "Other Income" ? 1 : -1;
    const cum = (k: number) => rr.monthly.times(new Decimal(k).div(dim));
    for (let i = 0; i < remaining; i++) {
      let v = cum(i + 1).minus(cum(i));
      if (i === 0) v = v.plus(rr.adjustment);
      add(addDays(today, i), segmentOfLine(line), line, "runrate", sign < 0 ? v.neg() : v, "forecast");
    }
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.segment.localeCompare(b.segment) || a.pl_line.localeCompare(b.pl_line) || a.basis.localeCompare(b.basis));
}

export interface PlTotals {
  revenue: Decimal;
  cogs: Decimal;
  gp: Decimal;
  opex: Decimal;
  nibt: Decimal;
}

const totals = (rows: PlRowV4[], v: (r: PlRowV4) => Decimal | null): PlTotals => {
  const f = (p: (l: string) => boolean) => sum(rows.filter((r) => p(r.pl_line)).map((r) => v(r) ?? ZERO));
  const revenue = f(isRevenueLine), cogs = f(isCogsLine), opex = f((l) => !isRevenueLine(l) && !isCogsLine(l));
  return { revenue, cogs, gp: revenue.plus(cogs), opex, nibt: revenue.plus(cogs).plus(opex) };
};

const addT = (a: PlTotals, b: PlTotals): PlTotals => ({
  revenue: a.revenue.plus(b.revenue), cogs: a.cogs.plus(b.cogs), gp: a.gp.plus(b.gp), opex: a.opex.plus(b.opex), nibt: a.nibt.plus(b.nibt),
});

export interface WeekDay {
  date: ISODate;
  /** actual = before the update date; po / runrate = forecast basis of the revenue; none = no revenue expected. */
  kind: "actual" | "po" | "runrate" | "none";
  revenue: Decimal;
  gp: Decimal;
}

export interface WeekOutlook {
  weekStart: ISODate;
  today: ISODate;
  actual: PlTotals;
  forecast: PlTotals;
  projection: PlTotals;
  gpPct: Decimal;
  /** Share of the forecast revenue (rest of the week) that comes from PO lines; null without forecast revenue. */
  poShare: Decimal | null;
  lastWeek: { revenue: Decimal; gp: Decimal; nibt: Decimal; basis: "rilis" | "jurnal" } | null;
  deltaGp: Decimal | null;
  days: WeekDay[];
  bySegment: { segment: PlSegment; revenue: Decimal; gp: Decimal }[];
}

/** Totals of the week from its P&L rows (actual before the update date, forecast from it). */
export function weekOutlook(rows: PlRowV4[], week: { weekStart: ISODate; today: ISODate }, lastWeek: WeekOutlook["lastWeek"] = null): WeekOutlook {
  const end = addDays(week.weekStart, 6);
  const inWeek = rows.filter((r) => r.date >= week.weekStart && r.date <= end);
  const act = inWeek.filter((r) => r.date < week.today);
  const fc = inWeek.filter((r) => r.date >= week.today);
  const actual = totals(act, (r) => r.actual);
  const forecast = totals(fc, (r) => r.forecast);
  const projection = addT(actual, forecast);
  const poRevenue = sum(fc.filter((r) => r.basis === "po" && isRevenueLine(r.pl_line)).map((r) => r.forecast ?? ZERO));
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(week.weekStart, i);
    const dr = inWeek.filter((r) => r.date === d);
    const isAct = d < week.today;
    const t = totals(dr, (r) => (isAct ? r.actual : r.forecast));
    const rev = dr.filter((r) => isRevenueLine(r.pl_line) && (isAct ? r.actual : r.forecast) !== null);
    const kind: WeekDay["kind"] = isAct ? "actual" : rev.some((r) => r.basis === "po") ? "po" : rev.some((r) => r.basis === "runrate") ? "runrate" : "none";
    days.push({ date: d, kind, revenue: t.revenue, gp: t.gp });
  }
  const bySegment = PL_SEGMENTS.map((segment) => {
    const t = addT(totals(act.filter((r) => r.segment === segment), (r) => r.actual), totals(fc.filter((r) => r.segment === segment), (r) => r.forecast));
    return { segment, revenue: t.revenue, gp: t.gp };
  });
  return {
    weekStart: week.weekStart, today: week.today, actual, forecast, projection, gpPct: div(projection.gp, projection.revenue),
    poShare: forecast.revenue.isZero() ? null : div(poRevenue, forecast.revenue),
    lastWeek, deltaGp: lastWeek ? projection.gp.minus(lastWeek.gp) : null, days, bySegment,
  };
}

/**
 * Rows of the weekly outlook back from the data mart (strings / numbers → decimals). The v5 fixed-cost estimate rows
 * (basis fixed_estimate) are left out unless asked for: every v4 reader stays on NIBT according to the journal.
 */
export function plRowsFromMart(rows: { date: string; segment: string; pl_line: string; basis: string; actual: Num | null; forecast: Num | null; kg?: Num | null; anomaly?: boolean | null }[], opts: { fixedEstimate?: boolean } = {}): PlRowV4[] {
  return rows.filter((r) => opts.fixedEstimate || r.basis !== "fixed_estimate").map((r) => ({
    date: r.date, segment: r.segment as PlSegment, pl_line: r.pl_line, basis: r.basis as PlBasisV4,
    actual: r.actual === null || r.actual === undefined ? null : D(r.actual), forecast: r.forecast === null || r.forecast === undefined ? null : D(r.forecast),
    kg: r.kg === null || r.kg === undefined ? null : D(r.kg), anomaly: r.anomaly === true,
  }));
}

/** Mart rows (plain JSON for mart_replace). Money 2 decimals, kg 2 decimals. */
export function plRowsToMart(rows: PlRowV4[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    date: r.date, segment: r.segment, pl_line: r.pl_line, basis: r.basis,
    actual: r.actual === null ? null : r.actual.toFixed(2), forecast: r.forecast === null ? null : r.forecast.toFixed(2),
    kg: r.kg === null ? null : r.kg.toFixed(2), anomaly: r.anomaly,
  }));
}

export interface BridgeStep {
  code: "gp_produk" | "timing" | "cogs_mapping" | "expedition" | "blasting" | "cogs_other" | "residual" | "gp_pl";
  label: string;
  value: Decimal;
  /** Rule in words for the "cara hitung" drawer. */
  rule: string;
}

export interface GpBridge {
  steps: BridgeStep[];
  residual: Decimal;
  /** |residual| ≤ Rp 1 (K5: a larger residual blocks the claim that GP produk and GP P&L reconcile). */
  reconciled: boolean;
}

/**
 * GP produk (block 1, DO / order − HPP per key) → GP P&L (journal + PO, all COGS accounts) for the week (K5, §3.4).
 * Every step is a difference of two sources; the residual is what no step explains.
 */
export function gpBridge(x: {
  /** block 1 TOTAL KGR: revenue and GP projection (DO + order). */
  revenueProduk: Num;
  gpProduk: Num;
  rows: PlRowV4[];
  week: { weekStart: ISODate; today: ISODate };
}): GpBridge {
  const wo = weekOutlook(x.rows, x.week);
  const end = addDays(x.week.weekStart, 6);
  const v = (r: PlRowV4) => (r.date < x.week.today ? r.actual : r.forecast) ?? ZERO;
  const inWeek = x.rows.filter((r) => r.date >= x.week.weekStart && r.date <= end);
  const line = (p: (l: string) => boolean) => sum(inWeek.filter((r) => p(r.pl_line)).map(v));
  const gpProduk = D(x.gpProduk);
  const hppProduk = D(x.revenueProduk).minus(gpProduk);
  const timing = wo.projection.revenue.minus(D(x.revenueProduk));
  const cogsKey = line((l) => l === "COGS - Live Bird" || l === "COGS - Trading");
  const mapping = cogsKey.plus(hppProduk);
  const expedition = line((l) => l === "Other COGS - Expedition");
  const blasting = line((l) => l === "COGS - Blasting");
  const other = line((l) => isCogsLine(l) && !["COGS - Live Bird", "COGS - Trading", "Other COGS - Expedition", "COGS - Blasting"].includes(l));
  const explained = gpProduk.plus(timing).plus(mapping).plus(expedition).plus(blasting).plus(other);
  const residual = wo.projection.gp.minus(explained);
  return {
    residual, reconciled: residual.abs().lte(1),
    steps: [
      { code: "gp_produk", label: "GP produk", value: gpProduk, rule: "Revenue DO dan order − HPP per key (blok 1 TOTAL KGR, proyeksi)" },
      { code: "timing", label: "Revenue jurnal − revenue DO", value: timing, rule: "Revenue P&L (jurnal s.d. kemarin + PO sisa minggu) − revenue blok 1; timing faktur dan baris di luar DO" },
      { code: "cogs_mapping", label: "COGS jurnal − HPP per key", value: mapping, rule: "COGS - Live Bird + COGS - Trading di P&L − HPP per key blok 1" },
      { code: "expedition", label: "Ekspedisi", value: expedition, rule: "Other COGS - Expedition (jurnal + run-rate sisa minggu)" },
      { code: "blasting", label: "Blasting", value: blasting, rule: "COGS - Blasting (jurnal + run-rate sisa minggu)" },
      { code: "cogs_other", label: "COGS lain", value: other, rule: "akun COGS lain yang tidak ada di HPP per key" },
      { code: "residual", label: "Penyesuaian / mapping", value: residual, rule: "GP P&L − semua langkah di atas; lebih dari Rp 1 berarti belum rekonsiliasi" },
      { code: "gp_pl", label: "GP P&L", value: wo.projection.gp, rule: "Revenue − semua akun COGS yang dipetakan (pl_daily_v4, minggu ini)" },
    ],
  };
}

/** K16: Rp juta with one decimal and the minus sign U+2212 (−67,5). */
export function jtV4(x: Num, dp = 1): string {
  return fixed(D(x).div(1_000_000), dp).replace(/^-/, "−");
}

/** Percent with one decimal and U+2212 (−4,1%). */
export function pctV4(x: Num, dp = 1): string {
  return `${fixed(D(x).times(100), dp).replace(/^-/, "−")}%`;
}

const DAY_NAME = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const dayName = (d: ISODate): string => DAY_NAME[new Date(`${d}T00:00:00Z`).getUTCDay()];

/**
 * Headline of §6.1 (three slots, at most two sentences). Slots without data are left out; without the weekly
 * outlook there is no headline (null).
 */
export function weekHeadline(x: {
  outlook: WeekOutlook | null;
  /** Block 1 segment rows (RPA, Trading): the worst GP produk projection names the segment. */
  segments: { segment: string; gpProjection: Num }[];
  stockOverAge: Num | null;
  cash: { lowest: Num; lowestDate: ISODate; average: Num } | null;
}): string | null {
  if (!x.outlook) return null;
  const segs = x.segments.filter((s) => s.segment === "RPA" || s.segment === "Trading");
  const worst = segs.length ? segs.reduce((a, b) => (D(b.gpProjection).lt(D(a.gpProjection)) ? b : a)) : null;
  let s1 = `GP P&L minggu ini diproyeksikan Rp ${jtV4(x.outlook.projection.gp)} jt (${pctV4(x.outlook.gpPct)})`;
  if (worst) s1 += `; ${worst.segment} menyumbang Rp ${jtV4(worst.gpProjection)} jt`;
  s1 += ".";
  const parts: string[] = [];
  if (x.stockOverAge !== null) parts.push(`Stok di atas batas umur Rp ${jtV4(x.stockOverAge)} jt`);
  if (x.cash && D(x.cash.lowest).lt(D(x.cash.average).times("0.25"))) {
    parts.push(`${parts.length ? "kas" : "Kas"} ${dayName(x.cash.lowestDate)} turun ke Rp ${jtV4(x.cash.lowest)} jt`);
  }
  return parts.length ? `${s1} ${parts.join(", ")}.` : s1;
}

export interface WeekCash {
  opening: Decimal;
  days: { date: ISODate; closing: Decimal; basis: "aktual" | "rencana" }[];
  lowest: { date: ISODate; balance: Decimal };
  /** Mean daily closing of the 7 days (the headline compares the lowest with 0,25 × this). */
  average: Decimal;
  /** Lowest balance without the affiliate loans received up to that day (operations only, §3.7). */
  lowestWithoutAffiliate: Decimal;
  /** The affiliate amount of the rest of the week has no day in the weekly cash flow; true when it is not zero. */
  affiliateTimingAssumed: boolean;
  /** Rows of the cash table: last week vs projection (§6.1 tile kas). */
  flows: { label: string; lastWeek: Decimal; projection: Decimal; total?: boolean }[];
}

const FLOW_GROUPS: { label: string; cats: string[] }[] = [
  { label: "Penerimaan pelanggan", cats: ["Penerimaan dari pelanggan"] },
  { label: "Bayar pemasok", cats: ["Bayar pemasok barang (live bird & trading)"] },
  { label: "Bayar jasa", cats: ["Bayar jasa (maklon, angkut, cold storage, sewa)"] },
  { label: "Karyawan dan lain-lain", cats: ["Penerimaan lain", "Bayar karyawan", "Bayar biaya operasional lain", "Bayar pajak", "Bunga & biaya bank", "Belanja aset tetap", "Setoran modal", "Transfer antar rekening"] },
  { label: "Pinjaman afiliasi net", cats: ["Pinjaman afiliasi (net)"] },
];

/** The week's cash from the weekly direct cash flow (v1 O_CF), used while M6 is off (§6.1 c-kas, kas). */
export function weekCash(r: WeekResult): WeekCash {
  const cf = r.statements.cf;
  const days = cf.daily.map((d) => ({ date: d.date, closing: d.closing, basis: d.basis }));
  const aff = cf.lines.find((l) => l.category === "Pinjaman afiliasi (net)");
  const affActual = aff?.values.actual ?? ZERO, affOutlook = aff?.values.outlook ?? ZERO;
  const lowestOnOrAfterToday = cf.lowest.date >= r.week.today;
  const affToLowest = affActual.plus(lowestOnOrAfterToday ? affOutlook : ZERO);
  const flows = FLOW_GROUPS.map((g) => {
    const ls = cf.lines.filter((l) => g.cats.includes(l.category));
    return { label: g.label, lastWeek: sum(ls.map((l) => l.values.lastWeek)), projection: sum(ls.map((l) => l.values.projection)) };
  });
  return {
    opening: cf.opening.projection, days, lowest: cf.lowest,
    average: days.length ? div(sum(days.map((d) => d.closing)), new Decimal(days.length)) : ZERO,
    lowestWithoutAffiliate: cf.lowest.balance.minus(affToLowest), affiliateTimingAssumed: lowestOnOrAfterToday && !affOutlook.isZero(),
    flows: [...flows, { label: "Arus kas bersih", lastWeek: cf.net.lastWeek, projection: cf.net.projection, total: true }],
  };
}

/** Stock over the age limit from the SKU balance mart (§6.1 c-stok): value at MA cost, kg, number of SKUs. */
export function stockOverAge(keys: { key: string; over_age_kg: Num | null; cost_per_kg_ma: Num | null }[]): { value: Decimal; kg: Decimal; skus: number; costMissing: number } {
  let value = ZERO, kg = ZERO, skus = 0, costMissing = 0;
  for (const k of keys) {
    const q = D(k.over_age_kg ?? 0);
    if (!q.gt(0)) continue;
    skus++;
    kg = kg.plus(q);
    if (k.cost_per_kg_ma === null || k.cost_per_kg_ma === undefined || k.cost_per_kg_ma === "") costMissing++;
    else value = value.plus(q.times(D(k.cost_per_kg_ma)));
  }
  return { value, kg, skus, costMissing };
}

export interface AgeBucketRow {
  key: string;
  /** kg aged 0–7, 8–30 and > 30 days. */
  buckets: [Decimal, Decimal, Decimal];
  kg: Decimal;
  value: Decimal | null;
  maxAge: number | null;
}

/** Stock per age bucket per SKU from the lot balance mart (§6.1 ch-stok-umur); the `top` SKUs by value. */
export function stockAgeBuckets(lots: { key: string; kg: Num; age_days: number | null; cost_per_kg_ma: Num | null }[], top = 7): AgeBucketRow[] {
  const m = new Map<string, AgeBucketRow>();
  for (const l of lots) {
    const q = D(l.kg);
    if (!q.gt(0)) continue;
    const r = m.get(l.key) ?? { key: l.key, buckets: [ZERO, ZERO, ZERO] as [Decimal, Decimal, Decimal], kg: ZERO, value: ZERO as Decimal | null, maxAge: null as number | null };
    const a = l.age_days ?? 0;
    const i = a <= 7 ? 0 : a <= 30 ? 1 : 2;
    r.buckets[i] = r.buckets[i].plus(q);
    r.kg = r.kg.plus(q);
    r.value = l.cost_per_kg_ma === null || l.cost_per_kg_ma === undefined || r.value === null ? null : r.value.plus(q.times(D(l.cost_per_kg_ma)));
    r.maxAge = l.age_days === null ? r.maxAge : Math.max(r.maxAge ?? 0, l.age_days);
    m.set(l.key, r);
  }
  return [...m.values()].sort((a, b) => (b.value ?? b.kg).cmp(a.value ?? a.kg) || a.key.localeCompare(b.key)).slice(0, top);
}
