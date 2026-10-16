"use server";
/** PRD v5 §6.1, journey M (flag v5_management): the operations director decides the LB price from the simulation. */
import { revalidatePath } from "next/cache";
import { moduleSettings, requireModuleAction } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { processRebuildQueue } from "@/lib/rebuild";
import { insertLbDecision } from "@/lib/v5/lb-decision";

export type ActionState = { ok?: string; error?: string };

export async function decideLbPriceV5Action(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await requireModuleAction("v5_management", ["admin", "operations_director"]);
    const msg = await insertLbDecision(await supabaseServer(), form);
    await processRebuildQueue(await moduleSettings());
    revalidatePath("/minggu-ini", "layout");
    return { ok: msg };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
