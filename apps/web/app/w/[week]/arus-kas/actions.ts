"use server";
import { revalidatePath } from "next/cache";
import { CF_CATEGORIES } from "@kgr/engine";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase";

export async function setCfOverride(form: FormData) {
  const v = await requireViewer();
  if (!can(v.role, "gl_override")) throw new Error("Tidak berwenang");
  const id = String(form.get("id"));
  const cat = String(form.get("category") ?? "");
  if (cat && !(CF_CATEGORIES as readonly string[]).includes(cat)) throw new Error("Kategori tidak dikenal");
  const sb = await supabaseServer();
  const { error } = await sb.from("gl_line").update({ cf_override: cat || null }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${String(form.get("week"))}/arus-kas`);
}
