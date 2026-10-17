import Link from "next/link";
import { clock } from "@/lib/clock";
import { addDays } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, Td } from "@/components/ui";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { mustRows } from "@/lib/loader";
import { fetchAll } from "@/lib/data";
import { URGENCY_LABEL, assignedKeysFor, commercialView } from "@/lib/v3/commercial-view";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

/** One SKU: commercial row over the last 14 days and the open orders (sales see no lot cost). */
export default async function KomersialKeyPage({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await params).key);
  const v = await requireModulePage("m7_commercial", ["admin", "sales", "commercial_lead", "management", "operations_director", "finance"]);
  const { viewer, weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const today = (await clock(sb)).data;
  const table = v.role === "sales" ? "commercial_daily_sales" : "commercial_daily";
  const raw = await fetchAll<Record<string, unknown>>((a, b) => sb.from(table).select("*").eq("key", key).gte("date", addDays(today, -14)).order("date", { ascending: false }).range(a, b));
  const { data: par } = week ? await sb.from("parameter").select("sales_sees_cost").eq("week_id", week.id).maybeSingle() : { data: null };
  const asg = mustRows(await sb.from("sales_assignment").select("key").eq("active", true).ilike("email", viewer.email), "komersial.assignment") as any[];
  const assignedKeys = assignedKeysFor(v.role, asg as { key: string | null }[]);
  const rows = commercialView(raw, { role: v.role, salesSeesCost: (par as { sales_sees_cost?: boolean } | null)?.sales_sees_cost !== false, assignedKeys, keepOrder: true });
  const orders = await fetchAll<Record<string, unknown>>((a, b) => sb.from("sales_line").select("id, delivery_date, date, customer, kg, price, demand_status, sales_rep, po_ref").eq("status", "Order").eq("key_manual", key).is("deleted_at", null).gte("date", today).range(a, b));
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      <h1>{key}</h1>
      <p className="muted"><Link href="/komersial">← Komersial</Link></p>
      <Card title="14 hari terakhir">
        <table className="t compact">
          <thead><tr><th>Tanggal</th><th>Status</th><th className="n">Bebas kg</th><th className="n">Umur</th><th className="n">Harga lantai</th><th className="n">Harga daftar</th><th className="n">Harga 7 hari</th><th className="n">Peringkat</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.date ?? ""}><td>{tgl(r.date)}</td><td>{URGENCY_LABEL[r.urgency ?? "aman"]}</td><Td v={r.form === "fresh" ? r.free_fresh_kg : r.free_frozen_kg} /><Td v={r.oldest_age_days} /><Td v={r.price_floor} /><Td v={r.price_list} /><Td v={r.realized_price_7d} /><Td v={r.rank} /></tr>)}</tbody>
        </table>
      </Card>
      <Card title={`Order terbuka (${orders.length})`}>
        <table className="t compact">
          <thead><tr><th>Tgl kirim</th><th>PO</th><th>Pelanggan</th><th>Status</th><th>Sales</th><th className="n">kg</th><th className="n">Harga</th></tr></thead>
          <tbody>{orders.map((o) => <tr key={String(o.id)}><td>{tgl(String(o.delivery_date ?? o.date))}</td><td>{String(o.po_ref ?? "—")}</td><td>{String(o.customer ?? "—")}</td><td>{String(o.demand_status ?? "Confirmed")}</td><td>{String(o.sales_rep ?? "—")}</td><Td v={o.kg as string} /><Td v={o.price as string} /></tr>)}</tbody>
        </table>
      </Card>
    </Shell>
  );
}
