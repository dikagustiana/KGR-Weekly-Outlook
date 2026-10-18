import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, Msg } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase";
import { computeForWeek, fetchAll } from "@/lib/data";
import { suggestKey } from "@/lib/upload";
import { MasterTabs } from "../MasterTabs";
import { deleteItem, saveItem } from "../actions";

export const dynamic = "force-dynamic";

export default async function ItemMaster({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  const sb = await supabaseServer();
  const items = await fetchAll<Record<string, string | null>>((f, t) => sb.from("item_map").select("*").is("deleted_at", null).order("item_code").range(f, t));
  const keys = await fetchAll<{ key: string; decision_group: string }>((f, t) => sb.from("sku_key").select("key, decision_group").eq("active", true).order("sort_order").order("key").range(f, t));
  const group = new Map(keys.map((k) => [k.key, k.decision_group]));
  const admin = viewer.role === "admin";
  const q = (sp.q ?? "").toLowerCase();
  const shown = items.filter((i) => !q || `${i.item_code} ${i.item_name} ${i.key}`.toLowerCase().includes(q));
  // new codes seen in the selected week
  const c = week ? await computeForWeek(sb, week.week_start) : null;
  const known = new Set(items.map((i) => String(i.item_code).toUpperCase()));
  const fresh = new Map<string, string | null>();
  if (c) {
    for (const r of [...c.loaded.inputs.sales_lines, ...c.loaded.inputs.receipt_lines, ...c.loaded.inputs.opening_stock]) {
      const code = r.item_code;
      if (code && !known.has(code.toUpperCase()) && !("key_manual" in r && r.key_manual)) fresh.set(code, ("item_name" in r ? (r.item_name as string | null) : null) ?? null);
    }
  }
  const path = `/master/item${week ? `?week=${week.week_start}` : ""}`;
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="master/item">
      <h1>Master data</h1>
      <MasterTabs active="item" week={week?.week_start} />
      {sp.ok ? <Msg kind="ok">{sp.ok}</Msg> : null}
      {sp.err ? <Msg kind="err">{sp.err}</Msg> : null}
      {fresh.size ? (
        <Card title={`Kode item baru di minggu ${week?.week_start} (kontrol 1–3)`}>
          <table className="t compact">
            <thead><tr><th>Kode</th><th>Nama</th><th>Key</th><th /></tr></thead>
            <tbody>
              {[...fresh.entries()].map(([code, name]) => (
                <tr key={code}>
                  <td>{code}</td><td>{name}</td>
                  <td>{admin ? (
                    <form id={`n-${code}`} action={saveItem}>
                      <input type="hidden" name="path" value={path} /><input type="hidden" name="item_code" value={code} /><input type="hidden" name="item_name" value={name ?? ""} />
                      <select className="in" name="key" defaultValue={suggestKey(code, name, keys.map((k) => k.key)) ?? ""}>
                        <option value="">— pilih —</option>{keys.map((k) => <option key={k.key}>{k.key}</option>)}
                      </select>
                    </form>
                  ) : null}</td>
                  <td>{admin ? <button className="b small" form={`n-${code}`}>Petakan</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      <Card title={`Kode item Accurate → key (${items.length})`}>
        <form className="row noprint" method="get">
          {week ? <input type="hidden" name="week" value={week.week_start} /> : null}
          <input className="in" name="q" placeholder="cari kode / nama / key" defaultValue={sp.q ?? ""} /><button className="b small sec">Cari</button>
        </form>
        {admin ? (
          <form action={saveItem} className="row" style={{ margin: "8px 0" }}>
            <input type="hidden" name="path" value={path} />
            <input className="in" name="item_code" placeholder="Kode item" required style={{ width: 110 }} />
            <input className="in" name="item_name" placeholder="Nama item (Accurate)" style={{ width: 260 }} />
            <select className="in" name="key" required defaultValue=""><option value="">— key —</option>{keys.map((k) => <option key={k.key}>{k.key}</option>)}</select>
            <button className="b small">Tambah / ubah</button>
          </form>
        ) : null}
        <table className="t compact">
          <thead><tr><th>Kode item</th><th>Nama item (Accurate)</th><th>Key</th><th>Kelompok</th><th /></tr></thead>
          <tbody>
            {shown.map((i) => (
              <tr key={String(i.item_code)}>
                <td>{i.item_code}</td><td>{i.item_name}</td><td>{i.key}</td><td className="muted">{group.get(String(i.key)) ?? <span className="warn">KEY TIDAK ADA</span>}</td>
                <td>{admin ? (
                  <form action={deleteItem}><input type="hidden" name="path" value={path} /><input type="hidden" name="item_code" value={String(i.item_code)} /><button className="b danger small">Nonaktifkan</button></form>
                ) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Shell>
  );
}
