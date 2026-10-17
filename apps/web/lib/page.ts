import "server-only";
import { notFound } from "next/navigation";
import { isISODate } from "@kgr/engine";
import { requireViewer, type Viewer } from "./session";
import { computeForWeek, weeksCached, type Computed, type WeekRow } from "./data";
import { supabaseServer } from "./supabase";
import { must } from "./loader";
import { currentView } from "./view-server";
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
  computed: Computed;
  lastRelease: LastRelease | null;
  /** Management View v2 R1 */
  view: ViewMode;
}

export async function weekContext(weekStart: string): Promise<WeekCtx> {
  if (!isISODate(weekStart)) notFound();
  const viewer = await requireViewer();
  const [weeks, computed] = await Promise.all([weeksCached(), computeForWeek(weekStart)]);
  if (!computed) notFound();
  const sb = await supabaseServer();
  const data = must(await sb.from("release").select("id, released_by, released_at, update_date, control_status, controls")
    .eq("week_id", computed.loaded.week.id).order("released_at", { ascending: false }).limit(1).maybeSingle(), "page.release") as LastRelease | null;
  return { viewer, weeks, week: computed.loaded.week, computed, lastRelease: data, view: await currentView(viewer) };
}

export type PageProps = { params: Promise<{ week: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** Context for pages outside a week path (admin, master, account): the week from ?week= or the latest. */
export async function plainContext(weekParam?: string) {
  const viewer = await requireViewer();
  const weeks = await weeksCached();
  const week = weeks.find((w) => w.week_start === weekParam) ?? weeks.find((w) => w.status !== "closed") ?? weeks[0] ?? null;
  return { viewer, weeks, week };
}
