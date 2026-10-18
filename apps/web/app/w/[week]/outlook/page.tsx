import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { OutlookBody } from "@/components/OutlookBody";
import { Headline } from "@/components/outlook/Headline";
import { tgl } from "@/lib/fmt";
import { MODULE_KEYS, isModuleOn, k25On, moduleSettings, type ModuleSettings } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { managementV3 } from "@/lib/v3/management";
import { HeadlineV3, managementSlots } from "@/components/v3/ManagementV3";
import { redirect } from "next/navigation";
import { mingguIniAllowed, v4On } from "@/lib/v4/nav";

export const dynamic = "force-dynamic";

export default async function OutlookPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  // v3 (PRD v3 §6): headline tiles and sections of the modules that are on; Input and COGS always
  const all = await moduleSettings();
  // PRD v4 K15, K18 (flag v4_design): the management view is "Minggu ini" (no RPA decision block 2, no cash-out
  // block 5); the preparer view, the print view and the PDF keep every v1 block (parity)
  if (ctx.view === "management" && mingguIniAllowed(ctx.viewer.role) && v4On(all, ctx.viewer.role)) redirect(`/minggu-ini/${week}`);
  const mine: ModuleSettings = Object.fromEntries(MODULE_KEYS.map((k) => [k, { enabled: isModuleOn(all[k], ctx.viewer.role) }]));
  const m3 = ctx.view === "management" ? await managementV3(await supabaseServer(), ctx.week, mine, r, ctx.viewer.role) : null;
  // PRD v5 K25 / v5.1 K54 (v5_costing or v5_management for the role): the live-bird block shows the simulation only
  const k25 = k25On(all, ctx.viewer.role);
  return (
    <WeekShell ctx={ctx} active="outlook">
      {ctx.view === "management" ? (
        // R11: the period is in the header dropdown, not repeated here; R15: one PDF button, print view as a text link
        <div className="row noprint" style={{ justifyContent: "space-between" }}>
          <h1>KGR — Weekly Outlook dan Keputusan Harian</h1>
          <div className="row">
            <a className="b sec" href={`/api/w/${week}/pdf`} target="_blank" rel="noreferrer">Unduh PDF</a>
            <a href={`/w/${week}/print`} target="_blank" rel="noreferrer">Tampilan cetak</a>
          </div>
        </div>
      ) : (
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
      )}
      {ctx.view === "management" ? <Headline r={r} week={week} k25={k25} extra={m3 ? <HeadlineV3 m={m3} month={ctx.week.update_date.slice(0, 7)} /> : null} /> : null}
      <OutlookBody r={r} week={week} view={ctx.view} v3={m3 ? managementSlots(m3) : null} k25={k25} />
      {ctx.view === "preparer" ? <p className="muted" style={{ fontSize: 11 }}>Engine v{r.engineVersion} · dihitung dalam {ctx.computed.computeMs} ms dari data minggu ini.</p> : null}
    </WeekShell>
  );
}
