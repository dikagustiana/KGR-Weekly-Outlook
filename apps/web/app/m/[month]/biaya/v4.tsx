import { addDays, fixedTotals, jakartaToday, monthlyAmount } from "@kgr/engine";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { V4Table, type Col, type TRow } from "@/components/v4/Table";
import { plainContext } from "@/lib/page";
import { supabaseServer } from "@/lib/supabase";
import { fetchAll } from "@/lib/data";
import { loadMonthDrivers } from "@/lib/v3/drivers";
import { jtV4, tglShort } from "@/lib/fmt";
import { monthName } from "@/lib/v4/outlook-bulan";
import type { Viewer } from "@/lib/session";
import type { ControlV3 } from "@kgr/engine";
import { costEventAction, deleteCostEventAction, saveDriverAction, saveFixedV4Action } from "./actions";

type Row = Record<string, unknown>;
const DRIVER: Record<string, string> = { fixed: "tetap (template 8.3)", variable: "variabel (Rp/kg)", runrate: "run-rate", event: "run-rate + event", none: "belum ada" };
const STATUS_TONE: Record<string, string> = { LULUS: "better", GAGAL: "worse", PERIKSA: "worse", "BELUM DIISI": "muted", STALE: "worse", "N/A": "muted" };

/**
 * PRD v4 §6.6 Finance · Biaya tetap & driver (flag v4_design): template 8.3 edited inline, drivers per account, one-off
 * costs (cost_event), the fixed lines' outlook of the month and C33 / C34 / C43. Finance and Admin only.
 */
export async function BiayaV4({ first, viewer }: { first: string; viewer: Viewer }) {
  const { weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const d = await loadMonthDrivers(sb, first, jakartaToday());
  const events = await fetchAll<Row>((a, b) => sb.from("cost_event").select("*").is("deleted_at", null).gte("date", d.first).lte("date", d.last).order("date").range(a, b));
  const tot = fixedTotals(d.fixed);
  const carried = new Set(d.carried.map((c) => c.row.pl_line));
  const month = d.month;
  const prev = addDays(first, -1).slice(0, 7), next = addDays(d.last, 1).slice(0, 7);
  const fixedCoa = d.coa.filter((c) => c.driver_type === "fixed");
  const costLines = [...new Set(d.coa.filter((c) => c.pl_line && !String(c.pl_line).startsWith("Revenue") && c.pl_line !== "Other Income").map((c) => String(c.pl_line)))].sort();

  const oCols: Col[] = [
    { key: "l", label: "Pos P&L", kind: "key" }, { key: "s", label: "Input bulan", num: true }, { key: "a", label: `Actual s.d. ${tglShort(d.through)}`, num: true },
    { key: "r", label: "Sisa", num: true }, { key: "o", label: "Outlook", num: true, kind: "key" }, { key: "n", label: "Catatan", kind: "sup" },
  ];
  const oRows: TRow[] = d.fixed.map((l) => ({
    id: l.pl_line,
    cells: {
      l: l.pl_line, s: jtV4(l.scheduled), a: jtV4(l.actual_mtd), r: jtV4(l.remaining), o: jtV4(l.outlook),
      n: [carried.has(l.pl_line) ? "belum diperbarui (nominal bulan lalu)" : "", l.missing.length ? `belum bernominal: ${l.missing.join(", ")}` : "", l.over ? "melebihi input" : "", l.day_basis === "working" ? "dibagi hari kerja" : ""].filter(Boolean).join(" · "),
    },
  }));
  if (oRows.length) oRows.push({ id: "total", kind: "total", cells: { l: "Total", s: jtV4(tot.scheduled), a: jtV4(tot.actual_mtd), r: jtV4(tot.outlook.minus(tot.actual_mtd)), o: jtV4(tot.outlook), n: "" } });

  const cCols: Col[] = [{ key: "c", label: "Kontrol", kind: "key" }, { key: "n", label: "Isi" }, { key: "s", label: "Status" }, { key: "a", label: "Tindakan", kind: "sup" }];
  const cRows: TRow[] = d.controls.map((c: ControlV3) => ({
    id: c.code,
    cells: { c: c.code, n: c.name, s: <span className={STATUS_TONE[c.status] ?? ""}>{c.status}</span>, a: [c.action, c.detail.slice(0, 4).join(", ")].filter(Boolean).join(": ") },
  }));

  const eCols: Col[] = [{ key: "d", label: "Tanggal", kind: "key" }, { key: "l", label: "Pos P&L" }, { key: "a", label: "Jumlah (Rp jt)", num: true }, { key: "r", label: "Alasan" }, { key: "o", label: "Pemilik", kind: "sup" }, { key: "x", label: "" }];
  const eRows: TRow[] = events.map((e) => ({
    id: String(e.id),
    cells: {
      d: tglShort(String(e.date)), l: String(e.pl_line), a: jtV4(String(e.amount)), r: String(e.reason), o: String(e.owner ?? ""),
      x: <ActionForm v4 action={deleteCostEventAction} submit="Hapus" confirm="Hapus biaya satu kali ini?"><input type="hidden" name="id" value={String(e.id)} /><input type="hidden" name="month" value={month} /></ActionForm>,
    },
  }));

  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/m">
      <h1 className="sr-only">Biaya tetap dan driver {monthName(first)}</h1>
      <div className="fin">
        <nav className="seg" aria-label="Bulan"><span className="seg-l">Bulan</span><a href={`/m/${prev}/biaya`}>{monthName(`${prev}-01`)}</a><a href={`/m/${month}/biaya`} aria-current="true">{monthName(first)}</a><a href={`/m/${next}/biaya`}>{monthName(`${next}-01`)}</a></nav>
        <h2>Outlook pos tetap {monthName(first)} (Rp jt)</h2>
        <p className="muted">Biaya harian normal = nominal bulan ÷ hari (kalender atau kerja) bulan itu; outlook = actual MTD + sisa input yang belum dibukukan, tidak pernah dobel. Baris tanpa input bulan ini memakai nominal bulan lalu dengan label &quot;belum diperbarui&quot; (C43).</p>
        <V4Table cols={oCols} rows={oRows} label="Outlook pos tetap" empty="belum ada baris biaya tetap untuk bulan ini" />
        <h2>Kontrol biaya</h2>
        <V4Table cols={cCols} rows={cRows} label="Kontrol biaya" />
      </div>

      <div className="fin">
        <h2>Template 8.3: biaya tetap per COA per periode</h2>
        <p className="muted">Satu baris per COA berdriver Tetap. Nominal yang berubah menaikkan versi dan butuh alasan di catatan. Upload massal lewat Upload → &quot;Finance — biaya tetap (template 8.3)&quot;.</p>
        <table>
          <thead><tr><th>COA</th><th>Pos P&amp;L</th><th className="n">Nominal / bulan</th><th>Berlaku dari</th><th>Sampai</th><th>Basis bagi</th><th>Posting</th><th>Dasar</th><th>Pemilik</th><th>Versi</th><th>Catatan</th></tr></thead>
          <tbody>
            {d.schedule.filter((r) => r.active).map((r) => (
              <tr key={r.id}><td colSpan={11}>
                <ActionForm v4 action={saveFixedV4Action} submit="Simpan">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="month" value={month} />
                  <input name="account" defaultValue={r.account ?? ""} size={8} placeholder="COA" aria-label="COA" />
                  <span className="muted">{r.pl_line}</span>
                  <input name="amount_per_month" defaultValue={String(r.amount_per_month ?? monthlyAmount(r)?.toFixed(2) ?? "")} size={12} placeholder="nominal" aria-label="Nominal per bulan" />
                  <input name="start_date" defaultValue={r.start_date} size={10} aria-label="Berlaku dari" />
                  <input name="end_date" defaultValue={r.end_date ?? ""} size={10} placeholder="terbuka" aria-label="Berlaku sampai" />
                  <select name="day_basis" defaultValue={r.day_basis ?? "calendar"} aria-label="Basis bagi"><option value="calendar">hari kalender</option><option value="working">hari kerja</option></select>
                  <input name="posting_day" defaultValue={r.posting_day === null || r.posting_day === undefined ? "" : String(r.posting_day)} size={2} placeholder="tgl" aria-label="Jadwal posting" />
                  <input name="basis_doc" defaultValue={r.basis_doc ?? ""} size={20} placeholder="dasar" aria-label="Dasar" />
                  <input name="owner" defaultValue={r.owner ?? ""} size={8} placeholder="pemilik" aria-label="Pemilik" />
                  <span className="muted">v{r.version ?? 1}</span>
                  <input name="note" defaultValue={String(r.note ?? "")} size={24} placeholder="alasan perubahan" aria-label="Catatan" />
                </ActionForm>
              </td></tr>
            ))}
            <tr><td colSpan={11}>
              <ActionForm v4="primary" action={saveFixedV4Action} submit="Tambah baris">
                <input type="hidden" name="month" value={month} />
                <select name="account" aria-label="COA" defaultValue="">{[<option key="" value="">COA berdriver Tetap…</option>, ...fixedCoa.map((c) => <option key={String(c.account)} value={String(c.account)}>{String(c.account)} · {String(c.pl_line)}</option>)]}</select>
                <input name="amount_per_month" size={12} placeholder="nominal / bulan" aria-label="Nominal per bulan" />
                <input name="start_date" size={10} placeholder="dari YYYY-MM-DD" aria-label="Berlaku dari" />
                <input name="end_date" size={10} placeholder="sampai" aria-label="Berlaku sampai" />
                <select name="day_basis" defaultValue="calendar" aria-label="Basis bagi"><option value="calendar">hari kalender</option><option value="working">hari kerja</option></select>
                <input name="posting_day" size={2} placeholder="tgl" aria-label="Jadwal posting" />
                <input name="basis_doc" size={20} placeholder="dasar (kontrak, payroll…)" aria-label="Dasar" />
                <input name="owner" size={8} placeholder="pemilik" aria-label="Pemilik" />
                <input name="note" size={20} placeholder="catatan" aria-label="Catatan" />
              </ActionForm>
            </td></tr>
          </tbody>
        </table>
      </div>

      <div className="fin">
        <h2>Biaya satu kali (event) {monthName(first)}</h2>
        <p className="muted">Dicatat terpisah dan tidak masuk rata-rata run-rate. Jumlah ditulis positif sebagai biaya.</p>
        <V4Table cols={eCols} rows={eRows} label="Biaya satu kali" empty="belum ada biaya satu kali bulan ini" />
        <ActionForm v4="primary" action={costEventAction} submit="Catat biaya satu kali">
          <input type="hidden" name="month" value={month} />
          <input name="date" size={10} placeholder="YYYY-MM-DD" aria-label="Tanggal" />
          <select name="pl_line" aria-label="Pos P&L" defaultValue="">{[<option key="" value="">Pos P&amp;L…</option>, ...costLines.map((l) => <option key={l} value={l}>{l}</option>)]}</select>
          <input name="amount" size={12} placeholder="jumlah Rp" aria-label="Jumlah" />
          <input name="reason" size={28} placeholder="alasan" aria-label="Alasan" />
          <input name="document_ref" size={12} placeholder="dokumen" aria-label="Dokumen" />
        </ActionForm>
      </div>

      <div className="fin">
        <h2>Driver per akun biaya</h2>
        <table>
          <thead><tr><th>Akun</th><th>Nama</th><th>Pos P&amp;L</th><th>Driver</th><th className="n">Actual MTD pos (Rp jt)</th></tr></thead>
          <tbody>{d.coa.filter((c) => c.pl_line && !String(c.pl_line).startsWith("Revenue") && c.pl_line !== "Other Income").map((c) => (
            <tr key={String(c.account)}><td>{String(c.account)}</td><td>{String(c.name ?? "")}</td><td>{String(c.pl_line)}</td>
              <td><ActionForm v4 action={saveDriverAction} submit="Simpan">
                <input type="hidden" name="account" value={String(c.account)} /><input type="hidden" name="month" value={month} />
                <select name="driver_type" defaultValue={String(c.driver_type ?? "none")} aria-label="Driver">{Object.entries(DRIVER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="driver_basis" defaultValue={String(c.driver_basis ?? "")} aria-label="Basis kg"><option value="">basis kg…</option><option value="kg_cut">kg potong</option><option value="kg_sold">kg jual</option><option value="kg_lb">kg LB</option></select>
                <input name="rp_per_kg" defaultValue={c.rp_per_kg === null || c.rp_per_kg === undefined ? "" : String(c.rp_per_kg)} size={8} placeholder="Rp/kg" aria-label="Rp per kg" />
                <label><input type="checkbox" name="intercompany" defaultChecked={c.intercompany === true} /> afiliasi</label>
              </ActionForm></td>
              <td className="n">{d.actual[String(c.pl_line)] ? jtV4(d.actual[String(c.pl_line)]) : ""}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Shell>
  );
}
