import "server-only";
/**
 * PRD v5.1 K39 (R11): data moves the update date. After a journal (`gl_daily`), stock card (`stock_daily`) or WP
 * upload is saved for dates d, each open week holding a d gets update_date = max(update_date, d + 1), at most the
 * Monday after it, through the RPC public.advance_update_date (the week's RLS stays closed). The upload is already
 * saved when this runs: a failure is reported in the upload message and logged, never dropped.
 */
import type { Supa } from "./supabase";
import type { WeekRow } from "./data";
import { forget } from "./request-memo";

export async function advanceUpdateDate(sb: Supa, weeks: WeekRow[], dates: (string | null | undefined)[]): Promise<string> {
  const notes: string[] = [];
  for (const w of weeks.filter((x) => x.status === "open")) {
    const inWeek = dates.filter((d): d is string => !!d && d >= w.week_start && d <= w.week_end).sort();
    if (!inWeek.length) continue;
    const d = inWeek[inWeek.length - 1];
    const { data, error } = await sb.rpc("advance_update_date", { p_week_id: w.id, p_date: d });
    forget(sb, "weeks");
    if (error) {
      console.error(`[advanceUpdateDate] minggu ${w.week_start}, ${d}: ${error.message}`);
      notes.push(`tanggal update minggu ${w.week_start} TIDAK dimajukan (${error.message})`);
    } else if (String(data) !== w.update_date) {
      notes.push(`tanggal update minggu ${w.week_start}: ${w.update_date} → ${String(data)}`);
    }
  }
  return notes.join("; ");
}
