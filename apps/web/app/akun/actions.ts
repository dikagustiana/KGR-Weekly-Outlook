"use server";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";

export async function changePassword(_: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  await requireViewer();
  const a = String(form.get("password") ?? "");
  const b = String(form.get("password2") ?? "");
  if (a.length < 10) return { error: "Minimal 10 karakter" };
  if (a !== b) return { error: "Kedua isian tidak sama" };
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password: a });
  return error ? { error: error.message } : { ok: "Kata sandi diganti" };
}
