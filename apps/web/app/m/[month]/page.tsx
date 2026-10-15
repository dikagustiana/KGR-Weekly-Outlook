import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, cumulative, monthEnd, monthSummary, versionDays } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { DailyChart } from "@/components/v3/DailyChart";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { currentView } from "@/lib/view-server";
import { monthStart } from "@/lib/v3/drivers";
import { monthView, plDaily } from "@/lib/v3/monthly";
import { tgl } from "@/lib/fmt";
import { budgetAction, lockAction, rebuildMonthAction } from "./actions";
import { moduleSettings } from "@/lib/modules";
import { v4On } from "@/lib/v4/nav";
import { OutlookBulanV4 } from "./v4";

export const dynamic = "force-dynamic";

type R = Record<string, unknown>;

/** PRD v3 §6 /m/[month]: daily chart, cumulative + band, versions, bridge V1 → V2, accuracy. Numbers from pl_daily. */
export default async function MonthPage({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { month } = await params;
  const first = monthStart(month);
  if (!first) notFound();
  const v = await requireModulePage("m4_monthly");
  if (v4On(await moduleSettings(), v.role)) return <OutlookBulanV4 first={first} viewer={v} versi={(await searchParams).versi ?? null} />;
  const { viewer, weeks, week } = await plainContext();
  const mgmt = (await currentView(viewer)) === "management";
  const sb = await supabaseServer();
  const [rows, mv, mo] = await Promise.all([plDaily(sb, first), monthView(sb, first), sb.from("month_outlook").select("*").eq("month", first).maybeSingle()]);
  const o = (mo.data ?? null) as R | null;
  const tolerance = String(mv.assumptions.find((a) => a.code === "forecast_tolerance_pct")?.value_num ?? "0.10");
  const sm = monthSummary(rows, first, o ? { revenue: o.budget_revenue as string | null, gp: o.budget_gp as string | null, nibt: o.budget_nibt as string | null } : null, tolerance);
  const days = versionDays(rows, first);
  const cum = cumulative(days);
  const anomalies = new Set(rows.filter((r) => r.anomaly).map((r) => r.date));
  const canWrite = v.role === "admin" || v.role === "finance";
  const prev = addDays(first, -1).slice(0, 7), next = addDays(monthEnd(first), 1).slice(0, 7);
  const ass = (code: string) => mv.assumptions.find((a) => a.code === code && a.source === "engine");
  const ver = (k: string) => mv.versions.find((x) => x.version === k);
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/m">
      <h1>Outlook bulanan — {first.slice(0, 7)}</h1>
      <div className="row noprint"><Link className="b small sec" href={`/m/${prev}`}>← {prev}</Link><Link className="b small sec" href={`/m/${next}`}>{next} →</Link>
        <a className="b small sec" href={`/api/m/${first.slice(0, 7)}/pdf`} target="_blank" rel="noreferrer">Unduh PDF</a>
        {canWrite && !mgmt ? <><Link className="b small sec" href={`/m/${first.slice(0, 7)}/tutup-buku`}>Tutup buku</Link><Link className="b small sec" href={`/m/${first.slice(0, 7)}/biaya`}>Biaya</Link></> : null}</div>
      <p className="muted">Aktual = jurnal s.d. {tgl(sm.lastActual)} (+ DO belum difaktur). Sisa bulan: hari dengan PO = PO berbobot; hari kerja tanpa PO = rata-rata revenue hari kerja dalam 7 hari kalender terakhir tanpa hari anomali, pada GP% bulan berjalan; biaya mengikuti driver. Rentang = ± <N v={tolerance} percent /> dari bagian forecast.</p>
      {rows.length === 0 ? <Card><p>Bulan ini belum dibangun.{canWrite ? " Tekan Bangun ulang." : ""}</p></Card> : null}
      <div className="kpis">
        <div className="kpi"><div className="l">Revenue outlook</div><div className="v"><N v={sm.outlook.revenue.div(1e6)} dp={1} /> jt</div><div className="l">aktual <N v={sm.actual.revenue.div(1e6)} dp={1} /> + forecast <N v={sm.forecast.revenue.div(1e6)} dp={1} /> · rentang <N v={sm.range.revenueLow.div(1e6)} dp={1} />–<N v={sm.range.revenueHigh.div(1e6)} dp={1} /></div></div>
        <div className="kpi"><div className="l">GP outlook</div><div className="v"><N v={sm.outlook.gp.div(1e6)} dp={1} /> jt</div><div className="l">aktual <N v={sm.actual.gp.div(1e6)} dp={1} /> + forecast <N v={sm.forecast.gp.div(1e6)} dp={1} /> · <N v={sm.outlook.revenue.isZero() ? null : sm.outlook.gp.div(sm.outlook.revenue)} percent /></div></div>
        <div className="kpi"><div className="l">NIBT outlook</div><div className="v"><N v={sm.outlook.nibt.div(1e6)} dp={1} /> jt</div><div className="l">biaya <N v={sm.outlook.opex.div(1e6)} dp={1} /> jt</div></div>
        <div className="kpi"><div className="l">Forecast dari PO</div><div className="v"><N v={sm.sharePo} percent /></div><div className="l">{sm.remainingDays} hari tersisa</div></div>
        {sm.budget.revenue ? <div className="kpi"><div className="l">Vs budget revenue <N v={sm.budget.revenue.div(1e6)} dp={1} /> jt</div><div className="v"><N v={sm.outlook.revenue.minus(sm.budget.revenue).div(1e6)} dp={1} /> jt</div><div className="l">butuh per hari <N v={sm.budget.needPerDay?.div(1e6) ?? null} dp={1} /> jt</div></div> : null}
      </div>
      <Card title="Revenue per hari (jt Rp)">
        {/* bar heights only (display); every number shown comes from the engine */}
        <DailyChart bars={days.map((d) => ({ date: d.date, value: Number(d.revenue) / 1e6, kind: d.kind, anomaly: anomalies.has(d.date) }))} />
        <p className="muted">Biru tua = aktual, biru = PO, biru muda = run-rate; garis merah = hari anomali (tidak ikut run-rate).</p>
        <table className="t compact">
          <thead><tr><th>Tanggal</th><th>Dasar</th><th className="n">Revenue</th><th className="n">Kumulatif</th></tr></thead>
          <tbody>{cum.map((c, i) => <tr key={c.date}><td>{tgl(c.date)}</td><td>{days[i].kind === "actual" ? "aktual" : days[i].kind === "po" ? "PO" : days[i].kind === "runrate" ? "run-rate" : "—"}{anomalies.has(c.date) ? " · anomali" : ""}</td><Td v={c.value} /><Td v={c.cumulative} /></tr>)}</tbody>
        </table>
      </Card>
      <div className="grid2">
        <Card title="Asumsi engine">
          <table className="t compact"><tbody>
            {["cut_off", "runrate_revenue", "gp_pct_4w", "anomaly_days", "holidays"].map((c) => { const a = ass(c); return <tr key={c}><td>{String(a?.description ?? c)}</td><td className="n">{a ? (a.value_num !== null && a.value_num !== undefined ? (c === "gp_pct_4w" ? <N v={String(a.value_num)} percent /> : <N v={String(a.value_num)} />) : String(a.value_text ?? "—")) : "—"}</td></tr>; })}
            {mv.assumptions.filter((a) => a.source === "kalibrasi").map((a) => <tr key={String(a.id)}><td>{String(a.description)} (kalibrasi)</td><td className="n">{a.code === "gp_pct" ? <N v={String(a.value_num)} percent /> : <N v={String(a.value_num)} />}</td></tr>)}
          </tbody></table>
        </Card>
        <Card title="Versi">
          <table className="t compact">
            <thead><tr><th>Versi</th><th>Cut-off</th><th className="n">Revenue</th><th className="n">GP</th><th className="n">NIBT</th><th>Dikunci</th><th>SHA-256</th></tr></thead>
            <tbody>{mv.versions.map((x) => <tr key={String(x.id)}><td>{String(x.version)}</td><td>{tgl(String(x.cut_off_date ?? ""))}</td><Td v={String(x.revenue)} /><Td v={String(x.gp)} /><Td v={String(x.nibt)} /><td>{mgmt ? "dikunci" : String(x.locked_by ?? "")}</td><td className="muted">{String(x.snapshot_sha256).slice(0, 12)}… <a href={`/api/m/${first.slice(0, 7)}/pdf?version=${String(x.version)}`} target="_blank" rel="noreferrer">PDF</a> · <a href={`/api/m/${first.slice(0, 7)}/snapshot.json?version=${String(x.version)}`} target="_blank" rel="noreferrer">JSON</a></td></tr>)}</tbody>
          </table>
          {canWrite && !mgmt ? <div className="row desktop-only">
            {(["V1", "V2", "FINAL"] as const).filter((k) => !ver(k)).map((k) => <ActionForm key={k} action={lockAction} submit={`Kunci ${k}`} confirm={`Kunci ${k}? Versi yang dikunci tidak bisa diubah.`}><input type="hidden" name="month" value={first} /><input type="hidden" name="version" value={k} /></ActionForm>)}
            <ActionForm action={rebuildMonthAction} submit="Bangun ulang"><input type="hidden" name="month" value={first} /></ActionForm>
          </div> : null}
        </Card>
      </div>
      {mv.bridge ? (
        <Card title="Bridge revenue V1 → V2">
          <table className="t compact"><tbody>
            <tr><td>V1</td><Td v={mv.bridge.from} /></tr><tr><td>Δ aktual (hari forecast yang sudah terjadi)</td><Td v={mv.bridge.dActual} /></tr>
            <tr><td>Δ volume</td><Td v={mv.bridge.dVolume} /></tr><tr><td>Δ harga</td><Td v={mv.bridge.dPrice} /></tr><tr><td>Δ event (asumsi berubah)</td><Td v={mv.bridge.dEvent} /></tr>
            <tr><td>V2</td><Td v={mv.bridge.to} /></tr><tr><td>Selisih (harus 0)</td><Td v={mv.bridge.check} /></tr>
          </tbody></table>
        </Card>
      ) : null}
      {mv.accuracy.length ? (
        <Card title="Akurasi vs FINAL">
          <table className="t compact">
            <thead><tr><th>Versi</th><th>Lingkup</th><th className="n">Bias</th><th className="n">APE</th><th className="n">Bias (sebelum penyesuaian)</th><th className="n">APE (sebelum penyesuaian)</th></tr></thead>
            <tbody>{[...new Set(mv.accuracy.map((a) => `${a.version}|${a.scope}`))].map((k) => { const [vv, sc] = k.split("|"); const g = (m: string) => mv.accuracy.find((a) => a.version === vv && a.scope === sc && a.metric === m)?.value as string | undefined;
              return <tr key={k}><td>{vv}</td><td>{sc}</td><Td v={g("bias") ?? null} /><Td v={g("MAPE") ?? null} percent /><Td v={g("bias_pre") ?? null} /><Td v={g("MAPE_pre") ?? null} percent /></tr>; })}</tbody>
          </table>
        </Card>
      ) : null}
      {canWrite && !mgmt ? (
        <div className="desktop-only"><Card title="Budget dan cut-off">
          <ActionForm action={budgetAction} submit="Simpan" className="row">
            <input type="hidden" name="month" value={first} />
            <label>Budget revenue <input name="budget_revenue" defaultValue={String(o?.budget_revenue ?? "")} size={14} /></label>
            <label>Budget GP <input name="budget_gp" defaultValue={String(o?.budget_gp ?? "")} size={12} /></label>
            <label>Budget NIBT <input name="budget_nibt" defaultValue={String(o?.budget_nibt ?? "")} size={12} /></label>
            <label>Cut-off (kosong = kemarin) <input name="cut_off_date" defaultValue={String(o?.cut_off_date ?? "")} size={10} /></label>
          </ActionForm>
        </Card></div>
      ) : null}
      {!mgmt ? <Card title="Kontrol (C32)"><ControlsV3Table controls={mv.controls} /></Card> : null}
    </Shell>
  );
}
