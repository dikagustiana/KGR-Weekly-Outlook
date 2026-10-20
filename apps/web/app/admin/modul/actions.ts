"use server";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { MODULE_KEYS, moduleSettings, type ModuleKey } from "@/lib/modules";
import { mergeFlagValue } from "@/lib/modules-core";
import { ROLES, type Role } from "@/lib/roles";
import { processRebuildQueue, queueRebuild } from "@/lib/rebuild";
import { addDays, isISODate } from "@kgr/engine";
import { must } from "@/lib/loader";
import { sinceOf } from "@/lib/v5/costing";
import { backfillSnapshots } from "@/lib/snapshot";
import { supabaseService } from "@/lib/supabase-service";
import { forget } from "@/lib/request-memo";

export type ActionState = { ok?: string; error?: string };

async function admin() {
  const v = await requireViewer();
  if (v.role !== "admin") throw new Error("Hanya Admin");
  return v;
}

export async function setFlag(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await admin();
    const key = String(form.get("key")) as ModuleKey;
    if (!MODULE_KEYS.includes(key)) return { error: "Modul tidak dikenal" };
    const enabled = form.get("enabled") === "1";
    const roles = ROLES.filter((r) => form.get(`role_${r}`) === "1");
    const sb = await supabaseServer();
    // Q-v5.2-5: the stored value is read first — fields the form does not manage (costing_rows_mode of v5_pl …) survive a toggle
    const prev = must(await sb.from("app_setting").select("value").eq("key", key).maybeSingle(), `app_setting ${key}`) as { value?: unknown } | null;
    // PRD v5.1 R40: v5_costing keeps its start date (value.since, the first day of the lot revaluation K22); the form
    // sets it, a toggle without it keeps the one stored
    let since: string | null = null;
    if (key === "v5_costing") {
      const typed = String(form.get("since") ?? "").trim();
      if (typed && !isISODate(typed)) return { error: "Tanggal mulai v5 costing tidak valid (YYYY-MM-DD)" };
      since = typed || sinceOf(prev?.value);
    }
    // R66 (K63): v5_pl carries the mode of the two v5 costing rows in the journal columns: 'cogs' (default) or 'memo'
    let mode: "cogs" | "memo" | null = null;
    if (key === "v5_pl") {
      const typed = String(form.get("costing_rows_mode") ?? "").trim();
      if (typed && typed !== "cogs" && typed !== "memo") return { error: "Mode baris costing tidak valid (cogs atau memo)" };
      mode = (typed || null) as typeof mode;
    }
    const value = mergeFlagValue(prev?.value, { key, enabled, roles, allRoles: ROLES.length, since, costingRowsMode: mode });
    const { error } = await sb.from("app_setting").upsert({ key, value }, { onConflict: "key" });
    forget(sb, "app_setting");
    if (error) return { error: error.message };
    revalidatePath("/", "layout");
    return { ok: `${key}: ${enabled ? "aktif" : "nonaktif"}${Array.isArray(value.roles) ? ` untuk ${(value.roles as string[]).join(", ")}` : enabled ? " untuk semua peran" : ""}${value.since ? `; mulai ${String(value.since)}` : key === "v5_costing" ? "; tanggal mulai belum diisi (revaluasi lot tidak berjalan)" : ""}${key === "v5_pl" ? `; baris costing di laba rugi: ${String(value.costing_rows_mode ?? "cogs")}` : ""}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function queueDates(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await admin();
    const from = String(form.get("from") || ""), to = String(form.get("to") || from);
    if (!isISODate(from) || !isISODate(to) || to < from) return { error: "Isi rentang tanggal yang valid" };
    const dates: string[] = [];
    for (let d = from; d <= to && dates.length < 400; d = addDays(d, 1)) dates.push(d);
    const sb = await supabaseServer();
    await queueRebuild(sb, dates, "manual (Admin)");
    const r = await processRebuildQueue(await moduleSettings());
    revalidatePath("/", "layout");
    return { ok: `Bangun ulang ${dates.length} hari: ${r.done} selesai, ${r.failed} gagal. ${r.notes.slice(0, 3).join(" · ")}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function processQueue(_: ActionState): Promise<ActionState> {
  try {
    await admin();
    const r = await processRebuildQueue(await moduleSettings());
    revalidatePath("/", "layout");
    return { ok: `Antrian diproses: ${r.done} selesai, ${r.failed} gagal. ${r.notes.slice(0, 1).join("")}`.trim() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** PRD v6 B-R120: build the snapshot of every week once and link the releases (irisan 1 gate). */
export async function snapshotAll(_: ActionState): Promise<ActionState> {
  try {
    await admin();
    const svc = supabaseService();
    if (!svc) return { error: "Server belum punya SUPABASE_SERVICE_ROLE_KEY: hasil hitung tersimpan tidak bisa ditulis" };
    const notes = await backfillSnapshots(svc);
    revalidatePath("/", "layout");
    return { ok: `${notes.length} minggu: ${notes.slice(0, 6).join(" · ")}${notes.length > 6 ? " …" : ""}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
