// nothing here may be reported by `lint.py k42` (scripts/test-lint.sh)
export async function good(sb: any, fetchAll: any, inChunks: any, ids: string[], week: string) {
  const a = await fetchAll((f: number, t: number) => sb.from("sales_line").select("id").order("date").order("id").range(f, t));
  const c = await fetchAll((f: number, t: number) => sb.from("sku_price").select("key").eq("week_id", week).order("key").range(f, t));
  const e = await sb.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
  const g = await inChunks(ids, (part: string[]) => fetchAll((f: number, t: number) => sb.from("batch").select("id").in("id", part).order("id").range(f, t)));
  for (let i = 0; i < ids.length; i += 200) await sb.from("batch").update({ x: 1 }).in("id", ids.slice(i, i + 200));
  const h = await sb.from("app_setting").select("*").in("key", ["v5_pl", "v5_costing"]);
  const table = week ? "commercial_daily" : "commercial_daily_sales_v5";
  const k = await fetchAll((f: number, t: number) => sb.from(table).select("*").eq("date", week).order("key").range(f, t));
  return [a, c, e, g, h, k];
}
