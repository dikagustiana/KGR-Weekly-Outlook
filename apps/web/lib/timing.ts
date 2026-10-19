import "server-only";
/**
 * PRD v6 R121: per-request timings (`auth` in the middleware's Server-Timing header; `ctx`, `data` here). A Server
 * Component cannot set response headers, so the page's share is logged as one line per request in the Server-Timing
 * syntax (Vercel logs, M2) and rendered as `data-server-timing` on the page (e2e T30).
 */
export interface Timing {
  ctx: number;
  data: number;
}

export const timingHeader = (t: Timing) => `ctx;dur=${t.ctx},data;dur=${t.data}`;

export function logTiming(path: string, t: Timing, source: string): void {
  console.log(`[timing] ${path} ${timingHeader(t)} source=${source}`);
}
