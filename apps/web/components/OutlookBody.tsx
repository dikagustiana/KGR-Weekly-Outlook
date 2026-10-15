import Link from "next/link";
import type { ReactNode } from "react";
import type { WeekResult } from "@kgr/engine";
import { Badge, Card, N, Td, statusClass } from "@/components/ui";
import { num, tgl, tglShort } from "@/lib/fmt";
import type { ViewMode } from "@/lib/view";
import { humanize } from "@/lib/sources";
import { RpaDecisionManagement } from "@/components/outlook/RpaDecisionManagement";

const T = {
  b1kgA: "T_Penjualan: Σ kg baris Aktual yang dihitung (tanggal di minggu ini)",
  b1revA: "T_Penjualan: Σ kg × harga baris Aktual",
  b1gpA: "Revenue − HPP. HPP = HPP aktual Accurate (DO) bila ada, selain itu kg × biaya rata-rata stok minggu ini",
  b1kgO: "T_Penjualan: Σ kg Order dengan tanggal ≥ hari ini s.d. akhir minggu",
  b1gpO: "Order dinilai di biaya rata-rata stok minggu ini (stok awal + penerimaan) per key",
  b1proj: "Aktual + order sisa minggu",
  b1gpkg: "GP proyeksi ÷ kg proyeksi",
  b1gppct: "GP proyeksi ÷ revenue proyeksi",
  b1lw: "I_Parameter minggu lalu: GP ÷ kg",
};

/** O_Outlook blocks 1–8; shared by the Outlook page and the print view. */
/** v3 management sections (PRD v3 §6), rendered only in the management view when modules provide them. */
export interface V3Slots {
  input?: ReactNode;
  cogs?: ReactNode;
  cash?: ReactNode;
  demand?: ReactNode;
  accuracy?: ReactNode;
}

export function OutlookBody({ r, week, print = false, view = "preparer", v3 }: { r: WeekResult; week: string; print?: boolean; view?: ViewMode; v3?: V3Slots | null }) {
  const b2 = r.block2;
  const p = r.prepared.params;
  const mgmt = view === "management";
  /** R5: plain source names in the management view */
  const h = (t: string | undefined) => (mgmt ? humanize(t) : t);
  // R10: management sees only its own warnings, and not the ones already in the headline / recommendation (R2, R4)
  const alerts = mgmt ? r.block7.filter((a) => a.audience === "management" && a.code !== "LB_DI_ATAS_BREAKEVEN") : r.block7;
  // R6/R14: statement headings without numbers in the management view; the preparer keeps the Excel block numbers
  const title = (preparer: string, management: ReactNode) => (mgmt ? management : preparer);
  // R7: decisive columns weigh 600, supporting columns are secondary (management view)
  const key = mgmt ? "key" : undefined;
  const sup = mgmt ? "support" : undefined;
  // R11: one date convention in the management view
  const day = (d: string) => (mgmt ? tgl(d) : tgl(d, true));
  const partRingkasan = (
    <>
      <Card id="ringkasan" title={title("1. Ringkasan minggu — GP produk (HPP dari Accurate; order dinilai di biaya rata-rata stok minggu ini; cost of sales others tidak termasuk)",
        <>Ringkasan GP minggu ini<Ref n={1} /><Ref n={2} /></>)}>
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Segmen</th><th className="n">kg aktual{"\n"}s.d. kemarin</th><th className="n">Revenue aktual{"\n"}Rp</th><th className="n">GP aktual{"\n"}Rp</th>
                <th className={`n ${sup ?? ""}`}>kg order{"\n"}sisa minggu</th><th className={`n ${sup ?? ""}`}>Revenue order{"\n"}Rp</th><th className={`n ${sup ?? ""}`}>GP order{"\n"}Rp</th>
                <th className="n">kg proyeksi{"\n"}minggu</th><th className="n">Revenue proyeksi{"\n"}Rp</th><th className={`n ${key ?? ""}`}>GP proyeksi{"\n"}Rp</th>
                <th className="n">GP/kg{"\n"}proyeksi</th><th className={`n ${key ?? ""}`}>GP %{"\n"}proyeksi</th><th className="n">GP/kg{"\n"}minggu lalu</th><th className={`n ${key ?? ""}`}>Δ GP/kg</th>
              </tr>
            </thead>
            <tbody>
              {r.block1.map((s) => (
                <tr key={s.segment} className={s.segment === "TOTAL KGR" ? "total" : ""}>
                  <td className="lbl">{s.segment}</td>
                  <Td v={s.kgActual} dp={0} tip={h(T.b1kgA)} /><Td v={s.revenueActual} tip={h(T.b1revA)} /><Td v={s.gpActual} tip={h(T.b1gpA)} />
                  <Td v={s.kgOrder} tip={h(T.b1kgO)} className={sup} /><Td v={s.revenueOrder} tip={h("Σ kg × harga order sisa minggu")} className={sup} /><Td v={s.gpOrder} tip={h(T.b1gpO)} className={sup} />
                  <Td v={s.kgProjection} tip={h(T.b1proj)} /><Td v={s.revenueProjection} tip={h(T.b1proj)} /><Td v={s.gpProjection} tip={h(T.b1proj)} className={key} />
                  <Td v={s.gpPerKg} tip={h(T.b1gpkg)} /><Td v={s.gpPct} percent tip={h(T.b1gppct)} className={key} /><Td v={s.gpPerKgLastWeek} tip={h(T.b1lw)} /><Td v={s.deltaGpPerKg} tip={h("GP/kg proyeksi − GP/kg minggu lalu")} className={key} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

    </>
  );
  const partRpa = (
        <Card id="keputusan-rpa" title={title("2. Keputusan RPA — potong berapa, beli live bird di harga berapa", <>Keputusan RPA hari ini<Ref n={3} /></>)}>
          {mgmt ? <RpaDecisionManagement r={r} /> : (
            <>
            <table className="t compact">
              <thead><tr><th>Indikator</th><th className="n">Nilai</th><th>Satuan</th><th>Cara hitung</th></tr></thead>
              <tbody>
                <Row l="Harga live bird hari ini (penawaran)" v={b2.lbPriceToday} u="Rp/kg LB" h={<Link href={`/w/${week}/input/parameter`}>I_Parameter</Link>} />
                <Row l={`Order karkas fresh — ${tglShort(b2.horizonFrom)} s.d. ${tglShort(b2.horizonTo)}`} v={b2.freshOrdersInHorizon} u="kg" h="T_Penjualan: order RPA|Karkas|Fresh dalam horizon" dp={0} />
                <Row l="Stok karkas fresh hari ini" v={b2.freshStockToday} u="kg" h={<Link href={`/w/${week}/stok?q=RPA|Karkas|Fresh`}>O_Stok</Link>} />
                <Row l="Kebutuhan bersih karkas fresh" v={b2.netFreshNeed} u="kg" h="order − stok (min 0)" />
                <Row l="Live bird maksimum tanpa menambah karkas frozen" v={b2.lbMaxWithoutFrozen} u="kg LB" h="kebutuhan bersih ÷ ((1 − shrink) × yield karkas)" />
                <Row l="Live bird yang sudah direncanakan potong (horizon)" v={b2.lbPlannedInHorizon} u="kg LB" h={<Link href={`/w/${week}/input/batch`}>T_Batch: Rencana</Link>} />
                <Row l="Karkas yang berpotensi jadi frozen" v={b2.karkasAtRiskOfFreezing} u="kg" h="kelebihan potong × (1 − shrink) × yield karkas" />
                <Row l="Porsi karkas fresh dari potong rencana" v={b2.freshShareOfPlan} u="%" pctv h="kebutuhan bersih ÷ (LB rencana × (1 − shrink) × yield karkas), maks 100%" />
                <Row l="Nilai output per kg live bird (porsi fresh rencana)" v={b2.valuePerKgLbAtPlanShare} u="Rp/kg LB" h="(1 − s)[y_k(f·P_fresh + (1−f)·P_frozen) + Σ y_i·P_i]" />
                <Row l="Breakeven live bird — porsi fresh rencana" v={b2.breakevenAtPlanShare} u="Rp/kg LB" h="nilai output − angkut − maklon × (1 − shrink)" />
                <Row l="Breakeven live bird — 100% karkas fresh" v={b2.breakevenAt100Fresh} u="Rp/kg LB" h="batas atas (f = 100%)" />
                <Row l="Margin per kg live bird di harga hari ini" v={b2.marginPerKgLb} u="Rp/kg LB" h="breakeven − harga" />
                <Row l="Perkiraan margin potong rencana" v={b2.expectedMarginOfPlan} u="Rp" h="margin/kg × kg LB rencana" />
                <Row l="Potensi selisih harga karkas yang jadi frozen" v={b2.frozenPriceGap} u="Rp" h="kg frozen × (harga fresh − frozen)" />
              </tbody>
            </table>
            <div className={`reco ${statusClass(b2.recommendationText)}`}>REKOMENDASI RPA: {b2.recommendationText}</div>
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Yield dipakai: {b2.yieldsUsed === "aktual" ? "aktual batch minggu ini" : "default parameter (rata-rata Agustus)"} — karkas {num(r.prepared.yields.karkas.times(100), 2)}%; shrink target {num(p.shrink.times(100), 1)}%; angkut Rp {num(p.freight)}/kg LB; maklon Rp {num(p.maklon)}/kg diproses.
            </p>
            </>
          )}
        </Card>
  );
  const partAlerts = (
    <>
          <h2 id="peringatan">{mgmt ? "Peringatan" : "7. Peringatan"}</h2>
          {alerts.length === 0 ? <p className="muted">Tidak ada peringatan.</p> : mgmt ? (
            // R8: a text prefix, not a colour
            <ul className="alerts plain">{alerts.map((a) => <li key={a.code}><b>Peringatan:</b> {h(a.text)}</li>)}</ul>
          ) : (
            <ul className="alerts">{alerts.map((a) => <li key={a.code}>{a.text}</li>)}</ul>
          )}
    </>
  );
  const partStok = (withAlerts: boolean) => (
        <Card id="stok" title={title("4. Stok — yang harus dijual / dibeli", "Stok yang harus dijual atau dibeli")} extra={<Link href={`/w/${week}/stok`}>detail per SKU →</Link>}>
          <table className="t compact">
            <thead><tr><th>Status{mgmt ? <Ref n={4} /> : null}</th><th className="n">Jumlah SKU</th><th className="n">kg hari ini</th><th className="n">Nilai Rp</th></tr></thead>
            <tbody>
              {r.block4.filter((s) => !(mgmt && s.keys === 0)).map((s) => (
                <tr key={s.status} className={s.keys === 0 ? "dim" : undefined}>
                  <td>{mgmt
                    ? <Link href={`/w/${week}/stok?status=${s.status}`}>{STATUS_TEXT[s.status]}</Link>
                    : <Link href={`/w/${week}/stok?status=${s.status}`}><Badge s={s.status}>{s.label}</Badge></Link>}</td>
                  <Td v={s.keys} tip={h("O_Stok: jumlah SKU dengan status ini")} /><Td v={s.kgToday} tip={h("Σ stok hari ini")} /><Td v={s.value} tip={h("Σ stok hari ini × biaya rata-rata")} />
                </tr>
              ))}
            </tbody>
          </table>
          {withAlerts ? partAlerts : null}
        </Card>
  );
  const partTrading = (
      <Card id="keputusan-trading" title={title("3. Keputusan Trading — beli apa, berapa, di spread berapa", <>Keputusan trading hari ini<Ref n={5} /></>)}>
        <div className="scroll">
          <table className="t compact">
            <thead>
              <tr>
                <th>SKU (key)</th><th className="n">Stok hari ini{"\n"}kg</th><th className="n">Order sisa{"\n"}minggu kg</th><th className="n">Rencana terima{"\n"}sisa minggu kg</th>
                <th className="n">Kebutuhan{"\n"}bersih kg</th><th className="n">Harga jual{"\n"}order Rp/kg</th><th className="n">Harga beli{"\n"}pengganti Rp/kg</th><th className="n">Spread{"\n"}Rp/kg</th>
                <th className="n">Spread %</th><th className="n">Biaya stok{"\n"}rata-rata Rp/kg</th><th>{mgmt ? "Rekomendasi" : "REKOMENDASI"}</th>
              </tr>
            </thead>
            <tbody>
              {r.block3.map((t) => (
                <tr key={t.key}>
                  <td className="lbl"><Link href={`/w/${week}/stok?q=${encodeURIComponent(t.key)}`}>{t.label}</Link></td>
                  <Td v={t.stockToday} tip={h("O_Stok: stok akhir kemarin")} /><Td v={t.ordersRestOfWeek} tip={h("Σ order hari ini s.d. akhir minggu")} />
                  <Td v={t.plannedReceipts} tip={h("T_Penerimaan: Rencana, hari ini s.d. akhir minggu")} /><Td v={t.netNeed} tip={h("max(0, order − stok − rencana terima)")} />
                  <Td v={t.sellPrice} tip={h(t.sellPriceFromOrders ? "Harga rata-rata tertimbang order ≥ hari ini" : "Tidak ada order: harga jual acuan I_Master")} />
                  <td className="n">{t.buyPrice === null ? <span className="muted">kosong</span> : <N v={t.buyPrice} tip={h("I_Master: harga beli pengganti")} />}</td>
                  <Td v={t.spread} tip={h("harga jual − harga beli pengganti")} /><Td v={t.spreadPct} percent tip={h("spread ÷ harga jual")} />
                  <Td v={t.avgStockCost} tip={h("(nilai stok awal + nilai terima) ÷ (kg stok awal + kg terima)")} />
                  <td>{mgmt ? t.recommendationText : <Badge s={t.recommendation.split(" ")[0]}>{t.recommendationText}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mgmt ? null : <p className="muted" style={{ fontSize: 11 }}>Spread minimum: Rp {num(p.minSpread)}/kg (placeholder, lihat parameter).</p>}
      </Card>
  );
  const partKas = (
        <Card id="kas-keluar" title={title("5. Kas keluar — live bird dan pembelian trading (sesuai termin)", <>Kas keluar untuk live bird dan pembelian trading<Ref n={6} /></>)}>
          <table className="t compact">
            <thead><tr><th>Tanggal</th><th className="n">Bayar live bird Rp</th><th className="n">Bayar pembelian trading Rp</th><th className="n">Total Rp</th><th>Basis</th></tr></thead>
            <tbody>
              {r.block5.rows.map((c) => (
                <tr key={c.date}>
                  <td className="lbl">{day(c.date)}</td>
                  <Td v={c.liveBird} tip={h(`Nilai LB batch bertanggal tanggal − ${p.termsLb} hari`)} />
                  <Td v={c.trading} tip={h(`Penerimaan Beli Trading bertanggal tanggal − ${p.termsTrading} hari`)} />
                  <Td v={c.total} /><td>{c.basis}</td>
                </tr>
              ))}
              <tr className="total"><td>Total minggu</td><Td v={r.block5.total.liveBird} /><Td v={r.block5.total.trading} /><Td v={r.block5.total.total} /><td /></tr>
            </tbody>
          </table>
          {mgmt ? null : <p className="muted" style={{ fontSize: 11 }}>Penerimaan kas dari pelanggan ada di Arus Kas. Catatan: lihat docs/open-questions A2 (pembayaran jatuh tempo dari minggu sebelumnya).</p>}
        </Card>
  );
  const partBatch = (
        <Card id="batch-rpa" title={title("6. Batch RPA minggu ini — aktual vs rencana", "Batch RPA minggu ini: aktual dan rencana")} extra={<Link href={`/w/${week}/batch`}>detail batch →</Link>}>
          <div className="scroll">
            <table className="t compact">
              <thead>
                <tr><th>Status</th><th className="n">Batch</th><th className="n">kg LB</th><th className="n">Harga LB{"\n"}rata-rata</th><th className="n">Shrink</th><th className="n">Yield karkas{"\n"}÷ diproses</th>
                  <th className="n">Karkas{"\n"}fresh %</th><th className="n">Margin{"\n"}batch Rp</th><th className="n">Margin per{"\n"}kg LB</th><th className="n">Biaya per{"\n"}kg output</th><th className="n">Nilai per{"\n"}kg output</th><th className="n">Breakeven LB{"\n"}Rp/kg</th></tr>
              </thead>
              <tbody>
                {r.block6.rows.map((b) => (
                  <tr key={b.status}>
                    <td>{b.status}</td><Td v={b.batches} /><Td v={b.lbKg} /><Td v={b.avgLbPrice} tip={h("Σ nilai LB ÷ Σ kg LB")} />
                    <Td v={b.shrink} percent tip={h("1 − kg diproses ÷ kg dibeli")} warnNeg={false} className={!mgmt && b.shrink && b.shrink.greaterThan(p.shrink) ? "warn" : ""} />
                    <Td v={b.karkasYield} percent tip={h("(fresh + frozen) ÷ kg diproses")} /><Td v={b.freshPct} percent tip={h("fresh ÷ (fresh + frozen)")} />
                    <Td v={b.margin} tip={h("nilai output di harga acuan − total biaya")} /><Td v={b.marginPerKgLb} /><Td v={b.costPerKgOutput} tip={h("total biaya ÷ kg output")} />
                    <Td v={b.valuePerKgOutput} tip={h("nilai output ÷ kg output")} /><Td v={b.breakevenLb} tip={h("(nilai output − angkut − maklon) ÷ kg LB")} />
                  </tr>
                ))}
                <tr className="dim">
                  <td>Target / benchmark</td><td /><td /><td /><Td v={r.block6.target.shrink} percent /><Td v={r.block6.target.karkasYield} percent /><td /><td /><td /><td /><td />
                  <Td v={r.block6.target.breakevenLb100Fresh} tip={mgmt ? "Breakeven 100% fresh, lihat Keputusan RPA hari ini" : "Breakeven 100% fresh (blok 2)"} />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
  );
  const partFs = (
      <Card id="laporan-keuangan" title={title("8. Laporan keuangan minggu ini — ringkasan", "Laporan keuangan minggu ini")} extra={<span className="row"><Link href={`/w/${week}/laba-rugi`}>Laba Rugi</Link><Link href={`/w/${week}/neraca`}>Neraca</Link><Link href={`/w/${week}/arus-kas`}>Arus Kas</Link></span>}>
        <table className="t compact">
          <thead><tr><th>Indikator</th><th className="n">Minggu lalu</th><th className="n">Proyeksi minggu ini</th><th className="n">Δ</th></tr></thead>
          <tbody>
            {r.block8.map((s) => (
              <tr key={s.label}><td>{s.label}</td><Td v={s.lastWeek} tip={h(s.source)} /><Td v={s.projection} tip={h(s.source)} /><Td v={s.delta} /></tr>
            ))}
          </tbody>
        </table>
      </Card>
  );
  if (mgmt && v3) {
    // PRD v3 §6 order: headline → segmen → keputusan RPA + batch → Input → COGS → spread trading → stok per umur → kas →
    // demand → akurasi → peringatan (sections a module does not provide are left out)
    return (
      <>
        {partRingkasan}
        <div className="grid2">{partRpa}{partBatch}</div>
        {v3.input}
        {v3.cogs}
        {partTrading}
        <div className="grid2">{partStok(false)}{partKas}</div>
        {v3.cash}
        {v3.demand}
        {v3.accuracy}
        <Card id="peringatan-v3">{partAlerts}</Card>
        {partFs}
        <Notes r={r} />
      </>
    );
  }
  return (
    <>
      {partRingkasan}
      <div className="grid2">
        {partRpa}
        {partStok(true)}
      </div>

      {print ? <div className="pagebreak" /> : null}
      {partTrading}
      <div className="grid2">
        {partKas}
        {partBatch}
      </div>

      {print ? <div className="pagebreak" /> : null}
      {partFs}
      {mgmt ? <Notes r={r} /> : null}
    </>
  );
}

/** R9: status as plain words in the management view (definitions in note 4). */
const STATUS_TEXT: Record<"KURANG" | "JUAL" | "PERHATIAN", string> = { KURANG: "Kurang", JUAL: "Jual", PERHATIAN: "Di atas batas umur" };

/** R6/R14: numbered note marker, an anchor link to the note. */
function Ref({ n }: { n: number }) {
  return <sup className="ref"><a href={`#catatan-${n}`} aria-label={`Catatan ${n}`}>{n}</a></sup>;
}

/** R6: the methodology parentheticals, the yield note and the status definitions as numbered notes (management view). */
function Notes({ r }: { r: WeekResult }) {
  const b2 = r.block2;
  const p = r.prepared.params;
  const notes = [
    "GP produk: HPP dari Accurate; order dinilai di biaya rata-rata stok minggu ini; cost of sales others tidak termasuk.",
    "Aktual = transaksi sampai kemarin; sisa minggu = order dan rencana mulai hari ini.",
    `Yield dipakai: ${b2.yieldsUsed === "aktual" ? "aktual batch minggu ini" : "default parameter (rata-rata Agustus)"} — karkas ${num(r.prepared.yields.karkas.times(100), 2)}%; shrink target ${num(p.shrink.times(100), 1)}%; angkut Rp ${num(p.freight)}/kg LB; maklon Rp ${num(p.maklon)}/kg diproses.`,
    `Status stok — Kurang: stok diproyeksikan minus dalam minggu ini. Jual: ada stok tanpa order minggu ini. Di atas batas umur: stok lebih tua dari ${num(p.ageLimit)} hari.`,
    `Spread minimum trading Rp ${num(p.minSpread)}/kg.`,
    `Kas keluar mengikuti termin pembayaran: live bird ${p.termsLb} hari, pembelian trading ${p.termsTrading} hari. Penerimaan dari pelanggan ada di Arus Kas.`,
  ];
  return (
    <section className="card notes" id="catatan" aria-label="Catatan">
      <h2>Catatan</h2>
      <ol>{notes.map((t, i) => <li key={i} id={`catatan-${i + 1}`}>{t}</li>)}</ol>
    </section>
  );
}

function Row({ l, v, u, h, dp = 0, pctv }: { l: string; v: import("@kgr/engine").Decimal; u: string; h: React.ReactNode; dp?: number; pctv?: boolean }) {
  return (
    <tr>
      <td>{l}</td>
      <td className="n"><N v={v} dp={dp} percent={pctv} tip={typeof h === "string" ? h : undefined} /></td>
      <td className="muted">{u}</td>
      <td className="muted" style={{ fontSize: 11 }}>{h}</td>
    </tr>
  );
}
