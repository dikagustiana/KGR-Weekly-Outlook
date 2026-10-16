import "server-only";
/**
 * C45 (PRD v4 §7.1): is the stock data mart current for a date? An input change queues its date in rebuild_queue and
 * balances roll forward, so the earliest queued / running / failed date is where the mart stops being current.
 * The arithmetic of the status is @kgr/engine staleControl.
 */
import { staleControl, type ControlV3 } from "@kgr/engine";
import type { Supa } from "../supabase";

export async function martStaleFrom(sb: Supa): Promise<string | null> {
  const { data } = await sb.from("rebuild_queue").select("date").in("status", ["queued", "running", "failed"]).order("date").limit(1);
  const r = (data ?? []) as { date: string }[];
  return r.length ? String(r[0].date) : null;
}

/** C45 for the stock mart (sku_balance_daily) on a date. */
export async function stockMartControl(sb: Supa, date: string): Promise<ControlV3> {
  const [staleFrom, built] = await Promise.all([
    martStaleFrom(sb),
    sb.from("sku_balance_daily").select("date").lte("date", date).order("date", { ascending: false }).limit(1),
  ]);
  return staleControl({ date, staleFrom, built: ((built.data ?? []) as unknown[]).length > 0 });
}
