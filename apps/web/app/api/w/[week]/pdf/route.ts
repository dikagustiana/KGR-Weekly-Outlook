import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { computeForWeek } from "@/lib/data";
import { outlookPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  const c = await computeForWeek(week);
  if (!c) return new NextResponse("Minggu tidak ada", { status: 404 });
  const pdf = await outlookPdf(c.result, { generatedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " (belum dirilis)" });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="KGR_Outlook_${week}_update_${c.result.week.today}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
