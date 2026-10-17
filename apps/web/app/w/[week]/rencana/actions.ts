"use server";
import { revalidatePath } from "next/cache";
import { addDays, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { moduleEnabled, requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { getWeek } from "@/lib/data";
import { approvePlan, loadPlanning, savePlan } from "@/lib/v3/planning";
import { copyPlanToBatches } from "@/lib/v5/copy-plan";
import { loadClassDemand, planWeekClassRows } from "@/lib/v5/ppic-data";
import { WriteError } from "@/lib/write";
import { must, mustRows } from "@/lib/loader";

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
    const { msg } = await savePlan(sb, v, week, { classCode: String(form.get("weight_class") || "") || null, supplyCommittedHeads: heads === null ? null : Math.round(Number(heads)), note: String(form.get("note") ?? "") || null });
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * PRD v5 §4.3 (flag v5_ppic_class): save the plan (plan_week, v4 rules, class STD for the heads) and its classes
 * (plan_week_class: kg LB and heads per class of the need). C42 PERIKSA may be saved, labelled "yield sementara".
 * R52: header, plan_day and plan_week_class are written in that order with the id the insert returned (no "latest
 * version" lookup); the class demand is read before the first write; a plan whose class rows did not go in is retired,
 * so a copy never falls back to the v4 plan days of a plan that was meant to be per class.
 */
export async function saveClassPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("v5_ppic_class", ["admin", "ppic"]);
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const cs = await loadClassDemand(sb, await loadPlanning(sb, week));
    const { id, msg } = await savePlan(sb, v, week, { classCode: "STD", supplyCommittedHeads: null, note: "v5: rencana per kelas" });
    const rows = planWeekClassRows(id, cs.demand);
    if (rows.length) {
      const { error } = await sb.from("plan_week_class").insert(rows);
      if (error) {
        const undo = await sb.from("plan_week").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        throw new WriteError(`plan_week_class: ${error.message}${undo.error ? ` (rencana ${id} tidak bisa ditarik: ${undo.error.message})` : "; rencana yang separuh tersimpan ditarik, simpan ulang"}`);
      }
    }
    done(week.week_start);
    return { ok: `${msg}; ${rows.length} kelas` };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Copy to batch (v5): everything goes through copyPlanToBatches' own gate (PRD v5.2 K58, R51) — C42, C45, C46, C47, C57 per
 * cut date × class (no reason opens it), C58 unless a written reason of this plan version, the downgrade approval. The
 * page reads the same copyGate.
 */
export async function copyClassPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_ppic_class", ["admin", "ppic"]);
    const { sb, week } = await ctx(form, ["admin", "ppic"]);
    const msg = await copyPlanToBatches(sb, week, String(form.get("plan_id")), { classOn: true });
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

/**
 * The v4 copy (no class screen for the caller): the same gate and the same copy as v5 (K58) — C58 only when v5_ppic_class
 * is on for the caller's role, C57 whenever v5_costing is on.
 */
export async function copyPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { v, sb, week } = await ctx(form, ["admin", "ppic"]);
    const msg = await copyPlanToBatches(sb, week, String(form.get("plan_id")), { classOn: await moduleEnabled("v5_ppic_class", v) });
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
    // PRD v5.1 R29 (§7): C57 holds without exception — the operations director decides the LB price
    if (code === "C57") return { error: "C57 tidak bisa diberi alasan: tunggu keputusan harga LB Direktur Operasional" };
    if (reason.length < 5) return { error: "Tulis alasannya (paling sedikit 5 huruf)" };
    // R51: a C58 reason belongs to the plan version saved before it (stage 1, by time — the column that binds it is B-R85): a
    // reason older than the latest version is retired so the new one can be written; one still valid is not written twice
    if (code === "C58") {
      const latest = must(await sb.from("plan_week").select("created_at").eq("week_start", week.week_start).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle(), "alasan C58 rencana") as { created_at?: string } | null;
      const old = mustRows<{ id: string; created_at: string }>(await sb.from("plan_check_reason").select("id, created_at").eq("week_start", week.week_start).eq("code", code).is("deleted_at", null), "alasan C58");
      const stale = latest?.created_at ? old.filter((o) => Date.parse(o.created_at) < Date.parse(latest.created_at!)) : [];
      const ids = stale.map((o) => o.id);
      for (let i = 0; i < ids.length; i += 200) {
        const r = await sb.from("plan_check_reason").update({ deleted_at: new Date().toISOString() }).in("id", ids.slice(i, i + 200));
        if (r.error) return { error: r.error.message };
      }
    }
    const { error } = await sb.from("plan_check_reason").insert({ week_start: week.week_start, code, reason });
    if (error) return { error: error.message.includes("duplicate") ? "Alasan untuk kontrol ini sudah ada" : error.message };
    done(week.week_start);
    return { ok: `Alasan ${code} disimpan` };
  } catch (e) { return { error: (e as Error).message }; }
}
