import Link from "next/link";
import { clock } from "@/lib/clock";
import { isISODate } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { mustRows, must } from "@/lib/loader";
import { currentView } from "@/lib/view-server";
import { commercialMart, computeCommercial } from "@/lib/v3/commercial";
import { URGENCY_LABEL, assignedKeysFor, commercialView } from "@/lib/v3/commercial-view";
import { tgl } from "@/lib/fmt";
import { moduleEnabled, moduleSettings } from "@/lib/modules";
import { v4On } from "@/lib/v4/nav";
import { KomersialV4 } from "./v4";
import { KomersialV5 } from "./v5";

export const dynamic = "force-dynamic";

/** PRD v3 §6 /komersial: SKUs to sell, ranked by urgency and priority (sales: own SKUs, no lot cost; lead/management: all). */
export default async function KomersialPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireModulePage("m7_commercial", ["admin", "sales", "commercial_lead", "management", "operations_director", "finance"]);
  // PRD v5 §6.2 (flag v5_commercial): the Commercial loop screen
  if (await moduleEnabled("v5_commercial", v)) {
    const f = (await searchParams).filter;
    return <KomersialV5 viewer={v} filter={f === "hari" || f === "batas" || f === "below" ? f : "all"} />;
  }
  if (v4On(await moduleSettings(), v.role)) return <KomersialV4 viewer={v} />;
  const { viewer, weeks, week } = await plainContext();
  const mgmt = (await currentView(viewer)) === "management";
  const sb = await supabaseServer();
  const date = sp.date && isISODate(sp.date) ? sp.date : (await clock(sb)).data;
  const sales = v.role === "sales";
  const mart = await commercialMart(sb, date, sales, await moduleEnabled("v5_costing", v));
  const asg = mustRows(await sb.from("sales_assignment").select("key").eq("active", true).ilike("email", viewer.email), "komersial.assignment") as any[];
  const own = asg as { key: string | null }[];
  const assignedKeys = assignedKeysFor(v.role, own);
  // B-REL-4 (fail-closed): a failed read throws; a week without a parameter row does not show Sales the cost
  const par = week ? must(await sb.from("parameter").select("sales_sees_cost").eq("week_id", week.id).maybeSingle(), "komersial.parameter") : null;
  const rows = commercialView(mart.rows, { role: v.role, salesSeesCost: par !== null && (par as { sales_sees_cost?: boolean }).sales_sees_cost !== false, assignedKeys });
  const showMa = rows.some((r) => r.cost_per_kg_ma !== null);
  const st = !sales && !mgmt ? await computeCommercial(sb, date) : null;
  const urgent = rows.filter((r) => r.urgency === "jual_hari_ini" || r.urgency === "di_atas_umur");
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      <h1>Komersial — stok yang harus dijual {mart.date ? `(${tgl(mart.date)})` : ""}</h1>
      <p className="muted">Urutan: status umur (di atas batas umur → jual hari ini → jual minggu ini → aman), lalu kerugian simpan per hari + risiko turun ke frozen. Harga lantai = biaya rata-rata + markup. </p>
      {sales && own.length === 0 ? <Card><p>Belum ada penugasan SKU untuk Anda. Minta penugasan ke commercial lead.</p></Card> : null}
      {!mart.date ? <Card><p>Belum dibangun untuk tanggal ini.</p></Card> : null}
      <div className="kpis">
        <div className="kpi"><div className="l">SKU jual hari ini / di atas umur</div><div className="v">{urgent.length}</div><div className="l">{urgent.filter((r) => Number(r.ordered_today_kg) === 0).length} tanpa order hari ini</div></div>
        <div className="kpi"><div className="l">SKU dengan stok bebas</div><div className="v">{rows.length}</div></div>
      </div>
      <Card>
        <table className="t compact">
          <thead><tr><th>#</th><th>SKU</th><th>Status</th><th className="n">Bebas kg</th><th className="n">Umur (hari)</th>{showMa ? <th className="n">Biaya/kg</th> : null}<th className="n">Harga lantai</th><th className="n">Harga daftar</th><th className="n">Margin/kg daftar</th><th className="n">Harga 7 hari</th><th className="n">Margin/kg 7 hari</th><th className="n">Rugi simpan/hari</th><th className="n">Risiko turun ke frozen</th><th className="n">Order hari ini kg</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key}><td>{r.rank}</td><td><Link href={`/komersial/${encodeURIComponent(r.key)}`}>{r.key}</Link></td><td>{URGENCY_LABEL[r.urgency ?? "aman"]}</td>
              <Td v={r.form === "fresh" ? r.free_fresh_kg : r.free_frozen_kg} /><Td v={r.oldest_age_days} />{showMa ? <Td v={r.cost_per_kg_ma} /> : null}<Td v={r.price_floor} /><Td v={r.price_list} />
              <Td v={r.margin_per_kg_list} /><Td v={r.realized_price_7d} /><Td v={r.margin_per_kg_realized} /><Td v={r.holding_loss_per_day} /><Td v={r.downgrade_risk_rp} /><Td v={r.ordered_today_kg} /></tr>
          ))}</tbody>
        </table>
      </Card>
      {st ? <Card title="Kontrol komersial (C39, C40)"><ControlsV3Table controls={st.controls} /></Card> : null}
    </Shell>
  );
}
