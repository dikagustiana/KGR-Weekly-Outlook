"use server";
/**
 * PRD v5 §4.6 actions (flag v5_commercial): next week's commitments (K26: Sales drafts for assigned SKUs, the
 * commercial lead locks; a version after the lock needs a reason — enforced by public.tg_commitment_guard), the price
 * list of next week locked with them (K24), and the answer to PPIC's surplus. Numbers are entered, never computed here.
 */
import { revalidatePath } from "next/cache";
import { isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { WriteError } from "@/lib/write";

export type ActionState = { ok?: string; error?: string };
type Row = Record<string, unknown>;
const num = (v: FormDataEntryValue | null) => { const t = String(v ?? "").trim(); return t === "" ? null : parseNumber(t); };
const done = () => { revalidatePath("/komersial"); };

export async function saveCommitmentsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    if (!isISODate(week)) throw new WriteError("Minggu tidak valid");
    const reason = String(form.get("reason") ?? "").trim() || null;
    const n = Number(form.get("n") ?? 0);
    let saved = 0;
    for (let i = 0; i < n; i++) {
      const key = String(form.get(`key_${i}`) ?? "");
      const fresh = num(form.get(`fresh_${i}`)), frozen = num(form.get(`frozen_${i}`)), price = num(form.get(`price_${i}`));
      if (!key || (fresh === null && frozen === null && price === null)) continue;
      const rec = { fresh_kg: fresh ?? "0", frozen_kg: frozen ?? "0", price: price ?? null };
      const { data: draft } = await sb.from("sales_commitment").select("id").eq("week_start", week).eq("key", key).eq("status", "draft").is("deleted_at", null).maybeSingle();
      const r = draft
        ? await sb.from("sales_commitment").update(rec).eq("id", String((draft as Row).id))
        : await sb.from("sales_commitment").insert({ week_start: week, key, ...rec, reason });
      if (r.error) throw new WriteError(`${key}: ${r.error.message}`);
      saved++;
    }
    done();
    return { ok: `${saved} SKU komitmen disimpan sebagai draft` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Kepala Sales: lock every draft of the week and the price list of the week (from the commitment prices). */
export async function lockCommitmentsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    if (!isISODate(week)) throw new WriteError("Minggu tidak valid");
    const { data: drafts, error } = await sb.from("sales_commitment").select("id, key, price").eq("week_start", week).eq("status", "draft").is("deleted_at", null);
    if (error) throw new WriteError(error.message);
    for (const d of (drafts ?? []) as Row[]) {
      const u = await sb.from("sales_commitment").update({ status: "locked" }).eq("id", String(d.id));
      if (u.error) throw new WriteError(`${String(d.key)}: ${u.error.message}`);
    }
    const { data: locked } = await sb.from("sales_commitment").select("key, price").eq("week_start", week).eq("status", "locked").is("deleted_at", null);
    const prices = ((locked ?? []) as Row[]).filter((r) => r.price !== null && r.price !== undefined);
    for (const p of prices) {
      const { data: cur } = await sb.from("price_list_week").select("locked_at").eq("week_start", week).eq("key", String(p.key)).maybeSingle();
      if ((cur as Row | null)?.locked_at) continue;
      const w = await sb.from("price_list_week").upsert({ week_start: week, key: String(p.key), price_fresh: String(p.price) }, { onConflict: "week_start,key" });
      if (w.error) throw new WriteError(`price list ${String(p.key)}: ${w.error.message}`);
      const l = await sb.from("price_list_week").update({ locked_at: new Date().toISOString() }).eq("week_start", week).eq("key", String(p.key));
      if (l.error) throw new WriteError(`price list ${String(p.key)}: ${l.error.message}`);
    }
    done();
    return { ok: `${(drafts ?? []).length} SKU komitmen dikunci; price list ${prices.length} SKU dikunci` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Answer to the surplus of PPIC's latest plan: absorb all / absorb part (kg, price) / reduce the cut. */
export async function answerSurplusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    const response = String(form.get("response") ?? "");
    if (!["absorb", "partial", "reduce"].includes(response)) throw new WriteError("Pilih jawaban surplus");
    const { data: plan } = await sb.from("plan_week").select("id").eq("week_start", week).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!plan) throw new WriteError("Belum ada rencana PPIC tersimpan untuk minggu ini");
    const kg = num(form.get("absorb_kg")), price = num(form.get("price"));
    if (response === "partial" && kg === null) throw new WriteError("Isi kg yang sanggup diserap");
    const { error } = await sb.from("surplus_response").insert({
      plan_week_id: String((plan as Row).id), key: "RPA|Karkas", surplus_kg: String(form.get("surplus_kg") ?? "0") || "0", response,
      absorb_kg: response === "reduce" ? null : kg, price, note: String(form.get("note") ?? "").trim() || null,
    });
    if (error) throw new WriteError(error.message);
    done();
    revalidatePath(`/w/${week}/rencana`);
    return { ok: "Jawaban terkirim ke PPIC" };
  } catch (e) { return { error: (e as Error).message }; }
}
