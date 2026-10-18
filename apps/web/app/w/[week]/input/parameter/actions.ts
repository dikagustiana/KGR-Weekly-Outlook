"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDate, parseNumber } from "@kgr/parsers";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/roles";
import { PARAM_AREA } from "@/lib/params";
import { supabaseServer } from "@/lib/supabase";
import { weekIdOf } from "@/lib/rollover";
import { must } from "@/lib/loader";

const PERCENT = new Set(["target_shrink", "yield_karkas", "yield_kepala", "yield_ceker", "yield_usus", "yield_hja", "yield_lemak"]);
const NULLABLE = new Set(["accurate_sales_kg", "accurate_opening_stock_value"]);
const LW = ["lw_rpa_kg", "lw_rpa_revenue", "lw_rpa_gp", "lw_trading_kg", "lw_trading_revenue", "lw_trading_gp"];

export async function saveParameters(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const go = (k: "ok" | "err", m: string): never => redirect(`/w/${week}/input/parameter?${k}=${encodeURIComponent(m)}`);
  const sb = await supabaseServer();
  const weekId = await weekIdOf(sb, week);
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [col, area] of Object.entries(PARAM_AREA)) {
    if (!form.has(col) || !can(v.role, area)) continue;
    try {
      let n = parseNumber(String(form.get(col) ?? ""));
      if (n !== null && PERCENT.has(col)) n = String(Number(n) / 100);
      if (n === null && !NULLABLE.has(col)) { errors.push(`${col} wajib diisi`); continue; }
      patch[col] = n;
    } catch (e) {
      errors.push(`${col}: ${(e as Error).message}`);
    }
  }
  if (errors.length) go("err", errors.join("; "));
  if (Object.keys(patch).length) {
    const { error } = await sb.from("parameter").update(patch).eq("week_id", weekId);
    if (error) go("err", error.message);
  }
  const weekPatch: Record<string, unknown> = {};
  if (form.has("update_date") && can(v.role, "update_date")) {
    // K69: the update date changes only while the week is open (the database refuses it otherwise); unchanged = not sent
    const w = must(await sb.from("week").select("status, update_date").eq("id", weekId).maybeSingle(), "week update_date") as { status: string; update_date: string } | null;
    let d: string | null = null;
    try { d = parseDate(String(form.get("update_date"))); } catch (e) { go("err", (e as Error).message); }
    if (!d) go("err", "Tanggal update wajib diisi");
    if (w && d !== String(w.update_date)) {
      if (w.status !== "open") go("err", `Tanggal update tidak bisa diubah: minggu berstatus ${w.status} (K69); buka minggunya dulu`);
      weekPatch.update_date = d;
    }
  }
  if (can(v.role, "parameter_all")) {
    for (const c of [...LW, "tb_opening_date"]) {
      if (!form.has(c)) continue;
      try {
        if (c === "tb_opening_date") { weekPatch[c] = parseDate(String(form.get(c))); continue; }
        // a blank last-week figure leaves the stored value as it is (the column is NOT NULL: a blank must not overwrite it with 0)
        const n = parseNumber(String(form.get(c)));
        if (n !== null) weekPatch[c] = n;
      } catch (e) { go("err", (e as Error).message); }
    }
    if (LW.some((c) => weekPatch[c] !== undefined)) weekPatch.lw_source = "diisi manual (Admin)";
  }
  if (Object.keys(weekPatch).length) {
    const { error } = await sb.from("week").update(weekPatch).eq("id", weekId);
    if (error) go("err", error.message);
  }
  revalidatePath(`/w/${week}`, "layout");
  go("ok", "Parameter disimpan");
}
