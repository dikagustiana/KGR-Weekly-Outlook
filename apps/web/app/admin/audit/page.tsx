import { redirect } from "next/navigation";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase";
import { restoreRow } from "./actions";

export const dynamic = "force-dynamic";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  if (!["admin", "inventory_accounting", "finance"].includes(viewer.role)) redirect("/");
  const sb = await supabaseServer();
  let q = sb.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
  if (sp.table) q = q.eq("table_name", sp.table);
  if (sp.op) q = q.eq("op", sp.op);
  if (sp.actor) q = q.ilike("actor", `%${sp.actor}%`);
  if (sp.inserts !== "1" && !sp.op) q = q.neq("op", "INSERT");
  const { data } = await q;
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="admin/audit">
      <h1>Audit trail</h1>
      <p className="muted">Setiap insert/update/hapus di tabel input dicatat (siapa, kapan, nilai lama dan baru). Hapus bersifat soft; Admin dapat memulihkan.</p>
      <Card>
        <form className="row" method="get">
          <select className="in" name="table" defaultValue={sp.table ?? ""}>
            <option value="">Semua tabel</option>
            {["sales_line", "receipt_line", "batch", "cash_plan", "opening_stock", "gl_line", "tb_opening", "parameter", "sku_price", "runrate", "week", "item_map", "coa_map", "sku_key", "app_user"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className="in" name="op" defaultValue={sp.op ?? ""}>
            <option value="">Semua perubahan</option><option>UPDATE</option><option>SOFT_DELETE</option><option>RESTORE</option><option>INSERT</option>
          </select>
          <input className="in" name="actor" placeholder="pengguna" defaultValue={sp.actor ?? ""} />
          <label className="row" style={{ gap: 4 }}><input type="checkbox" name="inserts" value="1" defaultChecked={sp.inserts === "1"} /> tampilkan insert</label>
          <button className="b small">Filter</button>
        </form>
      </Card>
      <Card>
        <table className="t compact">
          <thead><tr><th>Waktu</th><th>Pengguna</th><th>Tabel</th><th>Baris</th><th>Aksi</th><th>Perubahan (lama → baru)</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(a.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                <td>{a.actor}</td><td>{a.table_name}</td><td><code>{String(a.row_id ?? "").slice(0, 13)}</code></td><td>{a.op}</td>
                <td style={{ fontSize: 11 }}>
                  {a.op === "UPDATE" || a.op === "SOFT_DELETE" || a.op === "RESTORE"
                    ? Object.entries((a.changes ?? {}) as Record<string, [unknown, unknown]>).filter(([k]) => !["deleted_by"].includes(k)).map(([k, [o, n]]) => <div key={k}><b>{k}</b>: {fmt(o)} → {fmt(n)}</div>)
                    : a.op === "INSERT" ? <span className="muted">baris baru</span> : <span className="muted">{JSON.stringify(a.changes).slice(0, 160)}</span>}
                </td>
                <td>{viewer.role === "admin" && a.op === "SOFT_DELETE" ? (
                  <form action={restoreRow}><input type="hidden" name="table" value={a.table_name} /><input type="hidden" name="row_id" value={a.row_id ?? ""} /><button className="b sec small">Pulihkan</button></form>
                ) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Menampilkan 300 entri terbaru sesuai filter.</p>
      </Card>
    </Shell>
  );
}
