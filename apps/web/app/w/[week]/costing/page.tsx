import Link from "next/link";
import { D, idleCapacity } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { groupsOfWeek, loadCostingWeek, weekCostingControls } from "@/lib/v3/costing";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

/** Every role except sales (cost per batch is finance detail, PRD v3 Q17). */
const READERS = ["admin", "inventory_accounting", "ppic", "purchasing", "finance", "management", "commercial_lead", "cost_accounting"] as const;

export default async function CostingPage({ params }: PageProps) {
  const { week } = await params;
  await requireModulePage("m1_costing", [...READERS]);
  const ctx = await weekContext(week);
  const mgmt = ctx.view === "management";
  const sb = await supabaseServer();
  const d = await loadCostingWeek(sb, ctx.week);
  const runs = [...d.latestRun.values()];
  const lines = runs.flatMap((r) => (d.lines.get(r.id) ?? []).map((l) => ({ ...l, batch_id: r.batch_id })));
  // per SKU key (sum of the engine's allocated cost and kg — the cost per kg is their ratio)
  const byKey = new Map<string, { kg: ReturnType<typeof D>; cost: ReturnType<typeof D>; sv: ReturnType<typeof D>; wd: ReturnType<typeof D> }>();
  for (const l of lines) {
    const k = l.key ?? `(belum dipetakan) ${l.item_code ?? ""}`;
    const a = byKey.get(k) ?? { kg: D(0), cost: D(0), sv: D(0), wd: D(0) };
    a.kg = a.kg.plus(D(l.kg)); a.cost = a.cost.plus(D(l.allocated_cost)); a.sv = a.sv.plus(D(l.sales_value)); a.wd = a.wd.plus(D(l.nrv_writedown));
    byKey.set(k, a);
  }
  const groups = groupsOfWeek(d);
  const modes = (["maklon", "own"] as const).map((m) => {
    const rs = runs.filter((r) => r.mode === m);
    const cost = rs.reduce((a, r) => a.plus(D(r.total_allocated)), D(0));
    const kg = rs.reduce((a, r) => a.plus((d.lines.get(r.id) ?? []).reduce((x, l) => x.plus(D(l.kg)), D(0))), D(0));
    const lb = rs.reduce((a, r) => a.plus(D(d.batches.find((b) => b.id === r.batch_id)?.lb_kg)), D(0));
    return { m, n: rs.length, cost, kg, lb };
  });
  const ownLb = modes[1].lb;
  const idle = d.rates.map((r) => ({ r, ...idleCapacity({ rate_per_kg_lb: r.rate_per_kg_lb, basis_kg: r.basis_kg }, ownLb) }));
  return (
    <WeekShell ctx={ctx} active={`/w/${week}/costing`}>
      <h1>Costing — biaya per batch, per SKU dan per grup</h1>
      <p className="muted">Biaya batch (live bird, ekspedisi, potong) dibagi ke SKU menurut nilai jualnya (kg × harga daftar minggu potong). Angka dari alokasi terakhir per batch{runs.some((r) => r.status === "draft") ? "; sebagian masih draft" : ""}.</p>
      {runs.length === 0 ? <Card><p>Belum ada alokasi minggu ini.{!mgmt ? <> Jalankan di <Link href={`/w/${week}/input/costing`}>Input costing</Link>.</> : null}</p></Card> : null}
      <div className="kpis">
        {modes.map((x) => (
          <div className="kpi" key={x.m}><div className="l">{x.m === "maklon" ? "Maklon" : "RPA sendiri"}: {x.n} batch</div><div className="v">{x.kg.isZero() ? "—" : <><N v={x.cost.div(x.kg)} /> Rp/kg</>}</div>
            <div className="l">{x.kg.isZero() ? "" : <><N v={x.kg} /> kg hasil · <N v={x.lb.isZero() ? null : x.cost.div(x.lb)} /> Rp/kg LB</>}</div></div>
        ))}
        {idle.map((x) => <div className="kpi" key={x.r.id}><div className="l">Kapasitas idle {tgl(x.r.period_start)}–{tgl(x.r.period_end)}</div><div className="v"><N v={x.idleCost} /></div><div className="l"><N v={x.idleKg} /> kg LB di bawah basis (biaya periode)</div></div>)}
      </div>
      <Card title="Per batch">
        <table className="t compact">
          <thead><tr><th>Tanggal</th><th>Batch</th><th>Mode</th><th className="n">kg LB</th><th className="n">kg hasil SKU</th><th className="n">Total biaya</th><th className="n">Biaya / kg hasil</th><th className="n">Biaya / kg LB</th><th>Status</th></tr></thead>
          <tbody>
            {runs.map((r) => {
              const b = d.batches.find((x) => x.id === r.batch_id);
              const kg = (d.lines.get(r.id) ?? []).reduce((a, l) => a.plus(D(l.kg)), D(0));
              return (
                <tr key={r.id}><td>{tgl(b?.date)}</td><td>{b?.batch_ref}</td><td>{r.mode === "own" ? "RPA sendiri" : "maklon"}</td><Td v={b?.lb_kg} dp={2} /><Td v={kg} dp={2} />
                  <Td v={r.total_allocated} /><Td v={kg.isZero() ? null : D(r.total_allocated).div(kg)} /><Td v={D(b?.lb_kg).isZero() ? null : D(r.total_allocated).div(D(b?.lb_kg))} /><td>{r.status === "posted" ? "posted" : "draft"}</td></tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="grid2">
        <Card title="Per grup SKU">
          <table className="t compact">
            <thead><tr><th>Grup</th><th className="n">kg</th><th className="n">Biaya</th><th className="n">COGS/kg</th><th className="n">Nilai jual daftar</th><th className="n">Margin/kg di harga daftar</th></tr></thead>
            <tbody>{groups.map((g) => <tr key={g.group}><td>{g.group}</td><Td v={g.kg} /><Td v={g.cost} /><Td v={g.costPerKg} /><Td v={g.salesValue} /><Td v={g.kg.isZero() ? null : g.salesValue.minus(g.cost).div(g.kg)} /></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Per SKU">
          <table className="t compact">
            <thead><tr><th>SKU</th><th className="n">kg</th><th className="n">COGS/kg</th><th className="n">Harga daftar rata-rata</th><th className="n">Penurunan ke NRV</th></tr></thead>
            <tbody>{[...byKey.entries()].sort((a, b) => b[1].cost.cmp(a[1].cost)).map(([k, a]) => (
              <tr key={k}><td>{k}</td><Td v={a.kg} dp={2} /><Td v={a.kg.isZero() ? null : a.cost.div(a.kg)} /><Td v={a.kg.isZero() ? null : a.sv.div(a.kg)} /><Td v={a.wd.isZero() ? null : a.wd.neg()} /></tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
      {!mgmt ? <Card title="Kontrol costing"><ControlsV3Table controls={weekCostingControls(d)} /></Card> : null}
    </WeekShell>
  );
}
