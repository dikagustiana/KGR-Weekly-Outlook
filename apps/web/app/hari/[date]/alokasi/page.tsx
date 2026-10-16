import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, isISODate, outstandingKg } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { moduleEnabled, moduleSettings, requireModulePage } from "@/lib/modules";
import { v4On } from "@/lib/v4/nav";
import { AlokasiV4 } from "./v4";
import { supabaseServer } from "@/lib/supabase";
import { dayControls, loadDayAllocation } from "@/lib/v3/allocation";
import { stockMartControl } from "@/lib/v3/stale";
import { tgl } from "@/lib/fmt";
import { allocateAction, cutoffAction, deliverAction } from "./actions";

export const dynamic = "force-dynamic";

/** PRD v3 §6 /hari/[date]/alokasi: PO lines of the day → lots FEFO; cut-off → blast; Terkirim → out_sale per lot. */
export default async function AlokasiPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isISODate(date)) notFound();
  const v = await requireModulePage("m3_planning", ["admin", "ppic", "sales", "commercial_lead"]);
  const { viewer, weeks, week } = await plainContext();
  const ledgerOn = await moduleEnabled("m2_ledger", v);
  if (v4On(await moduleSettings(), v.role)) return <AlokasiV4 date={date} viewer={viewer} weeks={weeks} week={week} ledgerOn={ledgerOn} />;
  const sb = await supabaseServer();
  const d = ledgerOn ? await loadDayAllocation(sb, date) : null;
  const c45 = ledgerOn ? await stockMartControl(sb, date) : null;
  const canCut = v.role === "admin" || v.role === "ppic";
  const canDeliver = v.role === "admin" || v.role === "inventory_accounting" || v.role === "sales" || v.role === "commercial_lead";
  const byLine = new Map<string, { lot_ref: string; kg: string; method: string }[]>();
  for (const a of d?.allocations ?? []) byLine.set(String(a.sales_line_id), [...(byLine.get(String(a.sales_line_id)) ?? []), { lot_ref: String(a.lot_ref), kg: String(a.kg), method: String(a.method) }]);
  const unalloc = new Map((d?.proposal.unallocated ?? []).map((u) => [u.sales_ref, u.kg]));
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/hari">
      <h1>Alokasi stok — kirim {tgl(date)}</h1>
      <div className="row noprint">
        <Link className="b small sec" href={`/hari/${addDays(date, -1)}/alokasi`}>← {tgl(addDays(date, -1))}</Link>
        <Link className="b small sec" href={`/hari/${addDays(date, 1)}/alokasi`}>{tgl(addDays(date, 1))} →</Link>
      </div>
      <p className="muted">PO yang dikirim hari ini mengambil lot SKU yang sama, yang tertua lebih dulu, selama masih layak (fresh dalam jam window, frozen dalam batas umur). Urutan: PO pasti dulu, lalu tentatif; dalam satu status, nilai terbesar dulu. Pada cut-off ({d?.cutOffTime.slice(0, 5) ?? "14:00"}) sisa fresh yang tidak terpakai hari ini maupun oleh PO hari berikut selama masih fresh di-blast ke frozen.</p>
      {!ledgerOn ? <Card><p>Alokasi butuh ledger stok per lot (modul M2). Minta Admin menyalakan M2.</p></Card> : null}
      {ledgerOn && !d ? <Card><p>Ledger belum punya stok awal.</p></Card> : null}
      {d ? (
        <>
          <div className="kpis">
            <div className="kpi"><div className="l">Baris PO kirim hari ini</div><div className="v">{d.orders.length}</div><div className="l">{d.orders.filter((o) => o.status !== "Order").length} sudah terkirim</div></div>
            <div className="kpi"><div className="l">Belum tertutup stok (usulan FEFO)</div><div className="v">{d.proposal.unallocated.length}</div><div className="l">baris</div></div>
            <div className="kpi"><div className="l">Usulan cut-off</div><div className="v"><N v={d.cutoffKg} /> kg</div><div className="l">{d.cutoffDone.length ? `sudah dicatat (${d.cutoffDone.length} blast)` : `${d.cutoff.length} lot`}</div></div>
          </div>
          <Card title="PO lines" extra={<span className="row">
            <ActionForm action={allocateAction} submit="Alokasikan hari ini"><input type="hidden" name="date" value={date} /></ActionForm>
            {canCut ? <ActionForm action={cutoffAction} submit="Cut-off" confirm="Blast sisa fresh ke frozen sekarang?"><input type="hidden" name="date" value={date} /></ActionForm> : null}
          </span>}>
            <table className="t compact">
              <thead><tr><th>PO</th><th>Pelanggan</th><th>SKU</th><th>Status</th><th>Sales</th><th className="n">kg</th><th className="n">Terkirim kg</th><th>Lot teralokasi</th><th className="n">Belum tertutup kg</th><th /></tr></thead>
              <tbody>{d.orders.map((o) => (
                <tr key={o.id}><td>{o.po_ref ?? o.document_ref ?? "—"}</td><td>{o.customer ?? "—"}</td><td>{o.key}</td><td>{o.status === "Order" ? o.demand_status : "terkirim"}</td><td>{o.sales_rep ?? "—"}</td><Td v={o.kg as string} dp={2} /><Td v={o.fulfilled_kg ?? null} dp={2} />
                  <td>{(byLine.get(o.id) ?? []).map((a) => <div key={a.lot_ref}><Link href={`/sku/${encodeURIComponent(o.key)}`}>{a.lot_ref}</Link> <N v={a.kg} dp={2} /> kg{a.method === "manual" ? " (manual)" : ""}</div>)}</td>
                  <Td v={o.status === "Order" ? unalloc.get(o.id) ?? null : null} dp={2} />
                  <td>{o.status === "Order" && canDeliver ? <ActionForm action={deliverAction} submit="Terkirim" className="row">
                    <input type="hidden" name="date" value={date} /><input type="hidden" name="id" value={o.id} />
                    <input className="in small" name="kg" inputMode="decimal" size={7} aria-label="kg terkirim" defaultValue={outstandingKg(o).toFixed(2)} />
                    <input className="in small" name="document_ref" size={9} placeholder="No. DO" aria-label="nomor DO / surat jalan" />
                  </ActionForm> : null}</td></tr>
              ))}</tbody>
            </table>
          </Card>
          <div className="grid2">
            <Card title="Usulan FEFO (belum ditulis)">
              <table className="t compact">
                <thead><tr><th>Baris PO</th><th>Lot</th><th className="n">kg</th></tr></thead>
                <tbody>{d.proposal.allocations.map((a) => <tr key={`${a.sales_ref}${a.lot_ref}`}><td>{d.orders.find((o) => o.id === a.sales_ref)?.po_ref ?? a.sales_ref.slice(0, 8)}</td><td>{a.lot_ref}</td><Td v={a.kg} dp={2} /></tr>)}</tbody>
              </table>
            </Card>
            <Card title={d.cutoffDone.length ? "Blast cut-off tercatat" : "Usulan cut-off"}>
              <table className="t compact">
                <thead><tr><th>Lot</th><th>Ke</th><th className="n">kg</th><th className="n">Downgrade Rp</th></tr></thead>
                <tbody>{d.cutoffDone.length
                  ? d.cutoffDone.map((b) => <tr key={String(b.id)}><td>{String(b.lot_ref_from)}</td><td>{String(b.key_to ?? "—")}</td><Td v={b.kg as string} dp={2} /><Td v={(b.rp_downgrade as string) ?? null} /></tr>)
                  : d.cutoff.map((b) => <tr key={b.lot_ref}><td>{b.lot_ref}</td><td>{b.key_to}</td><Td v={b.kg} dp={2} /><Td v={b.rp_downgrade} /></tr>)}</tbody>
              </table>
            </Card>
          </div>
          <Card title="Stok tersedia per lot (sebelum alokasi hari ini)">
            <table className="t compact">
              <thead><tr><th>Lot</th><th>SKU</th><th>Bentuk</th><th>Asal</th><th className="n">kg tersedia</th><th className="n">Sisa setelah alokasi</th></tr></thead>
              <tbody>{d.current.lotsLeft.map((l) => { const a = d.lots.find((x) => x.lot_ref === l.lot_ref); return (
                <tr key={l.lot_ref}><td>{l.lot_ref}</td><td>{l.key}</td><td>{l.form}</td><td>{tgl(l.origin_date)}</td><Td v={a?.kg ?? null} dp={2} /><Td v={l.kg} dp={2} /></tr>
              ); })}</tbody>
            </table>
          </Card>
          <Card title="Kontrol alokasi (C29, C31, C45)"><ControlsV3Table controls={[...dayControls(d), ...(c45 ? [c45] : [])]} /></Card>
        </>
      ) : null}
    </Shell>
  );
}
