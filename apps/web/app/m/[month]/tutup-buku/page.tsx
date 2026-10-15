import Link from "next/link";
import { notFound } from "next/navigation";
import { closingTotals } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Card, Td } from "@/components/ui";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { monthStart } from "@/lib/v3/drivers";
import { monthView } from "@/lib/v3/monthly";
import { adjustmentAction, lockAction } from "../actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { unbilled_revaluation: "revaluasi unbilled", parked_cost: "biaya terparkir", inventory_adj: "penyesuaian persediaan", accrual: "akrual", other: "lain" };

/** PRD v3 §4.5 / §6 /m/[month]/tutup-buku: closing adjustments (DI-xx) before FINAL; FINAL lock (admin, finance). */
export default async function TutupBukuPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const first = monthStart(month);
  if (!first) notFound();
  await requireModulePage("m4_monthly", ["admin", "finance"]);
  const { viewer, weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const mv = await monthView(sb, first);
  const tot = closingTotals(mv.adjustments.map((a) => ({ pl_line: String(a.pl_line), amount: String(a.amount), posted: a.posted === true })));
  const final = mv.versions.find((v) => v.version === "FINAL");
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/m">
      <h1>Tutup buku — {first.slice(0, 7)}</h1>
      <p className="muted">Penyesuaian tutup buku (catatan DI) dicatat sebelum FINAL. FINAL = jurnal bulan penuh + penyesuaian yang sudah diposting; akurasi V1/V2 dihitung terhadap FINAL sebelum dan sesudah penyesuaian. Tanda jumlah mengikuti P&amp;L: + menambah laba, − mengurangi. <Link href={`/m/${first.slice(0, 7)}`}>← Outlook bulan</Link></p>
      <div className="kpis">
        <div className="kpi"><div className="l">Penyesuaian tercatat</div><div className="v">{mv.adjustments.length}</div><div className="l">dampak laba <Td.Inner v={tot.all} /></div></div>
        <div className="kpi"><div className="l">Sudah diposting</div><div className="v">{mv.adjustments.filter((a) => a.posted).length}</div><div className="l">dampak laba <Td.Inner v={tot.posted} /></div></div>
        <div className="kpi"><div className="l">FINAL</div><div className="v">{final ? "dikunci" : "belum"}</div><div className="l">{final ? `SHA ${String(final.snapshot_sha256).slice(0, 12)}…` : "setelah akhir bulan"}</div></div>
      </div>
      <Card title="Penyesuaian">
        <table className="t compact">
          <thead><tr><th>Kode</th><th>Keterangan</th><th>Pos P&amp;L</th><th>Jenis</th><th className="n">Jumlah</th><th>Posting</th></tr></thead>
          <tbody>{mv.adjustments.map((a) => (
            <tr key={String(a.id)}><td>{String(a.code)}</td><td>{String(a.description)}</td><td>{String(a.pl_line)}</td><td>{KIND[String(a.kind)] ?? String(a.kind)}</td><Td v={String(a.amount)} />
              <td><ActionForm action={adjustmentAction} submit={a.posted ? "Batalkan posting" : "Tandai diposting"} className="row">
                <input type="hidden" name="month" value={first} /><input type="hidden" name="id" value={String(a.id)} /><input type="hidden" name="op" value="post" />
                <input type="hidden" name="posted" value={a.posted ? "0" : "1"} /><input name="gl_voucher" defaultValue={String(a.gl_voucher ?? "")} placeholder="voucher GL" size={12} />
              </ActionForm></td></tr>
          ))}</tbody>
        </table>
        <ActionForm action={adjustmentAction} submit="Tambah penyesuaian" className="row">
          <input type="hidden" name="month" value={first} />
          <input name="code" placeholder="DI-06" size={6} /><input name="description" placeholder="Keterangan" size={34} /><input name="pl_line" placeholder="Pos P&L" size={20} />
          <select name="kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="amount" placeholder="Jumlah (+/−)" size={12} />
        </ActionForm>
      </Card>
      {!final ? <Card title="Kunci FINAL"><ActionForm action={lockAction} submit="Kunci FINAL" confirm="Kunci FINAL bulan ini? Akurasi dan kalibrasi bulan berikut dihitung."><input type="hidden" name="month" value={first} /><input type="hidden" name="version" value="FINAL" /></ActionForm></Card> : null}
    </Shell>
  );
}
