/** ISO calendar dates ('YYYY-MM-DD'), Asia/Jakarta business days. Pure date arithmetic, no clock. */
export type ISODate = string;

const RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' that names a real calendar day (2026-02-31 is rejected, not rolled into March). */
export function isISODate(d: string): boolean {
  if (!RE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

export function assertISODate(d: string): ISODate {
  if (!isISODate(d)) throw new Error(`Tanggal tidak valid (YYYY-MM-DD): ${d}`);
  return d;
}

function toUTC(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * 86_400_000);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}

/** Monday of the week containing d (Excel: d − WEEKDAY(d, 3)). */
export function mondayOf(d: ISODate): ISODate {
  const dow = new Date(toUTC(d)).getUTCDay(); // 0 = Sunday
  const offset = (dow + 6) % 7; // Monday = 0
  return addDays(d, -offset);
}

export function firstOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + "01";
}

/** DAY(EOMONTH(d, 0)) */
export function daysInMonth(d: ISODate): number {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function weekDays(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Inclusive range test on ISO strings; null dates never match (Excel COUNTIFS ignores blanks). */
export function between(d: ISODate | null, lo: ISODate, hi: ISODate): boolean {
  return d !== null && d >= lo && d <= hi;
}

/** Today in Asia/Jakarta (UTC+7, no DST). Only for defaults in the app — never inside the engine. */
export function jakartaToday(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
