import { WriteError } from "./write";

/** K40: the longest stretch an upload or action may queue up to the data date; longer = a manual rebuild by Admin. */
export const QUEUE_THROUGH_MAX_DAYS = 62;

/**
 * PRD v5.1 K40: the dates a change touches, closed up to the date the data stands on. Every affected date on or before
 * the data date queues itself and every later day through the data date (a cost of 26 Aug changes the stock and P&L
 * of 27 Aug); an affected date after the data date (a PO delivery next week, tomorrow's LB decision) queues only
 * itself. More than 62 days back is refused before anything is queued. Pure; `queueThrough` writes.
 */
export function throughDates(affected: string[], data: string): string[] {
  const uniq = [...new Set(affected.filter(Boolean))].sort();
  const past = uniq.filter((d) => d <= data), future = uniq.filter((d) => d > data);
  if (!past.length) return future;
  const from = past[0];
  const days = Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > QUEUE_THROUGH_MAX_DAYS) {
    throw new WriteError(`Rebuild ${from} s.d. ${data} = ${days} hari (lebih dari ${QUEUE_THROUGH_MAX_DAYS}): rebuild manual dari Admin (Modul → Bangun ulang)`);
  }
  const out: string[] = [];
  for (let d = from; d <= data; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return [...out, ...future];
}
