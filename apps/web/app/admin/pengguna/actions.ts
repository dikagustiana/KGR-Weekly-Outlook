"use server";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { ROLE_LABEL } from "@/lib/roles";

type S = { ok?: string; error?: string };

export async function saveUser(_: S, form: FormData): Promise<S> {
  const v = await requireViewer();
  if (v.role !== "admin") return { error: "Hanya Admin" };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "");
  if (!email.includes("@")) return { error: "E-mail tidak valid" };
  if (!(role in ROLE_LABEL)) return { error: "Peran tidak dikenal" };
  if (email === v.email && role !== "admin") return { error: "Tidak bisa menurunkan peran Anda sendiri" };
  const sb = await supabaseServer();
  const { error } = await sb.from("app_user").upsert({
    email, role, full_name: String(form.get("full_name") ?? "") || null, active: form.get("active") !== "0",
  }, { onConflict: "email" });
  if (error) return { error: error.message };
  revalidatePath("/admin/pengguna");
  return { ok: `${email} disimpan sebagai ${ROLE_LABEL[role as keyof typeof ROLE_LABEL]}` };
}

export async function setPassword(_: S, form: FormData): Promise<S> {
  const v = await requireViewer();
  if (v.role !== "admin") return { error: "Hanya Admin" };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const pw = String(form.get("password") ?? "");
  if (pw.length < 10) return { error: "Kata sandi sementara minimal 10 karakter" };
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("admin_set_password", { p_email: email, p_password: pw });
  if (error) return { error: error.message };
  return { ok: `Login ${data === "created" ? "dibuat" : "diatur ulang"} untuk ${email}. Sampaikan kata sandi sementara secara langsung; pengguna menggantinya di menu Akun.` };
}

export async function toggleActive(form: FormData) {
  const v = await requireViewer();
  if (v.role !== "admin") throw new Error("Hanya Admin");
  const email = String(form.get("email"));
  if (email === v.email) throw new Error("Tidak bisa menonaktifkan diri sendiri");
  const sb = await supabaseServer();
  const { error } = await sb.from("app_user").update({ active: form.get("active") === "1" }).eq("email", email);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pengguna");
}
