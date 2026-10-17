import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { moduleEnabled } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { must } from "@/lib/loader";
import { monthStart } from "@/lib/v3/drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Monthly release snapshot (V1 / V2 / FINAL): the locked JSON and its SHA-256, as stored. */
export async function GET(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  if (!(await moduleEnabled("m4_monthly", viewer))) return new NextResponse("Tidak ditemukan", { status: 404 });
  const first = monthStart(month);
  const version = new URL(req.url).searchParams.get("version") ?? "FINAL";
  if (!first) return new NextResponse("Bulan tidak valid", { status: 400 });
  const sb = await supabaseServer();
  const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "snapshot.month_outlook") as { id: string } | null;
  if (!mo) return new NextResponse("Belum ada outlook", { status: 404 });
  const v = must(await sb.from("month_outlook_version").select("snapshot, snapshot_sha256").eq("month_outlook_id", (mo as { id: string }).id).eq("version", version).maybeSingle(), "snapshot.version") as { snapshot: unknown; snapshot_sha256: string } | null;
  if (!v) return new NextResponse("Versi belum dikunci", { status: 404 });
  const row = v as { snapshot: unknown; snapshot_sha256: string };
  return new NextResponse(JSON.stringify(row.snapshot), { headers: { "Content-Type": "application/json", "X-Snapshot-SHA256": row.snapshot_sha256, "Content-Disposition": `inline; filename="KGR_Outlook_${first.slice(0, 7)}_${version}.json"`, "Cache-Control": "private, no-store" } });
}
