"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mondayOf } from "@kgr/engine";
import { exampleWeekInputs } from "@kgr/engine/example";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { loadWeekInputs } from "@/lib/write";
import { rolloverWeek } from "@/lib/rollover";
import { listWeeks } from "@/lib/data";

export type ActionState = { ok?: string; error?: string };

async function admin() {
  const v = await requireViewer();
  if (v.role !== "admin") throw new Error("Hanya Admin");
  return v;
}

export async function loadExampleWeek(_: ActionState): Promise<ActionState> {
  try {
    await admin();
    const sb = await supabaseServer();
    const r = await loadWeekInputs(sb, exampleWeekInputs(), { source: "Accurate", master: true, note: "Contoh minggu dari reference/KGR_Weekly_Outlook.xlsx" });
    revalidatePath("/", "layout");
    return { ok: `Minggu contoh dimuat: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", ")}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function createEmptyWeek(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await admin();
    const start = mondayOf(String(form.get("week_start")));
    const tb = String(form.get("tb_opening_date") || "");
    if (!tb) return { error: "Isi tanggal saldo awal (TB)" };
    const sb = await supabaseServer();
    const { data, error } = await sb.from("week").insert({ week_start: start, update_date: start, tb_opening_date: tb }).select("id").single();
    if (error) return { error: error.message };
    const e2 = await sb.from("parameter").insert({
      week_id: (data as { id: string }).id,
      placeholder_note: "PLACEHOLDER (PRD §11): spread minimum Rp 2.000/kg, termin LB 7 / trading 14 / angkut-maklon 30 hari, horizon 3 hari, target shrink 3%, batas umur 30 hari",
    });
    if (e2.error) return { error: e2.error.message };
    revalidatePath("/", "layout");
    return { ok: `Minggu ${start} dibuat. Isi parameter, harga, TB dan stok awal.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function rollover(_: ActionState): Promise<ActionState> {
  try {
    await admin();
    const sb = await supabaseServer();
    const weeks = await listWeeks(sb);
    if (weeks.length === 0) return { error: "Belum ada minggu untuk dilanjutkan" };
    const r = await rolloverWeek(sb, weeks[0]);
    revalidatePath("/", "layout");
    return { ok: `Minggu ${r.weekStart} dibuat: stok awal dibawa untuk ${r.carried} key, ${r.moved} baris order/rencana ikut pindah. Minggu lalu ditutup.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setWeekStatus(form: FormData) {
  await admin();
  const sb = await supabaseServer();
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  if (!["open", "released", "closed"].includes(status)) throw new Error("status");
  const { error } = await sb.from("week").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect("/admin/minggu");
}
