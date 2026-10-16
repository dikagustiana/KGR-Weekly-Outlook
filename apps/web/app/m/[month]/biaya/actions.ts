"use server";
import { revalidatePath } from "next/cache";
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { queueRebuild } from "@/lib/rebuild";

export type ActionState = { ok?: string; error?: string };

const money = (v: FormDataEntryValue | null, dp = 2) => { const x = parseNumber(String(v ?? "")); return x === null ? null : D(x).toFixed(dp); };
const date = (v: FormDataEntryValue | null) => { const x = String(v ?? "").trim(); return x === "" ? null : isISODate(x) ? x : undefined; };

/** Add or change a fixed-cost schedule row (Finance). */
export async function saveScheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const start = date(form.get("start_date")), end = date(form.get("end_date"));
    if (!start) return { error: "Tanggal mulai wajib (YYYY-MM-DD)" };
    if (end === undefined || (end && end < start)) return { error: "Tanggal akhir tidak valid" };
    const rec = {
      pl_line: String(form.get("pl_line") ?? "").trim(), description: String(form.get("description") ?? "").trim(), amount_per_month: money(form.get("amount_per_month")),
      start_date: start, end_date: end, amortize: form.get("amortize") === "on", prepaid_total: money(form.get("prepaid_total")), intercompany: form.get("intercompany") === "on",
      vendor: String(form.get("vendor") ?? "").trim() || null, active: form.get("active") === "on", note: String(form.get("note") ?? "").trim() || null,
    };
    if (!rec.pl_line || !rec.description) return { error: "Pos P&L dan keterangan wajib" };
    const id = String(form.get("id") ?? "");
    const { error } = id ? await sb.from("fixed_cost_schedule").update(rec).eq("id", id) : await sb.from("fixed_cost_schedule").insert(rec);
    if (error) return { error: error.message };
    revalidatePath(`/m/${String(form.get("month"))}/biaya`);
    return { ok: id ? "Jadwal biaya diperbarui" : "Jadwal biaya ditambah" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Driver of one account (driver columns only; the chart of accounts stays Admin's). */
export async function saveDriverAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const t = String(form.get("driver_type"));
    if (!["fixed", "variable", "runrate", "event", "none"].includes(t)) return { error: "Driver tidak dikenal" };
    const basis = String(form.get("driver_basis") ?? "");
    const { error } = await sb.from("coa_map").update({
      driver_type: t, rp_per_kg: money(form.get("rp_per_kg"), 4), intercompany: form.get("intercompany") === "on",
      driver_basis: ["kg_cut", "kg_sold", "kg_lb"].includes(basis) ? basis : null,
    }).eq("account", String(form.get("account")));
    if (error) return { error: error.message };
    revalidatePath(`/m/${String(form.get("month"))}/biaya`);
    return { ok: "Driver akun disimpan" };
  } catch (e) { return { error: (e as Error).message }; }
}

// ------------------------------------------------------------------------------------------------ PRD v4 §3.3 / §6.6

const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const done = (m: FormDataEntryValue | null) => { revalidatePath(`/m/${String(m)}/biaya`); revalidatePath(`/m/${String(m)}`); };

/**
 * One row of template 8.3, edited inline (Finance). A changed nominal on an existing row needs a reason and raises the
 * version; the COA must carry the fixed driver. The month is rebuilt by the queue afterwards.
 */
export async function saveFixedV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const start = date(form.get("start_date")), end = date(form.get("end_date"));
    if (!start) return { error: "Berlaku dari wajib (YYYY-MM-DD)" };
    if (end === undefined || (end && end < start)) return { error: "Berlaku sampai tidak valid" };
    const account = txt(form.get("account"));
    if (!account) return { error: "COA wajib" };
    const { data: coa } = await sb.from("coa_map").select("account, name, pl_line, driver_type").eq("account", account).is("deleted_at", null).maybeSingle();
    const c = coa as { account: string; name: string | null; pl_line: string | null; driver_type: string | null } | null;
    if (!c || !c.pl_line) return { error: `COA ${account} tidak ada di master akun` };
    if (c.driver_type !== "fixed") return { error: `COA ${account} berdriver ${c.driver_type ?? "belum ada"}, bukan Tetap` };
    const amount = money(form.get("amount_per_month"));
    if (amount === null || !D(amount).gt(0)) return { error: "Nominal per bulan harus lebih dari 0" };
    const basis = String(form.get("day_basis") ?? "calendar");
    if (basis !== "calendar" && basis !== "working") return { error: "Basis bagi: kalender atau kerja" };
    const pd = String(form.get("posting_day") ?? "").trim();
    const posting = pd === "" ? null : Number(pd);
    if (posting !== null && (!Number.isInteger(posting) || posting < 1 || posting > 31)) return { error: "Jadwal posting: tanggal 1–31" };
    const note = txt(form.get("note"));
    const id = String(form.get("id") ?? "");
    let version = 1;
    if (id) {
      const { data: cur } = await sb.from("fixed_cost_schedule").select("amount_per_month, version").eq("id", id).maybeSingle();
      const r = cur as { amount_per_month: string | null; version: number | null } | null;
      if (!r) return { error: "Baris tidak ditemukan" };
      const changed = r.amount_per_month === null || !D(String(r.amount_per_month)).eq(D(amount));
      if (changed && !note) return { error: "Nominal berubah: tulis alasannya di catatan" };
      version = Number(r.version ?? 1) + (changed ? 1 : 0);
    }
    const rec = {
      account, pl_line: c.pl_line, description: txt(form.get("basis_doc")) ?? `${c.name ?? account} (template 8.3)`, amount_per_month: amount, start_date: start, end_date: end,
      day_basis: basis, posting_day: posting, basis_doc: txt(form.get("basis_doc")), owner: txt(form.get("owner")), note, version, active: true, updated_by: v.email,
      ...(id ? {} : { code: `T83|${account}|${start}` }),
    };
    const { error } = id ? await sb.from("fixed_cost_schedule").update(rec).eq("id", id) : await sb.from("fixed_cost_schedule").insert(rec);
    if (error) return { error: error.message };
    await queueRebuild(sb, [String(form.get("month")).length === 7 ? `${String(form.get("month"))}-01` : String(form.get("month"))], "biaya tetap (template 8.3)");
    done(form.get("month"));
    return { ok: id ? `Baris diperbarui (versi ${version})` : "Baris ditambah" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** A one-off cost (cost_event): never averaged into the run-rate (§3.3). Entered as a positive cost. */
export async function costEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const d = date(form.get("date"));
    if (!d) return { error: "Tanggal wajib (YYYY-MM-DD)" };
    const pl = txt(form.get("pl_line"));
    const reason = txt(form.get("reason"));
    const amount = money(form.get("amount"));
    if (!pl || !reason) return { error: "Pos P&L dan alasan wajib" };
    if (amount === null || !D(amount).gt(0)) return { error: "Jumlah harus lebih dari 0 (biaya ditulis positif)" };
    const { error } = await sb.from("cost_event").insert({ date: d, account: txt(form.get("account")), pl_line: pl, amount, reason, owner: txt(form.get("owner")) ?? v.email, document_ref: txt(form.get("document_ref")), source: "Manual" });
    if (error) return { error: error.message };
    await queueRebuild(sb, [d], "cost_event");
    done(form.get("month"));
    return { ok: "Biaya satu kali dicatat" };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteCostEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m5_drivers", ["admin", "finance"]);
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "");
    const { data: ev } = await sb.from("cost_event").select("date").eq("id", id).maybeSingle();
    if (!ev) return { error: "Event tidak ditemukan" };
    const { error } = await sb.from("cost_event").update({ deleted_at: new Date().toISOString(), deleted_by: v.email }).eq("id", id);
    if (error) return { error: error.message };
    await queueRebuild(sb, [String((ev as { date: string }).date)], "cost_event dihapus");
    done(form.get("month"));
    return { ok: "Event dihapus" };
  } catch (e) { return { error: (e as Error).message }; }
}
