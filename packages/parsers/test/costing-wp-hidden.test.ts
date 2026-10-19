/**
 * BT-COGS-1 (backtest COGS LB Agu–Sep 2026, docs/v5.3/backtest-cogs/REPORT.md): a hidden sheet of the WP file (template
 * `Pot_ISA`, old `+Blasting` copies of August inside the September file) is not a cut batch; uploaded, it created a second
 * batch for 8 Aug and rewrote two August batches from the September file. BT-COGS-2: two visible sheets with the same cut
 * date and the same cost lines (`Pot_ISA20` and `Pot_ISA20 REV`) are reported as a probable duplicate.
 * The workbook below is made up for the test (no supplier, invoice or KGR numbers).
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseCostingWorkbook, readWorkbook } from "../src";

/** A minimal WP batch sheet: cost lines A3:B6, cut date and kg LB in I/J, header "Produk" on row 9, total row 10. */
function wpSheet(o: { date: number; lbKg: number; lb: number; freight: number; fee: number; rows: [string, number, string, number][] }): unknown[][] {
  const total = o.lb + o.freight + o.fee;
  const grid: unknown[][] = [
    [], ["Harga Perolehan"],
    ["Live Bird", o.lb, null, null, null, null, null, null, "Supplier", "PEMASOK UJI"],
    ["Biaya Ekspedisi", o.freight, null, null, null, null, null, null, "Tgl. Potong", o.date],
    ["Biaya Potong", o.fee, null, null, null, null, null, null, "Total KG LB", o.lbKg],
    ["Total", total], [], [],
    ["Produk", "Price/Kg", "Satuan", null, "SKU Fresh", "Non Blasting", "No. SKU", "Item Name", "Qty"],
    [null, null, null, null, null, total, null, null, o.rows.reduce((a, r) => a + r[3], 0)],
  ];
  for (const [p, price, code, kg] of o.rows) grid.push([p, price, "Kg", null, null, null, code, `Item ${code}`, kg]);
  return grid;
}

function workbook(sheets: { name: string; grid: unknown[][]; hidden?: boolean }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.grid), s.name);
  wb.Workbook = { Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })) } as XLSX.WBProps;
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const a = { date: 46265, lbKg: 1000, lb: 25_000_000, freight: 500_000, fee: 1_450_000, rows: [["AU 1.0", 37000, "TST001", 600], ["Kepala", 9500, "TST002", 50]] as [string, number, string, number][] };
const b = { ...a, date: 46266, lb: 24_000_000 };

describe("costing_wp: hidden sheets (BT-COGS-1)", () => {
  const sheets = readWorkbook(workbook([
    { name: "Pot_ISA01", grid: wpSheet(a) },
    { name: "Pot_ISA", grid: wpSheet(a), hidden: true },
    { name: "Pot_ISA02+Blasting", grid: wpSheet(b), hidden: true },
    { name: "Pot_ISA02", grid: wpSheet(b) },
  ]), "wp.xlsx");

  it("readWorkbook marks hidden sheets", () => {
    expect(sheets.map((s) => [s.name, !!s.hidden])).toEqual([["Pot_ISA01", false], ["Pot_ISA", true], ["Pot_ISA02+Blasting", true], ["Pot_ISA02", false]]);
  });

  it("a hidden sheet is not read as a batch, and the upload says so", () => {
    const r = parseCostingWorkbook(sheets);
    expect(r.batches.map((x) => x.sheet)).toEqual(["Pot_ISA01", "Pot_ISA02"]);
    expect(r.hidden).toEqual(["Pot_ISA", "Pot_ISA02+Blasting"]);
    expect(r.issues.some((i) => i.includes("tersembunyi") && i.includes("Pot_ISA,") && i.includes("Pot_ISA02+Blasting"))).toBe(true);
  });
});

describe("costing_wp: probable duplicate sheets (BT-COGS-2)", () => {
  it("two visible sheets with the same cut date and cost lines are reported, both are still read", () => {
    const r = parseCostingWorkbook(readWorkbook(workbook([
      { name: "Pot_ISA20", grid: wpSheet(a) },
      { name: "Pot_ISA20 REV", grid: wpSheet({ ...a, rows: [["AU 1.0", 37000, "TST001", 640], ["Kepala", 9500, "TST002", 50]] }) },
      { name: "Pot_ISA21", grid: wpSheet(b) },
    ]), "wp.xlsx"));
    expect(r.batches.map((x) => x.sheet)).toEqual(["Pot_ISA20", "Pot_ISA20 REV", "Pot_ISA21"]);
    const dup = r.issues.filter((i) => i.includes("duplikat"));
    expect(dup).toHaveLength(1);
    expect(dup[0]).toContain("Pot_ISA20, Pot_ISA20 REV");
  });
});
