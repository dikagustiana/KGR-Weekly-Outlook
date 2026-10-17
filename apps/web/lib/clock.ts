import "server-only";
/**
 * PRD v5.1 K38: two "todays", one rule. The **data date** (`data`) is only for reading marts and for the cut-off between
 * actual and outlook: the update date of the latest week, or the wall date when the data is current (Q-v5-54). The
 * **wall clock** in WIB (`wall`, `now`) is for every deadline, late status, cut-off time and stamp, the cut date of the
 * LB price decision (tomorrow = wall + 1), the task window and grid of Input, and "spot today". Loaders call `clock()`
 * and never `jakartaNow()` / `dataToday()` themselves.
 *
 * Tests set the clock with KGR_TEST_NOW (ISO with offset, e.g. 2026-08-27T09:00:00+07:00), read only when NODE_ENV is
 * "test". The one K41 whitelist entry (Bab 5.3): when the week query fails the data date falls back to the wall date,
 * with console.error.
 */
import { addDays, type ISODate } from "@kgr/engine";
import type { Supa } from "./supabase";

export interface Clock {
  /** The date the data stands on (marts, cut-off actual / outlook). */
  data: ISODate;
  /** Today on the wall clock, WIB. */
  wall: ISODate;
  /** Now, ISO with +07:00 (deadlines, late, stamps). */
  now: string;
}

const WIB = 7 * 3_600_000;

/** The wall clock in WIB: date, "HH:MM" and ISO "…+07:00". KGR_TEST_NOW only under NODE_ENV=test. */
export function wallNow(at: Date = testNow() ?? new Date()): { date: ISODate; time: string; now: string } {
  const iso = new Date(at.getTime() + WIB).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), now: `${iso.slice(0, 19)}+07:00` };
}

function testNow(): Date | null {
  if (process.env.NODE_ENV !== "test" || !process.env.KGR_TEST_NOW) return null;
  const t = Date.parse(process.env.KGR_TEST_NOW);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * The date the data stands on: the update date of the latest week not after `today`, or `today` when the data is
 * current. A week created ahead (rollover before Monday: update date = week start) says nothing about today's data.
 */
export async function dataToday(sb: Supa, today: ISODate = wallNow().date): Promise<ISODate> {
  const { data, error } = await sb.from("week").select("update_date").lte("update_date", today).order("update_date", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    // K41 whitelist (PRD v5.1 Bab 5.3): the pages still open, on the wall date, and the failure is logged
    console.error(`[clock] dataToday: ${error.message}; tanggal data = jam dinding ${today}`);
    return today;
  }
  const u = (data as { update_date?: string | null } | null)?.update_date ?? null;
  return u && u < today ? u : today;
}

export async function clock(sb: Supa): Promise<Clock> {
  const w = wallNow();
  return { data: await dataToday(sb, w.date), wall: w.date, now: w.now };
}

/** The task window of Input, the grid, the loop status and the source labels (K38): wall − 13 … wall + 7. */
export const taskWindow = (c: Pick<Clock, "wall">): { from: ISODate; to: ISODate } => ({ from: addDays(c.wall, -13), to: addDays(c.wall, 7) });
