"use server";
import { revalidatePath } from "next/cache";
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { moduleSettings, requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { moduleSettingsGlobal, processRebuildQueue } from "@/lib/rebuild";

export type ActionState = { ok?: string; error?: string };

async function rebuild() {
  const r = await processRebuildQueue(moduleSettingsGlobal(await moduleSettings()));
  return r.failed ? ` Bangun ulang: ${r.failed} gagal.` : !r.done && r.notes.length ? ` ${r.notes[0]}` : "";
}

/** Opname / lot correction (PRD v3 §2 lot_adjust): a manual lot_movement, read by the ledger as an input. */
export async function adjustLot(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m2_ledger", ["admin", "inventory_accounting"]);
    const date = String(form.get("date")), key = String(form.get("key")), lot = String(form.get("lot_ref") || "") || null;
    const kg = parseNumber(String(form.get("kg") ?? ""));
    if (!isISODate(date) || kg === null || D(kg).isZero()) return { error: "Isi tanggal dan kg (+ masuk / − keluar)" };
    const sb = await supabaseServer();
    const { error } = await sb.from("lot_movement").insert({
      movement_ref: `manual:${crypto.randomUUID()}`, lot_ref: lot ?? `adjust:${key}`, date, type: "adjust", kg: D(kg).toFixed(2), ref_table: "manual",
      key, note: String(form.get("note") ?? "") || "opname",
    });
    if (error) return { error: error.message };
    const msg = await rebuild();
    revalidatePath("/sku", "layout");
    return { ok: `Penyesuaian ${kg} kg dicatat.${msg}` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Blast fresh → frozen of one lot (PRD v3 §4.3). Cut-off blasts come from the allocation page (M3). */
export async function blastLot(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m2_ledger", ["admin", "ppic"]);
    const date = String(form.get("date")), lot = String(form.get("lot_ref")), key = String(form.get("key"));
    const kg = parseNumber(String(form.get("kg") ?? ""));
    if (!isISODate(date) || !lot || kg === null || !D(kg).gt(0)) return { error: "Isi tanggal, lot dan kg > 0" };
    const sb = await supabaseServer();
    const { error } = await sb.from("blast_event").insert({ date, lot_ref_from: lot, key_from: key, kg: D(kg).toFixed(2), reason: String(form.get("reason") || "planned"), note: String(form.get("note") ?? "") || null });
    if (error) return { error: error.message };
    const msg = await rebuild();
    revalidatePath("/sku", "layout");
    return { ok: `Blast ${kg} kg dicatat.${msg}` };
  } catch (e) { return { error: (e as Error).message }; }
}
