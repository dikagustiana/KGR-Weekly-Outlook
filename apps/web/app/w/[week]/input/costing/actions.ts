"use server";
import { revalidatePath } from "next/cache";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { getWeek } from "@/lib/data";
import { allocateWeek, postWeek, postWeekOverride } from "@/lib/v3/costing";
import { D, isISODate } from "@kgr/engine";
import type { Role } from "@/lib/roles";
import { parseNumber } from "@kgr/parsers";

export type ActionState = { ok?: string; error?: string };

const ROLES = ["admin", "cost_accounting"] as const;

async function ctx(form: FormData, roles: readonly Role[] = ROLES) {
  const v = await requireModuleAction("m1_costing", [...roles]);
  const sb = await supabaseServer();
  const week = await getWeek(sb, String(form.get("week")));
  if (!week) throw new Error("Minggu tidak ada");
  return { v, sb, week };
}

const done = (week: string) => { revalidatePath(`/w/${week}/input/costing`); revalidatePath(`/w/${week}/costing`); };

export async function allocate(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { v, sb, week } = await ctx(form);
    const id = form.get("batch_id");
    const msg = await allocateWeek(sb, v, week, id ? [String(id)] : undefined);
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function post(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { v, sb, week } = await ctx(form);
    const msg = await postWeek(sb, v, week);
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * R61 (Q-v5.2-30, -61): the override that posts the allocations with an SKU without a reference price — Finance or Admin, a reason
 * of at least 10 characters — through the RPC post_allocation_override (B5): one transaction writes allocation_run and
 * batch.costing_status, the reason goes into allocation_run.issues. Cost Accounting does not override: it posts the allocations
 * with a complete price (`post`).
 */
export async function postOverride(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { v, sb, week } = await ctx(form, ["admin", "finance"]);
    const msg = await postWeekOverride(sb, v, week, String(form.get("reason") ?? ""));
    done(week.week_start);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function setPoolGl(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { sb, week } = await ctx(form);
    const raw = parseNumber(String(form.get("total_gl") ?? ""));
    const total = raw === null ? null : D(raw).toFixed(2);
    const status = String(form.get("status") || "open");
    const { error } = await sb.from("cost_pool").update({ total_gl: total, status: ["open", "tied", "posted"].includes(status) ? status : "open" }).eq("id", String(form.get("pool_id")));
    if (error) return { error: error.message };
    done(week.week_start);
    return { ok: "Total GL cost pool disimpan" };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function setBatchCosting(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { sb, week } = await ctx(form);
    const mode = form.get("cost_mode") === "own" ? "own" : "maklon";
    const hc = String(form.get("head_count") ?? "").trim();
    const { error } = await sb.from("batch").update({ cost_mode: mode, head_count: hc === "" ? null : Math.round(Number(hc)) }).eq("id", String(form.get("batch_id")));
    if (error) return { error: error.message };
    done(week.week_start);
    return { ok: "Mode biaya batch disimpan — alokasikan ulang batch ini" };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function addOverheadRate(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { sb, week } = await ctx(form);
    const from = String(form.get("period_start")), to = String(form.get("period_end"));
    if (!isISODate(from) || !isISODate(to) || to < from) return { error: "Periode tidak valid" };
    const num = (k: string) => { const x = parseNumber(String(form.get(k) ?? "")); return x === null ? null : D(x).toFixed(4); };
    const rate = num("rate_per_kg_lb");
    if (rate === null) return { error: "Isi tarif Rp/kg LB" };
    // PRD v4 §3.5: per head as well; a batch with a head count then takes overhead = heads × rate per head
    const { error } = await sb.from("overhead_rate").insert({ period_start: from, period_end: to, rate_per_kg_lb: rate, rate_per_head: num("rate_per_head"), basis_kg: num("basis_kg"), budget_overhead: num("budget_overhead"), note: String(form.get("note") ?? "") || null });
    if (error) return { error: error.message };
    done(week.week_start);
    return { ok: "Tarif overhead disimpan" };
  } catch (e) { return { error: (e as Error).message }; }
}
