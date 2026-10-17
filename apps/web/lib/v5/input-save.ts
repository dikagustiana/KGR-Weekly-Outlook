import "server-only";
/**
 * K34 save (PRD v5 §4.9): the server validates the raw grid again with the shared module and the context it builds
 * itself, refuses when the result differs from the preview (fingerprint), keeps only the rows without `fail`, writes
 * them idempotently (line keys) and queues the rebuild of the dates they touch. Values are written as the engine
 * normalised them (decimal text); nothing is computed here.
 */
import { createHash } from "node:crypto";
import { D, addDays, normalizeGrid, type Grid, type UploadKindV5, type UploadRecord, type UploadResult } from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { fetchAll, listWeeks, type WeekRow } from "../data";
import { WriteError } from "../write";
import { queueThroughNote } from "../rebuild";
import { clock } from "../clock";
import { inChunks, must, mustRows } from "../loader";
import { advanceUpdateDate } from "../update-date";
import { moduleSettings } from "../modules";
import { floorGuard, consumeApprovals } from "../v3/discount";
import { v3Kind, weekOfDate, type Row } from "../v3/uploads";
import "../v3/costing";
import { UploadRejected, recheck } from "./input-check";
import { uploadContext } from "./input-data";
import { ROLE_KINDS, kindLabel } from "./input";
import { poLinesInScope } from "./po-lines";

interface Committed { inserted: number; updated: number; held: string[]; dates: string[]; note: string }
const ok = (r: UploadResult) => r.records.filter((x) => x.level !== "fail");
const v = (x: UploadRecord, k: string) => x.data[k] ?? null;
/** floorGuard refuses a line below the floor after filing the approval request (C38); any other error is an error (K41). */
const belowFloorFiled = (e: unknown) => e instanceof WriteError && e.message.startsWith("Harga di bawah lantai");
const monthEnd = (first: string) => addDays(addDays(first, 32).slice(0, 8) + "01", -1);

export async function saveUploadV5(sb: Supa, viewer: Viewer, x: { kind: UploadKindV5; grid: Grid; fingerprint: string; fileName: string; reason: string }): Promise<string> {
  if (!(ROLE_KINDS[viewer.role] ?? []).includes(x.kind)) throw new WriteError(`Peran Anda tidak mengunggah ${kindLabel(x.kind)}`);
  const ctx = await uploadContext(sb, viewer, x.kind);
  let r: UploadResult;
  try { r = recheck(x.kind, x.grid, x.fingerprint, ctx); } catch (e) { throw new WriteError(e instanceof UploadRejected ? e.message : String(e)); }
  if (!r.ok_count) throw new WriteError("Tidak ada baris yang lolos cek; perbaiki file lalu cek ulang");
  const reason = x.reason.trim();
  if (r.needsReason.length && reason.length < 10) throw new WriteError(`Batch ${r.needsReason.join(", ")}: selisih hasil potong di atas toleransi C22 — tulis alasan (minimal 10 karakter: susut, timbangan, by-product tidak tercatat)`);

  const weeks = await listWeeks(sb);
  // K38: the upload belongs to the week of the wall date
  const today = (await clock(sb)).wall;
  const week = weekOfDate(weeks, today);
  const sha = createHash("sha256").update(JSON.stringify(normalizeGrid(x.grid))).digest("hex");
  const batches = [...new Set(ok(r).map((q) => v(q, "batch_ref")).filter((q): q is string => !!q))];
  const ins = await sb.from("upload").insert({
    week_id: week?.id ?? null, kind: x.kind, file_name: x.fileName.slice(0, 200) || `${x.kind}.xlsx`, file_sha256: sha, status: "staged", uploaded_by: viewer.email,
    row_count: r.total, ok_count: r.ok_count, checks: r.checks, preview_fingerprint: x.fingerprint,
    issues: r.rows.filter((q) => q.level === "fail").map((q) => `${q.ref}: ${q.action}`),
    date_from: r.dates[0] ?? null, date_to: r.dates[r.dates.length - 1] ?? null,
    plan: { v5: true, needsReason: r.needsReason, reason: reason || null, batches },
  }).select("id").single();
  if (ins.error) throw new WriteError(`upload: ${ins.error.message}`);
  const uploadId = String((ins.data as Row).id);

  let c: Committed;
  try {
    c = await COMMIT[x.kind]({ sb, viewer, r, uploadId, weeks, week, reason, today, customers: ctx.customers ?? "all" });
  } catch (e) {
    await sb.from("upload").update({ status: "failed", message: e instanceof Error ? e.message : String(e) }).eq("id", uploadId);
    throw e;
  }
  // K39: WP of a batch moves the update date of its open week to the day after the batch
  const moved = x.kind === "costing_wp" ? await advanceUpdateDate(sb, weeks, c.dates) : "";
  // K40: the dates touched through the date the data stands on; the rows are saved already, so a range over 62 days
  // is reported in the message (rebuild by Admin) instead of failing the saved upload
  const queue = await queueThroughNote(sb, [...r.dates, ...c.dates], `upload v5 ${x.kind}`);
  const message = `${r.ok_count} dari ${r.total} baris lolos cek; ${c.inserted} baru, ${c.updated} diubah${c.held.length ? `; ${c.held.length} ditahan (${c.held.slice(0, 3).join("; ")}${c.held.length > 3 ? "; …" : ""})` : ""}. ${c.note}${moved ? ` ${moved}.` : ""}${queue}`.trim();
  must(await sb.from("upload").update({ status: "committed", committed_at: new Date().toISOString(), inserted: c.inserted, updated: c.updated, message }).eq("id", uploadId), "upload committed");
  return message;
}

type Ctx = { sb: Supa; viewer: Viewer; r: UploadResult; uploadId: string; weeks: WeekRow[]; week: WeekRow | null; reason: string; today: string; customers: "all" | string[] };

const COMMIT: Record<UploadKindV5, (c: Ctx) => Promise<Committed>> = {
  // PO lines → Order lines (Confirmed). Below the floor: a pending discount request (C38) instead of the line until approved.
  async po_lines({ sb, viewer, r, uploadId, weeks, customers }) {
    const settings = await moduleSettings();
    const n = new Map<string, number>();
    const keyOf = (q: UploadRecord) => {
      const base = `${v(q, "po_ref")}|${v(q, "item_code")}`;
      const i = (n.get(base) ?? 0) + 1;
      n.set(base, i);
      return `${base}|${i}`;
    };
    // line keys over every file row (failing ones too), so a row fixed later keeps its key
    const keyed = r.records.map((q) => ({ q, line_key: keyOf(q) }));
    const pos = [...new Set(r.records.map((q) => v(q, "po_ref")).filter((p): p is string => !!p))];
    // R7: only this channel's lines of the PO × customer pairs in the file (and, for Sales, of their customers)
    const found = pos.length ? await fetchAll<Row>((a, b) => sb.from("sales_line").select("id, line_key, po_ref, customer").eq("status", "Order").in("po_ref", pos).is("deleted_at", null).range(a, b)) : [];
    const existing = poLinesInScope(found, r.records.map((q) => ({ po_ref: v(q, "po_ref"), customer: v(q, "customer") })), customers);
    const byKey = new Map(existing.map((e) => [String(e.line_key), e]));
    let inserted = 0, updated = 0;
    const held: string[] = [], dates: string[] = [];
    let toApproval = 0;
    for (const { q, line_key } of keyed.filter((k) => k.q.level !== "fail")) {
      const date = v(q, "delivery_date")!, w = weekOfDate(weeks, date);
      if (!w) { held.push(`${v(q, "po_ref")}: minggu ${date} belum ada`); continue; }
      if (w.status === "closed") { held.push(`${v(q, "po_ref")}: minggu ${w.week_start} sudah ditutup`); continue; }
      const rec = {
        week_id: w.id, date, status: "Order", document_ref: v(q, "po_ref"), customer: v(q, "customer"), item_code: v(q, "item_code"), key_manual: null,
        kg: D(v(q, "kg")!).toFixed(2), price: D(v(q, "price")!).toFixed(4), source: "Manual", line_key, upload_id: uploadId,
        delivery_date: date, demand_status: "Confirmed", po_ref: v(q, "po_ref"), size_kg: v(q, "size_kg"),
      };
      let covered: string[] = [];
      if (v(q, "below_floor") && settings.m7_approval?.enabled) {
        try { covered = (await floorGuard(sb, viewer, settings, [{ key: v(q, "key"), customer: v(q, "customer"), price: rec.price, kg: rec.kg, date }])).covered; }
        catch (e) { if (!belowFloorFiled(e)) throw e; toApproval++; continue; } // the request is filed; the line waits for the commercial lead
      }
      const old = byKey.get(line_key);
      const e = old ? await sb.from("sales_line").update(rec).eq("id", String(old.id)).select("id").single() : await sb.from("sales_line").insert(rec).select("id").single();
      if (e.error) {
        if (/C38/.test(e.error.message) && settings.m7_approval?.enabled) {
          try { await floorGuard(sb, viewer, settings, [{ key: v(q, "key"), customer: v(q, "customer"), price: rec.price, kg: rec.kg, date }]); } catch (f) { if (!belowFloorFiled(f)) throw f; }
          toApproval++;
          continue;
        }
        throw new WriteError(`sales_line ${line_key}: ${e.error.message}`);
      }
      if (covered.length) await consumeApprovals(sb, covered, String((e.data as Row).id));
      if (old) updated++; else inserted++;
      dates.push(date);
    }
    // lines of these POs (and customers) that are no longer in the file at all
    const inFile = new Set(keyed.map((k) => k.line_key));
    const gone = existing.filter((e) => !inFile.has(String(e.line_key)));
    if (gone.length) {
      const e = await sb.from("sales_line").update({ deleted_at: new Date().toISOString() }).in("id", gone.map((g) => String(g.id)));
      if (e.error) throw new WriteError(`sales_line: ${e.error.message}`);
    }
    return { inserted, updated, held, dates, note: `Demand PPIC diperbarui${toApproval ? `; ${toApproval} baris di bawah lantai ke approval Kepala Sales (C38)` : ""}${gone.length ? `; ${gone.length} baris PO lama dihapus (soft)` : ""}.` };
  },

  // WP per batch → batch_output_sku (lot → sementara, v5/1 trigger); a gap outside C22 is saved with its reason
  async costing_wp({ sb, r, uploadId, reason }) {
    let inserted = 0;
    const held: string[] = [], dates: string[] = [];
    const byBatch = new Map<string, UploadRecord[]>();
    for (const q of ok(r)) byBatch.set(v(q, "batch_ref")!, [...(byBatch.get(v(q, "batch_ref")!) ?? []), q]);
    for (const [ref, qs] of byBatch) {
      const b = must(await sb.from("batch").select("id, date").eq("batch_ref", ref).eq("status", "Aktual").is("deleted_at", null).is("superseded_at", null).limit(1).maybeSingle(), `WP batch ${ref}`);
      if (!b) { held.push(`batch ${ref}: belum ada sebagai batch aktual`); continue; }
      const bid = String((b as Row).id);
      const agg = new Map<string, { key: string; item_code: string; item_name: string | null; kg: ReturnType<typeof D> }>();
      for (const q of qs) {
        const k = `${v(q, "key")}|${v(q, "item_code")}`;
        const a = agg.get(k) ?? { key: v(q, "key")!, item_code: v(q, "item_code")!, item_name: v(q, "item_name"), kg: D(0) };
        a.kg = a.kg.plus(D(v(q, "kg")!));
        agg.set(k, a);
      }
      const note = r.needsReason.includes(ref) ? `alasan selisih hasil potong: ${reason}` : null;
      const rows = [...agg.values()].map((a) => ({ batch_id: bid, key: a.key, item_code: a.item_code, item_name: a.item_name, kg: a.kg.toFixed(2), source: "WP", upload_id: uploadId, deleted_at: null, note }));
      const e = await sb.from("batch_output_sku").upsert(rows, { onConflict: "batch_id,key,item_code" });
      if (e.error) throw new WriteError(`batch_output_sku ${ref}: ${e.error.message}`);
      inserted += rows.length;
      const old = mustRows<Row>(await sb.from("batch_output_sku").select("id, key, item_code, source").eq("batch_id", bid).is("deleted_at", null), `WP batch ${ref} output lama`);
      const keep = new Set([...agg.keys()]);
      const gone = old.filter((o) => (o.source === "WP" && !keep.has(`${o.key}|${o.item_code}`)) || o.source === "manual").map((o) => String(o.id));
      if (gone.length) { const d = await sb.from("batch_output_sku").update({ deleted_at: new Date().toISOString() }).in("id", gone); if (d.error) throw new WriteError(d.error.message); }
      const u = await sb.from("batch").update({ costing_status: "uploaded" }).eq("id", bid);
      if (u.error) throw new WriteError(`batch ${ref}: ${u.error.message}`);
      dates.push(String((b as Row).date));
    }
    return { inserted, updated: 0, held, dates, note: `Lot batch ${[...byBatch.keys()].join(", ")} → sementara; PPIC dan Commercial membaca biaya baru setelah rebuild.${r.needsReason.length ? " Selisih hasil potong tercatat dengan alasan; batch tetap sementara." : ""}` };
  },

  async yield_matrix({ sb, r, uploadId }) {
    const rows = ok(r).map((q) => ({ weight_class: v(q, "weight_class"), cut_pattern: v(q, "cut_pattern"), key: v(q, "key"), yield_pct: v(q, "yield_pct"), effective_from: v(q, "effective_from"), upload_id: uploadId, deleted_at: null, note: null }));
    const e = await sb.from("yield_matrix").upsert(rows, { onConflict: "weight_class,cut_pattern,key,effective_from" });
    if (e.error) throw new WriteError(`yield_matrix: ${e.error.message}`);
    return { inserted: rows.length, updated: 0, held: [], dates: [], note: "Yield per kelas menggantikan placeholder C42; kg LB per kelas dihitung ulang." };
  },

  async lb_supply({ sb, r, uploadId }) {
    const rows = ok(r).map((q) => ({
      date: v(q, "date"), supplier: v(q, "supplier"), weight_class: v(q, "weight_class"), head_count: v(q, "head_count") === null ? null : Math.round(Number(v(q, "head_count"))),
      kg: D(v(q, "kg")!).toFixed(2), price_per_kg: v(q, "price_per_kg") === null ? null : D(v(q, "price_per_kg")!).toFixed(4), status: "confirmed", upload_id: uploadId, deleted_at: null,
    }));
    const e = await sb.from("lb_supply").upsert(rows, { onConflict: "date,supplier,weight_class" });
    if (e.error) throw new WriteError(`lb_supply: ${e.error.message}`);
    return { inserted: rows.length, updated: 0, held: [], dates: [...new Set(rows.map((q) => String(q.date)))], note: "Supply per kelas tersimpan (confirmed); C58 dicek ulang di layar PPIC." };
  },

  async fixed_cost({ sb, r }) {
    const accounts = [...new Set(ok(r).map((q) => v(q, "account")!))];
    const coa = await inChunks(accounts, async (part) => mustRows<Row>(await sb.from("coa_map").select("account, name, pl_line").in("account", part), "fixed_cost coa_map"));
    const plOf = new Map(coa.map((c) => [String(c.account), c]));
    const held: string[] = [];
    const rows = ok(r).flatMap((q) => {
      const c = plOf.get(v(q, "account")!);
      if (!c || !c.pl_line) { held.push(`${v(q, "account")}: COA tanpa baris P&L`); return []; }
      return [{
        code: v(q, "code"), pl_line: String(c.pl_line), account: v(q, "account"), description: [v(q, "basis"), v(q, "note") ?? (c.name ? String(c.name) : null)].filter(Boolean).join(" · ") || "jadwal Finance",
        amount_per_month: D(v(q, "amount")!).toFixed(2), start_date: v(q, "month"), end_date: monthEnd(v(q, "month")!), active: true, source: "Manual", deleted_at: null,
      }];
    });
    if (rows.length) { const e = await sb.from("fixed_cost_schedule").upsert(rows, { onConflict: "code" }); if (e.error) throw new WriteError(`fixed_cost_schedule: ${e.error.message}`); }
    return { inserted: rows.length, updated: 0, held, dates: [...new Set(rows.map((q) => String(q.start_date)))], note: `Jadwal beban tetap ${rows.length} baris menggantikan estimasi bulan lalu (C55).` };
  },

  // invoices → cost pool lines (the v3 PI commit: a PI replaces the WP cost of the same document) + invoice status
  async supplier_invoice({ sb, viewer, r, uploadId, week, weeks }) {
    const pi = v3Kind("cost_pool_pi");
    if (!pi) throw new WriteError("Jenis cost_pool_pi tidak terdaftar");
    const w = week ?? weeks[0];
    if (!w) throw new WriteError("Belum ada minggu");
    const rows = ok(r).map((q) => ({ target: "pi", data: { document_ref: v(q, "document_ref"), date: v(q, "date"), supplier: v(q, "supplier"), component: "LB", amount: v(q, "amount"), batch_ref: v(q, "batch_ref"), description: `Faktur LB batch ${v(q, "batch_ref")}${v(q, "kg") ? ` · ${v(q, "kg")} kg` : ""}` } as Row }));
    const res = await pi.commit({ sb, viewer, week: w, uploadId, rows });
    let tied = 0;
    for (const q of ok(r)) {
      const st = v(q, "tied") ? "tied" : "received";
      if (st === "tied") tied++;
      const q2 = sb.from("batch").update({ invoice_status: st }).eq("batch_ref", v(q, "batch_ref")!).eq("status", "Aktual").is("deleted_at", null);
      const e = st === "tied" ? await q2 : await q2.eq("invoice_status", "pending");
      if (e.error) throw new WriteError(`batch ${v(q, "batch_ref")}: ${e.error.message}`);
    }
    return { inserted: res.inserted, updated: res.updated, held: [], dates: [...new Set(ok(r).map((q) => v(q, "batch_date")).filter((d): d is string => !!d))], note: `${tied} faktur tie ke GL (biaya batch final); ${ok(r).length - tied} masih sementara.` };
  },
};
