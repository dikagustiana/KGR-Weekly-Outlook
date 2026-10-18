import "server-only";
/**
 * PRD v5.2-A R54 (A-UI-6): an input that changes the status of a task must refresh the grid cell of that task without
 * anybody pressing "Perbarui status tugas". The dates to rebuild are the due dates of the task rules for the anchors the
 * input touches (`dueDatesFor`, @kgr/engine): the lock of the commitments → the Friday before the week; a WP → the day
 * after the batch (H+1); the answer to a surplus → the date of the plan. They go through `queueThroughNote` (K40) and the
 * queue is processed inline (R45: at most REBUILD_INLINE_MAX dates, the rest by the cron).
 */
import { dueDatesFor } from "@kgr/engine";
import type { Supa } from "../supabase";
import { inChunks, mustRows } from "../loader";
import { moduleSettings } from "../modules";
import { processRebuildQueue, queueThroughNote } from "../rebuild";

/** What an input touches: a task rule kind and the anchors (week start, batch date…) the rule is read at. */
export interface TaskTouch { kind: string; anchors: string[] }

/** The due dates of the touched tasks. The rules are read with `mustRows`: a read that fails is an error, never "no rule". */
export async function dueDatesOf(sb: Supa, touches: TaskTouch[]): Promise<string[]> {
  const kinds = [...new Set(touches.map((t) => t.kind))];
  if (!kinds.length) return [];
  const rules = await inChunks(kinds, async (part) => mustRows<{ kind: string; due_rule: string; active: boolean | null }>(await sb.from("input_task_rule").select("kind, due_rule, active").in("kind", part), "input_task_rule"));
  const out = touches.flatMap((t) => {
    const r = rules.find((x) => x.kind === t.kind);
    return r && r.active !== false ? t.anchors.flatMap((a) => dueDatesFor({ due_rule: String(r.due_rule) }, a)) : [];
  });
  return [...new Set(out)].sort();
}

/**
 * After an input was saved: queue the due dates of its tasks and process the queue inline. The input is saved already, so a
 * failure here is told in the message (a sentence to append, "" when all went well) and logged — never thrown, because the
 * action must not report a saved input as failed (the user would enter it again).
 */
export async function refreshTasks(sb: Supa, touches: TaskTouch[], reason: string): Promise<string> {
  try {
    const dates = await dueDatesOf(sb, touches);
    const note = dates.length ? await queueThroughNote(sb, dates, reason) : "";
    const r = await processRebuildQueue(await moduleSettings());
    const tail = r.failed ? ` ${r.failed} tanggal gagal dibangun ulang (lihat Admin → Modul).` : !r.done && r.notes.length ? ` ${r.notes[0]}` : "";
    return `${note}${tail}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tugas] ${reason}: ${msg}`);
    return ` Status tugas belum diperbarui (${msg}); tekan "Perbarui status tugas" di Input.`;
  }
}
