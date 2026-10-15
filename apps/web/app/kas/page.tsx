import Link from "next/link";
import { isISODate, jakartaToday } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { moduleEnabled, requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { currentView } from "@/lib/view-server";
import { loadCash } from "@/lib/v3/cash";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

/** PRD v3 §6 /kas: position per account, plans, 13 weeks, 12 months, solvency (finance, management). */
export default async function KasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireModulePage("m6_cash", ["admin", "finance", "management"]);
  const { viewer, weeks, week } = await plainContext();
  const mgmt = (await currentView(viewer)) === "management";
  const date = sp.date && isISODate(sp.date) ? sp.date : jakartaToday();
  const sb = await supabaseServer();
  const st = await loadCash(sb, date, { m4: await moduleEnabled("m4_monthly", v) });
  const sol = st.solvency;
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/kas">
      <h1>Kas — {tgl(date)}</h1>
      <p className="muted">Saldo per rekening dari template kas harian Finance; proyeksi = saldo hari ini + rencana kas (dan jadwal biaya tetap yang belum direncanakan). <Link href="/kas/ccc">CCC dan modal kerja →</Link></p>
      <div className="kpis">
        <div className="kpi"><div className="l">Saldo kas ({st.position.length} rekening)</div><div className="v"><N v={st.projection.startClosing} /></div><div className="l">neraca kemarin <N v={st.bsCash} /></div></div>
        <div className="kpi"><div className="l">Kas terendah 13 minggu</div><div className="v"><N v={st.projection.lowest} /></div><div className="l">pada {tgl(st.projection.lowestDate)}</div></div>
        {sol ? <div className="kpi"><div className="l">Ekuitas (neraca mingguan)</div><div className="v"><N v={sol.equity} /></div><div className="l"><N v={sol.equity_to_capital} percent /> dari modal disetor <N v={sol.paid_in_capital} /></div></div> : null}
        {sol ? <div className="kpi"><div className="l">Hutang afiliasi</div><div className="v"><N v={sol.affiliate_payable} /></div><div className="l">{sol.months_to_negative_equity ? <>ekuitas habis dalam <N v={sol.months_to_negative_equity} dp={1} /> bulan pada laba bulan ini</> : "laba bulan ini tidak negatif"}</div></div> : null}
      </div>
      <div className="grid2">
        <Card title="Saldo per rekening">
          <table className="t compact"><thead><tr><th>Rekening</th><th>Bank</th><th className="n">Saldo</th><th>Per</th></tr></thead>
            <tbody>{st.position.map((b) => { const a = st.accounts.find((x) => x.account_no === b.account_no); return <tr key={b.account_no}><td>{b.account_no}</td><td>{String(a?.bank ?? "—")}</td><Td v={b.closing} /><td>{b.carried ? tgl(b.date) : "hari ini"}</td></tr>; })}</tbody>
          </table>
          {!mgmt ? <p className="muted">Upload "Finance — template kas harian" (reference/templates/Template_Kas_Harian.xlsx) di Upload minggu berjalan.</p> : null}
        </Card>
        <Card title="12 bulan">
          <table className="t compact"><thead><tr><th>Bulan</th><th className="n">Perubahan kas</th><th className="n">Saldo akhir</th></tr></thead>
            <tbody>{st.months.map((m) => <tr key={m.month}><td>{m.month.slice(0, 7)}</td><Td v={m.change} /><Td v={m.closing} /></tr>)}</tbody>
          </table>
          <p className="muted">Bulan berjalan dan seterusnya: laba sebelum pajak outlook bulan ini + depresiasi (non-kas), dipertahankan tetap.</p>
        </Card>
      </div>
      <Card title="13 minggu">
        <table className="t compact"><thead><tr><th>Minggu</th><th className="n">Saldo awal</th><th className="n">Masuk</th><th className="n">Keluar</th><th className="n">Saldo akhir</th><th className="n">Terendah</th><th>Tanggal terendah</th></tr></thead>
          <tbody>{st.projection.weeks.map((w) => <tr key={w.week_start}><td>{tgl(w.week_start)}</td><Td v={w.opening} /><Td v={w.cash_in} /><Td v={w.cash_out} /><Td v={w.closing} /><Td v={w.lowest} /><td>{tgl(w.lowest_day)}</td></tr>)}</tbody>
        </table>
      </Card>
      {!mgmt ? (
        <Card title={`Rencana kas (${st.plans.length + st.scheduled.length})`}>
          <table className="t compact"><thead><tr><th>Tanggal</th><th>Rekening</th><th>Kategori</th><th>Deskripsi</th><th className="n">Jumlah</th><th>Status</th></tr></thead>
            <tbody>{[...st.plans, ...st.scheduled].filter((p) => p.date >= date).sort((a, b) => a.date.localeCompare(b.date)).map((p, i) => (
              <tr key={i}><td>{tgl(p.date)}</td><td>{p.account_no ?? "—"}</td><td>{p.cf_category ?? "—"}</td><td>{p.description ?? "—"}</td><Td v={p.amount as string} /><td>{p.status ?? "plan"}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      ) : null}
      {!mgmt ? <Card title="Kontrol kas (C35–C37)"><ControlsV3Table controls={st.controls} /></Card> : null}
    </Shell>
  );
}
