"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseNumber, parseDate, parseUpload, readWorkbook, type UploadKind } from "@kgr/parsers";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { TABLES, canWriteRow, type TableDef } from "@/lib/tables";
import { applyChanges } from "@/lib/write";
import { moduleSettings } from "@/lib/modules";
import { weekIdOf } from "@/lib/rollover";

type Row = Record<string, unknown>;

function back(week: string, path: string, msg: string, kind: "ok" | "err" = "ok"): never {
  redirect(`/w/${week}/${path}?${kind}=${encodeURIComponent(msg)}`);
}

function readRow(def: TableDef, form: FormData, prefix = ""): { row: Row; errors: string[] } {
  const row: Row = {};
  const errors: string[] = [];
  for (const c of def.cols) {
    const raw = form.get(prefix + c.name);
    const v = raw === null ? null : String(raw).trim();
    try {
      if (c.type === "number") row[c.name] = parseNumber(v);
      else if (c.type === "date") row[c.name] = parseDate(v);
      else row[c.name] = v === "" ? null : v;
    } catch (e) {
      errors.push(`${c.label}: ${(e as Error).message}`);
    }
    if (c.required && (row[c.name] === null || row[c.name] === undefined)) errors.push(`${c.label} wajib diisi`);
    if (c.type === "select" && row[c.name] && c.options && !c.options.includes(String(row[c.name]))) errors.push(`${c.label}: pilihan tidak dikenal`);
  }
  if ((def.table === "sales_line" || def.table === "receipt_line") && !row.item_code && !row.key_manual) errors.push("Isi kode item atau key manual");
  if (def.table === "opening_stock" && !row.item_code && !row.key_manual) errors.push("Isi kode item atau key");
  return { row, errors };
}

export async function saveRow(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const path = String(form.get("path"));
  const def = TABLES[String(form.get("table")) as TableDef["table"]];
  if (!def) back(week, path, "Tabel tidak dikenal", "err");
  const id = String(form.get("id") ?? "");
  const { row, errors } = readRow(def, form);
  if (errors.length) back(week, path, errors.join("; "), "err");
  const sb = await supabaseServer();
  if (id) {
    const { data: old } = await sb.from(def.table).select("*").eq("id", id).maybeSingle();
    if (!old) back(week, path, "Baris tidak ditemukan", "err");
    if (!canWriteRow(v.role, def, old as Row) || !canWriteRow(v.role, def, { ...(old as Row), ...row })) back(week, path, "Peran Anda tidak boleh mengubah baris ini", "err");
    try { await applyChanges(sb, def.table, [], [{ id, ...row }]); } catch (e) { back(week, path, (e as Error).message, "err"); }
  } else {
    if (!canWriteRow(v.role, def, { ...row, source: "Manual" })) back(week, path, "Peran Anda tidak boleh menambah baris ini", "err");
    const weekId = await weekIdOf(sb, week);
    const { data: last } = await sb.from(def.table).select("seq").eq("week_id", weekId).order("seq", { ascending: false }).limit(1).maybeSingle();
    try {
      await applyChanges(sb, def.table, [{ ...row, week_id: weekId, seq: Number((last as Row | null)?.seq ?? 0) + 1, source: "Manual" }]);
    } catch (e) { back(week, path, (e as Error).message, "err"); }
  }
  revalidatePath(`/w/${week}`, "layout");
  back(week, path, id ? "Baris disimpan" : "Baris ditambahkan");
}

export async function deleteRow(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const path = String(form.get("path"));
  const def = TABLES[String(form.get("table")) as TableDef["table"]];
  const id = String(form.get("id"));
  const sb = await supabaseServer();
  const { data: old } = await sb.from(def.table).select("*").eq("id", id).maybeSingle();
  if (!old || !canWriteRow(v.role, def, old as Row)) back(week, path, "Peran Anda tidak boleh menghapus baris ini", "err");
  try { await applyChanges(sb, def.table, [], [], [id]); } catch (e) { back(week, path, (e as Error).message, "err"); }
  revalidatePath(`/w/${week}`, "layout");
  back(week, path, "Baris dihapus (soft delete — bisa dipulihkan Admin dari Audit)");
}

/** Sales marks a delivered order: Order → Aktual (PRD §2 step 2). */
export async function markDelivered(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const id = String(form.get("id"));
  const sb = await supabaseServer();
  const { data: old } = await sb.from("sales_line").select("*").eq("id", id).maybeSingle();
  if (!old || !canWriteRow(v.role, TABLES.sales_line, { ...(old as Row), status: "Aktual" })) back(week, "input/penjualan", "Tidak berwenang", "err");
  // M3 on: the PO line is fulfilled in full, so its lot allocations become the out_sale (PLAN Fase 3b)
  const m3 = (await moduleSettings()).m3_planning?.enabled === true;
  const upd = m3 ? { id, status: "Aktual", confirmed_by: v.email, fulfilled_kg: (old as Row).kg } : { id, status: "Aktual", confirmed_by: v.email };
  try { await applyChanges(sb, "sales_line", [], [upd]); } catch (e) { back(week, "input/penjualan", (e as Error).message, "err"); }
  revalidatePath(`/w/${week}`, "layout");
  back(week, "input/penjualan", "Order ditandai terkirim (Aktual)");
}

const PASTE_KIND: Record<string, UploadKind> = { sales_line: "orders", receipt_line: "receipts_plan", batch: "batch_plan", cash_plan: "cash_plan" };

/** CSV / tab paste into the order, receipt-plan, batch-plan and cash-plan forms (PRD §9). */
export async function pasteRows(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const path = String(form.get("path"));
  const table = String(form.get("table")) as TableDef["table"];
  const def = TABLES[table];
  const text = String(form.get("text") ?? "");
  if (!text.trim()) back(week, path, "Tempel baris dulu (dengan baris judul kolom)", "err");
  const parsed = parseUpload(PASTE_KIND[table], readWorkbook(new TextEncoder().encode(text), "paste.csv"));
  const set = parsed.sets.find((s) => s.target === table);
  if (!set || set.rows.length === 0) back(week, path, parsed.issues.join("; ") || "Tidak ada baris yang terbaca", "err");
  const sb = await supabaseServer();
  const weekId = await weekIdOf(sb, week);
  const { data: last } = await sb.from(table).select("seq").eq("week_id", weekId).order("seq", { ascending: false }).limit(1).maybeSingle();
  let seq = Number((last as Row | null)?.seq ?? 0);
  const rows = set.rows.map((r) => {
    const { _item_name, line_key, ...rest } = r as Row;
    void _item_name; void line_key;
    return { ...rest, week_id: weekId, seq: ++seq, source: "Manual" } as Row;
  });
  const bad = rows.filter((r) => !canWriteRow(v.role, def, r));
  if (bad.length) back(week, path, `Peran Anda tidak boleh menambah ${bad.length} baris dari tempelan`, "err");
  try { await applyChanges(sb, table, rows); } catch (e) { back(week, path, (e as Error).message, "err"); }
  revalidatePath(`/w/${week}`, "layout");
  back(week, path, `${rows.length} baris ditambahkan dari tempelan${parsed.issues.length ? ` (${parsed.issues.join("; ")})` : ""}`);
}
