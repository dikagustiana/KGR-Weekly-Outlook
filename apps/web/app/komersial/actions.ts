"use server";
import { revalidatePath } from "next/cache";
import { D, isISODate, jakartaToday, mondayOf } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { moduleSettings, requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { listWeeks } from "@/lib/data";
import { buildScorecardWeek, consumeApprovals, decide, floorGuard } from "@/lib/v3/discount";
import type { Supa } from "@/lib/supabase";
import { must, mustRows } from "@/lib/loader";

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

const weekOf = async (sb: Supa, date: string) => (await listWeeks(sb)).find((w) => w.week_start <= date && w.week_end >= date) ?? null;
const repOf = async (sb: Supa, email: string) => {
  const data = mustRows(await sb.from("sales_assignment").select("sales_rep").eq("active", true).ilike("email", email).limit(1), "komersial.sales_rep");
  return (data as { sales_rep: string }[])[0]?.sales_rep ?? null;
};
const numOf = (v: FormDataEntryValue | null) => parseNumber(String(v ?? ""));

/**
 * Spot sale (PRD v4 K8, P3.9): an Order line with channel 'spot', no PO number, for today. The server refuses it after
 * the cut-off, without spot_enabled, for a key that is not "jual hari ini", above the free fresh kg (spot_guard) and
 * under the floor without an approved discount (floor_guard_v4); the price floor check here files the request first.
 */
export async function spotSaleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m7_commercial", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const today = jakartaToday();
    const key = String(form.get("key") ?? "").trim(), customer = String(form.get("customer") ?? "").trim() || null;
    const kg = numOf(form.get("kg")), price = numOf(form.get("price"));
    if (!key) return { error: "Pilih SKU" };
    if (kg === null || !D(kg).gt(0)) return { error: "Isi kg" };
    if (price === null || !D(price).gt(0)) return { error: "Isi harga Rp/kg" };
    const week = await weekOf(sb, today);
    if (!week) return { error: `Minggu untuk ${today} belum dibuat` };
    const { covered } = await floorGuard(sb, v, await moduleSettings(), [{ key, customer, price: D(price).toFixed(4), kg: D(kg).toFixed(2), date: today }]);
    const { data, error } = await sb.from("sales_line").insert({
      week_id: week.id, date: today, delivery_date: today, status: "Order", channel: "spot", key_manual: key, customer, kg: D(kg).toFixed(2),
      price: D(price).toFixed(4), demand_status: "Confirmed", source: "Manual", sales_rep: await repOf(sb, v.email),
    }).select("id").single();
    if (error) return { error: error.message };
    await consumeApprovals(sb, covered, String((data as { id: string }).id));
    revalidatePath("/komersial");
    return { ok: `Spot ${key} ${D(kg).toFixed(0)} kg dicatat; alokasikan dan kirim dari halaman Alokasi hari ini` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Journey B: the order of an approved discount, by the sales who asked for it (one approval, one order line). */
export async function orderFromApprovalAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m7_approval", ["admin", "sales", "commercial_lead"]);
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "");
    const po = String(form.get("po_ref") ?? "").trim(), date = String(form.get("delivery_date") ?? "").trim();
    if (!po) return { error: "Isi nomor PO" };
    if (!isISODate(date) || date < jakartaToday()) return { error: "Tanggal kirim tidak valid" };
    const a = must(await sb.from("discount_approval").select("*").eq("id", id).maybeSingle(), "komersial.approval");
    const r = a as Record<string, unknown> | null;
    if (!r || r.status !== "approved") return { error: "Approval tidak ditemukan atau belum disetujui" };
    if (r.sales_line_id) return { error: "Approval ini sudah dipakai untuk order lain" };
    if (v.role !== "admin" && String(r.requested_by ?? "").toLowerCase() !== v.email.toLowerCase()) return { error: "Order dibuat oleh sales yang mengajukan approval" };
    const week = await weekOf(sb, date);
    if (!week) return { error: `Minggu untuk ${date} belum dibuat` };
    const { error } = await sb.from("sales_line").insert({
      week_id: week.id, date, delivery_date: date, status: "Order", document_ref: po, po_ref: po, key_manual: String(r.key), customer: r.customer ?? null,
      kg: String(r.kg), price: String(r.requested_price), demand_status: "Confirmed", source: "Manual", sales_rep: await repOf(sb, v.email),
    });
    if (error) return { error: error.message };
    revalidatePath("/komersial");
    return { ok: `Order ${po} ${String(r.key)} ${D(String(r.kg)).toFixed(0)} kg dibuat dengan approval diskon` };
  } catch (e) { return { error: (e as Error).message }; }
}
