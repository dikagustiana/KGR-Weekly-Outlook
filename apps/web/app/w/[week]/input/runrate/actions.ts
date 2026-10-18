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
  const empty: string[] = [];
  try {
    lines.forEach((l, i) => {
      const monthly = parseNumber(String(form.get(`m:${l}`) ?? ""));
      // a line without a monthly amount is not written: the column is NOT NULL, so a blank would become a stored 0 (missing ≠ 0)
      if (monthly === null) { empty.push(l); return; }
      rows.push({
        week_id: weekId, pl_line: l, seq: i + 1,
        monthly_amount: monthly,
        week_adjustment: parseNumber(String(form.get(`a:${l}`) ?? "")) ?? 0, // missing-ok: penyesuaian kosong = tidak ada penyesuaian (kolom NOT NULL default 0; supabase/** tak diubah)
        basis: String(form.get(`b:${l}`) ?? "") || null,
      });
    });
  } catch (e) { go("err", (e as Error).message); }
  if (rows.length) {
    const { error } = await sb.from("runrate").upsert(rows, { onConflict: "week_id,pl_line" });
    if (error) go("err", error.message);
  }
  revalidatePath(`/w/${week}`, "layout");
  if (empty.length) go(rows.length ? "ok" : "err", `${rows.length ? "Run-rate disimpan" : "Tidak ada baris yang disimpan"}; ${empty.length} baris belum diisi dan tidak ditulis (${empty.slice(0, 3).join(", ")}${empty.length > 3 ? ", …" : ""})`);
  go("ok", "Run-rate disimpan");
}
