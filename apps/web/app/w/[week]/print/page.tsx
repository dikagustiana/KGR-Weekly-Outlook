import { weekContext, type PageProps } from "@/lib/page";
import { OutlookBody } from "@/components/OutlookBody";
import { PrintButton } from "@/components/PrintButton";
import { tgl } from "@/lib/fmt";
import { moduleEnabled } from "@/lib/modules";

export const dynamic = "force-dynamic";

/** Print layout of the outlook (browser print → A4 landscape); the PDF route produces the same numbers server-side. */
export default async function PrintPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>KGR — Weekly Outlook · Minggu {tgl(r.week.weekStart)} – {tgl(r.week.weekEnd)} · Update {tgl(r.week.today, true)}</h1>
        <span>Kontrol: <b>{r.controls.overall}</b> <PrintButton /></span>
      </div>
      <OutlookBody r={r} week={week} print k25={await moduleEnabled("v5_costing", ctx.viewer)} />
    </main>
  );
}
