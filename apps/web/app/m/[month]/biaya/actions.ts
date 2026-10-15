"use server";
import { revalidatePath } from "next/cache";
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";

export type ActionState = { ok?: string; error?: string };

const money = (v: FormDataEntryValue | null, dp = 2) => { const x = parseNumber(String(v ?? "")); return x === null ? null : D(x).toFixed(dp); };
const date = (v: FormDataEntryValue | null) => { const x = String(v ?? "").trim(); return x === "" ? null : isISODate(x) ? x : undefined; };

/** Add or change a fixed-cost schedule row (Finance). */
export async function saveScheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const start = date(form.get("start_date")), end = date(form.get("end_date"));
    if (!start) return { error: "Tanggal mulai wajib (YYYY-MM-DD)" };
    if (end === undefined || (end && end < start)) return { error: "Tanggal akhir tidak valid" };
    const rec = {
      pl_line: String(form.get("pl_line") ?? "").trim(), description: String(form.get("description") ?? "").trim(), amount_per_month: money(form.get("amount_per_month")),
      start_date: start, end_date: end, amortize: form.get("amortize") === "on", prepaid_total: money(form.get("prepaid_total")), intercompany: form.get("intercompany") === "on",
      vendor: String(form.get("vendor") ?? "").trim() || null, active: form.get("active") === "on", note: String(form.get("note") ?? "").trim() || null,
    };
    if (!rec.pl_line || !rec.description) return { error: "Pos P&L dan keterangan wajib" };
    const id = String(form.get("id") ?? "");
    const { error } = id ? await sb.from("fixed_cost_schedule").update(rec).eq("id", id) : await sb.from("fixed_cost_schedule").insert(rec);
    if (error) return { error: error.message };
    revalidatePath(`/m/${String(form.get("month"))}/biaya`);
    return { ok: id ? "Jadwal biaya diperbarui" : "Jadwal biaya ditambah" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Driver of one account (driver columns only; the chart of accounts stays Admin's). */
export async function saveDriverAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const t = String(form.get("driver_type"));
    if (!["fixed", "variable", "runrate", "none"].includes(t)) return { error: "Driver tidak dikenal" };
    const basis = String(form.get("driver_basis") ?? "");
    const { error } = await sb.from("coa_map").update({
      driver_type: t, rp_per_kg: money(form.get("rp_per_kg"), 4), intercompany: form.get("intercompany") === "on",
      driver_basis: ["kg_cut", "kg_sold", "kg_lb"].includes(basis) ? basis : null,
    }).eq("account", String(form.get("account")));
    if (error) return { error: error.message };
    revalidatePath(`/m/${String(form.get("month"))}/biaya`);
    return { ok: "Driver akun disimpan" };
  } catch (e) { return { error: (e as Error).message }; }
}
