"use server";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { MODULE_KEYS, moduleSettings, type ModuleKey } from "@/lib/modules";
import { ROLES, type Role } from "@/lib/roles";
import { processRebuildQueue, queueRebuild } from "@/lib/rebuild";
import { addDays, isISODate } from "@kgr/engine";

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
    const value: { enabled: boolean; roles?: Role[] } = { enabled };
    if (roles.length && roles.length < ROLES.length) value.roles = roles;
    const sb = await supabaseServer();
    const { error } = await sb.from("app_setting").upsert({ key, value }, { onConflict: "key" });
    if (error) return { error: error.message };
    revalidatePath("/", "layout");
    return { ok: `${key}: ${enabled ? "aktif" : "nonaktif"}${value.roles ? ` untuk ${value.roles.join(", ")}` : enabled ? " untuk semua peran" : ""}` };
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
    const r = await processRebuildQueue(sb, await moduleSettings());
    revalidatePath("/", "layout");
    return { ok: `Bangun ulang ${dates.length} hari: ${r.done} selesai, ${r.failed} gagal. ${r.notes.slice(0, 3).join(" · ")}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function processQueue(_: ActionState): Promise<ActionState> {
  try {
    await admin();
    const sb = await supabaseServer();
    const r = await processRebuildQueue(sb, await moduleSettings());
    revalidatePath("/", "layout");
    return { ok: `Antrian diproses: ${r.done} selesai, ${r.failed} gagal.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
