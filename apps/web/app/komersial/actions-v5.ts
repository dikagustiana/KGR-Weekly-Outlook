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
import { must } from "@/lib/loader";

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
      const draft = must(await sb.from("sales_commitment").select("id").eq("week_start", week).eq("key", key).eq("status", "draft").is("deleted_at", null).maybeSingle(), "komersial.draft");
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

/**
 * Kepala Sales: lock every draft of the week and the price list of the week in one transaction (PRD v5.1 K46, RPC
 * public.lock_commitments): a new version without a reason locks nothing; the price list takes the fresh price of the
 * commitment and the frozen price of the form (fields `price_frozen|<key>`), else the frozen reference price of the
 * running week. The action only calls the RPC.
 */
export async function lockCommitmentsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    if (!isISODate(week)) throw new WriteError("Minggu tidak valid");
    const frozen = frozenPrices(form);
    const { data, error } = await sb.rpc("lock_commitments", { p_week_start: week, p_price_frozen: frozen });
    if (error) throw new WriteError(error.message);
    done();
    const n = Number(data ?? 0), f = Object.keys(frozen).length;
    return { ok: `${n} draft komitmen dikunci bersama price list minggu depan${f ? `; harga frozen dari form untuk ${f} SKU` : ""}` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** `price_frozen|<key>` fields of the lock form → { key: price } (empty fields left out: the RPC takes the reference price). */
function frozenPrices(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, v] of form.entries()) {
    if (!name.startsWith("price_frozen|")) continue;
    const p = num(v);
    if (p === null) continue;
    if (!/^\d+(\.\d+)?$/.test(p) || Number(p) <= 0) throw new WriteError(`Harga frozen ${name.slice(13)} tidak valid`);
    out[name.slice(13)] = p;
  }
  return out;
}

/** Answer to the surplus of PPIC's latest plan: absorb all / absorb part (kg, price) / reduce the cut. */
export async function answerSurplusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    const response = String(form.get("response") ?? "");
    if (!["absorb", "partial", "reduce"].includes(response)) throw new WriteError("Pilih jawaban surplus");
    const plan = must(await sb.from("plan_week").select("id").eq("week_start", week).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle(), "komersial.plan_week");
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
