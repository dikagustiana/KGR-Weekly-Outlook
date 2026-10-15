"use server";
import { revalidatePath } from "next/cache";
import { isISODate, mondayOf } from "@kgr/engine";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { buildScorecardWeek, decide } from "@/lib/v3/discount";

export type ActionState = { ok?: string; error?: string };

export async function decideAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m7_approval", ["admin", "commercial_lead", "finance"]);
    const sb = await supabaseServer();
    const msg = await decide(sb, v, String(form.get("id")), form.get("decision") === "approve", String(form.get("reason") ?? "") || null);
    revalidatePath("/komersial/approval");
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function scorecardAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m7_approval", ["admin", "commercial_lead"]);
    const w = String(form.get("week_start") ?? "");
    if (!isISODate(w)) return { error: "Minggu tidak valid" };
    const sb = await supabaseServer();
    const msg = await buildScorecardWeek(sb, mondayOf(w));
    revalidatePath("/komersial/scorecard");
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}
