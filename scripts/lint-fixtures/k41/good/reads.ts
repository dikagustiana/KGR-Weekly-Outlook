// nothing here may be reported by `lint.py k41` (scripts/test-lint.sh)
export async function good(sb: any, must: any, mustRows: any) {
  const { data, error } = await sb.from("week").select("*");
  if (error) throw new Error(error.message);
  const rows = mustRows(await sb.from("week").select("*"), "week");
  const { data: user } = await sb.auth.getUser();
  try { JSON.parse("{}"); } catch { throw new Error("tidak terbaca"); }
  try { JSON.parse("{}"); } catch { // k41-ok: contoh penanda dengan alasan
  }
  return [data, rows, user, must];
}
