import { NextResponse } from "next/server";
import { snapshotJsonV3 } from "@kgr/engine";
import { getViewer } from "@/lib/session";
import { computeForWeek } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase";
import { moduleSettings } from "@/lib/modules";
import { moduleSettingsGlobal } from "@/lib/rebuild";
import { v3ForWeek } from "@/lib/v3/week";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  const c = await computeForWeek(week);
  if (!c) return new NextResponse("Minggu tidak ada", { status: 404 });
  const v3 = await v3ForWeek(await supabaseServer(), c.loaded.week, moduleSettingsGlobal(await moduleSettings()), c.result, viewer.role);
  return new NextResponse(snapshotJsonV3(c.result, v3.snapshot), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}
