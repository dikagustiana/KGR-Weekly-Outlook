"use server";
import { revalidatePath } from "next/cache";
import type { Mapping } from "@kgr/parsers";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { getWeek } from "@/lib/data";
import { commitUpload, kindsFor, stageUpload, type AnyKind, type StageResult } from "@/lib/upload";
import { moduleSettings } from "@/lib/modules";
import { moduleSettingsGlobal, processRebuildQueue } from "@/lib/rebuild";

export async function stage(input: {
  week: string; kind: AnyKind; path: string; fileName: string; mapping?: Mapping; makeProductionReceipts?: boolean; replaces?: string;
}): Promise<StageResult | { error: string }> {
  try {
    const v = await requireViewer();
    if (!kindsFor(v.role, await moduleSettings()).some((k) => k.kind === input.kind)) return { error: "Peran Anda tidak boleh mengunggah jenis ini" };
    if (!input.path.startsWith(`${input.week}/`)) return { error: "Lokasi file tidak valid" };
    const sb = await supabaseServer();
    const week = await getWeek(sb, input.week);
    if (!week) return { error: "Minggu tidak ada" };
    if (input.replaces) await discardStaged(input.replaces);
    return await stageUpload(sb, v, week, input.kind, input.path, input.fileName, { mapping: input.mapping, makeProductionReceipts: input.makeProductionReceipts });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function commit(uploadId: string, week: string): Promise<{ ok?: string; error?: string }> {
  try {
    const v = await requireViewer();
    const sb = await supabaseServer();
    const settings = await moduleSettings();
    const msg = await commitUpload(sb, v, uploadId, settings);
    // PRD v3 §3: rebuild the data mart for the dates the upload touched (modules that are on)
    const rb = await processRebuildQueue(moduleSettingsGlobal(settings));
    revalidatePath(`/w/${week}`, "layout");
    revalidatePath("/", "layout");
    const rebuilt = rb.done || rb.failed ? ` Data harian dibangun ulang: ${rb.done} selesai${rb.failed ? `, ${rb.failed} gagal (lihat Admin → Modul)` : ""}.` : rb.notes.length ? ` ${rb.notes[0]}` : "";
    return { ok: `${msg}${rebuilt}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function discardStaged(uploadId: string): Promise<{ ok?: string; error?: string }> {
  await requireViewer();
  const sb = await supabaseServer();
  const rows = await sb.from("upload_row").delete().eq("upload_id", uploadId);
  if (rows.error) return { error: rows.error.message };
  const { error } = await sb.from("upload").update({ status: "discarded" }).eq("id", uploadId).eq("status", "staged");
  return error ? { error: error.message } : { ok: "Dibatalkan" };
}

export async function addItemMapping(code: string, name: string | null, key: string): Promise<{ ok?: string; error?: string }> {
  const v = await requireViewer();
  if (v.role !== "admin") return { error: "Hanya Admin yang memetakan kode item" };
  const sb = await supabaseServer();
  const { error } = await sb.from("item_map").upsert({ item_code: code, item_name: name, key, deleted_at: null }, { onConflict: "item_code" });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: `${code} → ${key}` };
}
