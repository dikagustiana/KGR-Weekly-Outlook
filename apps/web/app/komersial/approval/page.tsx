import Link from "next/link";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { fetchAll } from "@/lib/data";
import { weekFloorControls } from "@/lib/v3/discount";
import { tgl } from "@/lib/fmt";
import { decideAction } from "../actions";

export const dynamic = "force-dynamic";

/** PRD v3 §6 /komersial/approval: discount queue (commercial_lead ≤ limit, finance above; Q19). */
export default async function ApprovalPage() {
  const v = await requireModulePage("m7_approval", ["admin", "commercial_lead", "finance"]);
  const { viewer, weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const [rows, lim] = await Promise.all([
    fetchAll<Record<string, unknown>>((a, b) => sb.from("discount_approval").select("*").order("created_at", { ascending: false }).limit(200).range(a, b)),
    sb.rpc("discount_limit"),
  ]);
  const limit = String(lim.data ?? "500");
  const pending = rows.filter((r) => r.status === "pending");
  const controls = week ? await weekFloorControls(sb, week) : [];
  const mayDecide = (r: Record<string, unknown>) => v.role === "admin" || v.role === "finance" || (v.role === "commercial_lead" && Number(r.rp_per_kg_below) <= Number(limit));
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      <h1>Approval diskon</h1>
      <p className="muted">Order di bawah harga lantai ditolak sampai disetujui. Commercial lead memutuskan sampai <N v={limit} /> Rp/kg di bawah lantai; di atas itu Finance. <Link href="/komersial">← Komersial</Link></p>
      <Card title={`Menunggu (${pending.length})`}>
        <table className="t compact">
          <thead><tr><th>Diajukan</th><th>Oleh</th><th>SKU</th><th>Pelanggan</th><th className="n">Harga</th><th className="n">Lantai</th><th className="n">Di bawah Rp/kg</th><th className="n">kg</th><th className="n">Total di bawah</th><th>Keputusan</th></tr></thead>
          <tbody>{pending.map((r) => (
            <tr key={String(r.id)}><td>{tgl(String(r.created_at).slice(0, 10))}</td><td>{String(r.requested_by ?? "—")}</td><td>{String(r.key)}</td><td>{String(r.customer ?? "—")}</td>
              <Td v={String(r.requested_price)} /><Td v={String(r.floor_price)} /><Td v={String(r.rp_per_kg_below)} /><Td v={String(r.kg)} /><Td v={String(r.total_below)} />
              <td>{mayDecide(r) ? <div className="row">
                <ActionForm action={decideAction} submit="Setujui"><input type="hidden" name="id" value={String(r.id)} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                <ActionForm action={decideAction} submit="Tolak" danger><input type="hidden" name="id" value={String(r.id)} /><input type="hidden" name="decision" value="reject" /><input name="reason" placeholder="alasan" size={14} /></ActionForm>
              </div> : <span className="muted">keputusan Finance</span>}</td></tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="Riwayat">
        <table className="t compact">
          <thead><tr><th>Diajukan</th><th>SKU</th><th>Pelanggan</th><th className="n">Harga</th><th className="n">Di bawah Rp/kg</th><th className="n">kg</th><th>Status</th><th>Oleh</th><th>Dipakai</th></tr></thead>
          <tbody>{rows.filter((r) => r.status !== "pending").map((r) => (
            <tr key={String(r.id)}><td>{tgl(String(r.created_at).slice(0, 10))}</td><td>{String(r.key)}</td><td>{String(r.customer ?? "—")}</td><Td v={String(r.requested_price)} /><Td v={String(r.rp_per_kg_below)} /><Td v={String(r.kg)} />
              <td>{r.status === "approved" ? "disetujui" : "ditolak"}</td><td>{String(r.decided_by ?? "—")}</td><td>{r.sales_line_id || r.reason === "dipakai (baris tempel / upload)" ? "ya" : "belum"}</td></tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="Kontrol (C38)"><ControlsV3Table controls={controls} /></Card>
    </Shell>
  );
}
