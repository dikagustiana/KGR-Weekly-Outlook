"use client";
import { useState, useTransition } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { addItemMapping, commit, discardStaged, stage } from "./actions";
import type { StageResult, AnyKind } from "@/lib/upload";

type Kind = { kind: string; label: string; description: string; target: string; source: string };

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? nf.format(Number(v)) : String(v));

export function UploadWizard({ week, kinds, keys, isAdmin }: { week: string; kinds: Kind[]; keys: string[]; isAdmin: boolean }) {
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [prod, setProd] = useState(true);
  const [res, setRes] = useState<StageResult | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const def = kinds.find((k) => k.kind === kind);

  const run = (fn: () => Promise<void>) => start(async () => { setMsg({}); try { await fn(); } catch (e) { setMsg({ error: (e as Error).message }); } });

  const preview = () => run(async () => {
    if (!file) { setMsg({ error: "Pilih file dulu" }); return; }
    if (file.size > 25 * 1024 * 1024) { setMsg({ error: "File > 25 MB" }); return; }
    const p = `${week}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\- ]+/g, "_")}`;
    const up = await supabaseBrowser().storage.from("uploads").upload(p, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) { setMsg({ error: `Upload ke storage gagal: ${up.error.message}` }); return; }
    setPath(p);
    const r = await stage({ week, kind: kind as AnyKind, path: p, fileName: file.name, makeProductionReceipts: prod });
    if ("error" in r && !("uploadId" in r)) { setMsg({ error: r.error }); return; }
    setRes(r as StageResult);
    setMapping(((r as StageResult).parse?.mapping as Record<string, number | null>) ?? {});
  });

  const remap = () => run(async () => {
    if (!path || !file || !res) return;
    const r = await stage({ week, kind: kind as AnyKind, path, fileName: file.name, mapping, makeProductionReceipts: prod, replaces: res.uploadId });
    if ("error" in r && !("uploadId" in r)) { setMsg({ error: r.error }); return; }
    setRes(r as StageResult);
  });

  const doCommit = () => run(async () => {
    if (!res) return;
    if (!window.confirm("Simpan perubahan ini ke database?")) return;
    const r = await commit(res.uploadId, week);
    setMsg(r);
    if (r.ok) { setRes(null); setFile(null); setPath(null); }
  });

  const cancel = () => run(async () => {
    if (res) await discardStaged(res.uploadId);
    setRes(null); setPath(null); setMsg({ ok: "Pratinjau dibatalkan" });
  });

  const map = (code: string, name: string | null, key: string) => run(async () => {
    const r = await addItemMapping(code, name, key);
    setMsg(r);
    if (r.ok) remap();
  });

  const totals = res?.plan.reduce((a, t) => ({ i: a.i + t.inserts, u: a.u + t.updates, d: a.d + t.deletes }), { i: 0, u: 0, d: 0 });

  return (
    <div>
      {!res ? (
        <div className="card">
          <h2>1. Pilih jenis dan file</h2>
          <div className="row">
            <div className="field">
              <label>Jenis data</label>
              <select className="in" value={kind} onChange={(e) => setKind(e.target.value)} style={{ minWidth: 380 }}>
                {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>File (.xlsx, .xls, .csv)</label>
              <input className="in" type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            {kind === "ops_batch" ? (
              <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={prod} onChange={(e) => setProd(e.target.checked)} /> buat penerimaan Produksi RPA dari output batch</label>
            ) : null}
            <button className="b" onClick={preview} disabled={pending || !file}>{pending ? "Membaca…" : "Pratinjau"}</button>
          </div>
          {def ? <p className="muted">{def.description} → <b>{def.target}</b> (sumber: {def.source})</p> : null}
        </div>
      ) : (
        <>
          <div className="card">
            <h2>2. Pratinjau — {res.fileName}</h2>
            <p className="muted">SHA-256 {res.sha.slice(0, 16)}… · {res.workbookWeek ? `Minggu workbook: ${res.workbookWeek}` : `Sheet "${res.parse?.sheet}", judul kolom baris ${res.parse?.headerRow}, ${res.parse?.rowCount} baris terbaca, tanggal ${res.parse?.dateFrom ?? "—"} s.d. ${res.parse?.dateTo ?? "—"}`}</p>
            {res.parse?.issues.length ? <ul className="alerts">{res.parse.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
            {res.workbookWeek && res.workbookWeek !== week ? <div className="msg info">Workbook ini untuk minggu {res.workbookWeek}; data akan dimuat ke minggu itu (dibuat bila belum ada).</div> : null}
          </div>
          {res.fields && res.parse ? (
            <div className="card">
              <h2>Pemetaan kolom</h2>
              <div className="row" style={{ alignItems: "flex-end" }}>
                {res.fields.map((f) => (
                  <div className="field" key={f.field}>
                    <label>{f.label}{f.required ? " *" : ""}</label>
                    <select className="in" value={mapping[f.field] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.field]: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">(tidak ada)</option>
                      {res.parse!.columns.map((c, i) => <option key={i} value={i}>{c || `kolom ${i + 1}`}</option>)}
                    </select>
                  </div>
                ))}
                <button className="b sec" onClick={remap} disabled={pending}>Pratinjau ulang</button>
              </div>
            </div>
          ) : null}
          {res.unmappedItems.length || res.unmappedAccounts.length ? (
            <div className="card">
              <h2 className="warn">Kode belum dipetakan (kontrol 1–3, 14 akan GAGAL sampai dipetakan)</h2>
              {res.unmappedItems.length ? (
                <table className="t compact">
                  <thead><tr><th>Kode item</th><th>Nama</th><th>Key usulan</th><th /></tr></thead>
                  <tbody>
                    {res.unmappedItems.map((u) => (
                      <UnmappedRow key={u.code} u={u} keys={keys} isAdmin={isAdmin} onMap={map} pending={pending} />
                    ))}
                  </tbody>
                </table>
              ) : null}
              {res.unmappedAccounts.length ? (
                <p>Akun belum ada di I_COA: {res.unmappedAccounts.map((a) => `${a.account} ${a.name ?? ""}`).join(", ")} — tambahkan di Master → Akun (Admin).</p>
              ) : null}
            </div>
          ) : null}
          <div className="card">
            <h2>3. Perubahan yang akan disimpan</h2>
            <table className="t compact">
              <thead><tr><th>Tabel</th><th className="n">Baru</th><th className="n">Diubah</th><th className="n">Dihapus (soft)</th><th className="n">Ops diganti</th><th className="n">Sama</th><th>Catatan</th></tr></thead>
              <tbody>
                {res.plan.map((t, i) => (
                  <tr key={i}><td>{t.label}</td><td className="n">{t.inserts}</td><td className="n">{t.updates}</td><td className="n">{t.deletes}</td><td className="n">{t.supersede}</td><td className="n">{t.unchanged}</td><td className="muted">{t.notes.join(" · ")}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="b" onClick={doCommit} disabled={pending || (totals && totals.i + totals.u + totals.d === 0 && !res.workbookWeek)}>{pending ? "Menyimpan…" : "Simpan ke database"}</button>
              <button className="b sec" onClick={cancel} disabled={pending}>Batalkan</button>
            </div>
          </div>
          {res.parse?.sample.length ? (
            <div className="card scroll">
              <h2>Contoh baris (25 pertama)</h2>
              <table className="t compact">
                <thead><tr>{Object.keys(res.parse.sample[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{res.parse.sample.map((r, i) => <tr key={i}>{Object.keys(res.parse!.sample[0]).map((k) => <td key={k}>{show(r[k])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
          {res.parse?.badRows.length ? (
            <div className="card">
              <h2 className="warn">Baris bermasalah (tidak disimpan)</h2>
              <ul>{res.parse.badRows.map((b) => <li key={b.rowNo}>Baris {b.rowNo}: {b.issues.join("; ")}</li>)}</ul>
            </div>
          ) : null}
        </>
      )}
      {msg.ok ? <div className="msg ok">{msg.ok}</div> : null}
      {msg.error ? <div className="msg err">{msg.error}</div> : null}
    </div>
  );
}

function UnmappedRow({ u, keys, isAdmin, onMap, pending }: {
  u: { code: string; name: string | null; suggested: string | null }; keys: string[]; isAdmin: boolean; pending: boolean;
  onMap: (code: string, name: string | null, key: string) => void;
}) {
  const [key, setKey] = useState(u.suggested ?? "");
  return (
    <tr>
      <td>{u.code}</td><td>{u.name}</td>
      <td>{isAdmin ? (
        <select className="in" value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">— pilih key —</option>
          {keys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      ) : (u.suggested ?? "—")}</td>
      <td>{isAdmin ? <button className="b small" disabled={!key || pending} onClick={() => onMap(u.code, u.name, key)}>Petakan</button> : <span className="muted">minta Admin memetakan</span>}</td>
    </tr>
  );
}
