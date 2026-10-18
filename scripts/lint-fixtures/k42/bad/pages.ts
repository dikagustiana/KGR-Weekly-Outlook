// every builder below must be reported by `lint.py k42` (scripts/test-lint.sh); table keys come from supabase/migrations
export async function bad(sb: any, fetchAll: any, ids: string[]) {
  const a = await fetchAll((f: number, t: number) => sb.from("sales_line").select("id").range(f, t));
  const b = await fetchAll((f: number, t: number) => sb.from("gl_line").select("id").order("date").range(f, t));
  const c = await fetchAll((f: number, t: number) => sb.from("sku_price").select("key").order("key").range(f, t));
  const d = await fetchAll((f: number, t: number) => sb.from("week").select("id").order("id").limit(200).range(f, t));
  const e = await sb.from("audit_log").select("*").limit(300);
  const g = await sb.from("batch").update({ x: 1 }).in("id", ids);
  return [a, b, c, d, e, g];
}
