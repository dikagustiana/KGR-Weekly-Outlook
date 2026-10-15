"use server";
import { revalidatePath } from "next/cache";
import { isISODate } from "@kgr/engine";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { applyChanges } from "@/lib/write";
import { canWriteRow, TABLES } from "@/lib/tables";
import { queueRebuild } from "@/lib/rebuild";
import { allocateDay, cutoffDay } from "@/lib/v3/allocation";

export type ActionState = { ok?: string; error?: string };

const dateOf = (form: FormData) => {
  const d = String(form.get("date") ?? "");
  if (!isISODate(d)) throw new Error("Tanggal tidak valid");
  return d;
};

export async function allocateAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m3_planning", ["admin", "ppic", "sales", "commercial_lead"]);
    const date = dateOf(form);
    const sb = await supabaseServer();
    const msg = await allocateDay(sb, v, date);
    revalidatePath(`/hari/${date}/alokasi`);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function cutoffAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m3_planning", ["admin", "ppic"]);
    const date = dateOf(form);
    const sb = await supabaseServer();
    const msg = await cutoffDay(sb, v, date);
    revalidatePath(`/hari/${date}/alokasi`);
    return { ok: msg + " — ledger dibangun ulang saat antrian diproses" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Terkirim (v1 rule: the Order line becomes Aktual) + fulfilled_kg, so the allocated lots become the line's out_sale. */
export async function deliverAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m3_planning", ["admin", "sales", "commercial_lead"]);
    const date = dateOf(form);
    const id = String(form.get("id"));
    const sb = await supabaseServer();
    const { data: old } = await sb.from("sales_line").select("*").eq("id", id).maybeSingle();
    if (!old || !canWriteRow(v.role, TABLES.sales_line, { ...(old as Record<string, unknown>), status: "Aktual" })) return { error: "Tidak berwenang" };
    const o = old as Record<string, unknown>;
    await applyChanges(sb, "sales_line", [], [{ id, status: "Aktual", confirmed_by: v.email, fulfilled_kg: o.kg }]);
    await queueRebuild(sb, [date], "terkirim");
    revalidatePath(`/hari/${date}/alokasi`);
    return { ok: "PO ditandai terkirim (Aktual)" };
  } catch (e) { return { error: (e as Error).message }; }
}
