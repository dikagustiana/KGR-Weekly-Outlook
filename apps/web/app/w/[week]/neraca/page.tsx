import Link from "next/link";
import { ZERO, type BsColumn } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Td } from "@/components/ui";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function BsPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  const bs = r.statements.bs;
  const d = bs.dates;
  const cols: [BsColumn, string][] = [
    ["tb", `Saldo awal (TB)\n${tgl(d.tb)}`], ["lastWeekEnd", `Akhir minggu lalu\n${tgl(d.lastWeekEnd)}`], ["yesterday", `Kemarin (aktual)\n${tgl(d.yesterday)}`],
    ["projection", `Proyeksi akhir\nminggu ini ${tgl(d.projection)}`], ["delta", "Δ minggu ini\n(proyeksi − akhir minggu lalu)"], ["plannedFlow", "Δ rencana\n(debit +)"],
  ];
  const p = r.prepared;
  const line = sp.line;
  const accounts = line
    ? [...new Set([...p.tb.filter((t) => (line === "Current year profit" ? t.type === "LabaRugi" : t.bsLine === line)).map((t) => t.account),
        ...p.gl.filter((g) => (line === "Current year profit" ? g.type === "LabaRugi" : g.bsLine === line)).map((g) => g.account as string)])].sort()
    : [];
  const acctRow = (a: string) => {
    const tb = p.tb.filter((t) => t.account === a).reduce((s, t) => s.plus(t.balance), ZERO);
    const at = (x: string) => tb.plus(p.gl.filter((g) => g.account === a && g.date !== null && g.date <= x).reduce((s, g) => s.plus(g.drCr), ZERO));
    return { a, name: p.coa.get(a)?.name ?? "", tb, lw: at(d.lastWeekEnd), y: at(d.yesterday) };
  };
  const pf = bs.planned;
  const sideHead = (side: string) => (side === "asset" ? "ASSETS" : side === "liability" ? "LIABILITIES" : "EQUITY");
  let lastSide = "";
  return (
    <WeekShell ctx={ctx} active="neraca">
      <h1>Neraca mingguan — Rp</h1>
      <p className="muted">Aktual = saldo awal TB + jurnal s.d. tanggal. Proyeksi akhir minggu = saldo kemarin + arus rencana (blok di bawah). Aset positif; liabilitas dan ekuitas dibalik tandanya. Klik pos untuk rincian per akun.</p>
      <Card>
        <div className="scroll">
          <table className="t">
            <thead><tr><th>Pos</th>{cols.map(([c, h]) => <th key={c} className="n">{h}</th>)}</tr></thead>
            <tbody>
              {bs.lines.map((l) => {
                const head = (l.side === "asset" || l.side === "liability" || l.side === "equity") && l.side !== lastSide ? sideHead(l.side) : null;
                if (l.side !== "total" && l.side !== "control") lastSide = l.side;
                return [
                  head ? <tr key={`h-${l.line}`} className="sub"><td colSpan={7}>{head}</td></tr> : null,
                  <tr key={l.line} className={l.side === "total" ? "total" : l.side === "control" ? "dim" : ""}>
                    <td className="lbl">{l.side === "total" || l.side === "control" ? l.line : <Link href={`?line=${encodeURIComponent(l.line)}#drill`}>{l.line}</Link>}</td>
                    {cols.map(([c]) => (
                      <Td key={c} v={l.values[c]} className={l.side === "control" && !l.values[c].isZero() ? "warn" : ""}
                        tip={c === "projection" ? "kemarin + Δ rencana (aset) / kemarin − Δ rencana (liabilitas, ekuitas)" : c === "plannedFlow" ? "lihat Arus rencana minggu ini" : `Σ TB + Σ jurnal s.d. tanggal kolom${l.side === "asset" ? "" : " (tanda dibalik)"}`} />
                    ))}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {line ? (
        <Card id="drill" title={`Rincian akun: ${line}`} extra={<Link href="?">tutup</Link>}>
          <table className="t compact">
            <thead><tr><th>Akun</th><th>Nama</th><th className="n">Saldo TB (debit +)</th><th className="n">Akhir minggu lalu</th><th className="n">Kemarin</th></tr></thead>
            <tbody>
              {accounts.map(acctRow).map((x) => (
                <tr key={x.a}><td>{x.a}</td><td>{x.name}</td><Td v={x.tb} dp={2} /><Td v={x.lw} dp={2} /><Td v={x.y} dp={2} /></tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Saldo per akun dalam tanda debit (+). Mutasi jurnal per akun: buka Arus Kas / Laba Rugi atau Audit.</p>
        </Card>
      ) : null}
      <Card title="Arus rencana minggu ini (dipakai untuk proyeksi neraca dan arus kas)">
        <table className="t compact" style={{ maxWidth: 820 }}>
          <tbody>
            <tr><td>Biaya produksi rencana (LB + angkut + maklon)</td><Td v={pf.batchTotalCost} tip="T_Batch Rencana, hari ini s.d. akhir minggu" /></tr>
            <tr><td>Pembelian live bird rencana</td><Td v={pf.lbValue} /></tr>
            <tr><td>Angkut + maklon rencana</td><Td v={pf.freightMaklon} /></tr>
            <tr><td>Pembelian trading rencana</td><Td v={pf.tradingReceipts} tip="T_Penerimaan Beli Trading Rencana (dihitung)" /></tr>
            <tr><td>Bayar live bird jatuh tempo minggu ini (rencana)</td><Td v={pf.lbDue} tip={`Rencana bertanggal (hari ini … akhir minggu) − ${p.params.termsLb} hari`} /></tr>
            <tr><td>Bayar pembelian trading jatuh tempo minggu ini (rencana)</td><Td v={pf.tradingDue} tip={`− ${p.params.termsTrading} hari`} /></tr>
            <tr><td>Bayar angkut + maklon jatuh tempo minggu ini (rencana)</td><Td v={pf.freightMaklonDue} tip={`− ${p.params.termsFreightMaklon} hari`} /></tr>
            <tr><td>Revenue sisa minggu</td><Td v={pf.revenueOutlook} /></tr>
            <tr><td>COGS live bird sisa minggu</td><Td v={pf.cogsLbOutlook} /></tr>
            <tr><td>COGS trading sisa minggu</td><Td v={pf.cogsTradingOutlook} /></tr>
            <tr><td>Biaya run-rate (excl. D&amp;A), net</td><Td v={pf.runRateCostsNet} /></tr>
            <tr><td>D&amp;A sisa minggu</td><Td v={pf.daOutlook} /></tr>
            <tr><td>Laba bersih sisa minggu</td><Td v={pf.netIncomeOutlook} /></tr>
            <tr><td>Arus kas bersih sisa minggu (Arus Kas)</td><Td v={pf.netCashFlowOutlook} /></tr>
          </tbody>
        </table>
      </Card>
    </WeekShell>
  );
}
