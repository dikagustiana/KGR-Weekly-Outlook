import Link from "next/link";
import { D, addDays, dayName, outstandingKg } from "@kgr/engine";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Tile, TileGrid } from "@/components/v4/Tile";
import { CardBody } from "@/components/v4/Card";
import { V4Table, type Col, type TRow } from "@/components/v4/Table";
import { Slicer } from "@/components/v4/Controls";
import { supabaseServer } from "@/lib/supabase";
import { cutoffOpen, dayControls, loadDayAllocation } from "@/lib/v3/allocation";
import { stockMartControl } from "@/lib/v3/stale";
import { minus, num, tgl, tglShort } from "@/lib/fmt";
import type { Viewer } from "@/lib/session";
import type { WeekRow } from "@/lib/data";
import { allocateAction, cutoffAction, deliverAction, rebuildQueueAction } from "./actions";

const kg = (v: unknown) => (v === null || v === undefined ? "" : minus(num(String(v), 0)));

/**
 * PRD v4 §6.5 Alokasi hari ini (flag v4_design): PO kirim hari ini → lot layak → usulan FEFO → Alokasikan → Terkirim
 * (kg, nomor dokumen; sisa tetap terbuka, K7) → sisa fresh dijual spot (Komersial) → Cut-off setelah jamnya (K8).
 * Every number comes from the engine through loadDayAllocation; this page only places it.
 */
export async function AlokasiV4({ date, viewer, weeks, week, ledgerOn }: { date: string; viewer: Viewer; weeks: WeekRow[]; week: WeekRow | null; ledgerOn: boolean }) {
  const sb = await supabaseServer();
  const d = ledgerOn ? await loadDayAllocation(sb, date) : null;
  const c45 = ledgerOn ? await stockMartControl(sb, date) : null;
  const role = viewer.role;
  const canCut = role === "admin" || role === "ppic";
  const canAlloc = role === "admin" || role === "ppic" || role === "sales" || role === "commercial_lead";
  const canDeliver = role === "admin" || role === "inventory_accounting" || role === "sales" || role === "commercial_lead";
  const slicer = <Slicer label="Kirim" current={date} options={[-1, 0, 1].map((i) => addDays(date, i)).map((x) => ({ value: x, label: `${dayName(x).slice(0, 3)} ${tglShort(x)}`, href: `/hari/${x}/alokasi` }))} />;
  if (!d) {
    return (
      <Shell viewer={viewer} weeks={weeks} week={week} active="/hari">
        <h1 className="sr-only">Alokasi hari ini</h1>
        <TileGrid label="Alokasi hari ini">
          <Tile id="slicer-hari" pos={{ x: 0, y: 0, w: 6, h: 1 }} kind="bare">{slicer}</Tile>
          <Tile id="kosong" pos={{ x: 0, y: 1, w: 12, h: 1 }} kind="bare"><p className="note" data-tile-value="">{ledgerOn ? "Ledger stok belum punya stok awal." : "Alokasi butuh ledger stok per lot (modul M2), yang belum aktif."}</p></Tile>
        </TileGrid>
      </Shell>
    );
  }
  const stale = c45?.status === "STALE";
  const cut = cutoffOpen(date, d.cutOffTime);
  const byLine = new Map<string, { lot_ref: string; kg: string }[]>();
  for (const a of d.allocations) byLine.set(String(a.sales_line_id), [...(byLine.get(String(a.sales_line_id)) ?? []), { lot_ref: String(a.lot_ref), kg: String(a.kg) }]);
  const unalloc = new Map(d.proposal.unallocated.map((u) => [u.sales_ref, u.kg]));
  const open = d.orders.filter((o) => o.status === "Order");
  const spot = d.cutoff;
  const spotKg = spot.reduce((a, b) => a.plus(b.kg), D(0));

  const poCols: Col[] = [
    { key: "po", label: "PO", kind: "key" }, { key: "c", label: "Pelanggan" }, { key: "k", label: "SKU" }, { key: "s", label: "Status", kind: "sup" }, { key: "q", label: "kg", num: true },
    { key: "t", label: "Terkirim", num: true }, { key: "o", label: "Sisa", num: true, kind: "key" }, { key: "l", label: "Lot", kind: "sup", wrap: true }, { key: "u", label: "Belum tertutup", num: true }, { key: "a", label: "" },
  ];
  const poRows: TRow[] = d.orders.map((o) => ({
    id: o.id,
    cells: {
      po: o.po_ref ?? o.document_ref ?? "tanpa nomor", c: o.customer ?? "", k: o.key, s: o.status === "Order" ? String(o.demand_status ?? "") : "terkirim", q: kg(o.kg), t: o.fulfilled_kg ? kg(o.fulfilled_kg) : "",
      o: o.status === "Order" ? kg(outstandingKg(o)) : "0", l: (byLine.get(o.id) ?? []).map((a) => `${a.lot_ref} ${kg(a.kg)}`).join(", "),
      u: o.status === "Order" && unalloc.get(o.id) ? kg(unalloc.get(o.id)) : "",
      a: o.status === "Order" && canDeliver ? (
        <ActionForm v4 action={deliverAction} submit="Terkirim">
          <input type="hidden" name="date" value={date} /><input type="hidden" name="id" value={o.id} />
          <input name="kg" inputMode="decimal" size={7} aria-label="kg terkirim" defaultValue={outstandingKg(o).toFixed(2)} />
          <input name="document_ref" size={9} placeholder="No. DO" aria-label="nomor DO" />
        </ActionForm>
      ) : null,
    },
  }));

  const rekap = new Map<string, { avail: number; left: number }>();
  for (const l of d.lots) { const r = rekap.get(l.key) ?? { avail: 0, left: 0 }; r.avail += Number(l.kg); rekap.set(l.key, r); }
  for (const l of d.current.lotsLeft) { const r = rekap.get(l.key) ?? { avail: 0, left: 0 }; r.left += Number(l.kg); rekap.set(l.key, r); }
  const rCols: Col[] = [{ key: "k", label: "SKU", kind: "key" }, { key: "a", label: "Tersedia kg", num: true }, { key: "r", label: "Teralokasi kg", num: true }, { key: "f", label: "Bebas kg", num: true, kind: "key" }];
  const rRows: TRow[] = [...rekap.entries()].sort((a, b) => b[1].avail - a[1].avail).map(([k, r]) => ({ id: k, cells: { k, a: num(r.avail, 0), r: num(r.avail - r.left, 0), f: num(r.left, 0) } }));

  const sCols: Col[] = [{ key: "l", label: "Lot", kind: "key" }, { key: "k", label: "SKU" }, { key: "q", label: "kg", num: true }, { key: "z", label: "Bila di-blast", kind: "sup" }, { key: "d", label: "Downgrade Rp", num: true, kind: "sup" }];
  const sRows: TRow[] = (d.cutoffDone.length
    ? d.cutoffDone.map((b) => ({ id: String(b.id), cells: { l: String(b.lot_ref_from), k: String(b.key_from ?? ""), q: kg(b.kg), z: `di-blast ke ${String(b.key_to ?? "")}`, d: kg(b.rp_downgrade) } }))
    : spot.map((b) => ({ id: b.lot_ref, cells: { l: b.lot_ref, k: b.key_from, q: kg(b.kg), z: b.key_to, d: kg(b.rp_downgrade) } })));

  const ctl = [...dayControls(d), ...(c45 ? [c45] : [])];
  const cCols: Col[] = [{ key: "c", label: "Kontrol", kind: "key" }, { key: "n", label: "Isi" }, { key: "s", label: "Status" }];
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/hari">
      <h1 className="sr-only">Alokasi hari ini {tgl(date)}</h1>
      <TileGrid label="Alokasi hari ini">
        <Tile id="slicer-hari" pos={{ x: 0, y: 0, w: 6, h: 1 }} kind="bare">{slicer}</Tile>
        <Tile id="aksi" pos={{ x: 6, y: 0, w: 6, h: 1 }} kind="bare">
          <div className="actionbar">
            {canAlloc ? <ActionForm v4="primary" action={allocateAction} submit="Alokasikan hari ini" disabled={stale}><input type="hidden" name="date" value={date} /></ActionForm> : null}
            {canCut && !d.cutoffDone.length ? <ActionForm v4 action={cutoffAction} submit="Cut-off" disabled={!cut.ok} confirm="Blast sisa fresh ke frozen sekarang?"><input type="hidden" name="date" value={date} /></ActionForm> : null}
            {stale && (role === "admin" || role === "ppic") ? <ActionForm v4 action={rebuildQueueAction} submit="Bangun ulang antrean (sampai hari ini)"><input type="hidden" name="date" value={date} /></ActionForm> : null}
            <span className="reason">{stale ? "C45 STALE: bangun ulang ledger dulu" : !cut.ok ? `cut-off setelah ${d.cutOffTime.slice(0, 5)} WIB` : d.cutoffDone.length ? "cut-off sudah dicatat" : ""}</span>
          </div>
        </Tile>
        <Tile id="c-po" pos={{ x: 0, y: 1, w: 3, h: 2 }} kind="card" title="PO kirim hari ini"><CardBody value={String(d.orders.length)} compare={[{ label: "masih terbuka", value: String(open.length) }, { label: "sisa kg", value: kg(open.reduce((a, o) => a.plus(outstandingKg(o)), D(0))) }]} /></Tile>
        <Tile id="c-belum" pos={{ x: 3, y: 1, w: 3, h: 2 }} kind="card" title="Belum tertutup stok"><CardBody value={String(d.proposal.unallocated.length)} unit="baris" compare={[{ label: "kg", value: kg(d.proposal.unallocated.reduce((a, u) => a.plus(D(u.kg)), D(0))) }]} /></Tile>
        <Tile id="c-spot" pos={{ x: 6, y: 1, w: 3, h: 2 }} kind="card" title="Sisa fresh untuk spot"><CardBody value={kg(spotKg)} unit="kg" compare={[{ label: "lot", value: String(spot.length) }]} href="/komersial" /></Tile>
        <Tile id="c-cutoff" pos={{ x: 9, y: 1, w: 3, h: 2 }} kind="card" title={`Cut-off ${d.cutOffTime.slice(0, 5)} WIB`}><CardBody value={d.cutoffDone.length ? "dicatat" : cut.ok ? "terbuka" : "belum"} compare={[{ label: d.cutoffDone.length ? "blast" : "usulan blast kg", value: d.cutoffDone.length ? String(d.cutoffDone.length) : kg(d.cutoffKg) }]} /></Tile>
        <Tile id="t-po" pos={{ x: 0, y: 3, w: 12, h: 6 }} kind="tall" title={`PO kirim ${tgl(date)}`} note="Terkirim mencatat kg dan nomor DO; sisa tetap terbuka sampai terkirim penuh atau dibatalkan (K7).">
          <V4Table cols={poCols} rows={poRows} label="PO kirim hari ini" empty="tidak ada PO dengan tanggal kirim ini" />
        </Tile>
        <Tile id="t-spot" pos={{ x: 0, y: 9, w: 6, h: 4 }} kind="tall" title={d.cutoffDone.length ? "Blast cut-off tercatat" : "Sisa fresh: jual spot sebelum cut-off"} note={d.cutoffDone.length ? undefined : <>Sebelum cut-off sisa ini tampil di <Link href="/komersial">Komersial</Link> sebagai jual hari ini; yang tidak terjual di-blast ke frozen (K8).</>}>
          <V4Table cols={sCols} rows={sRows} label="Sisa fresh" empty="tidak ada sisa fresh" />
        </Tile>
        <Tile id="t-rekap" pos={{ x: 6, y: 9, w: 6, h: 4 }} kind="tall" title="Stok bebas lawan teralokasi per SKU">
          <V4Table cols={rCols} rows={rRows} label="Rekap stok" limit={12} />
        </Tile>
        <Tile id="t-kontrol" pos={{ x: 0, y: 13, w: 12, h: 2 }} kind="tall" title="Kontrol alokasi">
          <V4Table cols={cCols} rows={ctl.map((c) => ({ id: c.code, cells: { c: c.code, n: c.name, s: c.status } }))} label="Kontrol" />
        </Tile>
      </TileGrid>
    </Shell>
  );
}
