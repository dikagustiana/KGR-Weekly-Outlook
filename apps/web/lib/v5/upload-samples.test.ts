/**
 * G12 (PRD v5 §9.1, Lampiran B.5): the three example files give the same checks and ok_count in the browser (SheetJS →
 * grid → validateUpload) and on the server (the raw grid again → validateUpload, fingerprint compared), and the server
 * refuses a payload changed after the preview. Golden: fixtures/upload-samples/expected.json.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTsv, validateUpload, type Grid, type UploadContext, type UploadKindV5, type UploadResult } from "@kgr/engine";
import { workbookGrid, type SheetLib } from "./upload-grid";
import { UPLOAD_SAMPLES } from "./upload-samples";
import { UploadRejected, parseGridPayload, recheck } from "./input-check";

const root = join(__dirname, "../../../../fixtures");
const ctx0 = JSON.parse(readFileSync(join(root, "upload-samples/context.json"), "utf8")) as Omit<UploadContext, "items">;
const items = (JSON.parse(readFileSync(join(root, "week-2026-08-24/item_map.json"), "utf8")) as { item_code: string; item_name: string | null; key: string }[])
  .map((i) => ({ code: i.item_code, name: i.item_name, key: i.key }));
const ctx: UploadContext = { ...ctx0, items };
const expected = JSON.parse(readFileSync(join(root, "upload-samples/expected.json"), "utf8")) as Record<string, ReturnType<typeof golden>>;

/** What the golden holds of a result (records reduced to the saved file lines). */
function golden(r: UploadResult) {
  return { total: r.total, ok_count: r.ok_count, checks: r.checks, rows: r.rows, ok_lines: r.records.filter((x) => x.level !== "fail").map((x) => x.line), summary: r.summary, needsReason: r.needsReason, fingerprint: r.fingerprint };
}
const toTsv = (g: Grid) => g.map((r) => r.map((c) => (c === null ? "" : String(c))).join("\t")).join("\r\n");

describe("Lampiran B.5 — upload contoh", () => {
  for (const [kind, s] of Object.entries(UPLOAD_SAMPLES) as [UploadKindV5, { file: string; grid: Grid }][]) {
    it(`${s.file}: browser (SheetJS) = golden = server`, () => {
      const grid = workbookGrid(XLSX as unknown as SheetLib, readFileSync(join(root, "upload-samples", s.file)));
      const browser = validateUpload(kind, grid, ctx);
      expect(golden(browser)).toEqual(expected[kind]);
      // the server receives the grid as JSON and validates it again
      const server = recheck(kind, parseGridPayload(JSON.stringify(grid)), browser.fingerprint, ctx);
      expect(server).toEqual(browser);
    });
    it(`${s.file}: tempel dari Excel (TSV) memberi cek yang sama`, () => {
      const pasted = validateUpload(kind, parseTsv(toTsv(s.grid)), ctx);
      const file = validateUpload(kind, s.grid, ctx);
      expect(pasted.checks).toEqual(file.checks);
      expect(pasted.ok_count).toBe(file.ok_count);
      expect(pasted.rows).toEqual(file.rows);
    });
  }

  it("angka acuan B.5", () => {
    const po = expected.po_lines, wp = expected.costing_wp, y = expected.yield_matrix;
    expect([po.total, po.ok_count]).toEqual([7, 4]);
    expect(po.rows.filter((r) => /< lantai/.test(r.action)).length).toBe(5);
    expect(po.rows.find((r) => r.ref === "KGR26.00341")?.action).toMatch(/ukuran karkas kosong/);
    expect([wp.total, wp.ok_count]).toEqual([8, 6]);
    expect(wp.checks.find((c) => c.title === "Σ SKU vs hasil potong")?.detail).toBe("6.782,8 vs 7.286,6 kg (LB − susut 3%), selisih 6,9% (batas 2%)");
    expect(wp.checks.find((c) => c.title.endsWith("rata-rata LB"))?.detail).toBe("7.512,0 kg / 3.902 ekor = 1,93 kg/ekor");
    expect(wp.checks.find((c) => c.title === "Yield karkas")?.detail).toBe("73,4% (batas 68–76%)");
    expect([y.total, y.ok_count]).toEqual([18, 0]);
    expect(y.checks.find((c) => c.code === "C51")?.detail).toBe("K, S, B belum ada di tabel kelas berat (baru STD)");
    expect(y.checks.find((c) => c.title.startsWith("Σ yield"))?.detail).toBe("K 89,2% · S 89,9% · B 90,4%");
    expect(y.rows.map((r) => r.kg)).toEqual(["70,2%", "71,5%", "72,4%"]);
  });

  it("server menolak payload yang diubah setelah pratinjau", () => {
    const s = UPLOAD_SAMPLES.po_lines!;
    const preview = validateUpload("po_lines", s.grid, ctx);
    const tampered = s.grid.map((r) => [...r]);
    tampered[6][1] = "2026-08-28"; // KGR26.00360: the late delivery date moved after the preview
    expect(() => recheck("po_lines", parseGridPayload(JSON.stringify(tampered)), preview.fingerprint, ctx)).toThrow(UploadRejected);
    // the master changed since the preview (X-999 mapped): refused as well
    expect(() => recheck("po_lines", s.grid, preview.fingerprint, { ...ctx, items: [...items, { code: "X-999", name: "Kode baru", key: "RPA|Ceker|Fresh" }] })).toThrow(UploadRejected);
    expect(() => parseGridPayload('[["a", {"x": 1}]]')).toThrow(UploadRejected);
  });
});
