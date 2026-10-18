/**
 * PRD v5.2 R78 (A-UI-22): the Input panel offers .xls and now reads it — the core build of SheetJS for a legacy file (the mini
 * build cannot read BIFF), decided by name or by content. The .xls is written here (XLSX.write bookType "xls"); nothing
 * binary is committed. Same API in SheetJS 0.18.5 and 0.20.3.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import core from "xlsx/dist/xlsx.core.min.js";
import mini from "xlsx/dist/xlsx.mini.min.js";
import { validateUpload, type Grid, type UploadContext, type UploadKindV5 } from "@kgr/engine";
import { isLegacyXls, workbookGrid, type SheetLib } from "./upload-grid";
import { UPLOAD_SAMPLES } from "./upload-samples";

const root = join(__dirname, "../../../../fixtures");
const ctx0 = JSON.parse(readFileSync(join(root, "upload-samples/context.json"), "utf8")) as Omit<UploadContext, "items">;
const items = (JSON.parse(readFileSync(join(root, "week-2026-08-24/item_map.json"), "utf8")) as { item_code: string; item_name: string | null; key: string }[]).map((i) => ({ code: i.item_code, name: i.item_name, key: i.key }));
const ctx: UploadContext = { ...ctx0, items };

const bytesOf = (grid: Grid, bookType: "xls" | "xlsx") => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), "data");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
};

describe("R78: .xls di panel Input", () => {
  const grid: Grid = [["kode", "kg", "harga"], ["JLB1857", 811.3, "36.705"], ["X-1", null, "Rp 30.000"], [null, null, null], ["JLB0829", "1.755", 36705]];
  it("isLegacyXls: dari isi file (D0 CF 11 E0 A1 B1 1A E1), bukan dari nama", () => {
    expect(isLegacyXls(bytesOf(grid, "xls"))).toBe(true);
    expect(isLegacyXls(bytesOf(grid, "xlsx"))).toBe(false);
    expect(isLegacyXls(new TextEncoder().encode("kode;kg\nA;1"))).toBe(false);
    expect(isLegacyXls(new Uint8Array(3))).toBe(false);
    expect(isLegacyXls(bytesOf(grid, "xls").buffer.slice(0) as ArrayBuffer)).toBe(true);
  });
  it("build core membaca .xls menjadi grid yang sama dengan .xlsx lewat build mini (baris kosong dibuang, sel kosong null)", () => {
    const fromXls = workbookGrid(core as unknown as SheetLib, bytesOf(grid, "xls"));
    const fromXlsx = workbookGrid(mini as unknown as SheetLib, bytesOf(grid, "xlsx"));
    expect(fromXls).toEqual([["kode", "kg", "harga"], ["JLB1857", 811.3, "36.705"], ["X-1", null, "Rp 30.000"], ["JLB0829", "1.755", 36705]]);
    expect(fromXls).toEqual(fromXlsx);
  });
  for (const [kind, s] of Object.entries(UPLOAD_SAMPLES) as [UploadKindV5, { file: string; grid: Grid }][]) {
    it(`${s.file} disimpan sebagai .xls: cek, baris dan sidik jari sama dengan file contoh .xlsx`, () => {
      const want = validateUpload(kind, workbookGrid(XLSX as unknown as SheetLib, readFileSync(join(root, "upload-samples", s.file))), ctx);
      const got = validateUpload(kind, workbookGrid(core as unknown as SheetLib, bytesOf(s.grid, "xls")), ctx);
      expect(got.checks).toEqual(want.checks);
      expect(got.rows).toEqual(want.rows);
      expect(got.ok_count).toBe(want.ok_count);
      expect(got.fingerprint).toBe(want.fingerprint);
    });
  }
});
