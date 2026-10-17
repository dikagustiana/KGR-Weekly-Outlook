import "server-only";
import { createHash } from "node:crypto";
import { computeWeek, mondayOf } from "@kgr/engine";
import {
  KINDS, kindDef, parseUpload, parseWeekWorkbook, readWorkbook, type Mapping, type ParseResult, type StagedSet, type UploadKind,
} from "@kgr/parsers";
import type { Supa } from "./supabase";
import { fetchAll, listWeeks, loadWeek, type WeekRow } from "./data";
import { applyChanges, loadWeekInputs, WriteError } from "./write";
import type { Viewer } from "./session";
import { isModuleOn, type ModuleSettings } from "./modules-core";
import { V3_KINDS, v3Kind } from "./v3/uploads";
import { queueThroughNote } from "./rebuild";
import { must } from "./loader";
import { advanceUpdateDate } from "./update-date";
import "./v3/costing";

type Row = Record<string, unknown>;

/** v1 kinds, the workbook import, and the v3 kinds registered in lib/v3 (PRD v3 §5). */
export type AnyKind = UploadKind | "workbook" | (string & { readonly v3?: true });

export const WORKBOOK_KIND = {
  kind: "workbook" as const, label: "Workbook KGR Weekly Outlook (.xlsx)", source: "Manual", target: "semua tabel minggu",
  description: "Impor seluruh input satu minggu dari file Excel KGR_Weekly_Outlook (I_* dan T_*). Minggu diambil dari I_Parameter (tanggal update). Hanya Admin.",
  roles: ["admin"],
};

export function kindsFor(role: string, settings: ModuleSettings = {}) {
  // PRD v3 §2: the head of sales may do everything sales may
  const as = role === "commercial_lead" ? ["commercial_lead", "sales"] : [role];
  const v3 = V3_KINDS.filter((k) => k.roles.includes(role as never) && isModuleOn(settings[k.module], role as never))
    .map((k) => ({ kind: k.kind, label: k.label, description: k.description, target: k.target, source: k.source, roles: k.roles as string[] }));
  return [...KINDS.filter((k) => k.roles.some((r) => as.includes(r)) && k.kind !== "batch_plan"), ...(role === "admin" ? [WORKBOOK_KIND] : []), ...v3];
}

export interface PlanTarget {
  table: string;
  label: string;
  inserts: Row[];
  updates: Row[];
  deletes: string[];
  supersede: string[];
  unchanged: number;
  notes: string[];
}

export interface Plan {
  targets: PlanTarget[];
  unmappedItems: { code: string; name: string | null; suggested: string | null }[];
  unmappedAccounts: { account: string; name: string | null }[];
  weekFlag?: string | null;
}

const same = (a: unknown, b: unknown) => {
  const na = a === undefined || a === "" ? null : a;
  const nb = b === undefined || b === "" ? null : b;
  if (na === null || nb === null) return na === nb;
  const x = Number(na), y = Number(nb);
  if (!Number.isNaN(x) && !Number.isNaN(y) && typeof na !== "boolean") return Math.abs(x - y) < 1e-9;
  return String(na) === String(nb);
};

const FIELDS: Record<string, string[]> = {
  sales_line: ["date", "status", "document_ref", "customer", "item_code", "key_manual", "kg", "price", "hpp_actual"],
  receipt_line: ["date", "status", "receipt_source", "document_ref", "supplier", "item_code", "key_manual", "kg", "unit_cost"],
  gl_line: ["date", "voucher_no", "voucher_type", "account", "account_name", "description", "debit", "credit", "party"],
  tb_opening: ["name", "balance"],
  batch: ["date", "status", "batch_ref", "supplier", "lb_kg", "lb_price", "freight", "maklon", "processed_kg", "out_karkas_fresh", "out_karkas_frozen",
    "out_kepala", "out_ceker", "out_usus", "out_hja", "out_lemak", "out_other"],
};

function diffRow(table: string, old: Row, neu: Row): Row | null {
  const patch: Row = {};
  if (neu.line_key && old.line_key !== neu.line_key && table !== "batch" && table !== "tb_opening") patch.line_key = neu.line_key;
  for (const f of FIELDS[table] ?? Object.keys(neu)) {
    if (!(f in neu)) continue;
    if (table === "sales_line" && f === "hpp_actual" && (neu[f] === null || neu[f] === undefined)) continue; // keep HPP from the ledger
    if (!same(old[f], neu[f])) patch[f] = neu[f] ?? null;
  }
  return Object.keys(patch).length ? { id: old.id, ...patch } : null;
}

/** Rows loaded before line keys existed (seed, workbook import) are matched on their content instead. */
function takeLegacy(pool: Row[], r: Row, seen: Set<string>, fields = ["date", "document_ref", "item_code", "kg"]): Row | undefined {
  const hit = pool.find((e) => !seen.has(String(e.id)) && fields.every((f) => same(e[f], r[f])));
  if (hit) seen.add(String(hit.id));
  return hit;
}

const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")));

/** Suggest a key for a new item code from words in its Accurate name (PRD §7 mapping maintenance). */
export function suggestKey(code: string, name: string | null, keys: string[]): string | null {
  const n = ` ${(name ?? "").toLowerCase()} `;
  const seg = /^trd/i.test(code) ? "Trading" : /^jlb/i.test(code) ? "RPA" : null;
  const sku = [
    ["BLDK", /bldk/], ["BLPK", /blpk/], ["BLD", /\bbld\b/], ["BLP", /\bblp\b/], ["KRK (Kerangka)", /kerangka|\bkrk\b/], ["Kulit", /kulit/],
    ["Paha (parting)", /paha|parting/], ["Sayap", /sayap|wing/], ["TLP", /\btlp\b/], ["Ceker", /ceker|feet/], ["HJA (Hati/Jantung/Ampela)", /hja|hati|ampela|jantung/],
    ["Kepala", /kepala|head/], ["Lemak", /lemak|fat/], ["Usus", /usus/], ["Karkas", /karkas|carcass|\buk\b/],
  ].find(([, re]) => (re as RegExp).test(n))?.[0] as string | undefined;
  if (!sku) return null;
  const form = /frozen|beku/.test(n) ? "Frozen" : /fresh|segar/.test(n) ? "Fresh" : "n/a";
  const cands = keys.filter((k) => k.split("|")[1] === sku && (!seg || k.startsWith(seg + "|")));
  return cands.find((k) => k.endsWith(`|${form}`)) ?? cands[0] ?? null;
}

export interface StageResult {
  uploadId: string;
  kind: AnyKind;
  fileName: string;
  sha: string;
  parse?: Pick<ParseResult, "issues" | "dateFrom" | "dateTo"> & { columns: string[]; mapping: Mapping | null; headerRow: number | null; sheet: string | null; rowCount: number; badRows: { rowNo: number; issues: string[] }[]; sample: Row[] };
  fields?: { field: string; label: string; required: boolean }[];
  plan: { table: string; label: string; inserts: number; updates: number; deletes: number; supersede: number; unchanged: number; notes: string[] }[];
  unmappedItems: Plan["unmappedItems"];
  unmappedAccounts: Plan["unmappedAccounts"];
  workbookWeek?: string;
  /** v3 kinds: one line describing what was read (shown instead of the header-detection line). */
  v3Note?: string;
  error?: string;
}

async function nextSeq(sb: Supa, table: string, weekId: string | null): Promise<number> {
  let q = sb.from(table).select("seq").order("seq", { ascending: false }).limit(1);
  if (weekId) q = q.eq("week_id", weekId);
  const { data } = await q.maybeSingle();
  return Number((data as Row | null)?.seq ?? 0);
}

async function activeRows(sb: Supa, table: string, weekId: string, filter?: (q: any) => any): Promise<Row[]> {
  return fetchAll<Row>((f, t) => {
    let q: any = sb.from(table).select("*").eq("week_id", weekId).is("deleted_at", null);
    if (filter) q = filter(q);
    return q.order("seq").range(f, t);
  });
}

/** Compute what a commit would change, per target table (idempotent re-uploads; PRD §7). */
export async function planUpload(sb: Supa, week: WeekRow, kind: UploadKind, sets: StagedSet[], viewer: Viewer): Promise<Plan> {
  const loaded = await loadWeek(sb, week.week_start);
  if (!loaded) throw new WriteError("Minggu tidak ada");
  const inputs = loaded.inputs;
  const itemKey = new Map(inputs.item_map.map((i) => [i.item_code.toUpperCase(), i.key]));
  const segOf = new Map(inputs.sku_keys.map((k) => [k.key.toUpperCase(), k.segment]));
  const keyList = inputs.sku_keys.map((k) => k.key);
  const accounts = new Set(inputs.coa_map.map((c) => c.account));
  const targets: PlanTarget[] = [];
  const unmappedItems = new Map<string, { code: string; name: string | null; suggested: string | null }>();
  const unmappedAccounts = new Map<string, { account: string; name: string | null }>();
  let weekFlag: string | null | undefined;
  const def = kindDef(kind);

  const noteItems = (rows: Row[]) => {
    for (const r of rows) {
      const code = r.item_code as string | null;
      if (!code || r.key_manual || itemKey.has(code.toUpperCase())) continue;
      unmappedItems.set(code, { code, name: (r._item_name as string) ?? (r.item_name as string) ?? null, suggested: suggestKey(code, (r._item_name as string) ?? (r.item_name as string) ?? null, keyList) });
    }
  };
  const keyOfRow = (r: Row) => (r.key_manual as string) ?? itemKey.get(String(r.item_code ?? "").toUpperCase()) ?? null;

  for (const set of sets) {
    const t: PlanTarget = { table: set.target, label: set.target, inserts: [], updates: [], deletes: [], supersede: [], unchanged: 0, notes: [] };
    const staged = set.rows.map((r) => ({ ...r }));
    const dates = staged.map((r) => r.date as string | null).filter((d): d is string => !!d).sort();
    const from = dates[0], to = dates[dates.length - 1];
    const inWeek = (d: unknown) => typeof d === "string" && d >= week.week_start && d <= week.week_end;

    if (set.target === "sales_line") {
      t.label = "Penjualan";
      noteItems(staged);
      const outside = staged.filter((r) => !inWeek(r.date)).length;
      if (outside) t.notes.push(`${outside} baris bertanggal di luar minggu ini (tetap disimpan; kontrol 6 akan PERIKSA)`);
      const existing = await activeRows(sb, "sales_line", week.id);
      const docs = new Set(staged.map((r) => r.document_ref).filter(Boolean) as string[]);
      if (kind === "orders") {
        const byKey = new Map(existing.filter((e) => e.status === "Order" && e.source === "Manual" && e.line_key).map((e) => [String(e.line_key), e]));
        for (const r of staged) {
          const old = byKey.get(String(r.line_key));
          if (!old) t.inserts.push(r);
          else { const d = diffRow("sales_line", old, r); if (d) t.updates.push(d); else t.unchanged++; }
        }
      } else {
        const src = def.source; // Accurate | Ops
        const scope = existing.filter((e) => e.source === src && e.status === "Aktual" && !e.superseded_at && typeof e.date === "string" && e.date >= from && e.date <= to);
        const byKey = new Map(scope.filter((e) => e.line_key).map((e) => [String(e.line_key), e]));
        const legacy = scope.filter((e) => !e.line_key);
        const accurateDocs = new Set(existing.filter((e) => e.source === "Accurate" && e.status === "Aktual").map((e) => e.document_ref as string));
        // PRD v4 K8: a spot sale stays a spot sale when its invoice (same document number) replaces the order / Ops row
        const spotDocs = new Set(existing.filter((e) => e.channel === "spot" && e.document_ref).map((e) => String(e.document_ref)));
        if (spotDocs.size) for (const r of staged) if (r.document_ref && spotDocs.has(String(r.document_ref))) r.channel = "spot";
        const seen = new Set<string>();
        for (const r of staged) {
          if (src === "Ops" && accurateDocs.has(r.document_ref as string)) { t.unchanged++; continue; }
          const old = byKey.get(String(r.line_key)) ?? takeLegacy(legacy, r, seen);
          if (old) { seen.add(String(old.id)); const d = diffRow("sales_line", old, r); if (d) t.updates.push(d); else t.unchanged++; }
          else t.inserts.push(r);
        }
        t.deletes.push(...scope.filter((e) => !seen.has(String(e.id))).map((e) => String(e.id)));
        const orders = existing.filter((e) => e.status === "Order" && docs.has(e.document_ref as string));
        if (orders.length) { t.deletes.push(...orders.map((e) => String(e.id))); t.notes.push(`${orders.length} order dengan nomor dokumen sama menjadi Aktual (baris order di-soft-delete)`); }
        if (src === "Accurate") {
          const ops = existing.filter((e) => e.source === "Ops" && !e.superseded_at && docs.has(e.document_ref as string));
          if (ops.length) { t.supersede.push(...ops.map((e) => String(e.id))); t.notes.push(`${ops.length} baris Ops diganti posting Accurate (disimpan untuk kontrol 20)`); }
        }
      }
    } else if (set.target === "receipt_line") {
      t.label = "Penerimaan";
      noteItems(staged);
      for (const r of staged) {
        if (!r.receipt_source) {
          const k = keyOfRow(r);
          const seg = k ? segOf.get(k.toUpperCase()) : undefined;
          r.receipt_source = seg === "RPA" ? "Produksi RPA" : seg === "Trading" ? "Beli Trading" : null;
          if (!r.receipt_source) t.notes.push(`Sumber penerimaan ${r.item_code ?? r.key_manual} tidak diketahui (key belum dipetakan)`);
        }
      }
      const existing = await activeRows(sb, "receipt_line", week.id);
      const docs = new Set(staged.map((r) => r.document_ref).filter(Boolean) as string[]);
      if (kind === "receipts_plan") {
        const byKey = new Map(existing.filter((e) => e.status === "Rencana" && e.source === "Manual" && e.line_key).map((e) => [String(e.line_key), e]));
        for (const r of staged) {
          const old = byKey.get(String(r.line_key));
          if (!old) t.inserts.push(r);
          else { const d = diffRow("receipt_line", old, r); if (d) t.updates.push(d); else t.unchanged++; }
        }
      } else if (kind === "ops_batch") {
        const refs = new Set(staged.map((r) => r.document_ref as string));
        const old = existing.filter((e) => e.source === "Ops" && e.receipt_source === "Produksi RPA" && refs.has(e.document_ref as string));
        t.deletes.push(...old.map((e) => String(e.id)));
        t.inserts.push(...staged);
        t.notes.push("Penerimaan Produksi RPA dari batch ops (biaya per kg output)");
      } else {
        const src = def.source;
        const scope = existing.filter((e) => e.source === src && e.status === "Aktual" && !e.superseded_at && typeof e.date === "string" && e.date >= from && e.date <= to
          && (kind !== "ops_receipts" || e.receipt_source === "Beli Trading"));
        const byKey = new Map(scope.filter((e) => e.line_key).map((e) => [String(e.line_key), e]));
        const legacy = scope.filter((e) => !e.line_key);
        const seen = new Set<string>();
        for (const r of staged) {
          const old = byKey.get(String(r.line_key)) ?? takeLegacy(legacy, r, seen);
          if (old) { seen.add(String(old.id)); const d = diffRow("receipt_line", old, r); if (d) t.updates.push(d); else t.unchanged++; }
          else t.inserts.push(r);
        }
        t.deletes.push(...scope.filter((e) => !seen.has(String(e.id))).map((e) => String(e.id)));
        if (src === "Accurate") {
          const ops = existing.filter((e) => e.source === "Ops" && !e.superseded_at && docs.has(e.document_ref as string));
          if (ops.length) { t.supersede.push(...ops.map((e) => String(e.id))); t.notes.push(`${ops.length} baris Ops diganti GRN Accurate`); }
        }
      }
    } else if (set.target === "sales_hpp") {
      t.table = "sales_line";
      t.label = "HPP aktual per baris penjualan (DO)";
      const existing = await activeRows(sb, "sales_line", week.id, (q) => q.eq("status", "Aktual"));
      for (const h of staged) {
        const lines = existing.filter((e) => e.document_ref === h.document_ref && String(e.item_code ?? "").toUpperCase() === String(h.item_code).toUpperCase());
        if (!lines.length) { t.unchanged++; continue; }
        const kgTot = lines.reduce((a, e) => a + Number(e.kg ?? 0), 0);
        let left = Number(h.hpp);
        lines.forEach((e, i) => {
          const share = i === lines.length - 1 ? left : Math.round((Number(h.hpp) * Number(e.kg ?? 0) / (kgTot || 1)) * 100) / 100;
          left = Math.round((left - share) * 100) / 100;
          if (!same(e.hpp_actual, share)) t.updates.push({ id: e.id, hpp_actual: share.toFixed(2) });
          else t.unchanged++;
        });
      }
      const matched = t.updates.length + t.unchanged;
      if (staged.length) t.notes.push(`${staged.length} dokumen DO di ledger; ${matched} baris penjualan dicocokkan`);
    } else if (set.target === "opening_stock") {
      t.label = "Stok awal";
      noteItems(staged);
      const existing = await activeRows(sb, "opening_stock", week.id);
      if (kind === "ops_stock_count") {
        const r0 = computeWeek(inputs);
        for (const r of staged) {
          const k = keyOfRow(r);
          const avg = k ? r0.stock.byKey.get(k.toUpperCase())?.avgCost : undefined;
          r.value = avg ? avg.times(String(r.kg)).toFixed(2) : null;
          if (!avg) t.notes.push(`Biaya rata-rata ${r.item_code} tidak diketahui — nilai kosong`);
        }
        weekFlag = "stock count EOD — nilai di biaya rata-rata terakhir, menunggu Inventory Valuation";
      } else weekFlag = null;
      t.deletes.push(...existing.map((e) => String(e.id)));
      t.inserts.push(...staged);
      t.notes.push(`Mengganti ${existing.length} baris stok awal minggu ini`);
    } else if (set.target === "gl_line") {
      t.label = "Jurnal (GL)";
      const old = await fetchAll<Row>((f, tt) => sb.from("gl_line").select("*").is("deleted_at", null).gte("date", from).lte("date", to).order("seq").range(f, tt));
      const byKey = new Map(old.filter((e) => e.line_key).map((e) => [String(e.line_key), e]));
      const legacyGl = old.filter((e) => !e.line_key);
      const seen = new Set<string>();
      for (const r of staged) {
        if (r.account && !accounts.has(String(r.account))) unmappedAccounts.set(String(r.account), { account: String(r.account), name: (r.account_name as string) ?? null });
        const e = byKey.get(String(r.line_key)) ?? takeLegacy(legacyGl, r, seen, ["date", "voucher_no", "account", "debit", "credit"]);
        if (e) { seen.add(String(e.id)); const d = diffRow("gl_line", e, r); if (d) t.updates.push(d); else t.unchanged++; }
        else t.inserts.push(r);
      }
      t.deletes.push(...old.filter((e) => !seen.has(String(e.id))).map((e) => String(e.id)));
      t.notes.push(`Rentang tanggal ${from} s.d. ${to} diganti (idempotent)`);
      const bal = staged.reduce((a, r) => a + Number(r.debit ?? 0) - Number(r.credit ?? 0), 0);
      if (Math.abs(bal) > 1) t.notes.push(`Jurnal tidak seimbang: selisih ${bal.toFixed(2)} (kontrol 13)`);
    } else if (set.target === "tb_opening") {
      t.label = "Neraca saldo awal";
      const existing = await activeRows(sb, "tb_opening", week.id);
      const byAcc = new Map(existing.map((e) => [String(e.account), e]));
      const seen = new Set<string>();
      for (const r of staged) {
        if (!accounts.has(String(r.account))) unmappedAccounts.set(String(r.account), { account: String(r.account), name: (r.name as string) ?? null });
        const e = byAcc.get(String(r.account));
        if (e) { seen.add(String(e.id)); const d = diffRow("tb_opening", e, r); if (d) t.updates.push(d); else t.unchanged++; }
        else t.inserts.push(r);
      }
      t.deletes.push(...existing.filter((e) => !seen.has(String(e.id))).map((e) => String(e.id)));
    } else if (set.target === "batch") {
      t.label = "Batch";
      const existing = await activeRows(sb, "batch", week.id);
      const status = kind === "batch_plan" ? "Rencana" : "Aktual";
      const scope = existing.filter((e) => e.status === status && e.source === def.source);
      const k = (r: Row) => String(r.batch_ref ?? `${r.date}|${r.supplier ?? ""}`);
      const byKey = new Map(scope.map((e) => [k(e), e]));
      const seen = new Set<string>();
      for (const r of staged) {
        const e = byKey.get(k(r));
        if (e) { seen.add(String(e.id)); const d = diffRow("batch", e, r); if (d) t.updates.push(d); else t.unchanged++; }
        else t.inserts.push(r);
      }
      if (kind === "ops_batch") t.deletes.push(...scope.filter((e) => !seen.has(String(e.id)) && typeof e.date === "string" && e.date >= from && e.date <= to).map((e) => String(e.id)));
    } else if (set.target === "cash_plan") {
      t.label = "Rencana kas";
      const existing = await activeRows(sb, "cash_plan", week.id);
      const sig = (r: Row) => [r.date, r.cf_category, r.bs_counter_line, r.description, Number(r.amount)].join("|");
      const have = new Set(existing.map(sig));
      for (const r of staged) (have.has(sig(r)) ? t.unchanged++ : t.inserts.push(r));
    }
    targets.push(t);
  }
  void viewer;
  return { targets, unmappedItems: [...unmappedItems.values()], unmappedAccounts: [...unmappedAccounts.values()], weekFlag };
}

function summary(p: Plan) {
  return p.targets.map((t) => ({ table: t.table, label: t.label, inserts: t.inserts.length, updates: t.updates.length, deletes: t.deletes.length, supersede: t.supersede.length, unchanged: t.unchanged, notes: t.notes }));
}

/** Parse the file from storage, plan the changes and stage the upload (status 'staged'). Nothing is written to input tables. */
export async function stageUpload(
  sb: Supa, viewer: Viewer, week: WeekRow, kind: AnyKind, path: string, fileName: string,
  opts: { mapping?: Mapping; makeProductionReceipts?: boolean },
): Promise<StageResult> {
  const dl = await sb.storage.from("uploads").download(path);
  if (dl.error || !dl.data) throw new WriteError(`File tidak terbaca dari storage: ${dl.error?.message}`);
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  const sheets = readWorkbook(bytes, fileName);

  const v3 = v3Kind(kind);
  if (v3) {
    const st = await v3.stage({ sb, viewer, week, sheets, fileName });
    const ins = await sb.from("upload").insert({
      week_id: week.id, kind, file_name: fileName, file_sha256: sha, file_path: path, uploaded_by: viewer.email, status: "staged",
      date_from: st.dateFrom ?? null, date_to: st.dateTo ?? null, row_count: st.rows.length, issues: st.issues,
      plan: { targets: st.plan, unmappedItems: st.unmappedItems, unmappedAccounts: [], v3: true },
    }).select("id").single();
    if (ins.error) throw new WriteError(ins.error.message);
    const uploadId = (ins.data as { id: string }).id;
    for (let i = 0; i < st.rows.length; i += 500) {
      const part = st.rows.slice(i, i + 500).map((r, j) => ({ upload_id: uploadId, row_no: i + j + 1, target: r.target, data: r.data }));
      const e = await sb.from("upload_row").insert(part);
      if (e.error) throw new WriteError(`staging: ${e.error.message}`);
    }
    return {
      uploadId, kind, fileName, sha, v3Note: st.note,
      parse: { issues: st.issues, dateFrom: st.dateFrom ?? null, dateTo: st.dateTo ?? null, columns: [], mapping: null, headerRow: null, sheet: null, rowCount: st.rows.length, badRows: [], sample: st.sample },
      plan: st.plan, unmappedItems: st.unmappedItems, unmappedAccounts: [],
    };
  }

  if (kind === "workbook") {
    if (viewer.role !== "admin") throw new WriteError("Impor workbook hanya untuk Admin");
    const inputs = parseWeekWorkbook(sheets);
    const ins = await sb.from("upload").insert({
      week_id: week.id, kind, file_name: fileName, file_sha256: sha, file_path: path, uploaded_by: viewer.email, status: "staged",
      row_count: inputs.sales_lines.length + inputs.receipt_lines.length + inputs.gl_lines.length, target_week_start: inputs.week.week_start,
      date_from: inputs.week.week_start, plan: { workbook: true },
    }).select("id").single();
    if (ins.error) throw new WriteError(ins.error.message);
    const counts = [
      ["Stok awal", inputs.opening_stock.length], ["Penjualan", inputs.sales_lines.length], ["Penerimaan", inputs.receipt_lines.length], ["Batch", inputs.batches.length],
      ["Jurnal (GL)", inputs.gl_lines.length], ["Neraca saldo awal", inputs.tb_opening.length], ["Rencana kas", inputs.cash_plan.length],
      ["Master key / item / akun", inputs.sku_keys.length + inputs.item_map.length + inputs.coa_map.length],
    ] as const;
    return {
      uploadId: (ins.data as { id: string }).id, kind, fileName, sha, workbookWeek: inputs.week.week_start,
      plan: counts.map(([label, n]) => ({ table: label, label, inserts: n, updates: 0, deletes: 0, supersede: 0, unchanged: 0, notes: [] })),
      unmappedItems: [], unmappedAccounts: [],
    };
  }

  const res = parseUpload(kind as UploadKind, sheets, { mapping: opts.mapping, weekStart: week.week_start, stockAgeLimit: 30, makeProductionReceipts: opts.makeProductionReceipts });
  const plan = res.sets.length ? await planUpload(sb, week, kind as UploadKind, res.sets, viewer) : { targets: [], unmappedItems: [], unmappedAccounts: [] };
  const ins = await sb.from("upload").insert({
    week_id: week.id, kind, file_name: fileName, file_sha256: sha, file_path: path, uploaded_by: viewer.email, status: "staged",
    date_from: res.dateFrom, date_to: res.dateTo, row_count: res.rows.length, issues: res.issues, mapping: res.detected?.mapping ?? null,
    options: { makeProductionReceipts: !!opts.makeProductionReceipts }, plan: { targets: summary(plan), unmappedItems: plan.unmappedItems, unmappedAccounts: plan.unmappedAccounts },
  }).select("id").single();
  if (ins.error) throw new WriteError(ins.error.message);
  const uploadId = (ins.data as { id: string }).id;
  // stage the parsed rows (traceability: exactly what will be committed)
  const staged = res.sets.flatMap((s) => s.rows.map((r) => ({ target: s.target, data: r })));
  for (let i = 0; i < staged.length; i += 1000) {
    const part = staged.slice(i, i + 1000).map((s, j) => ({ upload_id: uploadId, row_no: i + j + 1, target: s.target, data: s.data }));
    const e = await sb.from("upload_row").insert(part);
    if (e.error) throw new WriteError(`staging: ${e.error.message}`);
  }
  const def = kindDef(kind as UploadKind);
  return {
    uploadId, kind, fileName, sha,
    parse: {
      issues: res.issues, dateFrom: res.dateFrom, dateTo: res.dateTo, columns: res.detected?.columns ?? [], mapping: res.detected?.mapping ?? null,
      headerRow: res.detected?.headerRow ?? null, sheet: res.detected?.sheet ?? null, rowCount: res.rows.length,
      badRows: res.rows.filter((r) => r.issues.length).slice(0, 50).map((r) => ({ rowNo: r.rowNo, issues: r.issues })),
      sample: (res.sets[0]?.rows ?? []).slice(0, 25).map(clean),
    },
    fields: def.fields.map((f) => ({ field: f.field, label: f.label, required: !!f.required })),
    plan: summary(plan), unmappedItems: plan.unmappedItems, unmappedAccounts: plan.unmappedAccounts,
  };
}

/** Commit a staged upload: re-plan against the current data and apply every target in RLS-checked RPC calls. */
export async function commitUpload(sb: Supa, viewer: Viewer, uploadId: string, settings: ModuleSettings = {}): Promise<string> {
  const { data: up, error } = await sb.from("upload").select("*, week:week_id(*)").eq("id", uploadId).single();
  if (error || !up) throw new WriteError("Upload tidak ditemukan");
  if (up.status !== "staged") throw new WriteError(`Upload sudah ${up.status}`);
  const week = up.week as WeekRow;
  const kind = up.kind as AnyKind;
  const v3 = v3Kind(kind);
  if (v3) {
    if (!isModuleOn(settings[v3.module], viewer.role) || !v3.roles.includes(viewer.role)) throw new WriteError(`Modul ${v3.module} belum aktif untuk peran Anda`);
    const rows = await fetchAll<{ target: string; data: Row }>((f, t) => sb.from("upload_row").select("target, data").eq("upload_id", uploadId).order("row_no").range(f, t));
    const r = await v3.commit({ sb, viewer, week, uploadId, rows });
    // K39: a stock card of date d moves the update date of its open week to d + 1
    const moved = kind === "stock_card" ? await advanceUpdateDate(sb, await listWeeks(sb), r.dates) : "";
    const queue = await queueThroughNote(sb, r.dates, `upload ${kind}`);
    must(await sb.from("upload").update({ status: "committed", committed_at: new Date().toISOString(), inserted: r.inserted, updated: r.updated, deleted: r.deleted }).eq("id", uploadId), "upload committed");
    return `Disimpan: ${r.inserted} baris baru, ${r.updated} diubah, ${r.deleted} dihapus (soft). ${r.message}${moved ? ` ${moved}.` : ""}${queue}`;
  }
  let counts = { inserted: 0, updated: 0, deleted: 0, superseded: 0 };
  const journalDates: string[] = [], touched: string[] = [];
  if (kind === "workbook") {
    if (viewer.role !== "admin") throw new WriteError("Hanya Admin");
    const dl = await sb.storage.from("uploads").download(up.file_path);
    if (dl.error || !dl.data) throw new WriteError("File tidak terbaca");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== up.file_sha256) throw new WriteError("File berubah sejak dipratinjau");
    const inputs = parseWeekWorkbook(readWorkbook(bytes, up.file_name));
    const r = await loadWeekInputs(sb, inputs, { source: "Manual", master: true, uploadId, note: `Impor workbook ${up.file_name}` });
    counts.inserted = Object.values(r.counts).reduce((a, b) => a + b, 0);
  } else {
    const rows = await fetchAll<{ target: string; data: Row }>((f, t) => sb.from("upload_row").select("target, data").eq("upload_id", uploadId).order("row_no").range(f, t));
    const sets = new Map<string, Row[]>();
    for (const r of rows) sets.set(r.target, [...(sets.get(r.target) ?? []), r.data]);
    const plan = await planUpload(sb, week, kind as UploadKind, [...sets.entries()].map(([target, rs]) => ({ target: target as StagedSet["target"], rows: rs })), viewer);
    for (const t of plan.targets) {
      let seq = await nextSeq(sb, t.table, t.table === "gl_line" ? null : week.id);
      const ins = t.inserts.map((r) => {
        const base = clean(r);
        const row: Row = { ...base, seq: ++seq, upload_id: uploadId };
        if (t.table !== "gl_line") row.week_id = week.id;
        if (!("source" in row)) row.source = kindDef(kind as UploadKind).source;
        return row;
      });
      const ds = ins.map((x) => String(x.date ?? "")).filter(Boolean);
      touched.push(...ds);
      if (t.table === "gl_line") journalDates.push(...ds);
      const r = await applyChanges(sb, t.table, ins, t.updates, t.deletes, t.supersede);
      counts = { inserted: counts.inserted + r.inserted, updated: counts.updated + r.updated, deleted: counts.deleted + r.deleted, superseded: counts.superseded + r.superseded };
    }
    if (plan.weekFlag !== undefined) must(await sb.from("week").update({ opening_stock_flag: plan.weekFlag }).eq("id", week.id), "week opening_stock_flag");
  }
  // K39: a journal of date d moves the update date of its open week to d + 1
  const moved = kind === "accurate_journal" && journalDates.length ? await advanceUpdateDate(sb, await listWeeks(sb), journalDates) : "";
  // K40: the trigger queues the dates of the rows; the app closes the range up to the data date
  const queue = await queueThroughNote(sb, touched, `upload ${kind}`);
  must(await sb.from("upload").update({
    status: "committed", committed_at: new Date().toISOString(), inserted: counts.inserted, updated: counts.updated, deleted: counts.deleted,
  }).eq("id", uploadId), "upload committed");
  return `Disimpan: ${counts.inserted} baris baru, ${counts.updated} diubah, ${counts.deleted} dihapus (soft), ${counts.superseded} baris Ops diganti.${moved ? ` ${moved}.` : ""}${queue}`;
}

export { mondayOf };
