import Link from "next/link";
import { D, isISODate, jakartaToday } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, N, Td } from "@/components/ui";
import { SKU_READERS, requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { skuBalances } from "@/lib/v3/ledger";
import { tgl } from "@/lib/fmt";
import { currentView } from "@/lib/view-server";

export const dynamic = "force-dynamic";


type R = Record<string, unknown>;

export default async function SkuPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireModulePage("m2_ledger", [...SKU_READERS]);
  const { viewer, weeks, week } = await plainContext(sp.week);
  const mgmt = (await currentView(viewer)) === "management";
  const want = sp.date && isISODate(sp.date) ? sp.date : jakartaToday();
  const sb = await supabaseServer();
  const { date, rows } = await skuBalances(sb, want);
  const group = sp.group ?? "";
  const form = sp.form ?? "";
  const shown = rows.filter((r) => (!group || r.group_code === group) && (!form || r.form === form) && (sp.all === "1" || !D(String(r.kg)).isZero()));
  const groups = [...new Set(rows.map((r) => String(r.group_code ?? "")))].filter(Boolean).sort();
  const tot = (k: string) => shown.reduce((a, r) => a.plus(D(String(r[k] ?? 0))), D(0));
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/sku">
      <h1>Stok per SKU {date ? `— ${tgl(date)}` : ""}</h1>
      <p className="muted">Saldo per SKU dari ledger lot: masuk dari hasil potong dan pembelian, keluar dari DO, blast fresh → frozen, opname. Biaya rata-rata (MA) mengikuti cara Accurate; biaya per lot (SI) dipakai manajemen.{rows.some((r) => r.projected) ? " Tanggal ini termasuk rencana terima dan order (proyeksi)." : ""}</p>
      {!date ? <Card><p>Belum ada data harian. {viewer.role === "admin" ? <Link href="/admin/modul">Bangun ulang di Admin → Modul</Link> : "Minta Admin membangun ulang data harian."}</p></Card> : null}
      <Card>
        <form className="row noprint" method="get">
          <input className="in" type="date" name="date" defaultValue={want} />
          <select className="in" name="group" defaultValue={group}><option value="">Semua grup</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
          <select className="in" name="form" defaultValue={form}><option value="">Fresh + frozen</option><option value="fresh">Fresh</option><option value="frozen">Frozen</option></select>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> tampilkan saldo nol</label>
          <button className="b small">Tampilkan</button>
        </form>
      </Card>
      <div className="kpis">
        <div className="kpi"><div className="l">Stok</div><div className="v"><N v={tot("kg")} /> kg</div></div>
        <div className="kpi"><div className="l">Bebas (belum terikat order)</div><div className="v"><N v={tot("free_kg")} /> kg</div></div>
        <div className="kpi"><div className="l">Nilai (biaya rata-rata)</div><div className="v"><N v={tot("cost_ma")} /></div></div>
        <div className="kpi"><div className="l">Di atas batas umur</div><div className="v"><N v={tot("over_age_kg")} /> kg</div></div>
      </div>
      <div className="card scroll">
        <table className="t compact">
          <thead><tr><th>SKU</th><th>Grup</th><th>Bentuk</th><th className="n">kg</th><th className="n">Bebas kg</th><th className="n">Terikat order kg</th><th className="n">Biaya rata-rata Rp/kg</th><th className="n">Biaya per lot Rp/kg</th><th className="n">Nilai Rp</th><th className="n">Umur tertua (hari)</th><th className="n">Di atas batas umur kg</th><th className="n">Lot</th></tr></thead>
          <tbody>
            {shown.map((r: R) => (
              <tr key={String(r.key)}>
                <td className="lbl"><Link href={`/sku/${encodeURIComponent(String(r.key))}?date=${date}`}>{String(r.key)}</Link></td><td className="muted">{String(r.group_code ?? "")}</td><td>{String(r.form ?? "")}</td>
                <Td v={String(r.kg)} dp={2} /><Td v={String(r.free_kg)} dp={2} /><Td v={String(r.reserved_kg)} dp={2} />
                <Td v={r.cost_per_kg_ma === null ? null : String(r.cost_per_kg_ma)} /><Td v={r.cost_per_kg_si === null ? null : String(r.cost_per_kg_si)} /><Td v={r.cost_ma === null ? null : String(r.cost_ma)} />
                <Td v={r.oldest_age_days === null ? null : String(r.oldest_age_days)} /><Td v={String(r.over_age_kg)} dp={2} /><Td v={String(r.lots)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!mgmt ? <p className="muted">Sumber: data harian <code>sku_balance_daily</code> (dibangun ulang setelah upload). Batas umur: fresh {">"} jendela fresh (48 jam), frozen {">"} batas umur (30 hari).</p> : null}
    </Shell>
  );
}
