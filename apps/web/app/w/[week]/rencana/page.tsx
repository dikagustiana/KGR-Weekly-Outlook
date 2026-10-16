import Link from "next/link";
import { v4On } from "@/lib/v4/nav";
import { RencanaV4 } from "./v4";
import { RencanaV5 } from "./v5";
import { addDays } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { ActionForm } from "@/components/ActionForm";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { moduleEnabled, moduleSettings, requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { loadPlanning, proposePlan, weekPlanningControls } from "@/lib/v3/planning";
import { stockMartControl } from "@/lib/v3/stale";
import { tgl } from "@/lib/fmt";
import { approvePlanAction, copyPlanAction, savePlanAction, setCapacityAction } from "./actions";

export const dynamic = "force-dynamic";

type J = Record<string, string>;

/** PRD v3 §4.4 steps 4–5: weekly plan (heads, surplus → frozen, Rp downgrade, approval) and daily plan. PPIC; finance approves. */
export default async function RencanaPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const q = await searchParams;
  const v = await requireModulePage("m3_planning", ["admin", "ppic", "finance"]);
  const ctx = await weekContext(week);
  // PRD v5 §6.3 (flag v5_ppic_class): demand per size → class → kg LB replaces the heads-based plan
  if (await moduleEnabled("v5_ppic_class", v)) return <RencanaV5 ctx={ctx} versi={q.versi === "batch" ? "batch" : "need"} />;
  if (v4On(await moduleSettings(), v.role)) return <RencanaV4 ctx={ctx} kelas={q.kelas ?? null} />;
  const sb = await supabaseServer();
  const src = await loadPlanning(sb, ctx.week);
  const c45 = await stockMartControl(sb, addDays(ctx.week.week_start, -1));
  const p = proposePlan(src, { classCode: q.kelas ?? null });
  const wp = p.proposal.plan;
  const latest = src.plans[0] ?? null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ctx.week.week_start, i));
  const canPlan = v.role === "admin" || v.role === "ppic";
  const canApprove = v.role === "admin" || v.role === "finance";
  const surplus = (latest?.surplus_kg_by_key ?? {}) as J;
  const output = (latest?.output_kg_by_key ?? {}) as J;
  return (
    <WeekShell ctx={ctx} active={`/w/${week}/rencana`}>
      <h1>Rencana potong minggu {tgl(ctx.week.week_start)}</h1>
      <p className="muted">Ekor = kebutuhan potong dari <Link href={`/w/${week}/demand`}>Demand</Link> (atau supply LB yang sudah dikonfirmasi bila lebih besar), dibatasi kapasitas potong. Output yang tidak tertampung demand direncanakan frozen; selisih harga fresh − frozen = Rp downgrade. Downgrade di atas <N v={src.threshold} /> per minggu perlu persetujuan. Batch rencana v1 (blok 2) <b>tidak</b> berubah sampai tombol &quot;Salin ke batch rencana&quot; ditekan.</p>
      <div className="kpis">
        <div className="kpi"><div className="l">Usulan engine: ekor</div><div className="v"><N v={wp.head_count} /></div><div className="l">dibutuhkan <N v={wp.headsNeeded} /> · supply konfirmasi <N v={p.supplyHeads} />{wp.cappedByCapacity ? <> · dibatasi kapasitas, kurang <N v={wp.shortHeads} /></> : null}</div></div>
        <div className="kpi"><div className="l">Direncanakan frozen</div><div className="v"><N v={wp.frozen_planned_kg} /> kg</div><div className="l">downgrade Rp <N v={wp.rp_downgrade} />{wp.needsApproval ? " — perlu persetujuan" : ""}</div></div>
        <div className="kpi"><div className="l">Kelas berat</div><div className="v">{p.cls?.code ?? "—"}</div><div className="l">rata-rata <N v={p.cls?.avg_kg ?? null} dp={2} /> kg/ekor · {Object.entries(p.proposal.patternMix).map(([k, h]) => `${k} ${h}`).join(", ") || "—"}</div></div>
        <div className="kpi"><div className="l">Rencana tersimpan</div><div className="v">{latest ? `v${latest.version}` : "—"}</div><div className="l">{latest ? <><N v={Number(latest.head_count)} /> ekor{latest.approved_by ? ` · disetujui ${latest.approved_by}` : latest.needs_approval ? " · menunggu persetujuan" : ""}{latest.copied_to_batch_at ? " · sudah disalin ke batch" : ""}</> : "belum ada"}</div></div>
      </div>
      {canPlan ? (
        <Card title="Simpan rencana">
          <ActionForm action={savePlanAction} submit="Simpan sebagai versi baru" className="row">
            <input type="hidden" name="week" value={week} />
            <label>Kelas berat <select name="weight_class" defaultValue={p.cls?.code ?? ""}>{src.weightClasses.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
            <label>Supply komitmen (ekor) <input name="supply_heads" placeholder={String(p.supplyHeads)} size={8} /></label>
            <label>Catatan <input name="note" size={30} /></label>
          </ActionForm>
        </Card>
      ) : null}
      {latest ? (
        <Card title={`Rencana v${latest.version} — per hari`} extra={<span className="row">
          {latest.needs_approval && !latest.approved_by && canApprove ? <ActionForm action={approvePlanAction} submit="Setujui downgrade" confirm="Setujui rencana dengan downgrade di atas batas?"><input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={String(latest.id)} /></ActionForm> : null}
          {canPlan ? <ActionForm action={copyPlanAction} submit="Salin ke batch rencana" confirm="Batch rencana minggu ini (salinan rencana sebelumnya) diganti. Lanjut?"><input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={String(latest.id)} /></ActionForm> : null}
        </span>}>
          <table className="t compact">
            <thead><tr><th>Tanggal potong</th><th className="n">Ekor</th><th>Kelas</th><th>Pola</th><th>Pemasok</th><th>Dibatasi</th><th className="n">Pindahan dari hari berikut</th><th className="n">Kapasitas</th></tr></thead>
            <tbody>{src.planDays.map((d) => (
              <tr key={String(d.id)}><td>{tgl(String(d.date))}</td><Td v={Number(d.head_count)} /><td>{String(d.weight_class ?? "—")}</td><td>{String(d.cut_pattern ?? "—")}</td><td>{String(d.supplier ?? "—")}</td>
                <td>{d.limited_by === "capacity" ? "kapasitas" : d.limited_by === "supply" ? "supply LB" : "—"}</td><Td v={Number(d.moved_from_later)} /><Td v={src.capacity.get(String(d.date))?.cut_capacity_head ?? null} /></tr>
            ))}</tbody>
          </table>
          <h3>Output dan surplus per SKU</h3>
          <table className="t compact">
            <thead><tr><th>SKU</th><th className="n">Output kg</th><th className="n">Surplus → frozen kg</th></tr></thead>
            <tbody>{Object.keys(output).sort().map((k) => <tr key={k}><td>{k}</td><Td v={output[k]} /><Td v={surplus[k] ?? null} /></tr>)}</tbody>
          </table>
        </Card>
      ) : null}
      <Card title="Usulan engine — per hari (belum disimpan)">
        <table className="t compact">
          <thead><tr><th>Tanggal potong</th><th className="n">Ekor</th><th>Dibatasi</th></tr></thead>
          <tbody>{p.days.rows.map((r) => <tr key={r.date}><td>{tgl(r.date)}</td><Td v={r.head_count} /><td>{r.limited_by === "capacity" ? "kapasitas" : r.limited_by === "supply" ? "supply LB" : "—"}</td></tr>)}</tbody>
        </table>
        {p.days.unplaced ? <p className="msg err"><N v={p.days.unplaced} /> ekor tidak muat di hari mana pun minggu ini.</p> : null}
      </Card>
      <div className="grid2">
        {canPlan ? (
          <Card title="Kapasitas harian">
            <ActionForm action={setCapacityAction} submit="Simpan kapasitas">
              <input type="hidden" name="week" value={week} />
              <table className="t compact">
                <thead><tr><th>Tanggal</th><th>Ekor / hari</th><th>Chiller kg</th></tr></thead>
                <tbody>{days.map((d) => { const c = src.capacity.get(d); return (
                  <tr key={d}><td>{tgl(d)}</td><td><input name={`head_${d}`} defaultValue={c?.cut_capacity_head ?? ""} size={7} /></td><td><input name={`chiller_${d}`} defaultValue={c?.chiller_kg ?? ""} size={9} /></td></tr>
                ); })}</tbody>
              </table>
            </ActionForm>
          </Card>
        ) : null}
        <Card title={`Supply live bird (${src.lbSupply.length})`}>
          <table className="t compact">
            <thead><tr><th>Tanggal</th><th>Pemasok</th><th>Kelas</th><th className="n">Ekor</th><th className="n">Harga Rp/kg</th><th>Status</th></tr></thead>
            <tbody>{src.lbSupply.map((r) => <tr key={String(r.id)}><td>{tgl(String(r.date))}</td><td>{String(r.supplier)}</td><td>{String(r.weight_class ?? "—")}</td><Td v={r.head_count === null ? null : Number(r.head_count)} /><Td v={(r.price_per_kg as string) ?? null} /><td>{r.status === "offer" ? "tawaran" : r.status === "confirmed" ? "konfirmasi" : "diterima"}</td></tr>)}</tbody>
          </table>
          <p className="muted">Upload jenis &quot;Purchasing — supply live bird&quot; di <Link href={`/w/${week}/upload`}>Upload</Link>.</p>
        </Card>
      </div>
      {src.plans.length > 1 ? (
        <Card title="Versi sebelumnya">
          <table className="t compact">
            <thead><tr><th>Versi</th><th className="n">Ekor</th><th className="n">Frozen kg</th><th className="n">Downgrade Rp</th><th>Disetujui</th><th>Dibuat</th></tr></thead>
            <tbody>{src.plans.slice(1).map((x) => <tr key={String(x.id)}><td>v{String(x.version)}</td><Td v={Number(x.head_count)} /><Td v={x.frozen_planned_kg as string} /><Td v={x.frozen_planned_rp_downgrade as string} /><td>{String(x.approved_by ?? "—")}</td><td>{String(x.created_by ?? "—")}</td></tr>)}</tbody>
          </table>
        </Card>
      ) : null}
      <Card title="Kontrol rencana (C28, C30, C45)"><ControlsV3Table controls={[...weekPlanningControls(src, ctx.week.update_date), c45]} /></Card>
    </WeekShell>
  );
}
