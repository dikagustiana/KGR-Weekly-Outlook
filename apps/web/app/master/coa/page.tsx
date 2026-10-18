import { BS_ASSETS, BS_EQUITY, BS_LIABILITIES, CF_CATEGORIES, PNL_COGS, PNL_DA, PNL_OPEX, PNL_OTHER, PNL_REVENUE } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card, Msg } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase";
import { computeForWeek, fetchAll } from "@/lib/data";
import { MasterTabs } from "../MasterTabs";
import { saveAccount } from "../actions";

export const dynamic = "force-dynamic";

const PL = [...PNL_REVENUE, ...PNL_COGS, ...PNL_OPEX, ...PNL_OTHER, PNL_DA];
const BS = [...BS_ASSETS, ...BS_LIABILITIES, ...BS_EQUITY.filter((x) => x !== "Current year profit")];

export default async function CoaMaster({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  const sb = await supabaseServer();
  const coa = await fetchAll<Record<string, unknown>>((f, t) => sb.from("coa_map").select("*").is("deleted_at", null).order("account").range(f, t));
  const admin = viewer.role === "admin";
  const known = new Set(coa.map((c) => String(c.account)));
  const c = week ? await computeForWeek(sb, week.week_start) : null;
  const missing = new Map<string, string | null>();
  if (c) {
    for (const g of c.loaded.inputs.gl_lines) if (g.account && !known.has(g.account)) missing.set(g.account, g.account_name ?? null);
    for (const t of c.loaded.inputs.tb_opening) if (!known.has(t.account)) missing.set(t.account, t.name ?? null);
  }
  const path = `/master/coa${week ? `?week=${week.week_start}` : ""}`;
  const edit = sp.edit ? coa.find((x) => String(x.account) === sp.edit) : undefined;
  const pre = edit ?? (sp.new ? { account: sp.new, name: missing.get(sp.new) ?? "" } : undefined);
  const q = (sp.q ?? "").toLowerCase();
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="master/coa">
      <h1>Master data</h1>
      <MasterTabs active="coa" week={week?.week_start} />
      {sp.ok ? <Msg kind="ok">{sp.ok}</Msg> : null}
      {sp.err ? <Msg kind="err">{sp.err}</Msg> : null}
      {missing.size ? (
        <Card title="Akun di jurnal / TB tanpa mapping (kontrol 14 — memblokir rilis)">
          <ul>{[...missing.entries()].map(([a, n]) => <li key={a}>{a} {n} {admin ? <a href={`${path}${path.includes("?") ? "&" : "?"}new=${a}#form`}>petakan</a> : null}</li>)}</ul>
        </Card>
      ) : null}
      {admin ? (
        <Card title={edit ? `Ubah akun ${edit.account}` : "Tambah akun"} id="form">
          <form action={saveAccount} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="path" value={path} />
            <div className="field"><label>Akun</label><input className="in" name="account" defaultValue={String(pre?.account ?? "")} required style={{ width: 100 }} /></div>
            <div className="field"><label>Nama</label><input className="in" name="name" defaultValue={String(pre?.name ?? "")} required style={{ width: 220 }} /></div>
            <div className="field"><label>Tipe</label><select className="in" name="type" defaultValue={String(edit?.type ?? "Neraca")}><option>Neraca</option><option>LabaRugi</option><option>Header</option></select></div>
            <div className="field"><label>Baris laba rugi</label><select className="in" name="pl_line" defaultValue={String(edit?.pl_line ?? "")}><option value="">—</option>{PL.map((l) => <option key={l}>{l}</option>)}</select></div>
            <div className="field"><label>Baris neraca</label><select className="in" name="bs_line" defaultValue={String(edit?.bs_line ?? "")}><option value="">—</option>{BS.map((l) => <option key={l}>{l}</option>)}</select></div>
            <div className="field"><label>Kategori arus kas (bila jadi lawan kas)</label><select className="in" name="cf_category_as_counter" defaultValue={String(edit?.cf_category_as_counter ?? "")}><option value="">—</option>{CF_CATEGORIES.map((l) => <option key={l}>{l}</option>)}</select></div>
            <div className="field"><label>Kas?</label><select className="in" name="is_cash" defaultValue={edit?.is_cash ? "Y" : "N"}><option>N</option><option>Y</option></select></div>
            <div className="field"><label>Mapping FS accounting (referensi)</label><input className="in" name="fs_mapping_reference" defaultValue={String(edit?.fs_mapping_reference ?? "")} style={{ width: 200 }} /></div>
            <button className="b small">Simpan</button>
          </form>
        </Card>
      ) : null}
      <Card title={`Akun → laporan keuangan mingguan (${coa.length})`}>
        <form className="row noprint" method="get">
          {week ? <input type="hidden" name="week" value={week.week_start} /> : null}
          <input className="in" name="q" placeholder="cari akun / nama / baris" defaultValue={sp.q ?? ""} /><button className="b small sec">Cari</button>
        </form>
        <table className="t compact">
          <thead><tr><th>Akun</th><th>Nama akun</th><th>Tipe</th><th>Baris laba rugi</th><th>Baris neraca</th><th>Kategori arus kas</th><th>Kas?</th><th>Mapping FS accounting</th><th /></tr></thead>
          <tbody>
            {coa.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q)).map((x) => (
              <tr key={String(x.account)}>
                <td>{String(x.account)}</td><td>{String(x.name)}</td><td>{String(x.type)}</td><td>{String(x.pl_line ?? "")}</td><td>{String(x.bs_line ?? "")}</td>
                <td>{String(x.cf_category_as_counter ?? "")}</td><td>{x.is_cash ? "Y" : "N"}</td><td className="muted">{String(x.fs_mapping_reference ?? "")}</td>
                <td>{admin ? <a href={`${path}${path.includes("?") ? "&" : "?"}edit=${x.account}#form`}>ubah</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Shell>
  );
}
