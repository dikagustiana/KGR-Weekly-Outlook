"use server";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase";
import { releaseWeek } from "@/lib/release";

export async function release(_: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  try {
    const v = await requireViewer();
    if (!can(v.role, "release")) return { error: "Hanya Admin / Finance yang boleh merilis" };
    const week = String(form.get("week"));
    const sb = await supabaseServer();
    const r = await releaseWeek(sb, week, v.email);
    revalidatePath(`/w/${week}`, "layout");
    return { ok: `Outlook dirilis (${r.overall}); snapshot SHA-256 ${r.sha.slice(0, 12)}…${r.ops ? `; ${r.ops} baris masih bersumber Ops` : ""}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
