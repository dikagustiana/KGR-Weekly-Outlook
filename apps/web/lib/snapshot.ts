import "server-only";
/**
 * PRD v6 bagian A (K77–K80, R119, R122): hitung sekali, baca banyak. `week_snapshot` holds the whole WeekResult of a
 * week (lossless codec, @kgr/engine result-codec); the rebuild worker and the release write it with the service client,
 * pages read the latest version. A new version is written only when the inputs or the engine changed (inputs_hash,
 * engine_version); a released or closed week is never computed again (K77).
 */
import { createHash } from "node:crypto";
import { decodeResult, encodeResult, type WeekInputs, type WeekResult } from "@kgr/engine";
import type { Supa } from "./supabase";
import { LoaderError, isSchemaError } from "./loader";
import { WriteError } from "./write";
import { computeForWeek, WORKER_PAGES, type Computed, type WeekRow } from "./data";

export interface SnapshotMeta {
  id: string;
  version: number;
  engineVersion: string;
  inputsHash: string;
  builtAt: string;
  builtBy: string;
}

export interface Snapshot {
  result: WeekResult;
  meta: SnapshotMeta;
}

/** K79: sha256 of every input row loadWeek read (the WeekInputs, in loadWeek's fixed order). */
export function inputsHash(inputs: WeekInputs): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

const META_COLS = "id, version, engine_version, inputs_hash, built_at, built_by";

type MetaRow = { id: string; version: number; engine_version: string; inputs_hash: string; built_at: string; built_by: string };
const metaOf = (r: MetaRow): SnapshotMeta => ({
  id: String(r.id), version: Number(r.version), engineVersion: String(r.engine_version), inputsHash: String(r.inputs_hash),
  builtAt: String(r.built_at), builtBy: String(r.built_by),
});

/**
 * R119: the latest snapshot of a week, or null when there is none. A database without `week_snapshot` (bundle v6 not
 * applied yet) reads as "no snapshot" and is logged, so the page falls back to computing (K80) instead of failing.
 */
export async function readSnapshot(sb: Supa, weekId: string): Promise<Snapshot | null> {
  const { data, error } = await sb.from("week_snapshot").select(`${META_COLS}, result`).eq("week_id", weekId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      console.error(`[snapshot] week_snapshot belum ada (bundel v6 belum diterapkan): ${error.message}`);
      return null;
    }
    throw new LoaderError("readSnapshot.week_snapshot", error.message, isSchemaError(error.code), error.code);
  }
  if (!data) return null;
  const row = data as MetaRow & { result: unknown };
  return { result: decodeResult(row.result), meta: metaOf(row) };
}

/** The latest snapshot's meta without its result (the rebuild compares hashes; no need to download the JSON). */
export async function latestSnapshotMeta(sb: Supa, weekId: string): Promise<SnapshotMeta | null> {
  const { data, error } = await sb.from("week_snapshot").select(META_COLS).eq("week_id", weekId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new LoaderError("latestSnapshotMeta.week_snapshot", error.message, isSchemaError(error.code), error.code);
  return data ? metaOf(data as MetaRow) : null;
}

export type WriteOutcome = { status: "written" | "unchanged"; meta: SnapshotMeta };

/**
 * R119 / R122: write the snapshot of a computed week with the service client. Same inputs_hash and engine_version as the
 * latest version → nothing is written ("unchanged"). Two runs racing for the same version: the loser reads the winner's
 * row (unique (week_id, version)) and reports it.
 */
export async function writeSnapshot(svc: Supa, weekId: string, result: WeekResult, meta: { inputsHash: string; builtBy: string }): Promise<WriteOutcome> {
  const last = await latestSnapshotMeta(svc, weekId);
  if (last && last.inputsHash === meta.inputsHash && last.engineVersion === result.engineVersion) return { status: "unchanged", meta: last };
  const next = last ? last.version + 1 : 1;
  const row = {
    week_id: weekId, version: next, engine_version: result.engineVersion, inputs_hash: meta.inputsHash,
    result: encodeResult(result), built_by: meta.builtBy,
  };
  // on conflict do nothing: the race is an empty answer, not an HTTP 409 (an e2e run counts every 4xx as unexpected)
  const { data, error } = await svc.from("week_snapshot").upsert(row, { onConflict: "week_id,version", ignoreDuplicates: true }).select(META_COLS).maybeSingle();
  if (error && error.code !== "23505") throw new WriteError(`week_snapshot: ${error.message}`);
  if (data) return { status: "written", meta: metaOf(data as MetaRow) };
  const won = await latestSnapshotMeta(svc, weekId);
  if (won) return { status: won.inputsHash === meta.inputsHash ? "unchanged" : "written", meta: won };
  throw new WriteError("week_snapshot: versi bentrok, tetapi tidak ada snapshot yang terbaca");
}

/**
 * A week computed with the worker's pages and its snapshot written; null when the week does not exist. computeForWeek is
 * memoised per client, so the other builders of the same rebuild run reuse this computation.
 */
export async function buildSnapshot(sb: Supa, week: Pick<WeekRow, "id" | "week_start">, builtBy: string): Promise<(WriteOutcome & { computed: Computed }) | null> {
  const computed = await computeForWeek(sb, week.week_start, WORKER_PAGES);
  if (!computed) return null;
  const out = await writeSnapshot(sb, week.id, computed.result, { inputsHash: inputsHash(computed.loaded.inputs), builtBy });
  return { ...out, computed };
}

/** K79: "dihitung 28 Agu 17.05" from built_at (WIB), the line that replaces "dihitung dalam N ms". */
export function builtAtLabel(builtAt: string): string {
  const d = new Date(builtAt);
  if (Number.isNaN(d.getTime())) return "";
  const s = d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return `dihitung ${s.replace(/\./g, ":").replace(/,/g, "").replace(/(\d{2}):(\d{2})$/, "$1.$2")}`;
}

/**
 * B-R120 (irisan 1 gate): the one-off build of every week's snapshot after the v6 bundle — open weeks as the worker
 * would, and released / closed weeks once (their inputs are frozen, so the snapshot equals what was released), each
 * release without snapshot_id linked to its week's snapshot. Re-runnable: unchanged inputs write nothing.
 */
export async function backfillSnapshots(svc: Supa): Promise<string[]> {
  const weeks = (await svc.from("week").select("id, week_start, status").order("week_start"));
  if (weeks.error) throw new LoaderError("backfill.week", weeks.error.message, isSchemaError(weeks.error.code), weeks.error.code);
  const out: string[] = [];
  for (const w of (weeks.data ?? []) as Pick<WeekRow, "id" | "week_start" | "status">[]) { // k41-ok: error dilempar di atas
    const o = await buildSnapshot(svc, w, "backfill v6");
    if (!o) continue;
    let linked = 0;
    if (w.status !== "open") {
      const r = await svc.from("release").update({ snapshot_id: o.meta.id }).eq("week_id", w.id).is("snapshot_id", null).select("id");
      if (r.error) throw new WriteError(`release.snapshot_id ${w.week_start}: ${r.error.message}`);
      linked = (r.data ?? []).length; // k41-ok: error dilempar di atas
    }
    out.push(`${w.week_start} v${o.meta.version} ${o.status === "written" ? "ditulis" : "tidak berubah"}${linked ? `, ${linked} rilis ditautkan` : ""}`);
  }
  return out;
}
