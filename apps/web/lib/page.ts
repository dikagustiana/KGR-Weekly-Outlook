import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { isISODate } from "@kgr/engine";
import { requireViewer, type Viewer } from "./session";
import { listWeeks, type WeekRow } from "./data";
import { supabaseServer, type Supa } from "./supabase";
import { must } from "./loader";
import { getRequestContext } from "./request-context";
import { weekResultFor, type PageComputed } from "./week-result";
import { logTiming, type Timing } from "./timing";
import type { ViewMode } from "./view";

export interface LastRelease {
  id: string;
  released_by: string;
  released_at: string;
  update_date: string;
  control_status: string;
  /** Control summary frozen with the release (counts per status). */
  controls: { counts?: Partial<Record<"LULUS" | "PERIKSA" | "BELUM DIISI" | "GAGAL", number>> } | null;
}

export interface WeekCtx {
  viewer: Viewer;
  weeks: WeekRow[];
  week: WeekRow;
  /**
   * PRD v6 R120: the result only — `loaded` (the raw input rows) is not on the request path any more; a page that needs
   * input rows reads its own table, narrowly (docs/v6/loaded-map.md).
   */
  computed: PageComputed;
  lastRelease: LastRelease | null;
  /** Management View v2 R1 */
  view: ViewMode;
  /** R121 */
  timing: Timing;
}

/** The weeks of the request, listed once per request (PRD v6 R126: the RequestContext's read). */
export const weeksCached = cache(async (sb: Supa) => listWeeks(sb));

export const weekContext = cache(async (weekStart: string): Promise<WeekCtx> => {
  if (!isISODate(weekStart)) notFound();
  const viewer = await requireViewer();
  const rc = await getRequestContext();
  const week = rc.weeks.find((w) => w.week_start === weekStart);
  if (!week) notFound();
  const sb = await supabaseServer();
  const t0 = performance.now();
  const [computed, rel] = await Promise.all([
    weekResultFor(sb, week, rc.settings, viewer.role),
    sb.from("release").select("id, released_by, released_at, update_date, control_status, controls")
      .eq("week_id", week.id).order("released_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!computed) notFound();
  const timing = { ctx: rc.ms, data: Math.round(performance.now() - t0) };
  logTiming(`/w/${weekStart}`, timing, computed.source);
  const lastRelease = must(rel, "page.release") as LastRelease | null;
  return { viewer, weeks: rc.weeks, week, computed, lastRelease, view: rc.view, timing };
});

export type PageProps = { params: Promise<{ week: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** Context for pages outside a week path (admin, master, account): the week from ?week= or the latest. */
export async function plainContext(weekParam?: string) {
  const viewer = await requireViewer();
  const weeks = (await getRequestContext()).weeks;
  const week = weeks.find((w) => w.week_start === weekParam) ?? weeks.find((w) => w.status !== "closed") ?? weeks[0] ?? null;
  return { viewer, weeks, week };
}
