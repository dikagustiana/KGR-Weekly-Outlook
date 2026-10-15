import "server-only";
/**
 * v3 upload kinds (PRD v3 §5) plugged into the existing wizard (file → preview → commit). Each kind belongs to a
 * module: it is offered only when that module's flag is on for the role, and its commit refuses otherwise.
 */
import type { Sheet } from "@kgr/parsers";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import type { WeekRow } from "../data";
import type { Role } from "../roles";
import type { ModuleKey } from "../modules-core";

export type Row = Record<string, unknown>;

export interface PlanLine {
  table: string;
  label: string;
  inserts: number;
  updates: number;
  deletes: number;
  supersede: number;
  unchanged: number;
  notes: string[];
}

export interface V3Stage {
  rows: { target: string; data: Row }[];
  plan: PlanLine[];
  issues: string[];
  note: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  sample: Row[];
  unmappedItems: { code: string; name: string | null; suggested: string | null }[];
}

export interface V3Commit {
  inserted: number;
  updated: number;
  deleted: number;
  message: string;
  /** Dates whose data mart must be rebuilt. */
  dates: string[];
}

export interface V3Kind {
  kind: string;
  module: ModuleKey;
  label: string;
  description: string;
  target: string;
  source: "Accurate" | "Ops" | "Manual";
  roles: Role[];
  stage(c: { sb: Supa; viewer: Viewer; week: WeekRow; sheets: Sheet[]; fileName: string }): Promise<V3Stage>;
  commit(c: { sb: Supa; viewer: Viewer; week: WeekRow; uploadId: string; rows: { target: string; data: Row }[] }): Promise<V3Commit>;
}

export const V3_KINDS: V3Kind[] = [];

export function registerV3Kind(k: V3Kind): void {
  if (!V3_KINDS.some((x) => x.kind === k.kind)) V3_KINDS.push(k);
}

export function v3Kind(kind: string): V3Kind | undefined {
  return V3_KINDS.find((k) => k.kind === kind);
}

export const plan0 = (table: string, label: string, notes: string[] = []): PlanLine => ({ table, label, inserts: 0, updates: 0, deletes: 0, supersede: 0, unchanged: 0, notes });

/** Monday-start week containing an ISO date, among the weeks that exist. */
export function weekOfDate(weeks: WeekRow[], d: string | null | undefined): WeekRow | null {
  if (!d) return null;
  return weeks.find((w) => d >= w.week_start && d <= w.week_end) ?? null;
}
