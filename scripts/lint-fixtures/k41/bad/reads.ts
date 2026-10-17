// every line below must be reported by `lint.py k41` (scripts/test-lint.sh)
export async function bad(sb: any) {
  const { data } = await sb.from("week").select("*");
  const { data: rows, count } = await sb.from("week").select("*", { count: "exact" });
  const x = await sb.from("week").select("*").then((r: any) => r).catch(() => null);
  const list = (await sb.from("week").select("*")).data ?? [];
  try { await sb.from("week").select("*"); } catch { /* ignored */ }
  const { data: s, error } = await sb.from("app_setting").select("*");
  if (error) return {};
  const { data: y } = await sb.from("week").select("*"); // k41-ok:
  return [data, rows, count, x, list, s, y];
}
