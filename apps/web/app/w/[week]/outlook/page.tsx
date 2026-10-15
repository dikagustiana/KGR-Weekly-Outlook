import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { OutlookBody } from "@/components/OutlookBody";
import { Headline } from "@/components/outlook/Headline";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function OutlookPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  return (
    <WeekShell ctx={ctx} active="outlook">
      <div className="row noprint" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>KGR — Weekly Outlook dan Keputusan Harian</h1>
          <p className="muted">
            Minggu {tgl(r.week.weekStart)} – {tgl(r.week.weekEnd)} · Update {tgl(r.week.today, true)} · Aktual = transaksi s.d. kemarin; sisa minggu = order + rencana mulai hari ini.
          </p>
        </div>
        <div className="row">
          <a className="b sec" href={`/api/w/${week}/pdf`} target="_blank" rel="noreferrer">Cetak outlook (PDF)</a>
          <a className="b sec" href={`/w/${week}/print`} target="_blank" rel="noreferrer">Tampilan cetak</a>
        </div>
      </div>
      {ctx.view === "management" ? <Headline r={r} week={week} /> : null}
      <OutlookBody r={r} week={week} view={ctx.view} />
      <p className="muted" style={{ fontSize: 11 }}>Engine v{r.engineVersion} · dihitung dalam {ctx.computed.computeMs} ms dari data minggu ini.</p>
    </WeekShell>
  );
}
