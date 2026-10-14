"use server";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";

const RESTORABLE = new Set(["sales_line", "receipt_line", "batch", "cash_plan", "opening_stock", "gl_line", "tb_opening", "item_map", "coa_map"]);

/** Admin restores a soft-deleted row (PRD §8: deleting is soft, Admin can restore). */
export async function restoreRow(form: FormData) {
  const v = await requireViewer();
  if (v.role !== "admin") throw new Error("Hanya Admin");
  const table = String(form.get("table"));
  const id = String(form.get("row_id"));
  if (!RESTORABLE.has(table)) throw new Error("Tabel tidak bisa dipulihkan");
  const sb = await supabaseServer();
  const pk = table === "item_map" ? "item_code" : table === "coa_map" ? "account" : "id";
  const { error } = await sb.from(table).update({ deleted_at: null, deleted_by: null }).eq(pk, id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}
