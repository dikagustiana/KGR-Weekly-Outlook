import { NextResponse } from "next/server";
import { D, type PlDailyRow } from "@kgr/engine";
import { getViewer } from "@/lib/session";
import { moduleEnabled } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { monthStart } from "@/lib/v3/drivers";
import { monthView, plDaily } from "@/lib/v3/monthly";
import { monthlyPdf } from "@/lib/v3/monthly-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Monthly release PDF: ?version=V1|V2|FINAL renders the locked snapshot; without it the current data mart. */
export async function GET(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  if (!(await moduleEnabled("m4_monthly", viewer))) return new NextResponse("Tidak ditemukan", { status: 404 });
  const first = monthStart(month);
  if (!first) return new NextResponse("Bulan tidak valid", { status: 400 });
  const version = new URL(req.url).searchParams.get("version");
  const sb = await supabaseServer();
  const view = await monthView(sb, first);
  const { data: mo } = await sb.from("month_outlook").select("budget_revenue, budget_gp, budget_nibt").eq("month", first).maybeSingle();
  const v = version ? view.versions.find((x) => x.version === version) : null;
  if (version && !v) return new NextResponse("Versi belum dikunci", { status: 404 });
  const rows: PlDailyRow[] = v
    ? ((v.snapshot as { rows?: Record<string, unknown>[] }).rows ?? []).map((r) => ({ date: String(r.date), pl_line: String(r.pl_line), basis: r.basis as PlDailyRow["basis"], actual: r.actual === null ? null : D(String(r.actual)), forecast: r.forecast === null ? null : D(String(r.forecast)), anomaly: r.anomaly === true }))
    : await plDaily(sb, first);
  const m = (mo ?? null) as { budget_revenue: string | null; budget_gp: string | null; budget_nibt: string | null } | null;
  const pdf = await monthlyPdf({
    first, rows, view, version: v ? String(v.version) : null, sha: v ? String(v.snapshot_sha256) : null,
    budget: m ? { revenue: m.budget_revenue, gp: m.budget_gp, nibt: m.budget_nibt } : null,
    generatedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
  });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="KGR_Outlook_${first.slice(0, 7)}${v ? `_${v.version}` : ""}.pdf"`, "Cache-Control": "private, no-store" } });
}
