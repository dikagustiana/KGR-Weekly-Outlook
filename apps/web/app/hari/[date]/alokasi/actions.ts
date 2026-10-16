"use server";
import { revalidatePath } from "next/cache";
import { isISODate } from "@kgr/engine";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { parseNumber } from "@kgr/parsers";
import { allocateDay, cutoffDay } from "@/lib/v3/allocation";
import { recordDelivery } from "@/lib/v3/delivery";

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

/** Terkirim with kg (PRD v4 K7): a delivery row; the line becomes Aktual only when nothing is outstanding. */
export async function deliverAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m3_planning", ["admin", "inventory_accounting", "sales", "commercial_lead"]);
    const date = dateOf(form);
    const sb = await supabaseServer();
    const kg = parseNumber(String(form.get("kg") ?? ""));
    const msg = await recordDelivery(sb, v, { id: String(form.get("id")), date, kg: kg === null ? null : String(kg), documentRef: String(form.get("document_ref") ?? "").trim() || null });
    revalidatePath(`/hari/${date}/alokasi`);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}
