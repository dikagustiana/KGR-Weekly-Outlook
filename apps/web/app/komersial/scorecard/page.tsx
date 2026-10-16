import Link from "next/link";
import { addDays, isISODate, jakartaToday, mondayOf } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Card, Td } from "@/components/ui";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { currentView } from "@/lib/view-server";
import { fetchAll } from "@/lib/data";
import { tgl } from "@/lib/fmt";
import { scorecardAction } from "../actions";

export const dynamic = "force-dynamic";

/** PRD v3 §6 /komersial/scorecard: per sales rep, the week before (built on Monday). */
export default async function ScorecardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireModulePage("m7_approval", ["admin", "commercial_lead", "management", "operations_director"]);
  const { viewer, weeks, week } = await plainContext();
  const mgmt = (await currentView(viewer)) === "management";
  const ws = sp.week && isISODate(sp.week) ? mondayOf(sp.week) : addDays(mondayOf(jakartaToday()), -7);
  const sb = await supabaseServer();
  const rows = await fetchAll<Record<string, unknown>>((a, b) => sb.from("sales_scorecard_weekly").select("*").eq("week_start", ws).order("sales_rep").range(a, b));
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      <h1>Scorecard sales — minggu {tgl(ws)}</h1>
      <div className="row noprint"><Link className="b small sec" href={`?week=${addDays(ws, -7)}`}>← minggu sebelumnya</Link><Link className="b small sec" href={`?week=${addDays(ws, 7)}`}>minggu berikutnya →</Link><Link href="/komersial">Komersial</Link></div>
      <Card>
        <table className="t compact">
          <thead><tr><th>Sales</th><th className="n">Target kg</th><th className="n">Aktual kg</th><th className="n">Spot kg</th><th className="n">Capaian</th><th className="n">Target Rp</th><th className="n">Aktual Rp</th><th className="n">Ke frozen tak terjual kg</th><th className="n">Downgrade Rp</th><th className="n">Error forecast</th><th className="n">Diskon (jumlah)</th><th className="n">Diskon Rp</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={String(r.sales_rep)}><td>{String(r.sales_rep)}</td><Td v={r.target_kg as string | null} /><Td v={r.actual_kg as string} /><Td v={(r.kg_spot ?? null) as string | null} /><Td v={r.pct as string | null} percent /><Td v={r.target_rp as string | null} /><Td v={r.actual_rp as string} />
              <Td v={r.kg_to_frozen_unsold as string} /><Td v={r.rp_downgrade as string} /><Td v={r.forecast_mape as string | null} percent /><Td v={Number(r.discount_count)} /><Td v={r.discount_rp as string} /></tr>
          ))}</tbody>
        </table>
        {!rows.length ? <p className="muted">Belum dibangun untuk minggu ini.</p> : null}
      </Card>
      {(v.role === "admin" || v.role === "commercial_lead") && !mgmt ? <ActionForm action={scorecardAction} submit="Hitung ulang minggu ini"><input type="hidden" name="week_start" value={ws} /></ActionForm> : null}
    </Shell>
  );
}
