import { NextResponse } from "next/server";
import { moduleSettingsOf } from "@/lib/modules";
import { processRebuildQueue } from "@/lib/rebuild";
import { supabaseService } from "@/lib/supabase-service";
import { wallNow } from "@/lib/clock";
import { buildInputDay } from "@/lib/v5/input-data";

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
    const drained = await processRebuildQueue(settings, { limit: 30, budgetMs: 50_000 });
    const tasks = settings.v5_input?.enabled ? await buildInputDay(svc, wallNow().date) : null;
    return NextResponse.json({ drained, tasks, at: wallNow().now });
  } catch (e) {
    console.error(`[cron] ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
