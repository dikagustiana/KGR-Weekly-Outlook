import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Chip, Td } from "@/components/ui";
import { tgl } from "@/lib/fmt";
import { BarChart } from "@/components/BarChart";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  const p = r.prepared;
  const batches = [...p.batches].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const last12 = batches.filter((b) => b.status === "Aktual").slice(-12);
  const label = (b: (typeof batches)[number]) => `${tgl(b.date).slice(0, 6)} ${b.src.batch_ref ?? ""}`.trim();
  return (
    <WeekShell ctx={ctx} active="batch">
      <h1>Batch potong RPA — aktual dan rencana</h1>
      <p className="muted">Aktual dari batch costing / data ops; Rencana = potong yang dijadwalkan. Nilai output dinilai di harga acuan (I_Master).</p>
      <Card title="Batch minggu ini">
        <div className="scroll">
          <table className="t compact">
            <thead>
              <tr>
                <th>Tanggal</th><th>Status</th><th>No. PO / batch</th><th>Pemasok</th><th className="n">kg LB{"\n"}dibeli</th><th className="n">Harga LB{"\n"}Rp/kg</th>
                <th className="n">Angkut Rp</th><th className="n">Maklon Rp</th><th className="n">kg{"\n"}diproses</th><th className="n">Karkas{"\n"}fresh kg</th><th className="n">Karkas{"\n"}frozen kg</th>
                <th className="n">Kepala</th><th className="n">Ceker</th><th className="n">Usus</th><th className="n">HJA</th><th className="n">Lemak</th><th className="n">Lainnya</th>
                <th className="n">Nilai LB Rp</th><th className="n">Total biaya{"\n"}Rp</th><th className="n">Shrink</th><th className="n">Output kg</th><th className="n">Yield output{"\n"}÷ diproses</th>
                <th className="n">Yield karkas{"\n"}÷ diproses</th><th className="n">Karkas{"\n"}fresh %</th><th className="n">Nilai output{"\n"}harga acuan Rp</th><th className="n">Margin{"\n"}batch Rp</th>
                <th className="n">Margin per{"\n"}kg LB</th><th className="n">Breakeven{"\n"}LB Rp/kg</th><th className="n">Biaya per{"\n"}kg output</th><th className="n">Nilai per{"\n"}kg output</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.idx}>
                  <td className="lbl">{tgl(b.date)}</td><td>{b.status} <Chip source={b.src.source} /></td><td>{b.src.batch_ref}</td><td>{b.src.supplier}</td>
                  <Td v={b.lbKg} dp={1} /><Td v={b.lbPrice} dp={2} /><Td v={b.freight} /><Td v={b.maklon} /><Td v={b.processedKg} dp={1} />
                  <Td v={b.out.karkas_fresh} dp={1} /><Td v={b.out.karkas_frozen} dp={1} /><Td v={b.out.kepala} dp={1} /><Td v={b.out.ceker} dp={1} />
                  <Td v={b.out.usus} dp={1} /><Td v={b.out.hja} dp={1} /><Td v={b.out.lemak} dp={1} /><Td v={b.out.other} dp={1} />
                  <Td v={b.lbValue} tip="kg LB × harga" /><Td v={b.totalCost} tip="nilai LB + angkut + maklon" />
                  <Td v={b.shrink} percent tip="1 − kg diproses ÷ kg dibeli" className={b.shrink && b.shrink.greaterThan(p.params.shrink) ? "warn" : ""} warnNeg={false} />
                  <Td v={b.outputKg} dp={1} tip="Σ output per produk" /><Td v={b.yieldOutput} percent tip="output ÷ kg diproses" />
                  <Td v={b.yieldKarkas} percent tip="(fresh + frozen) ÷ kg diproses" /><Td v={b.freshShare} percent tip="fresh ÷ karkas" />
                  <Td v={b.outputValue} tip="output × harga acuan" /><Td v={b.margin} tip="nilai output − total biaya" /><Td v={b.marginPerKgLb} />
                  <Td v={b.breakevenLb} tip="(nilai output − angkut − maklon) ÷ kg LB" /><Td v={b.costPerKgOutput} /><Td v={b.valuePerKgOutput} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="KPI batch vs target (blok 6)">
        <table className="t compact">
          <thead><tr><th>Status</th><th className="n">Batch</th><th className="n">kg LB</th><th className="n">Shrink</th><th className="n">Yield karkas</th><th className="n">Fresh %</th><th className="n">Margin Rp</th><th className="n">Breakeven LB</th></tr></thead>
          <tbody>
            {r.block6.rows.map((k) => (
              <tr key={k.status}><td>{k.status}</td><Td v={k.batches} /><Td v={k.lbKg} /><Td v={k.shrink} percent /><Td v={k.karkasYield} percent /><Td v={k.freshPct} percent /><Td v={k.margin} /><Td v={k.breakevenLb} /></tr>
            ))}
            <tr className="dim"><td>Target</td><td /><td /><Td v={r.block6.target.shrink} percent /><Td v={r.block6.target.karkasYield} percent /><td /><td /><Td v={r.block6.target.breakevenLb100Fresh} /></tr>
          </tbody>
        </table>
      </Card>
      {last12.length > 0 ? (
        <div className="grid3">
          <Card title="Shrink per batch"><BarChart unit="%" target={p.params.shrink.times(100).toNumber()} data={last12.map((b) => ({ label: label(b), value: b.shrink ? b.shrink.times(100).toNumber() : 0 }))} /></Card>
          <Card title="Karkas fresh % per batch"><BarChart unit="%" data={last12.map((b) => ({ label: label(b), value: b.freshShare ? b.freshShare.times(100).toNumber() : 0 }))} /></Card>
          <Card title="Biaya vs nilai per kg output"><BarChart unit="Rp" data={last12.flatMap((b) => [
            { label: `${label(b)} biaya`, value: b.costPerKgOutput?.toNumber() ?? 0, tone: "neg" as const },
            { label: `${label(b)} nilai`, value: b.valuePerKgOutput?.toNumber() ?? 0 },
          ])} /></Card>
        </div>
      ) : null}
      <p className="muted">Tren 12 batch memakai batch Aktual yang tersimpan di minggu ini; riwayat lintas minggu tersedia setelah beberapa minggu berjalan.</p>
    </WeekShell>
  );
}
