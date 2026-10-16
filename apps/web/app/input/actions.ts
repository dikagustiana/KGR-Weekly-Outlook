"use server";
/**
 * PRD v5 §4.9 / §6.4 actions (flag v5_input): save a validated upload (the server checks again, K34), Finance's
 * reminder to the owners of red cells and the K35 override, the operations director's LB price decision (K25), and a
 * refresh of today's tasks. Numbers are entered or come from the engine; nothing is computed here.
 */
import { revalidatePath } from "next/cache";
import { D, addDays, isISODate, mondayOf } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { requireModuleAction, moduleSettings } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { WriteError } from "@/lib/write";
import { processRebuildQueue, queueRebuild } from "@/lib/rebuild";
import { addOverride } from "@/lib/v4/release-override";
import { jakartaNow } from "@/lib/v3/allocation";
import { UploadRejected, isUploadKind, parseGridPayload } from "@/lib/v5/input-check";
import { saveUploadV5 } from "@/lib/v5/input-save";
import { ROLE_KINDS } from "@/lib/v5/input";
import type { Role } from "@/lib/roles";

export type ActionState = { ok?: string; error?: string };
type Row = Record<string, unknown>;
const fail = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : String(e) });
const UPLOADERS = Object.keys(ROLE_KINDS) as Role[];

export async function saveUploadAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const viewer = await requireModuleAction("v5_input", UPLOADERS);
    const kind = String(form.get("kind") ?? "");
    if (!isUploadKind(kind)) throw new WriteError("Jenis upload tidak dikenal");
    let grid;
    try { grid = parseGridPayload(String(form.get("grid") ?? "")); } catch (e) { throw new WriteError(e instanceof UploadRejected ? e.message : "Isi upload tidak terbaca"); }
    const msg = await saveUploadV5(await supabaseServer(), viewer, {
      kind, grid, fingerprint: String(form.get("fingerprint") ?? ""), fileName: String(form.get("file_name") ?? ""), reason: String(form.get("reason") ?? ""),
    });
    const r = await processRebuildQueue(await moduleSettings());
    revalidatePath("/input");
    return { ok: `${msg}${r.notes.length ? ` Rebuild: ${r.done} selesai${r.failed ? `, ${r.failed} gagal` : ""}.` : ""}` };
  } catch (e) { return fail(e); }
}

/** Finance reminds the owners of this week's red cells (journey P); the owner's Input screen lists it. */
export async function remindAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_input", ["admin", "finance"]);
    const ws = String(form.get("week_start") ?? "");
    if (!isISODate(ws) || mondayOf(ws) !== ws) throw new WriteError("Minggu tidak valid");
    const sb = await supabaseServer();
    const n = jakartaNow(), now = `${n.date}T${n.time}:00+07:00`;
    const { data } = await sb.from("input_completeness_daily").select("date, kind, owner_role, status, due_at, note").gte("date", ws).lte("date", form.get("week_end") ? String(form.get("week_end")) : ws);
    const red = ((data ?? []) as Row[]).filter((c) => c.status === "late" || (c.status === "not_due" && c.due_at && Date.parse(String(c.due_at)) <= Date.parse(now)));
    if (!red.length) return { ok: "Tidak ada sel merah; tidak ada pengingat yang dikirim." };
    const e = await sb.from("input_reminder").insert(red.map((c) => ({ date: c.date, kind: c.kind, owner_role: c.owner_role, note: c.note ?? null })));
    if (e.error) throw new WriteError(e.error.message);
    revalidatePath("/input");
    return { ok: `Pengingat dikirim ke ${new Set(red.map((c) => String(c.owner_role))).size} pemilik (${red.length} sel).` };
  } catch (e) { return fail(e); }
}

/** K35: Finance releases a week with red cells by recording the reason (release_override, code K35). */
export async function k35OverrideAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const viewer = await requireModuleAction("v5_input", ["finance"]);
    const ws = String(form.get("week_start") ?? "");
    if (!isISODate(ws) || mondayOf(ws) !== ws) throw new WriteError("Minggu tidak valid");
    const msg = await addOverride(await supabaseServer(), viewer, { scopeKind: "week", scope: ws, code: "K35", reason: String(form.get("reason") ?? ""), evidence: String(form.get("evidence") ?? "") });
    revalidatePath("/input");
    return { ok: `${msg}. Rilis minggu ${ws} di halaman Rilis.` };
  } catch (e) { return fail(e); }
}

/** K25: the operations director decides the LB price (and volume) for a cut date; a decision is never edited. */
export async function decideLbPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_input", ["admin", "operations_director"]);
    const date = String(form.get("date") ?? "");
    if (!isISODate(date)) throw new WriteError("Tanggal potong tidak valid");
    const price = parseNumber(String(form.get("price") ?? "").trim());
    if (price === null || D(price).lte(0)) throw new WriteError("Harga LB wajib diisi (Rp/kg LB)");
    const volRaw = String(form.get("volume") ?? "").trim();
    const volume = volRaw ? parseNumber(volRaw) : null;
    const cls = String(form.get("weight_class") ?? "").trim() || null;
    const sb = await supabaseServer();
    const e = await sb.from("lb_price_decision").insert({ date, price, volume_kg_lb: volume, weight_class: cls, note: String(form.get("note") ?? "").trim() || null });
    if (e.error) throw new WriteError(e.error.message);
    // the decision queues its date itself (trigger needs_rebuild, v5/0): the director does not write the queue
    await processRebuildQueue(await moduleSettings());
    revalidatePath("/input");
    return { ok: `Harga LB potong ${date} diputuskan Rp ${price}/kg${volume ? `, volume ${volume} kg` : ""}; batch hari itu memakainya (sementara).` };
  } catch (e) { return fail(e); }
}

/** Rebuild today's tasks and grid (the daily job runs from the rebuild queue; there is no cron in the repository). */
export async function refreshTasksAction(_: ActionState): Promise<ActionState> {
  try {
    await requireModuleAction("v5_input", ["admin", "finance", "inventory_accounting", "sales", "ppic", "purchasing", "commercial_lead", "cost_accounting"]);
    const sb = await supabaseServer();
    const t = jakartaNow().date;
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, -i));
    await queueRebuild(sb, days, "tugas input");
    const r = await processRebuildQueue(await moduleSettings());
    revalidatePath("/input");
    return { ok: `Tugas diperbarui: ${r.done} hari${r.failed ? `, ${r.failed} gagal` : ""}. ${r.notes.slice(0, 1).join("")}`.trim() };
  } catch (e) { return fail(e); }
}
