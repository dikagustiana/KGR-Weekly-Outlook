// Backtest FS Agu–Sep 2026 (docs/v5.3/backtest-fs/REPORT.md BT-FS-4): the FS correction SQL for KGR-OS against the cell values
// of the new FS (expected.json, read with openpyxl from the 18 Oct copy). Runs without the original workbook.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/fixtures";

type Cell = { row: number; label: string; value: number };
const read = (rel: string) => readFileSync(join(repoRoot(), rel), "utf-8");
const expected = JSON.parse(read("docs/v5.3/backtest-fs/expected.json")) as { source: { sha256: string }; months: Record<string, { pl: Record<string, Cell>; bs: Record<string, Cell> }> };
const fsNew = (month: string, st: "PL" | "BS", row: number) =>
  Object.values(expected.months[month.slice(0, 7)][st === "PL" ? "pl" : "bs"]).find((c) => c.row === row)?.value;
const cents = (v: number | string) => Math.round(Number(v) * 100);

// ('2026-09-01'::date, 'BS', 'BS - Management Report', 53, 'Accrued Expenses - Third Parties', 43845011.00[, -2.00])
const rows = (sql: string) => [...sql.matchAll(/\('(\d{4}-\d{2}-\d{2})'::date, '(PL|BS)', '[^']*', (\d+), '((?:[^']|'')*)', (-?\d+\.\d{2})(?:, (-?\d+\.\d{2}))?\)/g)]
  .map((m) => ({ month: m[1], st: m[2] as "PL" | "BS", row: Number(m[3]), line: m[4], amount: m[5], old: m[6] }));
const v1 = rows(read("docs/v5.2/kgr-os-data-fs.sql"));
const v2sql = read("docs/v5.3/kgr-os-data-fs-v2.sql");
const v2 = rows(v2sql);
const key = (r: { month: string; st: string; row: number }) => `${r.month} ${r.st} ${r.row}`;

describe("backtest FS: koreksi versi 2 (kgr-os-data-fs-v2.sql) = FS 18 Okt", () => {
  it("dibuat dari berkas FS yang sama dengan expected.json", () => {
    expect(v2sql).toContain(expected.source.sha256);
    expect(v1.length).toBe(146);
    expect(v2.length).toBe(12);
  });

  it("setiap baris versi 2 = sel FS baru, dan nilai lamanya = versi 1", () => {
    const old = new Map(v1.map((r) => [key(r), r.amount]));
    let n = 0;
    for (const r of v2) {
      expect(r.old, key(r)).toBe(old.get(key(r)));
      // expected.json carries the C59 rows and their components; PL 68 (comprehensive income) is not in it
      const now = fsNew(r.month, r.st, r.row);
      if (now === undefined) continue;
      expect(cents(r.amount), key(r)).toBe(cents(now));
      n++;
    }
    expect(n).toBe(11);
  });

  it("baris yang tidak dikoreksi tetap sama dengan FS baru (tidak ada perubahan yang terlewat)", () => {
    const corrected = new Set(v2.map(key));
    let n = 0;
    for (const r of v1) {
      const now = fsNew(r.month, r.st, r.row);
      if (corrected.has(key(r)) || now === undefined) continue;
      expect(cents(r.amount), key(r)).toBe(cents(now));
      n++;
    }
    expect(n).toBeGreaterThan(120);
  });
});
