import Link from "next/link";
import type { ReactNode } from "react";
import { TABLES, canAdd, canWriteRow, type ColDef, type TableDef } from "@/lib/tables";
import type { Role } from "@/lib/roles";
import { num, tgl } from "@/lib/fmt";
import { Chip, Msg } from "./ui";
import { deleteRow, markDelivered, pasteRows, saveRow } from "@/app/w/[week]/input/actions";
import { NumberInput } from "./v6/NumberInput";
import { v6PagesOn } from "@/lib/v6/flags";

type Row = Record<string, unknown>;

function display(c: ColDef, v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  if (c.type === "number") return num(String(v), c.dp ?? 2);
  if (c.type === "date") return tgl(String(v));
  return String(v);
}

/**
 * PRD v6 R166 (every cell has a name: column and row, "Harga Rp/kg baris 3") and, with v6_pages, R144 NumberInput for the
 * number columns.
 */
function inputFor(c: ColDef, v: unknown, formId: string, prefix = "", row = "baru", v6 = false): ReactNode {
  const val = v === null || v === undefined ? "" : String(v);
  const style = { width: c.width ?? 110 };
  const name = `${c.label} ${row === "baru" ? "baris baru" : `baris ${row}`}`;
  if (c.type === "select") {
    return (
      <select className="in" name={prefix + c.name} form={formId} defaultValue={val} style={style} required={c.required} aria-label={name}>
        {!c.required ? <option value="">—</option> : null}
        {c.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (c.type === "date") return <input className="in" type="date" name={prefix + c.name} form={formId} defaultValue={val} style={style} required={c.required} aria-label={name} />;
  if (c.type === "number") {
    const shown = val === "" ? "" : num(val, c.dp ?? 2).replace(/\./g, "");
    if (v6) return <NumberInput name={prefix + c.name} form={formId} defaultValue={shown} label={name} />;
    return <input className="in n" inputMode="decimal" name={prefix + c.name} form={formId} defaultValue={shown} style={style} required={c.required} aria-label={name} />;
  }
  return <input className="in" name={prefix + c.name} form={formId} defaultValue={val} style={style} list={c.type === "item" ? "dl-items" : c.type === "key" ? "dl-keys" : undefined} aria-label={name} />;
}

/**
 * Editable input table: read-only rows with computed columns, inline edit (?edit=id), soft delete, add row and CSV paste.
 * Inputs are blue on cream (Excel convention); computed columns are plain with "Cara hitung" tooltips.
 */
export async function InputTable({
  table, week, path, rows, role, editId, computed, computedHead, items, keys, msg, readOnly, extraActions, defaults,
}: {
  table: TableDef["table"]; week: string; path: string; rows: Row[]; role: Role; editId?: string;
  computed?: (r: Row) => ReactNode[]; computedHead?: string[]; items: { code: string; name: string | null }[]; keys: string[];
  msg?: { ok?: string; err?: string }; readOnly?: boolean; extraActions?: (r: Row) => ReactNode; defaults?: Row;
}) {
  const def = TABLES[table];
  const v6 = await v6PagesOn();
  const addable = !readOnly && canAdd(role, def);
  const hidden = (
    <>
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="table" value={table} />
    </>
  );
  return (
    <>
      {msg?.ok ? <Msg kind="ok">{msg.ok}</Msg> : null}
      {msg?.err ? <Msg kind="err">{msg.err}</Msg> : null}
      <datalist id="dl-items">{items.map((i) => <option key={i.code} value={i.code}>{i.name ?? ""}</option>)}</datalist>
      <datalist id="dl-keys">{keys.map((k) => <option key={k} value={k} />)}</datalist>
      <div className="scroll card">
        <table className="t compact">
          <thead>
            <tr>
              <th>#</th>
              {def.cols.map((c) => <th key={c.name} className={c.type === "number" ? "n" : ""}>{c.label}</th>)}
              {(computedHead ?? []).map((h) => <th key={h} className="n">{h}</th>)}
              <th>Sumber</th><th className="noprint" />
            </tr>
          </thead>
          <tbody>
            {addable ? (
              <tr className="noprint">
                <td><form id="f-new" action={saveRow}>{hidden}</form>+</td>
                {def.cols.map((c) => <td key={c.name}>{inputFor(c, (defaults ?? def.defaults ?? {})[c.name], "f-new", "", "baru", v6)}</td>)}
                {(computedHead ?? []).map((h) => <td key={h} />)}
                <td><span className="chip Manual">Manual</span></td>
                <td><button className="b small" form="f-new">Tambah</button></td>
              </tr>
            ) : null}
            {rows.map((r, i) => {
              const id = String(r.id);
              const editing = editId === id && !readOnly && canWriteRow(role, def, r);
              const fid = `f-${id}`;
              return (
                <tr key={id} className={editing ? "sub" : ""}>
                  <td className="muted">{i + 1}</td>
                  {def.cols.map((c) => (
                    <td key={c.name} className={c.type === "number" && !editing ? "n" : ""}>{editing ? inputFor(c, r[c.name], fid, "", String(i + 1), v6) : display(c, r[c.name])}</td>
                  ))}
                  {(computed?.(r) ?? []).map((x, j) => <td key={j} className="n">{x}</td>)}
                  <td><Chip source={String(r.source ?? "")} />{r.superseded_at ? <span className="chip">superseded</span> : null}</td>
                  <td className="noprint" style={{ whiteSpace: "nowrap" }}>
                    {editing ? (
                      <>
                        <form id={fid} action={saveRow}>{hidden}<input type="hidden" name="id" value={id} /></form>
                        <button className="b small" form={fid}>Simpan</button> <Link href={`/w/${week}/${path}`}>batal</Link>
                      </>
                    ) : !readOnly && canWriteRow(role, def, r) ? (
                      <span className="row" style={{ gap: 4 }}>
                        <Link href={`/w/${week}/${path}?edit=${id}#r`} className="b sec small">Ubah</Link>
                        {extraActions?.(r)}
                        <form action={deleteRow}>{hidden}<input type="hidden" name="id" value={id} /><button className="b danger small" title="Soft delete">Hapus</button></form>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">Belum ada baris.</p> : null}
      </div>
      {addable && table !== "opening_stock" ? (
        <details className="card noprint">
          <summary><b>Tempel dari Excel / CSV</b> <span className="muted">— salin baris beserta judul kolom (mis. Tanggal, Pelanggan, Kode item, kg, Harga Rp/kg) lalu tempel</span></summary>
          <form action={pasteRows} style={{ marginTop: 8 }}>
            {hidden}
            <textarea className="in" name="text" rows={6} aria-label="Tempel baris dari Excel" placeholder={"Tanggal\tPelanggan\tKode item\tkg\tHarga Rp/kg\n28/08/2026\tErwin\tTRD0024\t1.250,5\t31.277"} />
            <button className="b small" style={{ marginTop: 6 }}>Tambahkan baris</button>
          </form>
        </details>
      ) : null}
    </>
  );
}

export { markDelivered };
