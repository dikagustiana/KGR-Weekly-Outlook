import "server-only";
/**
 * PRD v6 K77 / K78 / R122: the rebuild worker writes the week's snapshot. Every write of a week input already queues its
 * dates (triggers needs_rebuild*, queueThrough); a queued date rebuilds the snapshot of the week it falls in. Runs
 * whatever the module flags (`always`): irisan 1 writes the snapshot before any page reads it. Released and closed weeks
 * are never computed again (K77). One week is built once per run (several of its dates are usually queued together).
 */
import type { Supa } from "./supabase";
import { must } from "./loader";
import { registerBuilder } from "./rebuild-registry";
import { buildSnapshot } from "./snapshot";
import type { WeekRow } from "./data";

const builtThisRun = new WeakMap<object, Map<string, Promise<string>>>();

export async function snapshotForDate(sb: Supa, date: string): Promise<string> {
  const week = must(await sb.from("week").select("id, week_start, status").lte("week_start", date).gte("week_end", date).maybeSingle(), "snapshot.week") as Pick<WeekRow, "id" | "week_start" | "status"> | null;
  if (!week) return "tidak ada minggu";
  if (week.status !== "open") return `minggu ${week.week_start} ${week.status}: tidak dihitung ulang`;
  let byWeek = builtThisRun.get(sb);
  if (!byWeek) builtThisRun.set(sb, (byWeek = new Map()));
  let p = byWeek.get(week.id);
  if (!p) {
    p = buildSnapshot(sb, week, "rebuild").then((o) => (o ? `snapshot ${week.week_start} v${o.meta.version} ${o.status === "written" ? "ditulis" : "tidak berubah"}` : "minggu tidak ada"));
    byWeek.set(week.id, p);
  }
  return p;
}

registerBuilder({ module: "v6_snapshot_read", always: true, name: "week_snapshot", build: snapshotForDate });
