/**
 * PRD v6 R127: the home page of `/` is remembered in a cookie for 30 days, so the next visit to `/` is a 307 from the
 * middleware without a render. The value names the Monday it was computed for: a new week (Monday changed) renders
 * `/` again, which writes the new home. Only same-origin paths are accepted. Edge-safe (no server-only imports).
 */
export const HOME_COOKIE = "kgr_home";
export const HOME_MAX_AGE = 30 * 24 * 3600;

export const homeCookieValue = (monday: string, path: string) => `${monday}|${path}`;

export function homeFromCookie(value: string | undefined, monday: string): string | null {
  if (!value) return null;
  const i = value.indexOf("|");
  if (i < 0) return null;
  const path = value.slice(i + 1);
  if (value.slice(0, i) !== monday) return null;
  return /^\/(?!\/)[\w\-/]*$/.test(path) ? path : null;
}

/** Monday of the current week in WIB (UTC+7, no DST) — the engine's mondayOf(jakartaToday()) without importing the engine into the edge bundle. */
export function jakartaMonday(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 7 * 3_600_000);
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset)).toISOString().slice(0, 10);
}
