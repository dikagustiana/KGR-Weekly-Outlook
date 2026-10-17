/**
 * PRD v5.2-A R68 (T15, K62, O25–O27): reconcile the app's numbers against the FS (Management Report) per line.
 * Pure — the numbers come from the caller: `app` = the app's lines (PL FINAL of the month, balance sheet at the month
 * end, bank balance; see fs-app.ts), `fs` = the imported FS rows `{statement, line, row_no, amount}` (table
 * `fs_statement_line`, PRD v5.2-B B-R86), `map` = pairs app line ↔ FS row (`fs_line_map`, fs-map.ts).
 *
 * The FS is a separate reference (K62): it never replaces an app number and a difference is shown, never closed.
 * selisih = app (× sign) − FS. A pair within the tolerance (default Rp 1, O26) is "sama".
 */
import { D, ZERO, type Decimal, type Num } from "./decimal";
import { fixed } from "./format";
import type { ControlV3 } from "./controls-v3";
import { APP_LINE_LABEL, fsKey, type FsMapEntry, type FsStatement } from "./fs-map";

export type ReconStatus = "sama" | "beda" | "tidak ada di app" | "tidak ada di FS";

/**
 * Why a line differs or is missing (R69 "sebab"): `data belum ada` (a side is missing or only partly loaded),
 * `definisi` (the two sides do not mean the same thing, REVIEW-v5.1 §7) or `selisih` (same definition and complete
 * data: a real difference Finance has to explain).
 */
export type ReconCause = "data belum ada" | "definisi" | "selisih";

/** Default tolerance of C59 (O26): |selisih| ≤ Rp 1. */
export const RECON_TOLERANCE = "1";

/** One number of the app. `amount` null = the app has no number for the line (never read as 0). */
export interface AppLine {
  app_line: string;
  amount: Num | null;
}

/** One FS row as stored in `fs_statement_line`. */
export interface FsLine {
  statement: FsStatement;
  line: string;
  row_no: number;
  amount: Num | null;
}

/** A known cause of a difference on an app line, given by the caller who knows how the app side was built. */
export interface ReconHint {
  cause: ReconCause;
  note: string;
}

export interface ReconInput {
  app: AppLine[];
  fs: FsLine[];
  /** Pairs app line ↔ FS row; rows of `fs` outside the map are listed as "tidak ada di app" and never count for C59. */
  map: FsMapEntry[];
  /** |selisih| ≤ tolerance counts as "sama" (default Rp 1, O26). */
  tolerance?: Num;
  /** Known cause per app line, used when the line is "beda" (default cause: `selisih`). */
  hints?: Record<string, ReconHint>;
}

export interface ReconLine {
  /** "PL b.12"; an app line outside the map is keyed by its app_line. */
  key: string;
  statement: FsStatement | null;
  row_no: number | null;
  /** The FS label of the row (null when the FS has no such row). */
  fs_line: string | null;
  app_line: string | null;
  /** Display label of the app line. */
  label: string;
  /** In the map (counts for C59) or listed only because one side has it. */
  mapped: boolean;
  /** App amount × sign; null = the app has no number. */
  app: Decimal | null;
  fs: Decimal | null;
  /** app − FS; null when a side is missing. */
  selisih: Decimal | null;
  status: ReconStatus;
  /** null when "sama". */
  cause: ReconCause | null;
  note: string | null;
}

export interface ReconSummary {
  mapped: number;
  sama: number;
  beda: number;
  /** Mapped pairs with a missing side. */
  missing: number;
  /** FS rows and app lines outside the map. */
  unmapped: number;
}

export interface ReconResult {
  lines: ReconLine[];
  summary: ReconSummary;
  tolerance: Decimal;
  c59: ControlV3;
}

const NOT_MAPPED = "belum dipetakan (O27 a: Management Report, baris kunci dulu)";

function unique<T>(xs: T[], key: (x: T) => string, what: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of xs) {
    const k = key(x);
    if (m.has(k)) throw new Error(`${what} ganda: ${k}`);
    m.set(k, x);
  }
  return m;
}

/** decimal.js keeps a negative zero (−0 × 1, 0 × −1): "-0.00" must never reach a table or a comparison. */
const nz = (d: Decimal): Decimal => (d.isZero() ? ZERO : d);
const dn = (v: Num | null | undefined): Decimal | null => (v === null || v === undefined || v === "" ? null : nz(D(v)));

/** Per-line reconciliation + the C59 control: GAGAL while a mapped pair differs beyond the tolerance. */
export function fsRecon(x: ReconInput): ReconResult {
  const tol = D(x.tolerance ?? RECON_TOLERANCE).abs();
  const appBy = unique(x.app, (a) => a.app_line, "baris app");
  const fsBy = unique(x.fs, (f) => fsKey(f.statement, f.row_no), "baris FS");
  const mapBy = unique(x.map, (m) => fsKey(m.statement, m.row_no), "pemetaan");
  const hints = x.hints ?? {};
  const labelOf = (app_line: string | null, fs_line: string | null) => (app_line ? APP_LINE_LABEL[app_line] ?? app_line : fs_line ?? "");
  const lines: ReconLine[] = [];
  const usedApp = new Set<string>();

  const ordered = [...mapBy.values()].sort((a, b) => (a.statement === b.statement ? a.row_no - b.row_no : a.statement === "PL" ? -1 : 1));
  for (const m of ordered) {
    usedApp.add(m.app_line);
    const key = fsKey(m.statement, m.row_no);
    const fsRow = fsBy.get(key) ?? null;
    const appRow = appBy.get(m.app_line) ?? null;
    const rawApp = dn(appRow?.amount);
    const a = rawApp === null ? null : nz(rawApp.times(m.sign));
    const f = dn(fsRow?.amount);
    const selisih = a !== null && f !== null ? nz(a.minus(f)) : null;
    const status: ReconStatus = a === null ? "tidak ada di app" : f === null ? "tidak ada di FS" : selisih!.abs().lte(tol) ? "sama" : "beda";
    const hint = hints[m.app_line];
    let cause: ReconCause | null = null;
    let note: string | null = null;
    if (status === "beda") { cause = hint?.cause ?? "selisih"; note = hint?.note ?? null; }
    else if (status !== "sama") { cause = "data belum ada"; note = hint?.cause === "data belum ada" ? hint.note : status === "tidak ada di app" ? "app belum punya angka untuk baris ini" : "FS belum diimpor untuk baris ini"; }
    lines.push({
      key, statement: m.statement, row_no: m.row_no, fs_line: fsRow?.line ?? null, app_line: m.app_line, label: labelOf(m.app_line, fsRow?.line ?? null),
      mapped: true, app: a, fs: f, selisih, status, cause, note,
    });
  }

  // FS rows outside the map, then app lines outside the map: listed with a cause, never counted for C59
  const unmappedFs = [...fsBy.entries()].filter(([k]) => !mapBy.has(k)).map(([, f]) => f)
    .sort((a, b) => (a.statement === b.statement ? a.row_no - b.row_no : a.statement === "PL" ? -1 : 1));
  for (const f of unmappedFs) {
    lines.push({
      key: fsKey(f.statement, f.row_no), statement: f.statement, row_no: f.row_no, fs_line: f.line, app_line: null, label: f.line,
      mapped: false, app: null, fs: dn(f.amount), selisih: null, status: "tidak ada di app", cause: "definisi", note: NOT_MAPPED,
    });
  }
  for (const a of x.app) {
    if (usedApp.has(a.app_line)) continue;
    lines.push({
      key: a.app_line, statement: null, row_no: null, fs_line: null, app_line: a.app_line, label: labelOf(a.app_line, null),
      mapped: false, app: dn(a.amount), fs: null, selisih: null, status: "tidak ada di FS", cause: "definisi", note: NOT_MAPPED,
    });
  }

  const mappedLines = lines.filter((l) => l.mapped);
  const beda = mappedLines.filter((l) => l.status === "beda");
  const missing = mappedLines.filter((l) => l.status === "tidak ada di app" || l.status === "tidak ada di FS");
  const summary: ReconSummary = {
    mapped: mappedLines.length, sama: mappedLines.filter((l) => l.status === "sama").length, beda: beda.length, missing: missing.length,
    unmapped: lines.length - mappedLines.length,
  };
  const why = (l: ReconLine) => `${l.cause}${l.note ? `: ${l.note}` : ""}`;
  const detail = [
    ...beda.map((l) => `${l.key} ${l.label}: app ${fixed(l.app!, 2)} vs FS ${fixed(l.fs!, 2)} = selisih ${fixed(l.selisih!, 2)} (${why(l)})`),
    ...missing.map((l) => `${l.key} ${l.label}: ${l.status} (${why(l)})`),
  ];
  // GAGAL = a difference beyond the tolerance (R68). A mapped pair with a missing side is never green: BELUM DIISI (missing ≠ 0).
  const status: ControlV3["status"] = beda.length ? "GAGAL" : missing.length || !mappedLines.length ? "BELUM DIISI" : "LULUS";
  const c59: ControlV3 = {
    code: "C59", module: "M4", name: "Rekonsiliasi angka app vs FS (Management Report)",
    value: D(beda.length), comparator: ZERO, difference: D(beda.length), status,
    action: status === "GAGAL" ? `Selisih app vs FS di atas toleransi Rp ${fixed(tol, 0)}: periksa baris yang beda, atau override Finance (C59)`
      : status === "BELUM DIISI" ? "Lengkapi angka app atau impor FS untuk baris yang belum ada" : "",
    detail,
  };
  return { lines, summary, tolerance: tol, c59 };
}
