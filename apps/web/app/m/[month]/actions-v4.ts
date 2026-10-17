"use server";
/**
 * Actions of the v4 monthly outlook (PRD v4 §6.2, §6.6): only Finance and Admin; each one re-checks the role on the
 * server and writes through RLS (the browser never sends a computed number). The marts are rebuilt by the queue
 * (service role, S1), never by these actions.
 */
import { revalidatePath } from "next/cache";
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import { moduleSettings, requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { moduleSettingsGlobal, processRebuildQueue, queueRebuild } from "@/lib/rebuild";
import { agreeAssumption, lockVersionV4 } from "@/lib/v4/month";
import { addOverride, withdrawOverride } from "@/lib/v4/release-override";
import { must, mustRows } from "@/lib/loader";
import { finalizeMonthV4 } from "@/lib/v4/close";
import { monthStart } from "@/lib/v3/drivers";

export type ActionState = { ok?: string; error?: string };

const monthOf = (form: FormData) => {
  const m = monthStart(String(form.get("month") ?? ""));
  if (!m) throw new Error("Bulan tidak valid");
  return m;
};
const money = (v: FormDataEntryValue | null) => { const x = parseNumber(String(v ?? "")); return x === null ? null : D(x).toFixed(2); };
const done = (m: string) => { revalidatePath(`/m/${m.slice(0, 7)}`); revalidatePath(`/m/${m.slice(0, 7)}/biaya`); };

/** "Bangun ulang": queue the month and process the queue with the service role (S1). */
export async function rebuildMonthV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const sb = await supabaseServer();
    await queueRebuild(sb, [first], "tombol Bangun ulang (bulan)");
    const r = await processRebuildQueue(moduleSettingsGlobal(await moduleSettings()));
    done(first);
    if (r.failed) return { error: r.notes.filter((n) => n.includes("GAGAL")).join("; ") || "Bangun ulang gagal" };
    return { ok: r.notes.join("; ") || "Antrean kosong" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Budget of the month: a revision is a new version (never an overwrite); total segment "Total". */
export async function budgetV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const sb = await supabaseServer();
    const metrics = { revenue: money(form.get("budget_revenue")), gp: money(form.get("budget_gp")), opex: money(form.get("budget_opex")), nibt: money(form.get("budget_nibt")), kg: money(form.get("budget_kg")) };
    const given = Object.entries(metrics).filter(([, x]) => x !== null) as [string, string][];
    if (!given.length) return { error: "Isi paling sedikit satu angka budget" };
    const have = mustRows(await sb.from("budget").select("version, segment, metric, value").eq("month", first).is("deleted_at", null), "month.budget");
    const rows = (have ?? []) as { version: number; segment: string; metric: string; value: string }[];
    const latest = rows.reduce((m, r) => Math.max(m, Number(r.version)), 0);
    const cur = rows.filter((r) => Number(r.version) === latest);
    const same = latest > 0 && cur.length === given.length && given.every(([m, x]) => cur.some((r) => r.segment === "Total" && r.metric === m && D(String(r.value)).eq(D(x))));
    if (same) return { ok: `Budget sama dengan versi ${latest}, tidak ada perubahan` };
    const ver = latest + 1;
    const ins = await sb.from("budget").insert(given.map(([metric, value]) => ({ version: ver, month: first, segment: "Total", metric, value, approved_by: v.email, approved_at: new Date().toISOString(), source: "Manual" })));
    if (ins.error) return { error: ins.error.message };
    await queueRebuild(sb, [first], "budget");
    done(first);
    return { ok: `Budget versi ${ver} disimpan` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Cut-off override (empty = the day after the last uploaded journal day, as the rebuild decides). */
export async function cutOffV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const co = String(form.get("cut_off_date") ?? "").trim();
    if (co && !isISODate(co)) return { error: "Cut-off tidak valid" };
    const sb = await supabaseServer();
    const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "month.month_outlook");
    let id = (mo as { id: string } | null)?.id;
    if (!id) { const ins = await sb.from("month_outlook").insert({ month: first, status: "open" }).select("id").single(); if (ins.error) return { error: ins.error.message }; id = (ins.data as { id: string }).id; }
    const u = await sb.from("month_outlook").update({ cut_off_date: co || null }).eq("id", id);
    if (u.error) return { error: u.error.message };
    await queueRebuild(sb, [first], "cut-off");
    done(first);
    return { ok: co ? `Cut-off diset ${co}` : "Cut-off kembali otomatis" };
  } catch (e) { return { error: (e as Error).message }; }
}

/** An assumption of the register is agreed by its owner (anomaly days need a reason). */
export async function agreeV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const sb = await supabaseServer();
    const note = String(form.get("note") ?? "").trim() || null;
    const msg = await agreeAssumption(sb, v, String(form.get("id") ?? ""), note);
    await queueRebuild(sb, [first], "register");
    done(first);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Lock V1 or V2 (K9). FINAL stays on the closing page until irisan 4. */
export async function lockV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const version = String(form.get("version"));
    if (version !== "V1" && version !== "V2") return { error: "Versi tidak dikenal" };
    const sb = await supabaseServer();
    const r = await lockVersionV4(sb, v, first, version, moduleSettingsGlobal(await moduleSettings()));
    done(first);
    return { ok: r.message };
  } catch (e) { return { error: (e as Error).message }; }
}

/** PRD v4 §7.2: override of one control for a month version ("2026-08-01:V1"), reason and evidence; RLS names the roles. */
export async function overrideMonthAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m4_monthly", ["admin", "finance", "cost_accounting"]);
    const first = monthOf(form);
    const version = String(form.get("version"));
    if (version !== "V1" && version !== "V2" && version !== "FINAL") return { error: "Versi tidak dikenal" };
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "");
    const msg = id
      ? await withdrawOverride(sb, v, id)
      : await addOverride(sb, v, { scopeKind: "month", scope: `${first}:${version}`, code: String(form.get("code") ?? ""), reason: String(form.get("reason") ?? ""), evidence: String(form.get("evidence") ?? "") });
    done(first);
    revalidatePath(`/m/${first.slice(0, 7)}/tutup-buku`);
    return { ok: msg };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Tutup buku: lock FINAL (public.release_month), calibration for the next month, then the accuracy mart via the queue. */
export async function finalV4Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await requireModuleAction("m4_monthly", ["admin", "finance"]);
    const first = monthOf(form);
    const sb = await supabaseServer();
    const settings = moduleSettingsGlobal(await moduleSettings());
    const r = await finalizeMonthV4(sb, v, first, settings);
    // forecast_accuracy_daily is a mart: written by the queue with the service role (S1)
    await queueRebuild(sb, [first], "FINAL dikunci (akurasi per hari)");
    const q = await processRebuildQueue(settings);
    done(first);
    revalidatePath(`/m/${first.slice(0, 7)}/tutup-buku`);
    return { ok: `${r.message}${q.notes.length ? `; ${q.notes.filter((n) => n.includes("akurasi") || n.includes("forecast_accuracy")).join("; ")}` : ""}` };
  } catch (e) { return { error: (e as Error).message }; }
}
