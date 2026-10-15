import Link from "next/link";
import type { ManagementV3 } from "@/lib/v3/management";
import type { V3Slots } from "@/components/OutlookBody";
import { Card, N, Td } from "@/components/ui";
import { isNeg, jt, mrd, num, tgl } from "@/lib/fmt";

const neg = (v: Parameters<typeof isNeg>[0]) => (isNeg(v) ? "neg" : undefined);

/** Headline tiles added by the modules (PRD v3 §6): month outlook vs budget, lowest cash in 13 weeks, SKUs to sell today. */
export function HeadlineV3({ m, month }: { m: ManagementV3; month: string }) {
  return (
    <>
      {m.month ? (
        <div className="hl">
          <div className="hl-label">Outlook bulan {m.month.first.slice(0, 7)}</div>
          <div className="hl-value">Rp {jt(m.month.summary.outlook.revenue)} · GP <span className={neg(m.month.summary.outlook.gp)}>Rp {jt(m.month.summary.outlook.gp)}</span></div>
          <div className="hl-sub">{m.month.budget.revenue ? <>vs budget <span className={neg(m.month.summary.outlook.revenue.minus(m.month.budget.revenue))}>Rp {jt(m.month.summary.outlook.revenue.minus(m.month.budget.revenue))}</span> · </> : null}<Link href={`/m/${month}`}>detail bulan →</Link></div>
        </div>
      ) : null}
      {m.cash && m.cash.lowest !== null ? (
        <div className="hl">
          <div className="hl-label">Kas terendah 13 minggu</div>
          <div className="hl-value"><span className={isNeg(m.cash.lowest) ? "neg" : undefined}>Rp {jt(m.cash.lowest)}</span></div>
          <div className="hl-sub">pada {tgl(m.cash.lowestDate)} · <Link href="/kas">kas →</Link></div>
        </div>
      ) : null}
      {m.urgent ? (
        <div className="hl">
          <div className="hl-label">SKU jual hari ini</div>
          <div className="hl-value">{m.urgent.skus} SKU · Rp {mrd(m.urgent.value)}</div>
          <div className="hl-sub">{num(m.urgent.kg)} kg · risiko turun ke frozen Rp {jt(m.urgent.downgradeRisk)} · <Link href="/komersial">komersial →</Link></div>
        </div>
      ) : null}
    </>
  );
}

/** The v3 sections of the weekly management view, in PRD v3 §6 order (OutlookBody places them). */
export function managementSlots(m: ManagementV3): V3Slots {
  const s: V3Slots = {};
  if (m.input) {
    const i = m.input;
    s.input = (
      <Card id="input" title="Input minggu ini: pembelian dan biaya potong">
        <table className="t compact">
          <thead><tr><th /><th className="n">kg sudah</th><th className="n">Rp sudah</th><th className="n">kg rencana</th><th className="n">Rp rencana</th></tr></thead>
          <tbody>
            <tr><td>Pembelian live bird</td><Td v={i.lb.actualKg} /><Td v={i.lb.actualValue} /><Td v={i.lb.plannedKg} /><Td v={i.lb.plannedValue} /></tr>
            <tr><td>Pembelian trading</td><Td v={i.trading.actualKg} /><Td v={i.trading.actualValue} /><Td v={i.trading.plannedKg} /><Td v={i.trading.plannedValue} /></tr>
          </tbody>
        </table>
        <table className="t compact">
          <tbody>
            <tr><td>Harga live bird rata-rata</td><Td v={i.lb.avgPriceActual} /><td className="muted">Rp/kg</td></tr>
            <tr><td>Ekspedisi live bird</td><Td v={i.batchCost.freight} /><td className="muted">Rp</td></tr>
            <tr><td>Maklon / potong</td><Td v={i.batchCost.maklon} /><td className="muted">Rp</td></tr>
            {i.batchCost.overhead ? <tr><td>Overhead RPA</td><Td v={i.batchCost.overhead} /><td className="muted">Rp</td></tr> : null}
            <tr><td>Biaya potong per kg live bird</td><Td v={i.batchCost.perKgLb} /><td className="muted">Rp/kg</td></tr>
          </tbody>
        </table>
      </Card>
    );
  }
  if (m.cogs) {
    const c = m.cogs;
    s.cogs = (
      <Card id="cogs" title="Harga pokok penjualan minggu ini">
        <table className="t compact">
          <thead><tr><th>Segmen</th><th className="n">kg</th><th className="n">Penjualan Rp</th><th className="n">HPP Rp</th><th className="n">Penjualan/kg</th><th className="n">HPP/kg</th><th className="n">Laba kotor/kg</th></tr></thead>
          <tbody>{c.segments.map((x) => <tr key={x.segment} className={x.segment === "TOTAL KGR" ? "total" : undefined}><td>{x.segment}</td><Td v={x.kg.isZero() ? null : x.kg} /><Td v={x.revenue.isZero() ? null : x.revenue} /><Td v={x.cogs} /><Td v={x.revenuePerKg} /><Td v={x.cogsPerKg} /><Td v={x.gpPerKg} /></tr>)}</tbody>
        </table>
        {c.groups && c.groups.length ? (
          <>
            <h3>HPP per kg per grup SKU (costing per batch)</h3>
            <table className="t compact"><thead><tr><th>Grup</th><th className="n">kg</th><th className="n">HPP/kg</th></tr></thead>
              <tbody>{c.groups.map((g) => <tr key={g.group}><td>{g.group}</td><Td v={g.kg} /><Td v={g.costPerKg} /></tr>)}</tbody></table>
          </>
        ) : null}
        {c.roll ? (
          <>
            <h3>Persediaan {tgl(c.roll.from)} – {tgl(c.roll.to)}</h3>
            <table className="t compact"><thead><tr><th /><th className="n">kg</th><th className="n">Rp</th></tr></thead>
              <tbody>
                <tr><td>Awal</td><Td v={c.roll.opening.kg} /><Td v={c.roll.opening.value} /></tr>
                <tr><td>+ Masuk</td><Td v={c.roll.in.kg} /><Td v={c.roll.in.value} /></tr>
                <tr><td>− Keluar (penjualan)</td><Td v={c.roll.out.kg} /><Td v={c.roll.out.value} /></tr>
                <tr><td>− Blast (fresh → frozen, bersih)</td><Td v={c.roll.blast.kg} /><Td v={c.roll.blast.value} /></tr>
                <tr><td>± Penyesuaian</td><Td v={c.roll.adjust.kg} /><Td v={c.roll.adjust.value} /></tr>
                <tr className="total"><td>Akhir</td><Td v={c.roll.closing.kg} /><Td v={c.roll.closing.value} /></tr>
                <tr><td>Selisih dengan neraca</td><td /><Td v={c.roll.vsBalanceSheet} /></tr>
              </tbody></table>
          </>
        ) : null}
      </Card>
    );
  }
  if (m.cash) {
    s.cash = (
      <Card id="kas-v3" title="Kas" extra={<Link href="/kas">detail →</Link>}>
        <p>Saldo per {tgl(m.cash.date)}: <b>Rp <N v={m.cash.closing} /></b>; terendah dalam 13 minggu <b className={isNeg(m.cash.lowest) ? "neg" : undefined}>Rp <N v={m.cash.lowest} /></b> pada {tgl(m.cash.lowestDate)}.</p>
      </Card>
    );
  }
  if (m.demand) {
    const t = m.demand.totals;
    s.demand = (
      <Card id="demand" title="Demand minggu ini">
        <table className="t compact"><tbody>
          <tr><td>PO pasti</td><Td v={t.confirmed} /><td className="muted">kg</td></tr>
          <tr><td>PO tentatif</td><Td v={t.tentative} /><td className="muted">kg</td></tr>
          <tr><td>Forecast sales</td><Td v={t.forecast} /><td className="muted">kg</td></tr>
          <tr><td>Demand berbobot</td><Td v={t.weighted} /><td className="muted">kg</td></tr>
          <tr><td>Dipenuhi dari stok</td><Td v={t.stock} /><td className="muted">kg</td></tr>
          <tr><td>Kebutuhan potong</td><Td v={t.net} /><td className="muted">kg</td></tr>
          <tr><td>Rencana potong{m.demand.planVersion ? ` (versi ${m.demand.planVersion})` : ""}</td><Td v={m.demand.heads} /><td className="muted">ekor</td></tr>
        </tbody></table>
      </Card>
    );
  }
  if (m.accuracy && m.accuracy.rows.length) {
    const g = (v: string, sc: string, k: string) => m.accuracy!.rows.find((r) => r.version === v && r.scope === sc && r.metric === k)?.value as string | undefined;
    s.accuracy = (
      <Card id="akurasi" title={`Akurasi outlook ${m.accuracy.month.slice(0, 7)}`}>
        <table className="t compact"><thead><tr><th>Versi</th><th className="n">Error penjualan</th><th className="n">Error laba kotor</th><th className="n">Error penjualan sebelum penyesuaian</th></tr></thead>
          <tbody>{["V1", "V2"].map((v) => <tr key={v}><td>{v}</td><Td v={g(v, "revenue", "MAPE") ?? null} percent /><Td v={g(v, "gp", "MAPE") ?? null} percent /><Td v={g(v, "revenue", "MAPE_pre") ?? null} percent /></tr>)}</tbody></table>
      </Card>
    );
  }
  return s;
}
