/** costing_wp upload (PRD v3 §5, §8 M1): the WP file itself → batches + SKU rows → allocation = column L ± Rp 1. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allocateBatch, D } from "@kgr/engine";
import { loadV3Fixture, repoRoot } from "@kgr/engine/fixtures";
import { parseCostingWorkbook, readWorkbook, wpToAllocateInput } from "../src";

const wb = readWorkbook(readFileSync(join(repoRoot(), "reference", "202609_Data_COGS_LB.xlsx")), "202609_Data_COGS_LB.xlsx");
const res = parseCostingWorkbook(wb);
type Fx = { sheet: string; date: string | null; lb_kg: string | null; processed_kg: string | null; total_cost: string | null; cost_bl: string | null; costs: { label: string; amount: string }[]; rows: { row: number; item_code: string | null; kg: string | null; price: string | null }[] };
const fx = loadV3Fixture<Fx[]>("costing-2026-09", "batches.json");
const golden = loadV3Fixture<Record<string, string | null>>("costing-2026-09", "golden.json");

describe("costing_wp parser", () => {
  it("finds every batch sheet the extractor found (and skips the scenario sheet)", () => {
    expect(res.batches.map((b) => b.sheet)).toEqual(fx.map((b) => b.sheet));
    expect(res.skipped).toContain("Pot_ISA (2)");
  });

  it("header and rows equal the openpyxl fixture", () => {
    for (const f of fx) {
      const b = res.batches.find((x) => x.sheet === f.sheet)!;
      expect(b.date, f.sheet).toBe(f.date);
      expect(D(b.lb_kg).toFixed(2), f.sheet).toBe(D(f.lb_kg).toFixed(2));
      expect(D(b.processed_kg).toFixed(2), f.sheet).toBe(D(f.processed_kg).toFixed(2));
      expect(D(b.total_cost).toFixed(2), f.sheet).toBe(D(f.total_cost).toFixed(2));
      expect(D(b.cost_bl).toFixed(2), f.sheet).toBe(D(f.cost_bl).toFixed(2));
      expect(b.costs.map((c) => [c.label, D(c.amount).toFixed(2)]), f.sheet).toEqual(f.costs.map((c) => [c.label, D(c.amount).toFixed(2)]));
      expect(b.rows.map((r) => [r.row, r.item_code, D(r.kg).toFixed(2), D(r.price).toFixed(2)]), f.sheet)
        .toEqual(f.rows.map((r) => [r.row, r.item_code, D(r.kg).toFixed(2), D(r.price).toFixed(2)]));
    }
  });

  it("upload → allocation reproduces column L of every Pot_ISA / Pot_AGRO sheet ± Rp 1", () => {
    let n = 0;
    for (const b of res.batches) {
      const r = allocateBatch(wpToAllocateInput(b));
      for (const row of b.rows) {
        const l = r.lines.find((x) => x.ref === `${b.sheet}!${row.row}`)!;
        expect(l.costPerKg.minus(D(golden[`${b.sheet}!L${row.row}`] ?? 0)).abs().toNumber(), `${b.sheet}!L${row.row}`).toBeLessThanOrEqual(1);
        n++;
      }
    }
    expect(n).toBe(fx.reduce((a, b) => a + b.rows.length, 0));
  });

  it("issues: empty batches (D2) and the yield gap (D1) are reported", () => {
    expect(res.issues.some((i) => i.startsWith("Pot_AGRO30") && i.includes("output kosong"))).toBe(true);
    expect(res.issues.some((i) => i.startsWith("Pot_ISA30") && i.includes("C22"))).toBe(true);
  });
});

import * as XLSX from "xlsx";
import { parseV3Table, type Sheet } from "../src";

function sheetOf(rows: unknown[][]): Sheet[] {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PI");
  return readWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, "pi.xlsx");
}

describe("cost_pool_pi parser", () => {
  it("reads the Accurate PI list with Indonesian headers", () => {
    const r = parseV3Table("cost_pool_pi", sheetOf([
      ["Daftar Faktur Pembelian"],
      ["Tanggal", "No. Faktur", "Pemasok", "Akun", "Keterangan", "Jumlah"],
      ["30/09/2026", "PI26090095", "ALBERTUS", "5100001", "Live Bird 18.793,7 kg", "466.083.760"],
      ["30/09/2026", "PI26090091", "EKSPEDISI", "5100002", "Biaya ekspedisi 6 rit", "9.000.000"],
      ["", "", "", "", "Total", "475.083.760"],
    ]));
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => [x.values.date, x.values.document_ref, x.values.amount])).toEqual([
      ["2026-09-30", "PI26090095", "466083760"], ["2026-09-30", "PI26090091", "9000000"],
    ]);
  });
});
