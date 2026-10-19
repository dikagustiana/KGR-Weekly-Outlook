import { tgl } from "../fmt";

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "24–30 Agu" (or "28 Sep–4 Okt" across a month); long form for management (R137, R11 v2): "24 Agu 2026 – 30 Agu 2026". */
export function weekRange(start: string, end: string, long = false): string {
  if (long) return `${tgl(start)} – ${tgl(end)}`;
  const [, ms, ds] = start.split("-").map(Number);
  const [, me, de] = end.split("-").map(Number);
  return ms === me ? `${ds}–${de} ${MON[me - 1]}` : `${ds} ${MON[ms - 1]}–${de} ${MON[me - 1]}`;
}

export const WEEK_STATUS: Record<string, string> = { open: "terbuka", released: "rilis", closed: "ditutup" };

/**
 * Where the week picker goes for another week: the same page with the week segment replaced when the path carries the
 * current week (/w/<week>/…, /minggu-ini/<week>), else the week's outlook.
 */
export function weekHref(path: string, current: string, next: string): string {
  if (path.includes(`/${current}`)) return path.replace(`/${current}`, `/${next}`);
  return `/w/${next}/outlook`;
}
