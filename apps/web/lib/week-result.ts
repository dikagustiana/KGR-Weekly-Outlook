import "server-only";
/**
 * PRD v6 R120 / K80: the WeekResult a page shows. With `v6_snapshot_read` on for the viewer's role it is the latest
 * week_snapshot (one read, no loadWeek, no computeWeek on the request path). Without a snapshot — a new week, the v6
 * bundle not applied yet, or a snapshot older than the week's update date — the week is computed once with the service
 * client and its snapshot written, then read from the snapshot from the next request on; the page says so in its source
 * line ("snapshot belum ada, dihitung langsung"), never silently. With the flag off: the path before v6.
 */
import type { WeekResult } from "@kgr/engine";
import type { Supa } from "./supabase";
import { computeForWeek, type WeekRow } from "./data";
import { buildSnapshot, builtAtLabel, readSnapshot } from "./snapshot";
import { supabaseService } from "./supabase-service";
import { supabaseServer } from "./supabase";
import { getRequestContext } from "./request-context";
import { primeWeekResult } from "./week-source";
import { isModuleOn, type ModuleSettings } from "./modules-core";
import type { Role } from "./roles";

export interface PageComputed {
  result: WeekResult;
  /** snapshot = read from week_snapshot; live = computed in this request (flag off, or K80). */
  source: "snapshot" | "live";
  /** K79: "dihitung 28 Agu 17.05" for a snapshot; null when computed in this request. */
  builtLabel: string | null;
  /** K80: the source line's note when there was no snapshot to read. */
  note: string | null;
}

export const SNAPSHOT_MISSING = "snapshot belum ada, dihitung langsung";

export const snapshotReadOn = (settings: ModuleSettings, role: Role) => isModuleOn(settings.v6_snapshot_read, role);

export async function weekResultFor(sb: Supa, week: WeekRow, settings: ModuleSettings, role: Role): Promise<PageComputed | null> {
  const out = await resultFor(sb, week, settings, role);
  if (out) primeWeekResult(sb, week.week_start, out.result);
  return out;
}

async function resultFor(sb: Supa, week: WeekRow, settings: ModuleSettings, role: Role): Promise<PageComputed | null> {
  if (snapshotReadOn(settings, role)) {
    const snap = await readSnapshot(sb, week.id);
    // the snapshot of an older update date is stale (the update date moved and the rebuild has not run yet)
    if (snap && snap.result.week.today === week.update_date) return { result: snap.result, source: "snapshot", builtLabel: builtAtLabel(snap.meta.builtAt), note: null };
    const svc = supabaseService();
    if (svc) {
      try {
        const built = await buildSnapshot(svc, week, "halaman (K80)");
        if (built) return { result: built.computed.result, source: "live", builtLabel: null, note: SNAPSHOT_MISSING };
      } catch (e) {
        // the page still opens on the session's own computation; the failed write is logged
        console.error(`[snapshot] K80 minggu ${week.week_start}: ${(e as Error).message}`);
      }
    }
    const c = await computeForWeek(sb, week.week_start);
    return c ? { result: c.result, source: "live", builtLabel: null, note: SNAPSHOT_MISSING } : null;
  }
  const c = await computeForWeek(sb, week.week_start);
  return c ? { result: c.result, source: "live", builtLabel: null, note: null } : null;
}

/** The week and its result for a route handler of this request (PDF, snapshot.json, stok.csv; R124). */
export async function requestWeekResult(weekStart: string): Promise<{ week: WeekRow; computed: PageComputed } | null> {
  const rc = await getRequestContext();
  const week = rc.weeks.find((w) => w.week_start === weekStart);
  if (!week || !rc.viewer) return null;
  const computed = await weekResultFor(await supabaseServer(), week, rc.settings, rc.viewer.role);
  return computed ? { week, computed } : null;
}
