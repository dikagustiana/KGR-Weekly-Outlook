"use server";
/**
 * PRD v5 §4.6 actions (flag v5_commercial): next week's commitments (K26: Sales drafts for assigned SKUs, the
 * commercial lead locks; a version after the lock needs a reason — enforced by public.tg_commitment_guard), the price
 * list of next week locked with them (K24), and the answer to PPIC's surplus. Numbers are entered, never computed here.
 */
import { revalidatePath } from "next/cache";
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { fetchAll } from "@/lib/data";
import { WriteError } from "@/lib/write";
import { must } from "@/lib/loader";
import { refreshTasks } from "@/lib/v5/task-queue";
import { surplusKeys } from "@/lib/v5/surplus";

export type ActionState = { ok?: string; error?: string };
type Row = Record<string, unknown>;
const num = (v: FormDataEntryValue | null) => { const t = String(v ?? "").trim(); return t === "" ? null : parseNumber(t); };
const done = () => { revalidatePath("/komersial"); };
/** Equal as numbers; empty = null. */
const same = (a: unknown, b: unknown) => { const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : D(String(v))); const x = n(a), y = n(b); return x === null || y === null ? x === y : x.eq(y); };

/**
 * Next week's commitments, saved as drafts (PRD v5.2 R55, A-CST-8). Only what changed is written: each row is compared with
 * the current state in the database (a draft shadows the locked version; an unchanged locked row makes no new version),
 * and everything that changed goes in ONE request — a draft that exists is updated by its id, a new version (after a
 * lock, with a reason) is inserted without one — so the request is one transaction: all rows or none (PostgREST
 * `upsert … onConflict: "id"`, proven against PostgREST 12.2.3 on a local database: docs/v5.2/a2.md).
 */
export async function saveCommitmentsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    if (!isISODate(week)) throw new WriteError("Minggu tidak valid");
    const reason = String(form.get("reason") ?? "").trim() || null;
    const n = Number(form.get("n") ?? 0);
    const wanted = new Map<string, { fresh: string | null; frozen: string | null; price: string | null }>();
    for (let i = 0; i < n; i++) {
      const key = String(form.get(`key_${i}`) ?? "");
      const fresh = num(form.get(`fresh_${i}`)), frozen = num(form.get(`frozen_${i}`)), price = num(form.get(`price_${i}`));
      if (!key || (fresh === null && frozen === null && price === null)) continue;
      wanted.set(key, { fresh, frozen, price });
    }
    const current = await fetchAll<Row>((a, b) => sb.from("sales_commitment").select("id, key, size_kg, fresh_kg, frozen_kg, price, status, version, reason")
      .eq("week_start", week).is("deleted_at", null).neq("status", "superseded").order("id").range(a, b));
    const rows: Row[] = [];
    let updated = 0, inserted = 0, unchanged = 0;
    for (const [key, v] of wanted) {
      const mine = current.filter((c) => String(c.key) === key && (c.size_kg === null || c.size_kg === undefined));
      const draft = mine.find((c) => c.status === "draft"), locked = mine.find((c) => c.status === "locked");
      const now = draft ?? locked;
      if (now && same(now.fresh_kg, v.fresh ?? "0") && same(now.frozen_kg, v.frozen ?? "0") && same(now.price, v.price)) { unchanged++; continue; }
      const rec = { week_start: week, key, fresh_kg: v.fresh ?? "0", frozen_kg: v.frozen ?? "0", price: v.price ?? null };
      // a draft updated through the upsert goes through the insert guard first: it needs the reason a new version needs
      if (draft) { rows.push({ id: String(draft.id), ...rec, reason: reason ?? (draft.reason ? String(draft.reason) : null) }); updated++; }
      else { rows.push({ ...rec, reason }); inserted++; }
    }
    if (!rows.length) return { ok: `Tidak ada perubahan: ${unchanged} SKU sama dengan yang tersimpan, tidak ada draft atau versi baru dibuat` };
    const { error } = await sb.from("sales_commitment").upsert(rows, { onConflict: "id", defaultToNull: false });
    if (error) throw new WriteError(`Tidak ada komitmen yang disimpan: ${error.message}`);
    done();
    // the lock task shows "masuk, ada catatan" while drafts wait next to a lock: its grid cell is refreshed now
    const tail = await refreshTasks(sb, [{ kind: "commitment_lock", anchors: [week] }], "komitmen disimpan");
    return { ok: `${rows.length} SKU komitmen disimpan sebagai draft (${updated} draft diperbarui, ${inserted} versi baru); ${unchanged} SKU tidak berubah.${tail}` };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Kepala Sales: lock every draft of the week and the price list of the week in one transaction (PRD v5.1 K46, RPC
 * public.lock_commitments): a new version without a reason locks nothing; the price list takes the fresh price of the
 * commitment and the frozen price of the form (fields `price_frozen|<key>`), else the frozen reference price of the
 * running week. The action calls the RPC; then (R54) it queues the due date of the lock tasks and processes the queue, so the
 * grid cell is green without a manual refresh.
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
    const tail = await refreshTasks(sb, [{ kind: "commitment_lock", anchors: [week] }, { kind: "price_list_lock", anchors: [week] }], "komitmen dikunci");
    const k = Number(data ?? 0), f = Object.keys(frozen).length;
    return { ok: `${k} draft komitmen dikunci bersama price list minggu depan${f ? `; harga frozen dari form untuk ${f} SKU` : ""}${tail}` };
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

/**
 * Answer to the surplus of PPIC's latest plan: absorb all / absorb part (kg, price) / reduce the cut. R56: the SKU is the field
 * `key` of the form (the surplus row answered), checked against the surplus list of the plan; the surplus kg is the plan's.
 * R54: the plan's date is queued after the answer is saved.
 */
export async function answerSurplusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_commercial", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const week = String(form.get("week_start") ?? "");
    const response = String(form.get("response") ?? "");
    if (!["absorb", "partial", "reduce"].includes(response)) throw new WriteError("Pilih jawaban surplus");
    const plan = must(await sb.from("plan_week").select("id, week_start, surplus_kg_by_key").eq("week_start", week).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle(), "komersial.plan_week") as Row | null;
    if (!plan) throw new WriteError("Belum ada rencana PPIC tersimpan untuk minggu ini");
    const key = String(form.get("key") ?? "").trim();
    if (!key) throw new WriteError("Pilih SKU surplus yang dijawab");
    const row = surplusKeys(plan.surplus_kg_by_key as Record<string, unknown>).find((s) => s.key === key);
    if (!row) throw new WriteError(`SKU ${key} tidak ada di daftar surplus rencana`);
    const kg = num(form.get("absorb_kg")), price = num(form.get("price"));
    if (response === "partial" && kg === null) throw new WriteError("Isi kg yang sanggup diserap");
    const { error } = await sb.from("surplus_response").insert({
      plan_week_id: String(plan.id), key, surplus_kg: row.kg, response,
      absorb_kg: response === "reduce" ? null : kg, price, note: String(form.get("note") ?? "").trim() || null,
    });
    if (error) throw new WriteError(error.message);
    done();
    revalidatePath(`/w/${week}/rencana`);
    const tail = await refreshTasks(sb, [{ kind: "plan_week", anchors: [String(plan.week_start)] }], "jawaban surplus");
    return { ok: `Jawaban terkirim ke PPIC.${tail}` };
  } catch (e) { return { error: (e as Error).message }; }
}
