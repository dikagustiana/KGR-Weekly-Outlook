import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, fixedTotals, jakartaToday, monthlyAmount } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { loadMonthDrivers, monthStart } from "@/lib/v3/drivers";
import { tgl } from "@/lib/fmt";
import { saveDriverAction, saveScheduleAction } from "./actions";
import { moduleSettings } from "@/lib/modules";
import { v4On } from "@/lib/v4/nav";
import { BiayaV4 } from "./v4";

export const dynamic = "force-dynamic";

const DRIVER: Record<string, string> = { fixed: "tetap (jadwal)", variable: "variabel (Rp/kg)", runrate: "run-rate", none: "— belum" };

/** PRD v3 §6 /m/[month]/biaya: fixed cost schedule, drivers per account, fixed outlook of the month (Finance). */
export default async function BiayaPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const first = monthStart(month);
  if (!first) notFound();
  const v = await requireModulePage("m5_drivers", ["admin", "finance"]);
  if (v4On(await moduleSettings(), v.role)) return <BiayaV4 first={first} viewer={v} />;
  const { viewer, weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const d = await loadMonthDrivers(sb, first, jakartaToday());
  const tot = fixedTotals(d.fixed);
  const prev = addDays(first, -1).slice(0, 7), next = addDays(d.last, 1).slice(0, 7);
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/m">
      <h1>Biaya dengan driver — {d.month}</h1>
      <div className="row noprint"><Link className="b small sec" href={`/m/${prev}/biaya`}>← {prev}</Link><Link className="b small sec" href={`/m/${next}/biaya`}>{next} →</Link></div>
      <p className="muted">Biaya tetap mengikuti jadwal: per hari = nominal bulan ÷ hari kalender selama masa berlaku; prepaid yang diamortisasi tanpa nominal = total ÷ jumlah bulan. Outlook pos tetap = jurnal s.d. {tgl(d.through)} + sisa jadwal yang belum dijurnal (tidak pernah dua kali). Biaya variabel = Rp/kg × kg rencana (M3); pos lain run-rate.</p>
      <div className="kpis">
        <div className="kpi"><div className="l">Jadwal biaya tetap bulan ini</div><div className="v"><N v={tot.scheduled} /></div><div className="l">{d.fixed.reduce((n, l) => n + l.missing.length, 0)} baris jadwal belum bernominal</div></div>
        <div className="kpi"><div className="l">Jurnal pos tetap s.d. {tgl(d.through)}</div><div className="v"><N v={tot.actual_mtd} /></div></div>
        <div className="kpi"><div className="l">Outlook pos tetap</div><div className="v"><N v={tot.outlook} /></div></div>
      </div>
      <Card title="Kontrol biaya (C33, C34)"><ControlsV3Table controls={d.controls} /></Card>
      <Card title="Outlook pos tetap">
        <table className="t compact">
          <thead><tr><th>Pos P&amp;L</th><th className="n">Jadwal bulan</th><th className="n">Jurnal MTD</th><th className="n">Outlook</th><th>Catatan</th></tr></thead>
          <tbody>{d.fixed.map((l) => <tr key={l.pl_line}><td>{l.pl_line}</td><Td v={l.scheduled} /><Td v={l.actual_mtd} /><Td v={l.outlook} />
            <td>{l.missing.length ? `belum bernominal: ${l.missing.join(", ")}` : l.over ? "jurnal melebihi jadwal" : ""}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title={`Jadwal biaya tetap (${d.schedule.length})`}>
        <table className="t compact">
          <thead><tr><th>Pos P&amp;L</th><th>Keterangan</th><th>Nominal / bulan</th><th>Mulai</th><th>Akhir</th><th>Prepaid total</th><th>Amortisasi</th><th>Afiliasi</th><th>Aktif</th><th>Catatan</th><th className="n">Per bulan dipakai</th><th /></tr></thead>
          <tbody>
            {d.schedule.map((r) => (
              <tr key={r.id}><td colSpan={12}>
                <ActionForm action={saveScheduleAction} submit="Simpan" className="row">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="month" value={d.month} />
                  <input name="pl_line" defaultValue={r.pl_line} size={22} /><input name="description" defaultValue={r.description} size={30} />
                  <input name="amount_per_month" defaultValue={String(r.amount_per_month ?? "")} size={12} placeholder="isi Finance" />
                  <input name="start_date" defaultValue={r.start_date} size={10} /><input name="end_date" defaultValue={r.end_date ?? ""} size={10} />
                  <input name="prepaid_total" defaultValue={String(r.prepaid_total ?? "")} size={12} />
                  <label><input type="checkbox" name="amortize" defaultChecked={r.amortize} /> amortisasi</label>
                  <label><input type="checkbox" name="intercompany" defaultChecked={r.intercompany} /> afiliasi</label>
                  <label><input type="checkbox" name="active" defaultChecked={r.active} /> aktif</label>
                  <input name="vendor" defaultValue={String(r.vendor ?? "")} size={14} placeholder="vendor" />
                  <input name="note" defaultValue={String(r.note ?? "")} size={40} />
                  <span className="muted">dipakai: <N v={monthlyAmount(r)} /></span>
                </ActionForm>
              </td></tr>
            ))}
            <tr><td colSpan={12}>
              <ActionForm action={saveScheduleAction} submit="Tambah" className="row">
                <input type="hidden" name="month" value={d.month} />
                <input name="pl_line" placeholder="Pos P&L" size={22} /><input name="description" placeholder="Keterangan" size={30} /><input name="amount_per_month" placeholder="Nominal/bulan" size={12} />
                <input name="start_date" placeholder="Mulai YYYY-MM-DD" size={10} /><input name="end_date" placeholder="Akhir" size={10} /><input name="prepaid_total" placeholder="Prepaid" size={12} />
                <label><input type="checkbox" name="amortize" /> amortisasi</label><label><input type="checkbox" name="intercompany" /> afiliasi</label><label><input type="checkbox" name="active" defaultChecked /> aktif</label>
                <input name="vendor" placeholder="vendor" size={14} /><input name="note" placeholder="catatan" size={30} />
              </ActionForm>
            </td></tr>
          </tbody>
        </table>
      </Card>
      <Card title="Driver per akun biaya">
        <table className="t compact">
          <thead><tr><th>Akun</th><th>Nama</th><th>Pos P&amp;L</th><th>Driver</th><th className="n">Jurnal MTD pos</th></tr></thead>
          <tbody>{d.coa.filter((c) => c.pl_line && !String(c.pl_line).startsWith("Revenue") && c.pl_line !== "Other Income").map((c) => (
            <tr key={String(c.account)}><td>{String(c.account)}</td><td>{String(c.name)}</td><td>{String(c.pl_line)}</td>
              <td><ActionForm action={saveDriverAction} submit="Simpan" className="row">
                <input type="hidden" name="account" value={String(c.account)} /><input type="hidden" name="month" value={d.month} />
                <select name="driver_type" defaultValue={String(c.driver_type ?? "none")}>{Object.entries(DRIVER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="driver_basis" defaultValue={String(c.driver_basis ?? "")}><option value="">—</option><option value="kg_cut">kg potong</option><option value="kg_sold">kg jual</option><option value="kg_lb">kg LB</option></select>
                <input name="rp_per_kg" defaultValue={String(c.rp_per_kg ?? "")} size={8} placeholder="Rp/kg" />
                <label><input type="checkbox" name="intercompany" defaultChecked={c.intercompany === true} /> afiliasi</label>
              </ActionForm></td>
              <Td v={d.actual[String(c.pl_line)] ?? null} /></tr>
          ))}</tbody>
        </table>
      </Card>
    </Shell>
  );
}
