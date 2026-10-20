import { NextResponse } from "next/server";
import { moduleSettingsOf } from "@/lib/modules-read";
import { processRebuildQueue } from "@/lib/rebuild";
import { supabaseService } from "@/lib/supabase-service";
import { wallNow } from "@/lib/clock";
import { buildInputDay } from "@/lib/v5/input-data";
import { buildSnapshot } from "@/lib/snapshot";
import { mustRows } from "@/lib/loader";

export const maxDuration = 60;

/**
 * K61 (R46): drain the rebuild queue within a time budget and build the input-task instances + completeness grid for
 * today (wall clock). Scheduled by `crons` in vercel.json; protected by `CRON_SECRET` (Bearer).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // no session here: the flags and the queue are read with the service client (RLS would read app_setting as empty)
  const svc = supabaseService();
  if (!svc) return NextResponse.json({ error: "server belum punya SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  try {
    const settings = await moduleSettingsOf(svc);
    const drained = await processRebuildQueue(settings, { limit: 30, budgetMs: 50_000, client: svc });
    const tasks = settings.v5_input?.enabled ? await buildInputDay(svc, wallNow().date) : null;
    // PRD v6 (risiko "snapshot basi"): a write that forgot to queue its dates still reaches the snapshot here — every open
    // week is hashed again and rewritten only when its inputs changed
    const open = mustRows<{ id: string; week_start: string }>(await svc.from("week").select("id, week_start").eq("status", "open").order("week_start"), "cron.week");
    const snapshots: string[] = [];
    for (const w of open) {
      try {
        const o = await buildSnapshot(svc, w, "cron");
        snapshots.push(`${w.week_start}: ${o ? o.status : "tidak ada"}`);
      } catch (e) {
        snapshots.push(`${w.week_start}: GAGAL ${(e as Error).message}`);
      }
    }
    return NextResponse.json({ drained, tasks, snapshots, at: wallNow().now });
  } catch (e) {
    console.error(`[cron] ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
