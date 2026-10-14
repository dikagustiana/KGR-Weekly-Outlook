import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, Msg } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase";
import { MasterTabs } from "../MasterTabs";
import { saveSkuKey } from "../actions";

export const dynamic = "force-dynamic";

export default async function SkuMaster({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  const sb = await supabaseServer();
  const { data } = await sb.from("sku_key").select("*").order("sort_order");
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="master/sku">
      <h1>Master data</h1>
      <MasterTabs active="sku" week={week?.week_start} />
      {sp.ok ? <Msg kind="ok">{sp.ok}</Msg> : null}
      {sp.err ? <Msg kind="err">{sp.err}</Msg> : null}
      {viewer.role === "admin" ? (
        <Card title="Tambah key (Segmen | SKU | Bentuk)">
          <form action={saveSkuKey} className="row" style={{ alignItems: "flex-end" }}>
            <div className="field"><label>Segmen</label><select className="in" name="segment"><option>RPA</option><option>Trading</option></select></div>
            <div className="field"><label>SKU</label><input className="in" name="sku" required /></div>
            <div className="field"><label>Bentuk</label><select className="in" name="form"><option>Fresh</option><option>Frozen</option><option>n/a</option></select></div>
            <div className="field"><label>Kelompok keputusan</label><input className="in" name="decision_group" required placeholder="mis. Boneless & parting / By-product / Karkas fresh / SKU" /></div>
            <button className="b small">Simpan</button>
          </form>
        </Card>
      ) : null}
      <Card title={`Key analisa (${data?.length ?? 0})`}>
        <table className="t compact">
          <thead><tr><th>Key</th><th>Segmen</th><th>SKU</th><th>Bentuk</th><th>Kelompok keputusan</th><th>Aktif</th></tr></thead>
          <tbody>{(data ?? []).map((k) => <tr key={k.key}><td>{k.key}</td><td>{k.segment}</td><td>{k.sku}</td><td>{k.form}</td><td>{k.decision_group}</td><td>{k.active ? "ya" : "tidak"}</td></tr>)}</tbody>
        </table>
        <p className="muted">Harga acuan per key disimpan per minggu di Input → Harga.</p>
      </Card>
    </Shell>
  );
}
