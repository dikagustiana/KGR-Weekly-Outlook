import "server-only";
/**
 * Upload kind `delivery` (PRD v4 §4.4, K7): one CSV row per delivery of a PO line — no_po, kode_item, tgl, kg,
 * no_dokumen. Each row is matched to the open Order line(s) of that PO and item (earliest delivery date first); the kg
 * may not exceed what is outstanding (kg − delivered − cancelled). A document already recorded on the line is skipped,
 * so the same file can be uploaded twice. The database keeps fulfilled_kg = Σ delivery and refuses more than the line.
 */
import { D, deliveryCheck, outstandingKg, toFixedString, type Decimal } from "@kgr/engine";
import { parseV3Table } from "@kgr/parsers";
import { fetchAll } from "../data";
import { applyChanges, WriteError } from "../write";
import { plan0, registerV3Kind, type Row } from "../v3/uploads";
import { inChunks, must } from "../loader";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

registerV3Kind({
  kind: "delivery", module: "m3_planning", label: "Sales — pengiriman per PO (CSV)", source: "Manual",
  target: "delivery", roles: ["admin", "inventory_accounting", "sales", "commercial_lead"],
  description: "Kolom no_po, kode_item, tgl, kg, no_dokumen. Satu baris per pengiriman; kg tidak boleh melebihi sisa order. Nomor dokumen yang sudah tercatat pada baris PO dilewati, jadi file yang sama aman diunggah ulang.",
  async stage({ sb, sheets }) {
    const p = parseV3Table("delivery", sheets);
    const issues = [...p.issues];
    const ok = p.rows.filter((r) => !r.issues.length);
    const pos = [...new Set(ok.map((r) => String(r.values.po_ref).trim()))];
    const lines = pos.length ? await inChunks(pos, (c) => fetchAll<Row>((a, b) => sb.from("sales_line").select("id, po_ref, item_code, delivery_date, kg, fulfilled_kg, cancelled_kg, status").in("po_ref", c).eq("status", "Order").is("deleted_at", null).is("superseded_at", null).order("delivery_date").order("id").range(a, b))) : [];
    const done = lines.length ? await inChunks(lines.map((l) => String(l.id)), (c) => fetchAll<Row>((a, b) => sb.from("delivery").select("sales_line_id, document_ref").in("sales_line_id", c).is("deleted_at", null).order("id").range(a, b))) : [];
    const recorded = new Set(done.map((x) => `${String(x.sales_line_id)}|${s(x.document_ref) ?? ""}`));
    // outstanding per line, reduced as the rows of this file take it
    const left = new Map<string, Decimal>(lines.map((l) => [String(l.id), outstandingKg({ kg: String(l.kg), fulfilled_kg: s(l.fulfilled_kg), cancelled_kg: s(l.cancelled_kg) })]));
    const rows: { target: string; data: Row }[] = [];
    let skipped = 0;
    for (const r of ok) {
      const v = r.values as Record<string, string | null>;
      const po = String(v.po_ref).trim(), item = String(v.item_code).trim(), doc = String(v.document_ref).trim();
      const cands = lines.filter((l) => String(l.po_ref) === po && String(l.item_code) === item);
      if (!cands.length) { issues.push(`Baris ${r.rowNo}: PO ${po} item ${item} tidak punya order terbuka`); continue; }
      if (cands.some((l) => recorded.has(`${String(l.id)}|${doc}`))) { skipped += 1; continue; }
      let need = D(String(v.kg));
      if (!need.gt(0)) { issues.push(`Baris ${r.rowNo}: kg harus lebih dari 0`); continue; }
      const total = cands.reduce((a, l) => a.plus(left.get(String(l.id)) ?? D(0)), D(0));
      if (need.gt(total)) { issues.push(`Baris ${r.rowNo}: ${need.toFixed(2)} kg melebihi sisa order ${total.toFixed(2)} kg (PO ${po}, ${item})`); continue; }
      for (const l of cands) {
        if (!need.gt(0)) break;
        const id = String(l.id), have = left.get(id) ?? D(0);
        if (!have.gt(0)) continue;
        const take = need.lt(have) ? need : have;
        left.set(id, have.minus(take));
        need = need.minus(take);
        rows.push({ target: "delivery", data: { sales_line_id: id, date: v.date, kg: toFixedString(take, 2), document_ref: doc, po_ref: po, item_code: item } });
      }
    }
    const pl = plan0("delivery", "Pengiriman", [skipped ? `${skipped} baris sudah tercatat, dilewati` : "", rows.length ? "ledger stok dan alokasi dibangun ulang untuk tanggal kirim" : ""].filter(Boolean));
    pl.inserts = rows.length; pl.unchanged = skipped;
    const dates = rows.map((x) => String(x.data.date)).sort();
    return { rows, plan: [pl], issues, note: `${rows.length} pengiriman`, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null, sample: rows.slice(0, 25).map((x) => x.data), unmappedItems: [] };
  },
  async commit({ sb, viewer, uploadId, rows }) {
    let n = 0;
    const closed: string[] = [];
    for (const r of rows) {
      const id = String(r.data.sales_line_id);
      const line = must(await sb.from("sales_line").select("kg, fulfilled_kg, cancelled_kg, status").eq("id", id).maybeSingle(), "uploads-ppic.sales_line");
      const l = line as Row | null;
      if (!l || l.status !== "Order") continue;
      const chk = deliveryCheck({ kg: String(l.kg), fulfilled_kg: String(l.fulfilled_kg ?? 0), cancelled_kg: String(l.cancelled_kg ?? 0) }, String(r.data.kg));
      if (!chk.ok) throw new WriteError(`PO ${String(r.data.po_ref)} ${String(r.data.item_code)}: ${chk.error}`);
      const e = await sb.from("delivery").insert({ sales_line_id: id, date: r.data.date, kg: r.data.kg, document_ref: r.data.document_ref, source: "Manual", upload_id: uploadId });
      if (e.error) {
        if (e.error.message.includes("delivery_line_document")) continue; // the same document arrived meanwhile
        throw new WriteError(`delivery: ${e.error.message}`);
      }
      n += 1;
      if (chk.closes) closed.push(id);
    }
    if (closed.length) await applyChanges(sb, "sales_line", [], closed.map((id) => ({ id, status: "Aktual", confirmed_by: viewer.email })));
    return { inserted: n, updated: closed.length, deleted: 0, dates: [...new Set(rows.map((r) => String(r.data.date)))], message: `${n} pengiriman dicatat${closed.length ? `, ${closed.length} order selesai` : ""}` };
  },
});
