import { NextResponse } from "next/server";
import { moduleSettings } from "@/lib/modules";
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
  const settings = await moduleSettings();
  const drained = await processRebuildQueue(settings, { limit: 30, budgetMs: 50_000 });
  let tasks: string | null = null;
  if (settings.v5_input?.enabled) {
    const svc = supabaseService();
    tasks = svc ? await buildInputDay(svc, wallNow().date) : "tidak ada SUPABASE_SERVICE_ROLE_KEY";
  }
  return NextResponse.json({ drained, tasks, at: wallNow().now });
}
