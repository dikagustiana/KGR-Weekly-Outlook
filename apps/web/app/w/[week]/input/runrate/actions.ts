"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runrateRowsFromForm } from "@/lib/runrate-form";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase";
import { weekIdOf } from "@/lib/rollover";

export async function saveRunrate(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const go = (k: "ok" | "err", m: string): never => redirect(`/w/${week}/input/runrate?${k}=${encodeURIComponent(m)}`);
  if (!can(v.role, "runrate")) go("err", "Hanya Admin / Finance");
  const sb = await supabaseServer();
  const weekId = await weekIdOf(sb, week);
  let rows: Record<string, unknown>[] = [], empty: string[] = [];
  try { ({ rows, empty } = runrateRowsFromForm(form, weekId)); } catch (e) { go("err", (e as Error).message); }
  if (rows.length) {
    const { error } = await sb.from("runrate").upsert(rows, { onConflict: "week_id,pl_line" });
    if (error) go("err", error.message);
  }
  revalidatePath(`/w/${week}`, "layout");
  if (empty.length) go(rows.length ? "ok" : "err", `${rows.length ? "Run-rate disimpan" : "Tidak ada baris yang disimpan"}; ${empty.length} baris belum diisi dan tidak ditulis (${empty.slice(0, 3).join(", ")}${empty.length > 3 ? ", …" : ""})`);
  go("ok", "Run-rate disimpan");
}
