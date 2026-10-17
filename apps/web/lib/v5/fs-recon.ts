/**
 * PRD v5.2-A R69 (T15, K62, O25–O27): the reconciliation of the app's month against the FS, as one model for the page
 * Rekonsiliasi, the C59 control of the FINAL lock and the accuracy tile. Pure: the loaders (fs-recon-data.ts) bring the
 * rows in, the arithmetic is @kgr/engine (appPlLines, appBsLines, fsRecon). Nothing here adds a number.
 */
import {
  addDays, appPlLines, fsRecon, plLineAmounts, reconHints,
  type AppLine, type CostingRowsMode, type Decimal, type FsLine, type FsMapEntry, type PlAmount, type ReconResult,
} from "@kgr/engine";

/** O27: months before August 2026 are out of scope; the opening balance is the TB of 31 Jul 2026. */
export const FS_RECON_FROM = "2026-08-01";
export const inFsReconScope = (first: string): boolean => first >= FS_RECON_FROM;

/**
 * Roles that read the Rekonsiliasi page: admin, finance and management (PRD v5.2-A R69), and operations_director, who
 * reads every screen like management (K37) and whom RLS on fs_statement_line lets read (PRD v5.2-B B-R86).
 */
export const REKONSILIASI_ROLES = ["admin", "finance", "management", "operations_director"] as const;

/** Where the FS rows of the month came from (fs_statement_line, B-R86): the newest version and its source file. */
export interface FsMeta {
  version: number;
  sourceFile: string | null;
  sha256: string | null;
  lockedAt: string | null;
  rows: number;
}

/** What the accuracy tile of Outlook bulan says about the month's reconciliation with the FS (C59). */
export interface FsReconTile {
  status: string;
  hasFs: boolean;
  mapped: number;
  beda: number;
  missing: number;
  href: string;
}

export interface BsSide {
  lines: AppLine[];
  /** Accounts the chart of accounts cannot place (the balance sheet would not balance by their amount). */
  unplaced: { account: string; net: Decimal }[];
  /** Date of the trial balance the balances start from. */
  tbDate: string | null;
}

export interface FsReconModel {
  first: string;
  last: string;
  mode: CostingRowsMode;
  /** "FINAL" = the locked FINAL version; "berjalan" = the journal of the month so far (not locked). */
  appSource: "FINAL" | "berjalan";
  /** Last date the journal is taken to cover (the month end once the month is over). */
  journalThrough: string;
  /** false = no FS row imported for the month: nothing to compare, C59 is not judged and does not hold FINAL. */
  hasFs: boolean;
  fs: FsMeta | null;
  result: ReconResult;
  /** Mode 'memo': the v5 rows kept out of COGS, GP and NIBT (shown as memo lines). */
  memo: PlAmount[];
  v5: Decimal;
  tbDate: string | null;
  unplaced: BsSide["unplaced"];
}

const NO_BS = (): BsSide => ({ lines: [], unplaced: [], tbDate: null });

/** App numbers (PL of the month, balance sheet at its end) against the FS rows through the map; the causes as the app knows them. */
export function buildFsRecon(x: {
  first: string;
  last: string;
  plLines: PlAmount[];
  appSource: FsReconModel["appSource"];
  mode: CostingRowsMode;
  bs: BsSide | null;
  fsRows: FsLine[];
  fsMeta: FsMeta | null;
  map: FsMapEntry[];
  /** The month is over: its journal is taken as complete up to the month end. */
  complete: boolean;
  /** Latest journal date seen in the month (open month only); null = none. */
  latestJournal: string | null;
}): FsReconModel {
  const pl = appPlLines({ lines: x.plLines, costingRowsMode: x.mode });
  const bs = x.bs ?? NO_BS();
  const app = [...pl.lines, ...bs.lines];
  const journalThrough = x.complete ? x.last : x.latestJournal ?? addDays(x.first, -1);
  const hints = reconHints({ journalThrough, monthEnd: x.last, costingRowsMode: x.mode, v5: pl.v5, appLines: app.map((l) => l.app_line) });
  const result = fsRecon({ app, fs: x.fsRows, map: x.map, hints });
  return {
    first: x.first, last: x.last, mode: x.mode, appSource: x.appSource, journalThrough, hasFs: x.fsRows.length > 0, fs: x.fsMeta, result,
    memo: pl.memo, v5: pl.v5, tbDate: bs.tbDate, unplaced: bs.unplaced,
  };
}

/** P&L amounts per line of a locked FINAL snapshot: its rows (actual) plus the closing adjustments it carries. null = not a v4 snapshot. */
export function plLinesFromSnapshot(snapshot: unknown): PlAmount[] | null {
  const s = snapshot as { rows?: { pl_line: string; basis: string; actual: string | null }[]; adjustments?: { pl_line: string; amount: string }[] } | null;
  if (!s || !Array.isArray(s.rows) || !s.rows.length) return null;
  return plLineAmounts(s.rows, (s.adjustments ?? []).map((a) => ({ pl_line: a.pl_line, amount: a.amount })));
}
