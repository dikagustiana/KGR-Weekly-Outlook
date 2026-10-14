"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseNumber } from "@kgr/parsers";
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
  const lines = form.getAll("pl_line").map(String);
  const rows: Record<string, unknown>[] = [];
  try {
    lines.forEach((l, i) => rows.push({
      week_id: weekId, pl_line: l, seq: i + 1,
      monthly_amount: parseNumber(String(form.get(`m:${l}`) ?? "")) ?? 0,
      week_adjustment: parseNumber(String(form.get(`a:${l}`) ?? "")) ?? 0,
      basis: String(form.get(`b:${l}`) ?? "") || null,
    }));
  } catch (e) { go("err", (e as Error).message); }
  const { error } = await sb.from("runrate").upsert(rows, { onConflict: "week_id,pl_line" });
  if (error) go("err", error.message);
  revalidatePath(`/w/${week}`, "layout");
  go("ok", "Run-rate disimpan");
}
