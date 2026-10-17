import Link from "next/link";
import { clock } from "@/lib/clock";
import { notFound } from "next/navigation";
import { isISODate } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, Td } from "@/components/ui";
import { SKU_READERS, requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { fetchAll } from "@/lib/data";
import { tgl } from "@/lib/fmt";
import { ActionForm } from "@/components/ActionForm";
import { can } from "@/lib/roles";
import { adjustLot, blastLot } from "./actions";

export const dynamic = "force-dynamic";

type R = Record<string, unknown>;

const TYPE: Record<string, string> = { in: "Masuk", out_sale: "Keluar (DO)", out_blast: "Blast keluar", in_blast: "Blast masuk", adjust: "Opname / koreksi", transfer: "Pindah", writedown: "Penurunan nilai" };

export default async function SkuKeyPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key: raw } = await params;
  const sp = await searchParams;
  await requireModulePage("m2_ledger", [...SKU_READERS]);
  const key = decodeURIComponent(raw);
  const { viewer, weeks, week } = await plainContext(sp.week);
  const sb = await supabaseServer();
  const want = sp.date && isISODate(sp.date) ? sp.date : (await clock(sb)).data;
  const { data: dd } = await sb.from("lot_balance_daily").select("date").eq("key", key).lte("date", want).order("date", { ascending: false }).limit(1).maybeSingle();
  const date = dd ? String((dd as R).date) : null;
  const { data: k } = await sb.from("sku_key").select("key").eq("key", key).maybeSingle();
  if (!k && !date) notFound();
  const bal = date ? await fetchAll<R>((a, b) => sb.from("lot_balance_daily").select("*").eq("date", date).eq("key", key).order("age_days", { ascending: false }).range(a, b)) : [];
  const refs = bal.map((b) => String(b.lot_ref));
  const lots = refs.length ? await fetchAll<R>((a, b) => sb.from("lot").select("lot_ref, origin, origin_date, batch_ref, item_code, kg_in, cost_per_kg_si, assumed, parent_lot_ref, note").in("lot_ref", refs).range(a, b)) : [];
  const moves = refs.length ? await fetchAll<R>((a, b) => sb.from("lot_movement").select("movement_ref, lot_ref, date, type, kg, cost, cost_ma, document_ref, assumed, ref_table").in("lot_ref", refs).lte("date", date!).order("date").range(a, b)) : [];
  const lotBy = new Map(lots.map((l) => [String(l.lot_ref), l]));
  const sel = sp.lot ?? null;
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/sku">
      <p><Link href={`/sku?date=${date ?? want}`}>← Stok per SKU</Link></p>
      <h1>{key}{date ? ` — ${tgl(date)}` : ""}</h1>
      <Card title={`Lot dengan saldo (${bal.length})`}>
        <div className="scroll">
          <table className="t compact">
            <thead><tr><th>Lot</th><th>Asal</th><th>Tanggal asal</th><th>Batch / dokumen</th><th className="n">kg</th><th className="n">Bebas kg</th><th className="n">Terikat kg</th><th className="n">Biaya lot Rp/kg</th><th className="n">Biaya rata-rata Rp/kg</th><th className="n">Umur (hari)</th><th className="n">Jam ke batas fresh</th><th>Catatan</th></tr></thead>
            <tbody>
              {bal.map((b) => {
                const l = lotBy.get(String(b.lot_ref));
                return (
                  <tr key={String(b.lot_ref)}>
                    <td><Link href={`/sku/${encodeURIComponent(key)}?date=${date}&lot=${encodeURIComponent(String(b.lot_ref))}`}>{String(b.lot_ref).split(":")[0]}{l?.item_code ? ` ${String(l.item_code)}` : ""}</Link></td>
                    <td>{String(l?.origin ?? "")}{l?.assumed ? " (diduga)" : ""}</td><td>{tgl(String(l?.origin_date ?? ""))}</td><td>{String(l?.batch_ref ?? "")}</td>
                    <Td v={String(b.kg)} dp={2} /><Td v={String(b.free_kg)} dp={2} /><Td v={String(b.reserved_kg)} dp={2} />
                    <Td v={b.cost_per_kg_si === null ? null : String(b.cost_per_kg_si)} /><Td v={b.cost_per_kg_ma === null ? null : String(b.cost_per_kg_ma)} />
                    <Td v={String(b.age_days)} /><Td v={b.hours_to_cutoff === null ? null : String(b.hours_to_cutoff)} /><td className="muted">{String(l?.note ?? "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={sel ? `Mutasi lot ${sel}` : "Mutasi (semua lot di atas)"}>
        <table className="t compact">
          <thead><tr><th>Tanggal</th><th>Lot</th><th>Jenis</th><th>Dokumen</th><th className="n">kg</th><th className="n">Biaya lot Rp</th><th className="n">Biaya rata-rata Rp</th><th>Lot diduga</th></tr></thead>
          <tbody>
            {moves.filter((m) => !sel || m.lot_ref === sel).slice(-300).map((m) => (
              <tr key={String(m.movement_ref)}><td>{tgl(String(m.date))}</td><td className="muted">{String(m.lot_ref).split(":")[0]}</td><td>{TYPE[String(m.type)] ?? String(m.type)}</td><td>{String(m.document_ref ?? "")}</td>
                <Td v={String(m.kg)} dp={2} /><Td v={String(m.cost)} /><Td v={m.cost_ma === null ? null : String(m.cost_ma)} /><td>{m.assumed ? "ya (FIFO)" : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      {can(viewer.role, "lot_adjust") || can(viewer.role, "blast_event") ? (
        <div className="grid2">
          {can(viewer.role, "lot_adjust") ? (
            <Card title="Opname / koreksi lot">
              <ActionForm action={adjustLot} submit="Catat penyesuaian" className="row desktop-only">
                <input type="hidden" name="key" value={key} />
                <div className="field"><label>Tanggal</label><input className="in" type="date" name="date" defaultValue={date ?? want} required /></div>
                <div className="field"><label>Lot (kosong = FIFO)</label><select className="in" name="lot_ref"><option value="">—</option>{bal.map((b) => <option key={String(b.lot_ref)} value={String(b.lot_ref)}>{String(b.lot_ref)}</option>)}</select></div>
                <div className="field"><label>kg (+ / −)</label><input className="in" name="kg" required /></div>
                <div className="field"><label>Catatan</label><input className="in" name="note" placeholder="opname" /></div>
              </ActionForm>
            </Card>
          ) : null}
          {can(viewer.role, "blast_event") && key.endsWith("|Fresh") ? (
            <Card title="Blast fresh → frozen">
              <ActionForm action={blastLot} submit="Catat blast" className="row desktop-only">
                <input type="hidden" name="key" value={key} />
                <div className="field"><label>Tanggal</label><input className="in" type="date" name="date" defaultValue={date ?? want} required /></div>
                <div className="field"><label>Lot</label><select className="in" name="lot_ref" required>{bal.map((b) => <option key={String(b.lot_ref)} value={String(b.lot_ref)}>{String(b.lot_ref)}</option>)}</select></div>
                <div className="field"><label>kg</label><input className="in" name="kg" required /></div>
                <div className="field"><label>Alasan</label><select className="in" name="reason"><option value="planned">rencana</option><option value="quality">kualitas</option><option value="cutoff">lewat cut-off</option></select></div>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}
