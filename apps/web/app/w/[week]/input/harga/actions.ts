"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseNumber } from "@kgr/parsers";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase";
import { weekIdOf } from "@/lib/rollover";

/** Reference sell prices (Sales) and replacement buy prices (Purchasing), per week (I_Master F:G). */
export async function savePrices(form: FormData) {
  const v = await requireViewer();
  const week = String(form.get("week"));
  const go = (k: "ok" | "err", m: string): never => redirect(`/w/${week}/input/harga?${k}=${encodeURIComponent(m)}`);
  const sell = can(v.role, "price_sell");
  const buy = can(v.role, "price_buy");
  if (!sell && !buy) go("err", "Peran Anda tidak boleh mengubah harga");
  const sb = await supabaseServer();
  const weekId = await weekIdOf(sb, week);
  const { data: cur } = await sb.from("sku_price").select("*").eq("week_id", weekId);
  const byKey = new Map((cur ?? []).map((r) => [String(r.key), r]));
  const keys = form.getAll("key").map(String);
  const rows: Record<string, unknown>[] = [];
  try {
    for (const k of keys) {
      const old = byKey.get(k) ?? { ref_sell_price: null, replacement_buy_price: null };
      const s = sell ? parseNumber(String(form.get(`sell:${k}`) ?? "")) : old.ref_sell_price;
      const b = buy ? parseNumber(String(form.get(`buy:${k}`) ?? "")) : old.replacement_buy_price;
      const same = (a: unknown, c: unknown) => (a === null || a === undefined ? null : Number(a)) === (c === null || c === undefined ? null : Number(c));
      if (byKey.has(k) && same(s, old.ref_sell_price) && same(b, old.replacement_buy_price)) continue;
      rows.push({ week_id: weekId, key: k, ref_sell_price: s, replacement_buy_price: b });
    }
  } catch (e) {
    go("err", (e as Error).message);
  }
  if (rows.length) {
    const { error } = await sb.from("sku_price").upsert(rows, { onConflict: "week_id,key" });
    if (error) go("err", error.message);
  }
  revalidatePath(`/w/${week}`, "layout");
  go("ok", `${rows.length} harga diperbarui`);
}
