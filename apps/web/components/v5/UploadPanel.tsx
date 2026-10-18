"use client";
/**
 * Upload dan cek (PRD v5 §4.9, §6.4, K34): a file (.xlsx through the SheetJS mini build, loaded on demand; .csv
 * without a library), a range pasted from Excel (TSV), or the mockup example; the same validateUpload as the server;
 * "Simpan N baris yang lolos" sends the raw grid and the preview fingerprint — the server checks again and refuses a
 * different result. An example is never saved.
 */
import { useActionState, useMemo, useState, type ChangeEvent } from "react";
import { UPLOAD_TEMPLATES, parseCsv, parseTsv, templateGrid, validateUpload, type Grid, type UploadContext, type UploadKindV5 } from "@kgr/engine/upload";
import { workbookGrid, type SheetLib } from "@/lib/v5/upload-grid";

export type ActionState = { ok?: string; error?: string };
/** PRD v5.1 R36 (v4 §5.1 rule 3): the level of a check in words, no icon and no colour. */
const CHECK_LEVEL = { ok: "", warn: "catatan:", fail: "ditahan:", info: "" } as const;
const LEVEL = { ok: "lolos", warn: "catatan", fail: "gagal" } as const;

async function sheetLib(): Promise<SheetLib & { write: (wb: unknown, o: { type: "array"; bookType: "xlsx" }) => ArrayBuffer; utils: SheetLib["utils"] & { aoa_to_sheet(r: unknown[][]): unknown; book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, n: string): void } }> {
  const mod = await import("xlsx/dist/xlsx.mini.min.js");
  return ((mod as { default?: unknown }).default ?? mod) as never;
}

export function UploadPanel({ kind, ctx, sample, canSave, action }: {
  kind: UploadKindV5;
  ctx: UploadContext;
  sample: Grid | null;
  canSave: boolean;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
}) {
  const tpl = UPLOAD_TEMPLATES[kind];
  const [src, setSrc] = useState<{ name: string; grid: Grid; sample: boolean } | null>(null);
  const [paste, setPaste] = useState("");
  const [status, setStatus] = useState("");
  const [tplUrl, setTplUrl] = useState<string | null>(null);
  const [state, run, pending] = useActionState(action, {});
  const r = useMemo(() => (src ? validateUpload(kind, src.grid, ctx) : null), [src, kind, ctx]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    if (f.size > 4_000_000) { setStatus("File maksimal 4 MB"); return; }
    try {
      if (name.endsWith(".csv") || name.endsWith(".txt")) { setSrc({ name: f.name, grid: parseCsv(await f.text()), sample: false }); setStatus(""); return; }
      if (name.endsWith(".tsv")) { setSrc({ name: f.name, grid: parseTsv(await f.text()), sample: false }); setStatus(""); return; }
      if (name.endsWith(".xls")) { setStatus("Format .xls lama tidak dibaca build mini: simpan ulang sebagai .xlsx, atau salin sel dan tempel di bawah."); return; }
      setStatus("Membaca file…");
      setSrc({ name: f.name, grid: workbookGrid(await sheetLib(), new Uint8Array(await f.arrayBuffer())), sample: false });
      setStatus("");
    } catch (err) {
      setStatus(`File tidak terbaca: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function makeTemplate() {
    try {
      const X = await sheetLib();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(templateGrid(kind)), "data");
      setTplUrl(URL.createObjectURL(new Blob([X.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })));
    } catch { // k41-ok: SheetJS tidak termuat di browser → templat CSV yang sama (bukan bacaan data)
      setTplUrl(URL.createObjectURL(new Blob([templateGrid(kind)[0].join(";") + "\n"], { type: "text/csv" })));
    }
  }

  return (
    <div className="upl" data-upload={kind}>
      <div className="actionbar">
        <label className="v4b">Pilih file Excel atau CSV<input type="file" accept=".xlsx,.csv" onChange={onFile} className="sr-only" /></label>
        {sample ? <button type="button" className="v4b" onClick={() => setSrc({ name: "contoh", grid: sample, sample: true })}>Pakai file contoh</button> : null}
        <button type="button" className="v4b" onClick={makeTemplate}>Buat template</button>
        {tplUrl ? <a className="v4b link" href={tplUrl} download={tplUrl.startsWith("blob:") ? tpl.fileName : undefined}>Unduh {tpl.fileName}</a> : null}
      </div>
      <label className="note upl-paste">Atau salin sel dari Excel lalu tempel di sini (baris pertama = judul kolom)
        <textarea rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} />
      </label>
      <button type="button" className="v4b" disabled={!paste.trim()} onClick={() => setSrc({ name: "tempelan", grid: parseTsv(paste), sample: false })}>Cek tempelan</button>
      {status ? <p className="note" role="status">{status}</p> : null}
      {r && src ? (
        <>
          <p className="note">{src.sample ? "contoh" : src.name} · {r.total} baris dibaca</p>
          <ul className="upl-checks">
            {r.checks.map((c, i) => <li key={i} data-level={c.level}>{CHECK_LEVEL[c.level] ? <span>{CHECK_LEVEL[c.level]} </span> : null}<b>{c.title}</b> {c.detail} <span className="note">{c.result}{c.code ? ` · ${c.code}` : ""}</span></li>)}
          </ul>
          {r.rows.length ? (
            <table className="v4t" aria-label="Baris upload">
              <thead><tr><th scope="col">{kind === "yield_matrix" ? "Kelas" : kind === "costing_wp" ? "Kode" : "Ref"}</th><th scope="col">Isi</th><th scope="col" className="n">{kind === "yield_matrix" ? "Yield karkas" : kind === "fixed_cost" || kind === "supplier_invoice" ? "Rp jt" : "kg"}</th><th scope="col">Cek</th><th scope="col">Tindakan</th></tr></thead>
              <tbody>{r.rows.slice(0, 50).map((x, i) => <tr key={i} data-level={x.level}><td>{x.ref}</td><td className="wrap">{x.name}</td><td className="n">{x.kg}</td><td>{LEVEL[x.level]}</td><td className="wrap">{x.action}</td></tr>)}</tbody>
            </table>
          ) : null}
          {r.rows.length > 50 ? <p className="cut">menampilkan 50 dari {r.rows.length}</p> : null}
          <p className="note">{r.summary}</p>
          <form action={run} className="actionbar">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="grid" value={JSON.stringify(src.grid)} />
            <input type="hidden" name="fingerprint" value={r.fingerprint} />
            <input type="hidden" name="file_name" value={src.name} />
            {r.needsReason.length ? <label className="note">Alasan selisih hasil potong ({r.needsReason.join(", ")}) <input name="reason" size={40} required minLength={10} /></label> : null}
            <button className="v4b primary" disabled={pending || !canSave || src.sample || !r.ok_count}>
              {pending ? "Memproses…" : src.sample ? "Contoh tidak disimpan" : r.ok_count ? `Simpan ${r.ok_count} baris yang lolos` : "Tidak ada baris yang lolos"}
            </button>
            {!canSave ? <span className="note">Mode baca: simpan oleh pemilik input.</span> : null}
          </form>
        </>
      ) : <p className="note">{tpl.hint}</p>}
      {state.ok ? <div className="msg ok" role="status">{state.ok}</div> : null}
      {state.error ? <div className="msg err" role="alert">{state.error}</div> : null}
    </div>
  );
}
