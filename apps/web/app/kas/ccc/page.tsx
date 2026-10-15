import Link from "next/link";
import { jakartaToday, simulateCcc } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, N, Td } from "@/components/ui";
import { moduleEnabled, requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { loadCash } from "@/lib/v3/cash";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

const num = (v: string | undefined, d: string) => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : d);

/** PRD v3 §6 /kas/ccc: DIO / DSO / DPO / CCC, working capital and a what-if on terms and stock days. */
export default async function CccPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireModulePage("m6_cash", ["admin", "finance", "management"]);
  const { viewer, weeks, week } = await plainContext();
  const date = jakartaToday();
  const sb = await supabaseServer();
  const st = await loadCash(sb, date, { m4: await moduleEnabled("m4_monthly", v) });
  const c = st.ccc;
  const termsLb = num(sp.lb, "7"), termsTr = num(sp.tr, "14"), share = num(sp.share, "0.5"), stock = sp.stock ? num(sp.stock, "") : "";
  const sim = c ? simulateCcc(c, { termsLbDays: termsLb, termsTradingDays: termsTr, shareLb: share, targetStockDays: stock === "" ? null : stock }) : null;
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/kas">
      <h1>CCC dan modal kerja — {tgl(date)}</h1>
      <p className="muted">DIO = persediaan ÷ HPP per hari; DSO = piutang ÷ penjualan per hari; DPO = utang dagang ÷ HPP per hari; HPP dan penjualan dari jurnal {st.cccWindowDays} hari terakhir (maks. 90). Modal kerja = CCC ÷ 365 × HPP setahun. <Link href="/kas">← Kas</Link></p>
      {!c ? <Card><p>Belum ada neraca mingguan atau jurnal untuk menghitung CCC.</p></Card> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="l">CCC</div><div className="v"><N v={c.ccc} dp={1} /> hari</div><div className="l">DIO <N v={c.dio} dp={1} /> + DSO <N v={c.dso} dp={1} /> − DPO <N v={c.dpo} dp={1} /></div></div>
            <div className="kpi"><div className="l">Modal kerja terikat</div><div className="v"><N v={c.workingCapital} /></div><div className="l">HPP per hari <N v={c.cogsPerDay} /></div></div>
          </div>
          <Card title="Simulasi">
            <form className="row noprint" method="get">
              <label>Termin LB (hari) <input className="in" name="lb" defaultValue={termsLb} size={4} /></label>
              <label>Termin trading (hari) <input className="in" name="tr" defaultValue={termsTr} size={4} /></label>
              <label>Porsi pembelian LB (0–1) <input className="in" name="share" defaultValue={share} size={4} /></label>
              <label>Target hari stok (kosong = sekarang) <input className="in" name="stock" defaultValue={stock} size={4} /></label>
              <button className="b">Hitung</button>
            </form>
            {sim ? (
              <table className="t compact"><thead><tr><th /><th className="n">Sekarang</th><th className="n">Simulasi</th></tr></thead>
                <tbody>
                  <tr><td>DIO</td><Td v={c.dio} dp={1} /><Td v={sim.dio} dp={1} /></tr>
                  <tr><td>DSO</td><Td v={c.dso} dp={1} /><Td v={sim.dso} dp={1} /></tr>
                  <tr><td>DPO</td><Td v={c.dpo} dp={1} /><Td v={sim.dpo} dp={1} /></tr>
                  <tr><td>CCC</td><Td v={c.ccc} dp={1} /><Td v={sim.ccc} dp={1} /></tr>
                  <tr><td>Modal kerja</td><Td v={c.workingCapital} /><Td v={sim.workingCapital} /></tr>
                  <tr><td>Selisih modal kerja</td><td /><Td v={sim.deltaWorkingCapital} /></tr>
                </tbody>
              </table>
            ) : null}
          </Card>
        </>
      )}
    </Shell>
  );
}
