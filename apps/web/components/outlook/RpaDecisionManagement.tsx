import type { Decimal, WeekResult } from "@kgr/engine";
import { N } from "@/components/ui";
import { num, tglShort } from "@/lib/fmt";

type Line = { l: string; v: Decimal; u: string; how: string; dp?: number; pct?: boolean };

/**
 * Management View v2 R3 + R5, section 2 in the management view: the action, the four deciding figures,
 * then the rest folded under "Lihat perhitungan". "Cara hitung" is a tooltip on each label (plain words).
 * Same fields as the preparer table; nothing recomputed.
 */
export function RpaDecisionManagement({ r }: { r: WeekResult }) {
  const b2 = r.block2;
  const p = r.prepared.params;
  // R3: with no net fresh need, "kebutuhan bersih", "LB maksimum" and "porsi fresh" are 0 by construction
  const covered = b2.netFreshNeed.isZero();
  const key: Line[] = [
    { l: "Harga live bird hari ini (penawaran)", v: b2.lbPriceToday, u: "Rp/kg LB", how: "Parameter harian: harga penawaran live bird hari ini" },
    { l: "Breakeven live bird — 100% karkas fresh", v: b2.breakevenAt100Fresh, u: "Rp/kg LB", how: "Batas atas: nilai output bila semua karkas laku fresh − angkut − maklon" },
    { l: "Margin per kg live bird di harga hari ini", v: b2.marginPerKgLb, u: "Rp/kg LB", how: "Breakeven rencana potong − harga hari ini" },
    { l: "Perkiraan margin potong rencana", v: b2.expectedMarginOfPlan, u: "Rp", how: "Margin per kg × kg live bird yang direncanakan potong" },
  ];
  const rest: Line[] = [
    { l: `Order karkas fresh — ${tglShort(b2.horizonFrom)} s.d. ${tglShort(b2.horizonTo)}`, v: b2.freshOrdersInHorizon, u: "kg", how: "Penjualan: order karkas fresh RPA dalam horizon" },
    { l: "Stok karkas fresh hari ini", v: b2.freshStockToday, u: "kg", how: "Stok hari ini" },
    ...(covered ? [] : [
      { l: "Kebutuhan bersih karkas fresh", v: b2.netFreshNeed, u: "kg", how: "Order − stok (minimal 0)" },
      { l: "Live bird maksimum tanpa menambah karkas frozen", v: b2.lbMaxWithoutFrozen, u: "kg LB", how: "Kebutuhan bersih ÷ ((1 − shrink) × yield karkas)" },
    ]),
    { l: "Live bird yang sudah direncanakan potong (horizon)", v: b2.lbPlannedInHorizon, u: "kg LB", how: "Rencana batch dalam horizon" },
    { l: "Karkas yang berpotensi jadi frozen", v: b2.karkasAtRiskOfFreezing, u: "kg", how: "Kelebihan potong × (1 − shrink) × yield karkas" },
    ...(covered ? [] : [{ l: "Porsi karkas fresh dari potong rencana", v: b2.freshShareOfPlan, u: "%", pct: true, how: "Kebutuhan bersih ÷ karkas dari potong rencana, maksimal 100%" }]),
    { l: "Nilai output per kg live bird (porsi fresh rencana)", v: b2.valuePerKgLbAtPlanShare, u: "Rp/kg LB", how: "(1 − shrink) × nilai karkas dan produk samping per kg" },
    { l: "Breakeven live bird — porsi fresh rencana", v: b2.breakevenAtPlanShare, u: "Rp/kg LB", how: "Nilai output − angkut − maklon × (1 − shrink)" },
    { l: "Potensi selisih harga karkas yang jadi frozen", v: b2.frozenPriceGap, u: "Rp", how: "Kg frozen × (harga fresh − harga frozen)" },
  ];
  return (
    <>
      <div className="reco" data-reco>{b2.action.text}</div>
      <Lines lines={key} />
      {covered ? (
        <p className="cond">
          Stok fresh {num(b2.freshStockToday)} kg sudah menutup order {num(b2.freshOrdersInHorizon)} kg — tidak perlu potong tambahan.
        </p>
      ) : null}
      <details className="calc">
        <summary>Lihat perhitungan</summary>
        <Lines lines={rest} />
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Yield dipakai: {b2.yieldsUsed === "aktual" ? "aktual batch minggu ini" : "default parameter (rata-rata Agustus)"} — karkas {num(r.prepared.yields.karkas.times(100), 2)}%; shrink target {num(p.shrink.times(100), 1)}%; angkut Rp {num(p.freight)}/kg LB; maklon Rp {num(p.maklon)}/kg diproses.
        </p>
      </details>
    </>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <table className="t compact">
      <thead>
        <tr>
          <th>Indikator <span className="q" aria-hidden="true">?</span><span className="sr-only"> — arahkan atau fokus pada label untuk cara hitung</span></th>
          <th className="n">Nilai</th><th>Satuan</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((x) => (
          <tr key={x.l}>
            <td><span className="tip" data-tip={x.how} tabIndex={0} data-r5-tip>{x.l}</span></td>
            <td className="n"><N v={x.v} dp={x.dp ?? 0} percent={x.pct} /></td>
            <td className="muted unit">{x.u}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
