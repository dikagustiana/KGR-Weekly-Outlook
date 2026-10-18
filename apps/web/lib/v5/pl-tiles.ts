/**
 * PRD v5 §4.7 tiles (K29–K31), pure: the P&L table of the month in two views (plTable) and the cumulative chart of five
 * measures (cumulativeSeries). Every number comes from @kgr/engine; this file places and labels it (Rp jt one decimal,
 * U+2212, red only for negatives on the deciding rows, status in words).
 */
import {
  CUMULATIVE_METRICS, PL_MEMO_ROWS, PL_TABLE_ROWS, cumulativeSeries, fixedAllMissing, plBudgetOf, plTable, plTotalsV5,
  type BudgetRow, type CostingRowsMode, type CumulativeMetric, type CumulativeSeries, type Decimal, type PlColumn, type PlRowV4, type PlTable,
} from "@kgr/engine";
import { jtV4, pctV4, tglShort } from "../fmt";
import type { Col, TRow } from "@/components/v4/Table";
import type { TilePos } from "@/components/v4/Tile";
import type { LinePlot } from "@/components/v4/Chart";
import type { TileModel } from "../v4/minggu-ini";

/** Fixed-cost nominal of a line as the month builder recorded it (data_status month_lock). */
/** `nominal` null = no schedule and no FINAL month (PRD v5.1 K51), never 0. */
export interface FixedSource { pl_line: string; nominal: string | null; source: "jadwal" | "estimasi bulan lalu" | "belum ada"; finalMonth: string | null }

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthWord = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
const day = (d: string | null) => (d ? String(Number(d.slice(8, 10))) : "");
const range = (c: PlColumn) => (c.from === c.to ? day(c.from) : `${day(c.from)}–${day(c.to)}`);

export const LINE_WORD: Record<string, string> = { "Salaries and allowance": "gaji", "Depreciation & amortisation": "penyusutan", "Interest Expense": "bunga", "Rent Expenses": "sewa" };
const words = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} dan ${xs[xs.length - 1]}`);
/** "gaji, penyusutan dan bunga" for the fixed lines with a nominal. */
const ORDER = Object.keys(LINE_WORD);
const rank = (l: string) => (ORDER.includes(l) ? ORDER.indexOf(l) : ORDER.length);
const byK29 = (fx: FixedSource[]) => fx.filter((f) => Number(f.nominal) > 0).sort((a, b) => rank(a.pl_line) - rank(b.pl_line));
export const fixedWords = (fx: FixedSource[]) => words(byK29(fx).map((f) => LINE_WORD[f.pl_line] ?? f.pl_line.toLowerCase()));

function colLabel(t: PlTable, c: PlColumn, budgetEmpty: boolean): string {
  const mon = MON[Number(t.month.slice(5, 7)) - 1];
  const fc = c.forecastBasis.length === 2 ? "PO + run-rate" : c.forecastBasis[0] === "po" ? "PO" : c.forecastBasis[0] === "runrate" ? "run-rate" : "tanpa pengiriman";
  if (t.view === "rr") {
    switch (c.kind) {
      case "actual": return `Actual · ${range(c)} ${mon} · jurnal`;
      case "forecast": return `${fc} · ${range(c)} ${mon}`;
      case "total": return `Outlook · ${monthWord(t.month)}`;
      case "share": return "% revenue · outlook";
      default: return budgetEmpty ? "Budget · belum diisi" : "Budget";
    }
  }
  if (c.kind === "total") return `${monthWord(t.month)} · outlook`;
  if (c.kind === "actual") return `${range(c)} ${mon} · jurnal`;
  if (c.kind === "mixed") return `${range(c)} ${mon} · act + ${fc === "PO + run-rate" ? "PO" : fc}`;
  return `${range(c)} ${mon} · ${fc}`;
}

const cell = (v: Decimal | null, pct: boolean, missing: string) => (v === null ? missing : pct ? pctV4(v, 1) : jtV4(v));

/** K30 tile: Actual vs run-rate (rr) or Per minggu (wk); the other view and the split are links (query string). */
export function plTableTile(t: PlTable, o: {
  id: string; pos: TilePos; hrefs: { rr: string; wk: string }; fixed: FixedSource[]; status: string;
  /** R66 (K63): the memo block is on; the note says what the journal columns hold. */
  mode?: CostingRowsMode;
  /** R67: which cost the forecast order lines took (plan cost or MA), as the month builder recorded it. */
  forecastText?: string | null;
}): TileModel {
  const budgetIdx = t.columns.findIndex((c) => c.kind === "budget");
  const budgetEmpty = budgetIdx >= 0 && t.rows.every((r) => r.values[budgetIdx] === null);
  const cols: Col[] = [{ key: "l", label: "", kind: "key" }, ...t.columns.map((c, i): Col => ({
    key: `c${i}`, label: colLabel(t, c, budgetEmpty), num: true, kind: c.current ? "hi" : c.kind === "forecast" ? "fc" : c.kind === "share" || c.kind === "budget" ? "sup" : undefined,
  }))];
  // K51: without any fixed nominal the fixed row and NIBT after it say "belum ada" (never 0)
  const unknown = (k: string) => t.fixedMissing && (k === "fixed" || k === "nibt_after" || k === "nibt_pct");
  const memoKeys = new Set(PL_MEMO_ROWS.map((r) => r.key));
  const rows: TRow[] = t.rows.map((r) => ({
    id: r.key, kind: r.strong === 2 ? "total" : r.strong === 1 ? "strong" : r.pct || memoKeys.has(r.key) ? "sub" : undefined, redNeg: r.strong > 0 || r.pct,
    // the share column holds a share of outlook revenue (a percentage) on every amount row
    cells: { l: r.label, ...Object.fromEntries(r.values.map((v, i) => [`c${i}`, cell(v, r.pct || t.columns[i].kind === "share", t.columns[i].kind === "budget" ? "—" : unknown(r.key) ? "belum ada" : "")])) },
  }));
  const o5 = t.outlook, fc = t.columns.find((c) => c.kind === "forecast" && t.view === "rr");
  const fcIdx = fc ? t.columns.indexOf(fc) : -1;
  const gpRest = fcIdx >= 0 ? t.rows.find((r) => r.key === "gp")!.values[fcIdx] : null;
  const fw = fixedWords(o.fixed);
  const est = o.fixed.filter((f) => f.source === "estimasi bulan lalu");
  const fixedText = byK29(o.fixed).map((f) => `${LINE_WORD[f.pl_line] ?? f.pl_line} ${jtV4(f.nominal)}`).join(" + ");
  const memoNote = o.mode === "memo" ? ` Selisih costing dan biaya kapasitas idle tampil sebagai memo: kolom jurnal memuat baris jurnal saja (sama dengan FS), NIBT manajemen (${jtV4(o5.nibtMgmt)} jt) memuat keduanya (K63).` : "";
  const note = (t.view === "rr"
    ? [gpRest === null ? null : `Sisa bulan GP ${jtV4(gpRest)} jt.`,
      t.fixedMissing
        ? `NIBT menurut jurnal ${jtV4(o5.nibt)} jt; beban tetap bulan ini belum ada (jadwal Finance dan FINAL bulan lalu kosong, C55), jadi NIBT setelah beban tetap belum bisa dihitung.`
        : `NIBT menurut jurnal ${jtV4(o5.nibt)} jt${fw ? ` belum memuat ${fw}` : ""}; setelah beban tetap ${jtV4(o5.fixed.neg())} jt, ${monthWord(t.month)} ${o5.nibtAfter.lt(0) ? "diproyeksikan rugi" : "diproyeksikan laba"} ${jtV4(o5.nibtAfter)} jt.`].filter(Boolean).join(" ")
    : `Minggu tertutup dari jurnal; kolom miring berisi PO dan run-rate.${fw ? ` ${fw.charAt(0).toUpperCase()}${fw.slice(1)} baru dijurnal saat tutup buku, jadi tiap minggu memuat estimasinya per hari kalender.` : ""}`) + memoNote;
  return {
    id: o.id, pos: o.pos, title: `Laba rugi ${monthWord(t.month)} ${t.month.slice(0, 4)} (Rp jt)`, note,
    views: [{ label: "Tampilan laba rugi", current: t.view, options: [{ value: "rr", label: "Actual vs run-rate", href: o.hrefs.rr }, { value: "wk", label: "Per minggu", href: o.hrefs.wk }] }],
    cara: {
      title: "Laba rugi bulan", fn: `plTable('${t.view}')`, status: o.status,
      rule: `Actual = jurnal Accurate per tanggal posting s.d. ${tglShort(t.cutOff)}. Sesudahnya PO × harga dengan COGS dari biaya per kg SKU, dan hari tanpa PO run-rate dengan margin acuan. Beban operasi sisa bulan = rata-rata harian actual. Beban tetap${fixedText ? ` (${fixedText} = ${jtV4(o5.fixed.neg())} jt/bulan${est.length ? `, ${words(est.map((f) => LINE_WORD[f.pl_line] ?? f.pl_line))} estimasi dari FINAL ${est[0].finalMonth ? MONTHS[Number(est[0].finalMonth.slice(5, 7)) - 1] : "bulan lalu"}` : ""})` : ""} belum dijurnal sebelum tutup buku, jadi dibagi rata per hari kalender. Angka dibulatkan; total bisa selisih 0,1.`,
      period: `${monthWord(t.month)} ${t.month.slice(0, 4)}`, basis: "journal, do_unbilled, po, runrate, fixed, variable, event, fixed_estimate",
      sources: [{ label: "Tabel", value: "pl_daily_v4" }, { label: "Beban tetap", value: o.fixed.length ? o.fixed.map((f) => `${f.pl_line}: ${f.source}`).join("; ") : "belum dibangun" },
        ...(o.forecastText ? [{ label: "COGS forecast", value: o.forecastText }] : []), ...(o.mode === "memo" ? [{ label: "Kolom jurnal", value: "jurnal saja; selisih costing dan biaya idle sebagai memo (K63)" }] : [])],
    },
    content: { type: "table", cols, rows },
  };
}

const TITLE: Record<CumulativeMetric, (m: string) => string> = {
  revenue: (m) => `Revenue kumulatif ${m}: actual dan outlook (Rp jt)`,
  cogs: (m) => `COGS kumulatif ${m} (Rp jt, ditampilkan positif)`,
  gp: (m) => `Gross profit kumulatif ${m} (Rp jt)`,
  nibt: () => "NIBT kumulatif menurut jurnal (Rp jt)",
  nibt_after: () => "NIBT kumulatif setelah beban tetap (Rp jt)",
};

const jtNum = (v: Decimal | null) => (v === null ? null : Number(v.div(1e6).toFixed(1)));

/** K31 tile: the chosen measure's running total, actual solid, outlook dashed, band on the forecast part only. */
export function cumulativeTile(s: CumulativeSeries, o: { id: string; pos: TilePos; month: string; tolerance: string; href: (m: CumulativeMetric) => string; fixed: FixedSource[]; budget?: (number | null)[] | null }): TileModel {
  const n = s.dates.length;
  // K51 (R64): NIBT after fixed costs without any fixed nominal is unknown — no point is drawn, the note says why
  if (s.unknown) {
    const m0 = monthWord(o.month);
    return {
      id: o.id, pos: o.pos, kind: "tall", title: TITLE[s.metric](m0),
      note: "Beban tetap bulan ini belum ada (jadwal Finance dan FINAL bulan lalu kosong, C55), jadi NIBT setelah beban tetap belum bisa digambar. Grafik tidak menampilkan NIBT jurnal sebagai penggantinya.",
      views: [{ label: "Ukuran grafik kumulatif", current: s.metric, options: CUMULATIVE_METRICS.map((c) => ({ value: c.key, label: c.label, href: o.href(c.key) })) }],
      cara: { title: "Grafik kumulatif", fn: `cumulativeSeries('${s.metric}')`, rule: "Tanpa nominal beban tetap, ukuran ini tidak diketahui dan tidak digambar.", period: `${m0} ${o.month.slice(0, 4)}`, basis: "pl_daily_v4", sources: [{ label: "Tabel", value: "pl_daily_v4" }] },
      content: { type: "line", plot: { xLabels: s.dates.map((d) => day(d)), series: [{ key: "a", tone: "a", points: s.actual.map(jtNum) }, { key: "o", tone: "o", dash: true, points: s.outlook.map(jtNum) }], marks: [], cutIndex: null }, legend: [{ tone: "s1", label: "actual" }, { tone: "s2", label: "outlook" }] },
    };
  }
  const fpart = s.cutIndex < n - 1;
  const plot: LinePlot = {
    xLabels: s.dates.map((d) => day(d)),
    series: [
      { key: "a", tone: "a", points: s.actual.map(jtNum) },
      { key: "o", tone: "o", dash: true, points: s.outlook.map(jtNum) },
      ...(o.budget ? [{ key: "b", tone: "b" as const, dash: true, points: o.budget }] : []),
    ],
    band: fpart ? { low: s.low.map(jtNum), high: s.high.map(jtNum), title: `Band ± ${pctV4(o.tolerance, 0)} pada porsi forecast` } : undefined,
    marks: [
      ...(s.cutIndex >= 0 && s.mtd !== null ? [{ series: "a", i: s.cutIndex, text: `MTD ${jtV4(s.mtd)}`, place: "above" as const }] : []),
      { series: "o", i: n - 1, text: `Outlook ${jtV4(s.total)}`, place: "above" as const },
      ...(fpart ? [{ series: "o", i: n - 1, text: `${jtV4(s.bandLow)}–${jtV4(s.bandHigh)}`, place: "below" as const }] : []),
    ],
    cutIndex: s.cutIndex >= 0 && s.cutIndex < n - 1 ? s.cutIndex : null,
  };
  const m = monthWord(o.month);
  const fw = fixedWords(o.fixed);
  const lead: Record<CumulativeMetric, string> = {
    revenue: "Actual dari jurnal; sisa bulan PO, hari tanpa PO run-rate.",
    cogs: "COGS sisa bulan = biaya per kg SKU × kg PO; hari run-rate dari margin acuan.",
    gp: "GP per hari forecast dari engine: PO pada biaya per kg SKU, run-rate pada margin acuan.",
    nibt: fw ? `Belum memuat ${fw}; akun ini baru dijurnal saat tutup buku.` : "NIBT menurut jurnal.",
    nibt_after: fw ? `Beban tetap (${fw}) dibagi rata per hari kalender.` : "Belum ada nominal beban tetap.",
  };
  return {
    id: o.id, pos: o.pos, kind: "tall", title: TITLE[s.metric](m),
    note: `${lead[s.metric]}${fpart ? ` Band ±${pctV4(o.tolerance, 0)} hanya pada porsi forecast: ${jtV4(s.bandLow)} s.d. ${jtV4(s.bandHigh)} jt.` : ""}`,
    views: [{ label: "Ukuran grafik kumulatif", current: s.metric, options: CUMULATIVE_METRICS.map((c) => ({ value: c.key, label: c.label, href: o.href(c.key) })) }],
    cara: {
      title: "Grafik kumulatif", fn: `cumulativeSeries('${s.metric}')`, rule: "Jumlah berjalan per hari: jurnal s.d. cut-off, sesudahnya PO atau run-rate. Band = ± toleransi × jumlah forecast berjalan, hanya setelah cut-off.",
      period: `${m} ${o.month.slice(0, 4)}`, basis: "pl_daily_v4", sources: [{ label: "Tabel", value: "pl_daily_v4" }],
    },
    content: { type: "line", plot, legend: [{ tone: "s1", label: "actual" }, { tone: "s2", label: "outlook" }, ...(o.budget ? [{ tone: "s3" as const, label: "budget" }] : [])] },
  };
}

/** Rows to show of PL_TABLE_ROWS (re-exported for tests). */
export const PL_ROWS = PL_TABLE_ROWS;

// ------------------------------------------------------------------------------------------------ Outlook bulan (flag v5_pl)

export interface OutlookBulanV5 {
  /** Rows of the month including the fixed-cost estimate rows (basis fixed_estimate). */
  rows: PlRowV4[];
  fixed: FixedSource[];
  pl: "rr" | "wk";
  cm: CumulativeMetric;
  /** Query-string link builder of the page. */
  href: (q: { pl?: string; cm?: string }) => string;
  /** R66 (K63): how the two v5 costing rows count in the journal columns ('cogs' = v5 behaviour); the selected version's own definition for a locked version. */
  mode?: CostingRowsMode;
  /** R67: the label of the forecast COGS (plan cost / MA cost), from the month builder's note. */
  forecastText?: string | null;
}

/**
 * PRD v5 §6.2 on the v4 Outlook bulan: the P&L tile (K30, default Actual vs run-rate) at rows 5–8 across, the tiles
 * below moved down four rows, the cards and the headline with NIBT according to the journal and after fixed costs (K29),
 * and the cumulative chart with a choice of measure (K31).
 */
export function outlookBulanV5(tiles: TileModel[], x: { first: string; cutOff: string; tolerance: string; budget: BudgetRow[]; status: string; v5: OutlookBulanV5 }): TileModel[] {
  const e = { cumulativeSeries, plBudgetOf, plTable, plTotalsV5 };
  const m = monthWord(x.first);
  const rows = x.v5.rows;
  const mode = x.v5.mode ?? "cogs";
  const actual = e.plTotalsV5(rows.filter((r) => r.date <= x.cutOff), undefined, mode);
  const forecast = e.plTotalsV5(rows.filter((r) => r.date > x.cutOff), undefined, mode);
  const outlook = e.plTotalsV5(rows, undefined, mode);
  const fw = fixedWords(x.v5.fixed);
  const neg = (v: Decimal) => (v.lt(0) ? "neg" as const : undefined);
  // K51: no fixed nominal at all → NIBT after fixed costs is not known
  const missing = fixedAllMissing(x.v5.fixed);
  const after = (v: Decimal) => (missing ? "belum ada" : `${jtV4(v)} jt`);
  const out: TileModel[] = [];
  for (const t of tiles) {
    const moved = t.pos.y >= 4 ? { ...t, pos: { ...t.pos, y: t.pos.y + 4 } } : t;
    if (t.id === "headline" && t.content.type === "headline") {
      const gpPct = outlook.revenue.isZero() ? null : outlook.gp.div(outlook.revenue);
      out.push({ ...t, content: { type: "headline", text: `Outlook ${m}: revenue Rp ${jtV4(outlook.revenue)} jt, GP Rp ${jtV4(outlook.gp)} jt${gpPct ? ` (${pctV4(gpPct)})` : ""}, NIBT Rp ${jtV4(outlook.nibt)} jt menurut jurnal${missing ? "; beban tetap bulan ini belum ada (C55)" : ` atau Rp ${jtV4(outlook.nibtAfter)} jt setelah ${fw || "beban tetap"}`}.` } });
    } else if (t.content.type === "card" && (t.id === "c-actual" || t.id === "c-forecast" || t.id === "c-outlook") && t.content.value !== null) {
      const tot = t.id === "c-actual" ? actual : t.id === "c-forecast" ? forecast : outlook;
      const keep = t.content.compare.filter((c) => c.label !== "NIBT" && c.label !== "GP P&L");
      const gp = { label: "GP P&L", value: `${jtV4(tot.gp)} jt`, tone: neg(tot.gp) };
      const nj = { label: "NIBT jurnal", value: `${jtV4(tot.nibt)} jt`, tone: neg(tot.nibt) };
      const na = { label: "NIBT setelah beban tetap", value: after(tot.nibtAfter), tone: missing ? undefined : neg(tot.nibtAfter) };
      // PRD v5.1 R38 (§6.5): NIBT after fixed costs on all three cards (at most four lines)
      const compare = t.id === "c-outlook" ? [...keep, gp, nj, na] : t.id === "c-forecast" ? [gp, nj, na, ...keep] : [gp, nj, na];
      out.push({ ...t, content: { ...t.content, compare, maxCompare: 4 } });
    } else if (t.id === "ch-kumulatif") {
      const s = e.cumulativeSeries(x.v5.cm, x.first, rows, x.cutOff, x.tolerance, { mode, fixedMissing: missing });
      const budget = x.v5.cm === "revenue" && t.content.type === "line" ? t.content.plot.series.find((q) => q.key === "b")?.points ?? null : null;
      out.push(cumulativeTile(s, { id: t.id, pos: moved.pos, month: x.first, tolerance: x.tolerance, href: (cm) => x.v5.href({ cm }), fixed: x.v5.fixed, budget }));
    } else out.push(moved);
  }
  const table = e.plTable(x.v5.pl, x.first, { rows, cutOff: x.cutOff, budget: e.plBudgetOf(x.budget), nominals: x.v5.fixed, mode });
  out.push(plTableTile(table, { id: "t-laba-rugi", pos: { x: 0, y: 4, w: 12, h: 4 }, hrefs: { rr: x.v5.href({ pl: "rr" }), wk: x.v5.href({ pl: "wk" }) }, fixed: x.v5.fixed, status: x.status, mode, forecastText: x.v5.forecastText }));
  return out;
}

// ------------------------------------------------------------------------------------------------ Minggu ini (flag v5_pl)

export interface MingguIniV5Pl {
  /** R66 (K63): how the two v5 costing rows count in the journal columns ('cogs' = v5 behaviour). */
  mode?: CostingRowsMode;
  first: string;
  cutOff: string;
  rows: PlRowV4[];
  fixed: FixedSource[];
  pl: "rr" | "wk";
  href: (pl: "rr" | "wk") => string;
}

/**
 * PRD v5 §6.1 tile "Laba rugi <bulan>" on the v4 Minggu ini (K30): default Per minggu with the selected week
 * highlighted, the running week split into actual and rest under "Aktual s.d. kemarin"; the month card carries NIBT
 * after fixed costs (K29). The tiles from row 5 move down four rows.
 */
export function mingguIniV5(tiles: TileModel[], x: { v5: MingguIniV5Pl; weekStart: string; split: boolean }): TileModel[] {
  const mode = x.v5.mode ?? "cogs";
  const outlook = plTotalsV5(x.v5.rows, undefined, mode);
  const missing = fixedAllMissing(x.v5.fixed);
  const out = tiles.map((t): TileModel => {
    const moved = t.pos.y >= 4 ? { ...t, pos: { ...t.pos, y: t.pos.y + 4 } } : t;
    if (t.id === "c-bulan" && t.content.type === "card") {
      return { ...moved, content: { ...t.content, compare: [...t.content.compare.filter((c) => c.label !== "vs budget"), { label: "NIBT setelah beban tetap", value: missing ? "belum ada" : `${jtV4(outlook.nibtAfter)} jt`, tone: !missing && outlook.nibtAfter.lt(0) ? "neg" : undefined }, ...t.content.compare.filter((c) => c.label === "vs budget")] } };
    }
    return moved;
  });
  const table = plTable(x.v5.pl, x.v5.first, { rows: x.v5.rows, cutOff: x.v5.cutOff, highlight: x.weekStart, split: x.split && x.v5.pl === "wk", nominals: x.v5.fixed, mode });
  out.push(plTableTile(table, { id: "t-laba-rugi", pos: { x: 0, y: 4, w: 12, h: 4 }, hrefs: { rr: x.v5.href("rr"), wk: x.v5.href("wk") }, fixed: x.v5.fixed, status: "draft", mode }));
  return out;
}
