import { parseNumber } from "@kgr/parsers";

/**
 * Form "Run-rate" → rows of table runrate. A line without a monthly amount is not written (the column is NOT NULL: a
 * blank would be stored as 0, missing ≠ 0, R64) and is reported in `empty`; a blank adjustment means no adjustment (NOT NULL default 0).
 */
export function runrateRowsFromForm(form: FormData, weekId: string): { rows: Record<string, unknown>[]; empty: string[] } {
  const rows: Record<string, unknown>[] = [];
  const empty: string[] = [];
  form.getAll("pl_line").map(String).forEach((l, i) => {
    const monthly = parseNumber(String(form.get(`m:${l}`) ?? ""));
    if (monthly === null) { empty.push(l); return; }
    rows.push({
      week_id: weekId, pl_line: l, seq: i + 1,
      monthly_amount: monthly,
      week_adjustment: parseNumber(String(form.get(`a:${l}`) ?? "")) ?? 0, // missing-ok: penyesuaian kosong = tidak ada penyesuaian (kolom NOT NULL default 0)
      basis: String(form.get(`b:${l}`) ?? "") || null,
    });
  });
  return { rows, empty };
}
