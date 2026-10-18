/**
 * PRD v5.2 R78 (A-UI-22): the legacy .xls (BIFF in a compound document) is read through SheetJS like .xlsx. The file is written
 * here with XLSX.write(bookType "xls") — nothing binary is committed and no real export is used — so the test runs on the
 * SheetJS version that is installed (0.20.3 in CI, 0.18.5 where cdn.sheetjs.com is not reachable): the API used is the same.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readWorkbook } from "../src";

const rows = [
  ["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan"],
  ["KGR26.00349", "2026-08-29", "JLB0829", 1755, 36705, "Pelanggan B"],
  ["KGR26.00350", 46263, "JLB0830", "1.234,5", "Rp 36.705", "Pelanggan ü"],
  [null, null, null, null, null, null],
  ["KGR26.00353", "2026-08-30", "JLB0831", 812.25, 30000, null],
];
function write(bookType: "xls" | "xlsx"): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PO");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "Lain");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
}

describe("R78: .xls dibaca lewat SheetJS", () => {
  it("file yang ditulis adalah .xls sungguhan (dokumen majemuk D0 CF 11 E0), bukan .xlsx (PK)", () => {
    expect([...write("xls").slice(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
    expect([...write("xlsx").slice(0, 2)]).toEqual([0x50, 0x4b]);
  });
  it("readWorkbook(.xls): dua sheet, angka tetap angka, teks Indonesia tetap teks, tanggal Excel tetap serial", () => {
    const sheets = readWorkbook(write("xls"), "po.xls");
    expect(sheets.map((s) => s.name)).toEqual(["PO", "Lain"]);
    const po = sheets[0].rows;
    expect(po[0]).toEqual(rows[0]);
    expect(po[1]).toEqual(["KGR26.00349", "2026-08-29", "JLB0829", 1755, 36705, "Pelanggan B"]);
    expect(po[2]).toEqual(["KGR26.00350", 46263, "JLB0830", "1.234,5", "Rp 36.705", "Pelanggan ü"]);
    expect(po[4][3]).toBe(812.25);
    expect(sheets[1].rows).toEqual([["a", "b"], [1, 2]]);
  });
  it(".xls dan .xlsx dari isi yang sama memberi baris yang sama", () => {
    expect(readWorkbook(write("xls"), "po.xls")).toEqual(readWorkbook(write("xlsx"), "po.xlsx"));
  });
  it("nama file tidak menentukan: .xls bernama .xlsx tetap terbaca (isi yang dibaca)", () => {
    expect(readWorkbook(write("xls"), "export-accurate.xlsx")[0].rows[1][2]).toBe("JLB0829");
  });
});
