import Link from "next/link";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { computeDemand, demandWeekly, loadPlanning, weekPlanningControls } from "@/lib/v3/planning";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

const READERS = ["admin", "sales", "commercial_lead", "ppic", "management", "operations_director", "finance"] as const;

/** PRD v3 §6 /w/[week]/demand: PO (berbobot) vs forecast vs stok bebas → net → ekor, SKU penentu. Numbers from demand_weekly. */
export default async function DemandPage({ params }: PageProps) {
  const { week } = await params;
  await requireModulePage("m3_planning", [...READERS]);
  const ctx = await weekContext(week);
  const mgmt = ctx.view === "management";
  const sb = await supabaseServer();
  const [rows, src] = await Promise.all([demandWeekly(sb, week), loadPlanning(sb, ctx.week)]);
  const { demand, cls } = computeDemand(src, src.plans[0] ? String(src.plans[0].weight_class ?? "") || null : null);
  const plan = src.plans[0] ?? null;
  const byStatus = (st: string) => src.orders.filter((o) => (o.demand_status ?? "Confirmed") === st).length;
  return (
    <WeekShell ctx={ctx} active={`/w/${week}/demand`}>
      <h1>Demand minggu {tgl(ctx.week.week_start)} – {tgl(ctx.week.week_end)}</h1>
      <p className="muted">PO pasti dihitung penuh, PO tentatif <N v={src.weights.tentative} percent /> dan forecast <N v={src.weights.forecast} percent />; stok bebas yang masih layak kirim mengurangi kebutuhan; sisanya dikonversi ke ekor lewat yield per kelas berat dan pola potong.</p>
      <div className="kpis">
        <div className="kpi"><div className="l">Baris PO minggu ini</div><div className="v">{src.orders.length}</div><div className="l">{byStatus("Confirmed")} pasti · {byStatus("Tentative")} tentatif · {byStatus("Forecast")} forecast</div></div>
        <div className="kpi"><div className="l">Ekor dibutuhkan ({cls?.code ?? "—"}, rata-rata <N v={cls?.avg_kg ?? null} dp={2} /> kg)</div><div className="v"><N v={demand.heads.heads} /></div>
          <div className="l">SKU penentu: {demand.binding.join(", ") || "—"}</div></div>
        <div className="kpi"><div className="l">Rencana tersimpan</div><div className="v">{plan ? <N v={Number(plan.head_count)} /> : "—"}</div><div className="l">{plan ? `versi ${plan.version}${plan.approved_by ? " · disetujui" : plan.needs_approval ? " · menunggu persetujuan" : ""}` : "belum ada"}</div></div>
        <div className="kpi"><div className="l">Stok bebas dipakai (per {tgl(src.stock.date)})</div><div className="v">{src.stock.date ? <N v={demand.totals.stock_free_kg} /> : "—"}</div><div className="l">kg; tanpa ledger stok (M2) = 0</div></div>
      </div>
      {rows.length === 0 && (src.orders.length || src.forecasts.length) ? <Card><p>Demand minggu ini belum dibangun. {!mgmt ? <>Proses antrian di <Link href="/admin/modul">Modul</Link>.</> : null}</p></Card> : null}
      <Card title="Per SKU">
        <table className="t compact">
          <thead><tr><th>SKU</th><th className="n">PO pasti kg</th><th className="n">PO tentatif kg</th><th className="n">Forecast kg</th><th className="n">Demand berbobot</th><th className="n">Stok bebas dipakai</th><th className="n">Substitusi</th><th className="n">Kebutuhan potong</th><th>Pola</th><th className="n">kg / ekor</th><th className="n">Ekor (SKU ini)</th><th className="n">Karkas setara kg</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={String(r.key)} className={r.binding ? "hl" : undefined}><td>{String(r.key)}{r.binding ? " — penentu" : ""}</td><Td v={r.confirmed_kg as string} /><Td v={r.tentative_kg as string} /><Td v={r.forecast_kg as string} /><Td v={r.weighted_kg as string} />
              <Td v={r.stock_free_kg as string} /><Td v={r.substituted_kg as string} /><Td v={r.net_kg as string} /><td>{r.cut_pattern ? String(r.cut_pattern) : "beli (trading)"}</td>
              <Td v={(r.kg_per_head as string) ?? null} dp={3} /><Td v={(r.heads as string) ?? null} /><Td v={(r.karkas_kg_equiv as string) ?? null} /></tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="Ekor per pola potong">
        <table className="t compact">
          <thead><tr><th>Pola</th><th className="n">Ekor</th><th>Penentu</th></tr></thead>
          <tbody>
            {demand.heads.patterns.map((p) => <tr key={p.pattern}><td>{p.pattern}</td><Td v={p.heads} /><td>{p.binding ?? "—"}</td></tr>)}
            {demand.heads.topUps.map((t) => <tr key={`t${t.key}`}><td>+ {t.pattern} untuk {t.key}</td><Td v={t.heads} /><td>kurang <N v={t.short_kg} /> kg</td></tr>)}
          </tbody>
        </table>
      </Card>
      {!mgmt ? (
        <Card title={`PO lines (${src.orders.length})`}>
          <table className="t compact">
            <thead><tr><th>Tgl kirim</th><th>PO</th><th>Pelanggan</th><th>SKU</th><th>Status</th><th>Sales</th><th className="n">kg</th><th className="n">Terkirim kg</th><th className="n">Harga</th></tr></thead>
            <tbody>{src.orders.slice().sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date))).map((o) => (
              <tr key={o.id}><td>{tgl(o.delivery_date)}</td><td>{o.po_ref ?? "—"}</td><td>{o.customer ?? "—"}</td><td>{o.key}</td><td>{o.demand_status ?? "Confirmed"}</td><td>{o.sales_rep ?? "—"}</td>
                <Td v={o.kg as string} dp={2} /><Td v={(o.fulfilled_kg as string) ?? null} dp={2} /><Td v={(o.price as string) ?? null} /></tr>
            ))}</tbody>
          </table>
        </Card>
      ) : null}
      {!mgmt ? <Card title="Kontrol rencana"><ControlsV3Table controls={weekPlanningControls(src, ctx.week.update_date)} /></Card> : null}
    </WeekShell>
  );
}
