"use server";
import { revalidatePath } from "next/cache";
import { addDays, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { getWeek } from "@/lib/data";
import { approvePlan, copyPlanToBatches, loadPlanning, savePlan } from "@/lib/v3/planning";
import { loadClassDemand, planWeekClassRows } from "@/lib/v5/ppic-data";
import { WriteError } from "@/lib/write";

export type ActionState = { ok?: string; error?: string };

async function ctx(form: FormData, roles: ("admin" | "ppic" | "finance")[]) {
  const v = await requireModuleAction("m3_planning", roles);
  const sb = await supabaseServer();
  const week = await getWeek(sb, String(form.get("week")));
  if (!week) throw new Error("Minggu tidak ada");
  return { v, sb, week };
}

const done = (week: string) => { revalidatePath(`/w/${week}/rencana`); revalidatePath(`/w/${week}/demand`); revalidatePath(`/w/${week}/batch`); };

export async function savePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { v, sb, week } = await ctx(form, ["admin", "ppic"]);
    const sup = String(form.get("supply_heads") ?? "").trim();
    const heads = sup === "" ? null : parseNumber(sup);
    const msg = await savePlan(sb, v, week, { classCode: String(form.get("weight_class") || "") || null, supplyCommittedHeads: heads === null ? null : Math.round(Number(heads)), note: String(form.get("note") ?? "") || null });
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * PRD v5 §4.3 (flag v5_ppic_class): save the plan (plan_week, v4 rules, class STD for the heads) and its classes
 * (plan_week_class: kg LB and heads per class of the need). C42 PERIKSA may be saved, labelled "yield sementara".
 */
export async function saveClassPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("v5_ppic_class", ["admin", "ppic"]);
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const msg = await savePlan(sb, v, week, { classCode: "STD", supplyCommittedHeads: null, note: "v5: rencana per kelas" });
    const { data: pw } = await sb.from("plan_week").select("id").eq("week_start", week.week_start).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!pw) throw new WriteError("plan_week tidak ditemukan setelah disimpan");
    const cs = await loadClassDemand(sb, await loadPlanning(sb, week));
    const rows = planWeekClassRows(String((pw as { id: string }).id), cs.demand);
    if (rows.length) {
      const { error } = await sb.from("plan_week_class").insert(rows);
      if (error) throw new WriteError(`plan_week_class: ${error.message}`);
    }
    done(week.week_start);
    return { ok: `${msg}; ${rows.length} kelas` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Copy to batch (v5): the v4 rules (C42, C45, C46, C47) and C58 LULUS, or C58 with a written reason. */
export async function copyClassPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_ppic_class", ["admin", "ppic"]);
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const src = await loadPlanning(sb, week);
    const c58 = (await loadClassDemand(sb, src)).controls.find((c) => c.code === "C58");
    if (c58 && c58.status !== "LULUS" && !src.reasons.some((r) => r.code === "C58")) throw new WriteError(`C58 ${c58.status}: ${c58.action}`);
    const msg = await copyPlanToBatches(sb, week, String(form.get("plan_id")));
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function approvePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { v, sb, week } = await ctx(form, ["admin", "finance"]);
    const msg = await approvePlan(sb, v, String(form.get("plan_id")));
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function copyPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const msg = await copyPlanToBatches(sb, week, String(form.get("plan_id")));
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function setCapacityAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(week.week_start, i);
      if (!isISODate(date)) continue;
      const h = parseNumber(String(form.get(`head_${date}`) ?? ""));
      const c = parseNumber(String(form.get(`chiller_${date}`) ?? ""));
      rows.push({ date, cut_capacity_head: h === null ? null : Math.round(Number(h)), chiller_kg: c });
    }
    const { error } = await sb.from("capacity").upsert(rows, { onConflict: "date" });
    if (error) return { error: error.message };
    done(week.week_start);
    return { ok: "Kapasitas disimpan — simpan rencana ulang untuk memakai kapasitas baru" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** §6.4: the written reason that lets a PERIKSA control (C41 by-product short) open the next step. */
export async function reasonAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const code = String(form.get("code") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    if (!/^C\d{2}$/.test(code)) return { error: "Kode kontrol tidak dikenal" };
    if (reason.length < 5) return { error: "Tulis alasannya (paling sedikit 5 huruf)" };
    const { error } = await sb.from("plan_check_reason").insert({ week_start: week.week_start, code, reason });
    if (error) return { error: error.message.includes("duplicate") ? "Alasan untuk kontrol ini sudah ada" : error.message };
    done(week.week_start);
    return { ok: `Alasan ${code} disimpan` };
  } catch (e) { return { error: (e as Error).message }; }
}
