"use server";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase";
import { releaseWeek } from "@/lib/release";
import { k25Enabled } from "@/lib/modules";
import { addOverride, withdrawOverride } from "@/lib/v4/release-override";

export async function release(_: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  try {
    const v = await requireViewer();
    if (!can(v.role, "release")) return { error: "Hanya Admin / Finance yang boleh merilis" };
    const week = String(form.get("week"));
    const sb = await supabaseServer();
    const r = await releaseWeek(sb, week, v.email, { k25: await k25Enabled(v) });
    revalidatePath(`/w/${week}`, "layout");
    return { ok: `Outlook dirilis (${r.overall}); snapshot SHA-256 ${r.sha.slice(0, 12)}…${r.ops ? `; ${r.ops} baris masih bersumber Ops` : ""}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** PRD v4 §7.2: an override of one control for this week, with reason and evidence (RLS: roles per control). */
export async function overrideAction(_: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  try {
    const v = await requireViewer();
    const week = String(form.get("week"));
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "");
    const msg = id
      ? await withdrawOverride(sb, v, id)
      : await addOverride(sb, v, { scopeKind: "week", scope: week, code: String(form.get("code") ?? ""), reason: String(form.get("reason") ?? ""), evidence: String(form.get("evidence") ?? "") });
    revalidatePath(`/w/${week}/kontrol`);
    return { ok: msg };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
