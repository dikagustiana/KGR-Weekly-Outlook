"use server";
import { revalidatePath } from "next/cache";
import { D, isISODate, jakartaToday } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { moduleSettings, requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { moduleSettingsGlobal } from "@/lib/rebuild";
import { computeMonth, lockVersion, setBudget, writeMonthMart } from "@/lib/v3/monthly";
import { monthStart } from "@/lib/v3/drivers";

export type ActionState = { ok?: string; error?: string };

const monthOf = (form: FormData) => {
  const m = monthStart(String(form.get("month") ?? ""));
  if (!m) throw new Error("Bulan tidak valid");
  return m;
};
const money = (v: FormDataEntryValue | null) => { const x = parseNumber(String(v ?? "")); return x === null ? null : D(x).toFixed(2); };
const done = (m: string) => { revalidatePath(`/m/${m.slice(0, 7)}`); revalidatePath(`/m/${m.slice(0, 7)}/tutup-buku`); };

export async function rebuildMonthAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const sb = await supabaseServer();
    const st = await computeMonth(sb, first, jakartaToday(), moduleSettingsGlobal(await moduleSettings()));
    const w = await writeMonthMart(sb, st);
    done(first);
    return { ok: `Bulan dibangun ulang: cut-off ${st.cutOff}, ${w.written} baris ditulis, ${w.deleted} dihapus` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function budgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const co = String(form.get("cut_off_date") ?? "").trim();
    if (co && !isISODate(co)) return { error: "Cut-off tidak valid" };
    const sb = await supabaseServer();
    const msg = await setBudget(sb, first, { revenue: money(form.get("budget_revenue")), gp: money(form.get("budget_gp")), nibt: money(form.get("budget_nibt")), cutOff: co || null });
    done(first);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function lockAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const version = String(form.get("version"));
    if (version !== "V1" && version !== "V2" && version !== "FINAL") return { error: "Versi tidak dikenal" };
    const sb = await supabaseServer();
    const msg = await lockVersion(sb, v, first, version, jakartaToday(), moduleSettingsGlobal(await moduleSettings()));
    done(first);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function adjustmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "");
    if (form.get("op") === "post") {
      const { error } = await sb.from("closing_adjustment").update({ posted: form.get("posted") === "1", gl_voucher: String(form.get("gl_voucher") ?? "") || null }).eq("id", id);
      if (error) return { error: error.message };
      done(first);
      return { ok: "Status posting disimpan" };
    }
    const amount = money(form.get("amount"));
    const kind = String(form.get("kind") ?? "other");
    if (amount === null) return { error: "Isi jumlah (tanda P&L: + pendapatan / − biaya)" };
    const { data: mo } = await sb.from("month_outlook").select("id").eq("month", first).maybeSingle();
    let moId = (mo as { id: string } | null)?.id;
    if (!moId) { const r = await sb.from("month_outlook").insert({ month: first }).select("id").single(); if (r.error) return { error: r.error.message }; moId = (r.data as { id: string }).id; }
    const rec = { month_outlook_id: moId, code: String(form.get("code") ?? "").trim(), description: String(form.get("description") ?? "").trim(), pl_line: String(form.get("pl_line") ?? "").trim(), amount,
      kind: ["unbilled_revaluation", "parked_cost", "inventory_adj", "accrual", "other"].includes(kind) ? kind : "other" };
    if (!rec.code || !rec.description || !rec.pl_line) return { error: "Kode, keterangan dan pos P&L wajib" };
    const { error } = id ? await sb.from("closing_adjustment").update(rec).eq("id", id) : await sb.from("closing_adjustment").insert(rec);
    if (error) return { error: error.message };
    done(first);
    return { ok: "Penyesuaian disimpan" };
  } catch (e) { return { error: (e as Error).message }; }
}
