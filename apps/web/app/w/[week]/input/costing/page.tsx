import Link from "next/link";
import { D } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { loadCostingWeek, poolSummaries, weekCostingControls } from "@/lib/v3/costing";
import { tgl } from "@/lib/fmt";
import { addOverheadRate, allocate, post, setBatchCosting, setPoolGl } from "./actions";

export const dynamic = "force-dynamic";

const COMP: Record<string, string> = { LB: "Live bird", freight: "Ekspedisi", maklon: "Maklon / potong", labour: "TKL", overhead: "Overhead", blast: "Biaya BL / blasting", other: "Lain" };

export default async function InputCostingPage({ params }: PageProps) {
  const { week } = await params;
  await requireModulePage("m1_costing", ["admin", "cost_accounting"]);
  const ctx = await weekContext(week);
  const sb = await supabaseServer();
  const d = await loadCostingWeek(sb, ctx.week);
  const controls = weekCostingControls(d);
  const pools = poolSummaries(d);
  const drafts = [...d.latestRun.values()].filter((r) => r.status === "draft").length;
  return (
    <WeekShell ctx={ctx} active={`/w/${week}/input/costing`}>
      <h1>Input costing — WP potong, cost pool, alokasi ke SKU</h1>
      <p className="muted">Alur: <Link href={`/w/${week}/upload`}>Upload</Link> WP potong per batch (jenis "WP potong per batch") dan daftar PI pemasok → periksa cost pool dan tie-out ke GL → <b>Alokasikan</b> (relative sales value: biaya batch × nilai jual SKU ÷ Σ nilai jual) → <b>Posting</b>. Metode by-product: <b>{d.params.by_product_method}</b>; toleransi hasil potong {D(d.params.yield_gap_tolerance).times(100).toFixed(1)}% (Parameter).</p>
      <Card title="Kontrol costing (C21–C24)"><ControlsV3Table controls={controls} /></Card>
      <Card title={`Batch minggu ini (${d.batches.length})`} extra={
        <div className="row">
          <ActionForm action={allocate} submit="Alokasikan semua"><input type="hidden" name="week" value={week} /></ActionForm>
          <ActionForm action={post} submit={`Posting ${drafts} draft`} confirm="Posting alokasi draft minggu ini?"><input type="hidden" name="week" value={week} /></ActionForm>
        </div>}>
        <div className="scroll">
          <table className="t compact">
            <thead><tr><th>Tanggal</th><th>Batch</th><th>Status</th><th>Mode</th><th className="n">kg LB</th><th className="n">Hasil potong kg</th><th className="n">Σ hasil SKU kg</th><th className="n">Gap</th><th className="n">Baris SKU</th><th className="n">Total biaya Rp</th><th className="n">Teralokasi Rp</th><th>Alokasi</th><th>Atur</th></tr></thead>
            <tbody>
              {d.batches.map((b) => {
                const outs = d.outputs.get(b.id) ?? [];
                const kg = outs.reduce((a, o) => a.plus(D(o.kg)), D(0));
                const run = d.latestRun.get(b.id);
                const gap = b.processed_kg && !D(b.processed_kg).isZero() ? D(b.processed_kg).minus(kg).div(D(b.processed_kg)) : null;
                return (
                  <tr key={b.id}>
                    <td>{tgl(b.date)}</td><td>{b.batch_ref}<div className="muted">{b.supplier}</div></td><td>{b.status}</td><td>{b.cost_mode}</td>
                    <Td v={b.lb_kg} dp={2} /><Td v={b.processed_kg} dp={2} /><Td v={kg} dp={2} tip="Σ batch_output_sku.kg" />
                    <td className="n">{gap === null ? <span className="muted">—</span> : <N v={gap} percent dp={1} />}</td>
                    <td className="n">{outs.length}{outs.some((o) => o.source === "manual") ? <span className="muted"> (dari out_*)</span> : null}</td>
                    <Td v={run?.total_cost} /><Td v={run?.total_allocated} />
                    <td>{run ? <Badge s={run.status === "posted" ? "LULUS" : D(run.diff).abs().gt(1) ? "GAGAL" : "PERIKSA"}>{run.status}{D(run.diff).abs().gt(1) ? ` · selisih ${D(run.diff).toFixed(0)}` : ""}</Badge> : <span className="muted">belum</span>}</td>
                    <td>
                      <ActionForm action={setBatchCosting} submit="Simpan" className="row">
                        <input type="hidden" name="week" value={week} /><input type="hidden" name="batch_id" value={b.id} />
                        <select className="in" name="cost_mode" defaultValue={b.cost_mode}><option value="maklon">maklon</option><option value="own">RPA sendiri</option></select>
                        <input className="in" name="head_count" placeholder="ekor" defaultValue={b.head_count ?? ""} style={{ width: 70 }} />
                      </ActionForm>
                      {outs.length ? <ActionForm action={allocate} submit="Alokasikan"><input type="hidden" name="week" value={week} /><input type="hidden" name="batch_id" value={b.id} /></ActionForm> : null}
                    </td>
                  </tr>
                );
              })}
              {d.batches.length === 0 ? <tr><td colSpan={13} className="muted">Belum ada batch minggu ini.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
      {pools.map(({ pool, res }) => (
        <Card key={pool.id} title={`${pool.description ?? "Cost pool"} · ${tgl(pool.period_start)} – ${tgl(pool.period_end)}`}>
          <div className="kpis">
            <div className="kpi"><div className="l">Σ PI / biaya batch</div><div className="v"><N v={res.totalPi} /></div></div>
            <div className="kpi"><div className="l">Langsung ke batch</div><div className="v"><N v={res.direct} /></div></div>
            <div className="kpi"><div className="l">Biaya periode (overhead)</div><div className="v"><N v={res.period} /></div></div>
            <div className="kpi"><div className="l">Σ GL akun biaya RPA</div><div className="v">{res.totalGl === null ? <span className="muted">belum diisi</span> : <N v={res.totalGl} />}</div></div>
            <div className="kpi"><div className="l">Selisih PI − GL (C23)</div><div className="v">{res.diff === null ? "—" : <N v={res.diff} />}</div></div>
          </div>
          <ActionForm action={setPoolGl} submit="Simpan GL" className="row">
            <input type="hidden" name="week" value={week} /><input type="hidden" name="pool_id" value={pool.id} />
            <div className="field"><label>Σ GL periode (Rp)</label><input className="in" name="total_gl" defaultValue={pool.total_gl ?? ""} /></div>
            <div className="field"><label>Status</label><select className="in" name="status" defaultValue={pool.status}><option value="open">open</option><option value="tied">tied</option><option value="posted">posted</option></select></div>
          </ActionForm>
          <details><summary>Baris cost pool ({d.poolLines.filter((l) => l.cost_pool_id === pool.id).length})</summary>
            <table className="t compact">
              <thead><tr><th>Tanggal</th><th>Komponen</th><th>Dokumen</th><th>Pemasok</th><th>Batch</th><th>Sumber</th><th className="n">Rp</th></tr></thead>
              <tbody>
                {d.poolLines.filter((l) => l.cost_pool_id === pool.id).map((l) => (
                  <tr key={l.id}><td>{tgl(l.date)}</td><td>{COMP[l.component] ?? l.component}{l.note?.startsWith("pool:") ? " (pool boneless)" : ""}</td><td>{l.document_ref}</td><td>{l.supplier}</td>
                    <td>{d.batches.find((b) => b.id === l.batch_id)?.batch_ref ?? (l.batch_id ? "minggu lain" : <span className="muted">periode</span>)}</td><td>{l.source}</td><Td v={l.amount} /></tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
      ))}
      {pools.length === 0 ? <Card title="Cost pool"><p className="muted">Belum ada cost pool untuk bulan minggu ini. Upload WP potong atau daftar PI untuk membentuknya.</p></Card> : null}
      <Card title="Tarif overhead (mode RPA sendiri)">
        <table className="t compact">
          <thead><tr><th>Periode</th><th className="n">Rp/kg LB</th><th className="n">Basis kg LB</th><th className="n">Budget overhead</th><th>Catatan</th></tr></thead>
          <tbody>{d.rates.map((r) => <tr key={r.id}><td>{tgl(r.period_start)} – {tgl(r.period_end)}</td><Td v={r.rate_per_kg_lb} dp={2} /><Td v={r.basis_kg} /><Td v={r.budget_overhead} /><td>{r.note}</td></tr>)}
            {d.rates.length === 0 ? <tr><td colSpan={5} className="muted">Belum ada — maklon (s.d. Okt 2026) tidak memakai tarif overhead.</td></tr> : null}</tbody>
        </table>
        <ActionForm action={addOverheadRate} submit="Tambah tarif" className="row">
          <input type="hidden" name="week" value={week} />
          <div className="field"><label>Dari</label><input className="in" type="date" name="period_start" required /></div>
          <div className="field"><label>Sampai</label><input className="in" type="date" name="period_end" required /></div>
          <div className="field"><label>Rp/kg LB</label><input className="in" name="rate_per_kg_lb" required /></div>
          <div className="field"><label>Basis kg LB</label><input className="in" name="basis_kg" /></div>
          <div className="field"><label>Budget overhead Rp</label><input className="in" name="budget_overhead" /></div>
          <div className="field"><label>Catatan</label><input className="in" name="note" /></div>
        </ActionForm>
      </Card>
      <p className="muted">Hasil per SKU, per grup dan COGS/kg ada di <Link href={`/w/${week}/costing`}>Costing</Link>.</p>
    </WeekShell>
  );
}
