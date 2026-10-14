"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";

const go = (path: string, k: "ok" | "err", m: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);

async function admin(path: string) {
  const v = await requireViewer();
  if (v.role !== "admin") go(path, "err", "Hanya Admin yang mengubah master data");
  return v;
}

export async function saveItem(form: FormData) {
  const path = String(form.get("path") ?? "/master/item");
  await admin(path);
  const code = String(form.get("item_code") ?? "").trim();
  const key = String(form.get("key") ?? "").trim();
  if (!code || !key) go(path, "err", "Kode item dan key wajib");
  const sb = await supabaseServer();
  const { error } = await sb.from("item_map").upsert({ item_code: code, item_name: String(form.get("item_name") ?? "") || null, key, deleted_at: null }, { onConflict: "item_code" });
  if (error) go(path, "err", error.message);
  revalidatePath("/", "layout");
  go(path, "ok", `${code} → ${key} disimpan`);
}

export async function deleteItem(form: FormData) {
  const path = String(form.get("path") ?? "/master/item");
  const v = await admin(path);
  const sb = await supabaseServer();
  const { error } = await sb.from("item_map").update({ deleted_at: new Date().toISOString(), deleted_by: v.email }).eq("item_code", String(form.get("item_code")));
  if (error) go(path, "err", error.message);
  revalidatePath("/", "layout");
  go(path, "ok", "Kode item dinonaktifkan (soft delete)");
}

export async function saveAccount(form: FormData) {
  const path = String(form.get("path") ?? "/master/coa");
  await admin(path);
  const s = (k: string) => (String(form.get(k) ?? "").trim() || null);
  const account = s("account");
  const type = s("type");
  if (!account || !type || !s("name")) go(path, "err", "Akun, nama dan tipe wajib");
  const sb = await supabaseServer();
  const { error } = await sb.from("coa_map").upsert({
    account, name: s("name"), type, pl_line: type === "LabaRugi" ? s("pl_line") : null, bs_line: type === "Neraca" ? s("bs_line") : null,
    cf_category_as_counter: s("cf_category_as_counter"), is_cash: form.get("is_cash") === "Y", fs_mapping_reference: s("fs_mapping_reference"), deleted_at: null,
  }, { onConflict: "account" });
  if (error) go(path, "err", error.message);
  revalidatePath("/", "layout");
  go(path, "ok", `Akun ${account} disimpan`);
}

export async function saveSkuKey(form: FormData) {
  const path = "/master/sku";
  await admin(path);
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const seg = s("segment"), sku = s("sku"), formv = s("form"), group = s("decision_group");
  if (!seg || !sku || !formv || !group) go(path, "err", "Semua kolom wajib");
  const sb = await supabaseServer();
  const { data: last } = await sb.from("sku_key").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await sb.from("sku_key").upsert({ key: `${seg}|${sku}|${formv}`, segment: seg, sku, form: formv, decision_group: group, sort_order: Number(last?.sort_order ?? 0) + 1, active: true }, { onConflict: "key" });
  if (error) go(path, "err", error.message);
  revalidatePath("/", "layout");
  go(path, "ok", `Key ${seg}|${sku}|${formv} disimpan — isi harga acuan di Input → Harga`);
}
