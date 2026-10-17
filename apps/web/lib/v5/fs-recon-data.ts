import "server-only";
/**
 * Reads for the Rekonsiliasi page and for C59 (PRD v5.2-A R69, PRD v5.2-B B-R86): the FS rows of a month
 * (`fs_statement_line`), the mapping app ↔ FS (`fs_line_map`), the app's balance sheet at the month end (trial balance of
 * the week + journal), the P&L of a locked FINAL, and the costing mode. A failing read throws (K41): an empty result is
 * "FS belum diimpor", never an error read as nothing. Pages through fetchAll ordered by the unique keys (K42).
 *
 * The two FS tables exist only after B-R86 is applied: this code is merged after it (PRD v5.2-A Bab 4).
 */
import {
  appBsLines, isCostingRowsMode, monthEnd,
  type CostingRowsMode, type FsLine, type FsMapEntry, type FsStatement, type PlAmount,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import { LoaderError, must } from "../loader";
import { buildFsRecon, inFsReconScope, plLinesFromSnapshot, type BsSide, type FsMeta, type FsReconModel, type FsReconTile } from "./fs-recon";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** `app_setting` v5_pl.costing_rows_mode (R66): 'cogs' (no value = the default) or 'memo'; any other value is refused. */
export async function loadCostingRowsMode(sb: Supa): Promise<CostingRowsMode> {
  const r = must(await sb.from("app_setting").select("value").eq("key", "v5_pl").maybeSingle(), "fs-recon.app_setting") as { value?: { costing_rows_mode?: unknown } | null } | null;
  const v = r?.value?.costing_rows_mode;
  if (v === undefined || v === null || v === "") return "cogs";
  if (!isCostingRowsMode(v)) throw new LoaderError("fs-recon.costing_rows_mode", `nilai tidak dikenal: ${String(v)} (cogs atau memo)`);
  return v;
}

/** The mapping Finance keeps in `fs_line_map` (B-R86): a row that cannot be read as a map entry stops the page. */
export async function loadFsMap(sb: Supa): Promise<FsMapEntry[]> {
  const rows = await fetchAll<Row>((a, b) => sb.from("fs_line_map").select("statement, row_no, app_line, sign, note").order("statement").order("row_no").range(a, b));
  return rows.map((r) => {
    const statement = String(r.statement), sign = Number(r.sign), row_no = Number(r.row_no);
    if (statement !== "PL" && statement !== "BS") throw new LoaderError("fs-recon.fs_line_map", `statement tidak dikenal: ${statement}`);
    if (sign !== 1 && sign !== -1) throw new LoaderError("fs-recon.fs_line_map", `tanda ${String(r.sign)} di ${statement} b.${row_no} bukan 1 atau -1`);
    if (!Number.isInteger(row_no) || !s(r.app_line)) throw new LoaderError("fs-recon.fs_line_map", `baris pemetaan tidak lengkap: ${statement} b.${String(r.row_no)}`);
    return { statement: statement as FsStatement, row_no, app_line: String(r.app_line), sign: sign as 1 | -1, note: s(r.note) };
  });
}

/** FS rows of a month, the newest version of each row (a correction is a new version, K70), and where they came from. */
export async function loadFsRows(sb: Supa, first: string): Promise<{ rows: FsLine[]; meta: FsMeta | null }> {
  const all = await fetchAll<Row>((a, b) => sb.from("fs_statement_line").select("statement, row_no, line, amount, source_file, source_sha256, version, locked_at")
    .eq("month", first).order("statement").order("row_no").order("version").range(a, b));
  const newest = new Map<string, Row>();
  for (const r of all) {
    const k = `${String(r.statement)}|${String(r.row_no)}`;
    const o = newest.get(k);
    if (!o || Number(r.version) > Number(o.version)) newest.set(k, r);
  }
  const rows: FsLine[] = [...newest.values()].map((r): FsLine => {
    const statement = String(r.statement);
    if (statement !== "PL" && statement !== "BS") throw new LoaderError("fs-recon.fs_statement_line", `statement tidak dikenal: ${statement}`);
    return { statement, row_no: Number(r.row_no), line: String(r.line ?? ""), amount: s(r.amount) };
  }).sort((a, b) => (a.statement === b.statement ? a.row_no - b.row_no : a.statement === "PL" ? -1 : 1));
  if (!rows.length) return { rows, meta: null };
  const version = Math.max(...[...newest.values()].map((r) => Number(r.version)));
  const latest = [...newest.values()].filter((r) => Number(r.version) === version);
  const locked = latest.map((r) => s(r.locked_at)).filter((v): v is string => v !== null).sort();
  return {
    rows,
    meta: { version, sourceFile: s(latest[0].source_file), sha256: s(latest[0].source_sha256), lockedAt: locked.length === latest.length ? locked[locked.length - 1] : null, rows: rows.length },
  };
}

/**
 * The app's balance sheet at the month end: the trial balance of the latest week that starts by then, plus the journal
 * after the trial balance date up to the month end. null = no trial balance yet (the lines are then missing, never 0).
 */
export async function loadAppBs(sb: Supa, first: string): Promise<(BsSide & { latestJournal: string | null }) | null> {
  const last = monthEnd(first);
  const wk = must(await sb.from("week").select("id, tb_opening_date").lte("week_start", last).order("week_start", { ascending: false }).limit(1).maybeSingle(), "fs-recon.week") as Row | null;
  if (!wk) return null;
  const tbDate = String(wk.tb_opening_date);
  if (tbDate > last) return null;
  const [tb, coa, gl] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("tb_opening").select("account, balance").eq("week_id", String(wk.id)).is("deleted_at", null).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, type, bs_line").is("deleted_at", null).order("account").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gt("date", tbDate).lte("date", last).order("id").range(a, b)),
  ]);
  const r = appBsLines({
    tb: tb.map((t) => ({ account: String(t.account), balance: s(t.balance) })),
    gl: gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) })),
    coa: coa.map((c) => ({ account: String(c.account), type: String(c.type), bs_line: s(c.bs_line) })),
    date: last, tbDate,
  });
  const dates = gl.map((g) => s(g.date)).filter((d): d is string => d !== null).sort();
  return { lines: r.lines, unplaced: r.unplaced, tbDate, latestJournal: dates.length ? dates[dates.length - 1] : null };
}

/** P&L per line of a locked FINAL (its snapshot rows and adjustments); null = FINAL not locked yet. */
export async function loadFinalSnapshotPl(sb: Supa, first: string): Promise<PlAmount[] | null> {
  const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "fs-recon.month_outlook") as Row | null;
  if (!mo) return null;
  const v = must(await sb.from("month_outlook_version").select("snapshot, locked_at").eq("month_outlook_id", String(mo.id)).eq("version", "FINAL").maybeSingle(), "fs-recon.month_outlook_version") as Row | null;
  if (!v) return null;
  const lines = plLinesFromSnapshot(v.snapshot);
  // a locked FINAL is the reference: one that carries no P&L rows is refused, not replaced by the live month
  if (!lines) throw new LoaderError("fs-recon.month_outlook_version", `FINAL ${first.slice(0, 7)} tidak memuat baris laba rugi v4 di snapshot`);
  return lines;
}

/**
 * App numbers of the month against the FS (C59 and the page). null = the month is before August 2026 (O27). `plLines`
 * are the month's P&L per line: the locked FINAL, or the journal so far (appSource).
 */
export async function loadFsRecon(sb: Supa, first: string, x: { plLines: PlAmount[]; appSource: "FINAL" | "berjalan"; today: string }): Promise<FsReconModel | null> {
  if (!inFsReconScope(first)) return null;
  const last = monthEnd(first);
  const [mode, map, fs, bs] = await Promise.all([loadCostingRowsMode(sb), loadFsMap(sb), loadFsRows(sb, first), loadAppBs(sb, first)]);
  return buildFsRecon({
    first, last, plLines: x.plLines, appSource: x.appSource, mode, bs, fsRows: fs.rows, fsMeta: fs.meta, map,
    complete: x.today > last, latestJournal: bs?.latestJournal ?? null,
  });
}

/**
 * The C59 summary of a FINAL month for the accuracy tile of Outlook bulan: its locked snapshot against the imported FS.
 * null = not judged (before August 2026, or no FINAL P&L).
 */
export async function loadFsReconTile(sb: Supa, month: string, today: string): Promise<FsReconTile | null> {
  if (!inFsReconScope(month)) return null;
  const pl = await loadFinalSnapshotPl(sb, month);
  const m = pl ? await loadFsRecon(sb, month, { plLines: pl, appSource: "FINAL", today }) : null;
  if (!m) return null;
  const c = m.result;
  return { status: c.c59.status, hasFs: m.hasFs, mapped: c.summary.mapped, beda: c.summary.beda, missing: c.summary.missing, href: `/m/${month.slice(0, 7)}/rekonsiliasi` };
}
