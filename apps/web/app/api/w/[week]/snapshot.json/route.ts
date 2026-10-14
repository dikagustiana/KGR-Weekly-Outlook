import { NextResponse } from "next/server";
import { snapshotJson } from "@kgr/engine";
import { getViewer } from "@/lib/session";
import { computeForWeek } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  const c = await computeForWeek(week);
  if (!c) return new NextResponse("Minggu tidak ada", { status: 404 });
  return new NextResponse(snapshotJson(c.result), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}
