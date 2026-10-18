/** PRD v5 §4.9 (K34): parsing rules and the checks per upload kind; Lampiran B.5 with the golden context. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../src/fixtures";
import {
  classOfAvg, normHeader, parseCsv, parseTsv, registeredClasses, templateGrid, upDate, upMonth, upNum, upNumAmbiguous, upSize, uploadFingerprint, validateUpload,
  type Grid, type UploadContext, type UploadKindV5,
} from "../src/upload-validate";
import { D } from "../src/decimal";

const dir = join(repoRoot(), "fixtures");
const ctx0 = JSON.parse(readFileSync(join(dir, "upload-samples/context.json"), "utf8")) as Omit<UploadContext, "items">;
const items = (JSON.parse(readFileSync(join(dir, "week-2026-08-24/item_map.json"), "utf8")) as { item_code: string; item_name: string | null; key: string }[])
  .map((i) => ({ code: i.item_code, name: i.item_name, key: i.key }));
const ctx: UploadContext = { ...ctx0, items };
const samples = JSON.parse(readFileSync(join(dir, "upload-samples/samples.json"), "utf8")) as Record<UploadKindV5, { grid: Grid }>;

describe("aturan parsing (§4.9)", () => {
  it("angka: 1.234,5 · 36.705 · Rp 43.086 · 71,5% · angka Excel", () => {
    expect(upNum("1.234,5")!.toString()).toBe("1234.5");
    expect(upNum("36.705")!.toString()).toBe("36705");
    expect(upNum("Rp 43.086")!.toString()).toBe("43086");
    expect(upNum("71,5%")!.toString()).toBe("71.5");
    expect(upNum(811.3)!.toString()).toBe("811.3");
    expect(upNum("−12,5")!.toString()).toBe("-12.5");
    expect(upNum("")).toBeNull();
    expect(upNum("abc")).toBeNull();
    // PRD v5.1 R32: a leading 0 is a decimal, not a thousands group
    expect(upNum("0.715")!.toString()).toBe("0.715");
    expect(upNum("0.500")!.toString()).toBe("0.5");
    expect(upNum("-0.25")!.toString()).toBe("-0.25");
    expect(upNum("1.234")!.toString()).toBe("1234");
    expect(upNum("12.345,6")!.toString()).toBe("12345.6");
    // R79: English thousands ("1,234") is ambiguous — refuse it; a leading 0 is a decimal comma, never a thousands group
    expect(upNum("1,234")).toBeNull();
    expect(upNum("12,345,678")).toBeNull();
    expect(upNum("-1,234")).toBeNull();
    expect(upNum("0,715")!.toString()).toBe("0.715");
    expect(upNum("1,23")!.toString()).toBe("1.23");
    expect(upNum("1,2345")!.toString()).toBe("1.2345");
    expect(upNumAmbiguous("1,234")).toBe(true);
    expect(upNumAmbiguous("1.234,5")).toBe(false);
    expect(upNumAmbiguous(1234)).toBe(false);
    // both separators: the last one is the decimal point (en-US "1,234.5" is not ambiguous)
    expect(upNum("1,234.5")!.toString()).toBe("1234.5");
    expect(upNum("1.234.567,8")!.toString()).toBe("1234567.8");
    expect(upNum(null)).toBeNull();
  });
  it("tanggal: YYYY-MM-DD · DD/MM/YYYY · tanggal Excel; bulan", () => {
    expect(upDate("2026-08-27")).toBe("2026-08-27");
    expect(upDate("2026-8-7 10:00")).toBe("2026-08-07");
    expect(upDate("27/08/2026")).toBe("2026-08-27");
    expect(upDate(46261)).toBe("2026-08-27");
    expect(upDate("31/02/2026")).toBeNull();
    expect(upDate("besok")).toBeNull();
    expect(upMonth("2026-08")).toBe("2026-08-01");
    expect(upMonth("08/2026")).toBe("2026-08-01");
    expect(upMonth("Agu 2026")).toBe("2026-08-01");
    expect(upMonth("2026-08-17")).toBe("2026-08-01");
  });
  it("ukuran: Uk 1.3 · 1,3 · nama item", () => {
    expect(upSize("Uk 1.3")!.toFixed(2)).toBe("1.30");
    expect(upSize("1,4")!.toFixed(2)).toBe("1.40");
    expect(upSize("Karkas Uk 0.9 Frozen")!.toFixed(2)).toBe("0.90");
    expect(upSize("")).toBeNull();
  });
  it("judul kolom dinormalisasi; tempel TSV dan CSV (koma / titik koma, tanda kutip)", () => {
    expect(normHeader(" Kode  Item ")).toBe("kode_item");
    expect(parseTsv('a\tb\r\n"x\ty"\t2\n')).toEqual([["a", "b"], ["x\ty", "2"]]);
    expect(parseTsv('a\t"say ""hi"""')).toEqual([["a", 'say "hi"']]);
    expect(parseCsv("no_po;kg\nKGR1;1.234,5\n")).toEqual([["no_po", "kg"], ["KGR1", "1.234,5"]]);
    expect(parseCsv('no_po,kg\n"KGR,1",12\n')).toEqual([["no_po", "kg"], ["KGR,1", "12"]]);
  });
  it("template: baris judul saja", () => {
    expect(templateGrid("po_lines")).toEqual([["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan", "ukuran"]]);
  });
  it("kolom wajib hilang → satu cek gagal, tidak ada baris lolos", () => {
    const r = validateUpload("po_lines", [["no_po", "kg"], ["A", 1]], ctx);
    expect(r.ok_count).toBe(0);
    expect(r.checks).toEqual([{ level: "fail", title: "Kolom wajib", detail: "tidak ditemukan: tanggal_kirim, kode_item, harga", result: "perbaiki judul kolom" }]);
    expect(validateUpload("po_lines", [], ctx).checks[0].detail).toBe("kosong");
  });
});

describe("kelas terdaftar (C51)", () => {
  it("kelas dengan angka saja; seed v5/0 K/S/B tanpa angka belum terdaftar", () => {
    expect(registeredClasses(ctx.classes)).toEqual(["STD"]);
    expect(classOfAvg(ctx.classes, D("1.93"))).toBe("STD");
    expect(classOfAvg(ctx.classes, D("2.3"))).toBeNull();
  });
  it("Lampiran B.5 'kelas S': hanya dengan rentang ilustrasi mockup (input tes berlabel, bukan seed/golden)", () => {
    const illustrative = [{ code: "K", min_kg: "1.3", max_kg: "1.6", avg_kg: null }, { code: "S", min_kg: "1.6", max_kg: "2.0", avg_kg: null }, { code: "B", min_kg: "2.0", max_kg: "2.3", avg_kg: null }];
    const r = validateUpload("costing_wp", samples.costing_wp.grid, { ...ctx, classes: illustrative });
    expect(r.checks.find((c) => c.title.endsWith("rata-rata LB"))?.result).toBe("kelas S");
    // and with K/S/B registered the yield sample passes (Σ ≤ 100%, karkas within 68–76%)
    const y = validateUpload("yield_matrix", samples.yield_matrix.grid, { ...ctx, classes: illustrative });
    expect(y.ok_count).toBe(18);
    expect(y.records[0].data).toEqual({ weight_class: "K", cut_pattern: "karkas", key: "Karkas", yield_pct: "0.702000", effective_from: "2026-08-27" });
    expect(y.records.find((x) => x.data.key === "HJA (Hati/Jantung/Ampela)")).toBeTruthy();
  });
});

describe("Lampiran B.5 dengan konteks golden", () => {
  it("PO 7 → 5 lolos (O15 warn): Karkas Mix tanpa ukuran tersimpan STD; 5 baris di bawah lantai ke approval; 26 Agu lewat, X-999 dan harga kosong ditahan", () => {
    const r = validateUpload("po_lines", samples.po_lines.grid, ctx);
    expect([r.total, r.ok_count]).toEqual([7, 5]);
    expect(r.records.filter((x) => x.level !== "fail").map((x) => x.data.po_ref)).toEqual(["KGR26.00341", "KGR26.00349", "KGR26.00350", "KGR26.00353", "KGR26.00357"]);
    expect(r.records[0]).toMatchObject({ level: "warn", data: { key: "RPA|Karkas|n/a", size_kg: null } });
    expect(r.rows[0].action).toBe("ukuran karkas kosong: isi kolom ukuran atau biarkan STD");
    expect(r.checks.find((c) => c.code === "C50")).toMatchObject({ level: "warn", detail: "4 dari 5 baris karkas", result: "1 baris → STD" });
    expect(r.records.filter((x) => x.data.below_floor === "true").length).toBe(5);
    expect(r.records[1].data).toMatchObject({ key: "RPA|Karkas|Fresh", size_kg: "1.30", delivery_date: "2026-08-29", kg: "1755", price: "36705" });
    expect(r.summary).toBe("5 dari 7 baris bisa disimpan (7.594,9 kg dari 7.764,9 kg). Baris gagal ditahan sampai diperbaiki.");
    expect(r.dates).toEqual(["2026-08-27", "2026-08-29"]);
  });
  it("R79: kg \"1,234\" (ribuan Inggris) ditahan dengan alasan 'format ribuan ambigu', bukan dibaca 1,234 atau dianggap kosong", () => {
    const g = samples.po_lines.grid.map((r) => [...r]);
    g[2][3] = "1,234"; // KGR26.00349: kg
    g[3][4] = "12,500"; // KGR26.00350: harga
    const r = validateUpload("po_lines", g, ctx);
    expect(r.rows[1].level).toBe("fail");
    expect(r.rows[1].action).toContain('kg "1,234": format ribuan ambigu');
    expect(r.rows[2].level).toBe("fail");
    expect(r.rows[2].action).toContain('harga "12,500": format ribuan ambigu');
    expect(r.ok_count).toBe(3);
    // the same numbers written the id-ID way pass
    g[2][3] = "1.234"; g[3][4] = "12.500";
    expect(validateUpload("po_lines", g, ctx).rows.slice(1, 3).every((x) => !x.action.includes("ambigu"))).toBe(true);
  });
  it("PO dengan po_unsized_mode = fail: 7 → 4 lolos, Karkas Mix tanpa ukuran ditahan (perilaku v5)", () => {
    const r = validateUpload("po_lines", samples.po_lines.grid, { ...ctx, poUnsizedMode: "fail" });
    expect([r.total, r.ok_count]).toEqual([7, 4]);
    expect(r.records.filter((x) => x.level !== "fail").map((x) => x.data.po_ref)).toEqual(["KGR26.00349", "KGR26.00350", "KGR26.00353", "KGR26.00357"]);
    expect(r.rows[0].action).toBe("ukuran karkas kosong: isi kolom ukuran (Uk 0.8–1.5)");
    expect(r.checks.find((c) => c.code === "C50")).toMatchObject({ level: "fail", result: "1 baris" });
    expect(r.summary).toBe("4 dari 7 baris bisa disimpan (6.783,6 kg dari 7.764,9 kg). Baris gagal ditahan sampai diperbaiki.");
  });
  it("WP 8 → 6 lolos; Σ SKU 6.782,8 vs 7.286,6 (6,9%) gagal C22 2% → alasan wajib; yield karkas 73,4%", () => {
    const r = validateUpload("costing_wp", samples.costing_wp.grid, ctx);
    expect([r.total, r.ok_count]).toEqual([8, 6]);
    expect(r.needsReason).toEqual(["B260826"]);
    expect(r.checks.find((c) => c.code === "C22")?.level).toBe("fail");
    // the mockup tolerance (3%) would fail as well: 6,9% is outside both
    expect(validateUpload("costing_wp", samples.costing_wp.grid, { ...ctx, tolerance: "0.03" }).needsReason).toEqual(["B260826"]);
    expect(r.dates).toEqual(["2026-08-26"]);
  });
  it("yield 18 → 0 lolos: K, S, B belum terdaftar", () => {
    const r = validateUpload("yield_matrix", samples.yield_matrix.grid, ctx);
    expect([r.total, r.ok_count]).toEqual([18, 0]);
    expect(r.rows.map((x) => x.action)).toEqual(["daftarkan kelas K", "daftarkan kelas S", "daftarkan kelas B"]);
  });
  it("fingerprint: sama untuk grid dan konteks yang sama; berubah bila satu sel berubah", () => {
    const a = validateUpload("po_lines", samples.po_lines.grid, ctx);
    const b = validateUpload("po_lines", samples.po_lines.grid.map((r) => [...r]), ctx);
    expect(a.fingerprint).toBe(b.fingerprint);
    const g = samples.po_lines.grid.map((r) => [...r]);
    g[2][3] = 1755.1;
    expect(validateUpload("po_lines", g, ctx).fingerprint).not.toBe(a.fingerprint);
    const { fingerprint, ...rest } = a;
    expect(uploadFingerprint("po_lines", samples.po_lines.grid, rest)).toBe(fingerprint);
  });
});

describe("cek per jenis lain", () => {
  it("PO: pelanggan di luar assignment ditahan (K32); tanpa lantai (biaya disembunyikan) cek lantai = info", () => {
    const g: Grid = [["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan", "ukuran"], ["P1", "2026-08-28", "JLB1857", 100, 30000, "Toko X", "Uk 1.3"], ["P2", "2026-08-28", "JLB0829", 100, 30000, "Toko Y", ""]];
    const r = validateUpload("po_lines", g, { ...ctx, customers: ["toko x"], floors: null });
    expect(r.records.map((x) => x.level)).toEqual(["ok", "fail"]);
    expect(r.records[0].data.size_kg).toBe("1.30");
    expect(r.rows[1].action).toBe("pelanggan Toko Y tidak ditugaskan kepada Anda");
    expect(r.checks.find((c) => c.code === "C38")?.level).toBe("info");
  });
  it("WP: batch tidak dikenal ditahan; kg LB vs batch dicek bila batch punya kg LB", () => {
    const g: Grid = [["batch", "kg_lb", "ekor", "kode_item", "kg"], ["B1", 1000, 500, "JLB0829", 720], ["B9", 100, 50, "JLB0829", 70]];
    const r = validateUpload("costing_wp", g, { ...ctx, batches: [{ ref: "B1", date: "2026-08-25", lb_kg: "1010", heads: "500" }] });
    expect(r.records.map((x) => x.level)).toEqual(["ok", "fail"]);
    expect(r.checks.find((c) => c.title === "kg LB sesuai batch")).toEqual({ level: "ok", title: "kg LB sesuai batch", detail: "1.000 di WP vs 1.010 di batch (−1,0%)", result: "lolos" });
    // 720 vs 970 = 25,8% short; karkas yield 72%
    expect(r.checks.find((c) => c.code === "C22")?.level).toBe("fail");
  });
  it("PRD v5.1 R34: batch tanpa kg LB / ekor, atau kg LB berbeda antar baris → semua baris batch itu ditahan", () => {
    const batches = [{ ref: "B1", date: "2026-08-25", lb_kg: null, heads: null }, { ref: "B2", date: "2026-08-25", lb_kg: null, heads: null }, { ref: "B3", date: "2026-08-25", lb_kg: null, heads: null }];
    const g: Grid = [
      ["batch", "kg_lb", "ekor", "kode_item", "kg"],
      ["B1", "", "", "JLB0829", 720], ["B1", "", "", "JLB0829", 50],
      ["B2", 1000, 500, "JLB0829", 700], ["B2", 1100, "", "JLB0829", 40],
      ["B3", 1000, 500, "JLB0829", 700], ["B3", "", "", "JLB0829", 40],
    ];
    const r = validateUpload("costing_wp", g, { ...ctx, batches });
    expect(r.records.map((x) => x.level)).toEqual(["fail", "fail", "fail", "fail", "ok", "ok"]);
    expect(r.rows[1].action).toBe("batch B1: kg_lb atau ekor kosong");
    expect(r.rows[3].action).toBe("batch B2: kg LB tidak konsisten");
    expect(r.checks.find((c) => c.title === "Batch B2")).toEqual({ level: "fail", title: "Batch B2", detail: "kg LB tidak konsisten (1.000,0 / 1.100,0)", result: "satu angka kg LB per batch" });
    // kg LB on the first row only (the template) is consistent
    expect(r.checks.some((c) => c.title === "Batch B3")).toBe(false);
  });
  it("supply LB: kelas tidak terdaftar gagal (C51); kurang dari kebutuhan kelas → PERIKSA (C58)", () => {
    const g: Grid = [["tanggal", "kelas", "pemasok", "kg_lb", "harga"], ["2026-08-28", "STD", "AGRO", 2400, 24600], ["2026-08-28", "S", "AGRO", 100, ""]];
    const r = validateUpload("lb_supply", g, { ...ctx, classNeed: [{ date: "2026-08-28", weight_class: "STD", kg_lb: "2456" }] });
    expect(r.records.map((x) => x.level)).toEqual(["ok", "fail"]);
    expect(r.checks.find((c) => c.code === "C58")).toMatchObject({ level: "warn", detail: "STD 28/08 kurang 56 kg" });
    expect(r.records[0].data).toEqual({ date: "2026-08-28", weight_class: "STD", supplier: "AGRO", kg: "2400", price_per_kg: "24600", head_count: null });
  });
  it("beban tetap: COA harus berdriver tetap; periode tidak tumpang tindih; kode idempoten per COA × bulan", () => {
    const g: Grid = [["coa", "bulan", "nominal", "basis", "dasar"], ["6101", "2026-08", "85.600.000", "payroll", "gaji Agustus"], ["6102", "Agu 2026", 31900000, "", ""], ["7001", "2026-08", 1, "", ""], ["6101", "2026-08", 1, "", ""]];
    const r = validateUpload("fixed_cost", g, { ...ctx, fixedAccounts: ["6101", "6102"], fixedSchedule: [{ code: "seed-bunga", account: "6102", start: "2026-01-01", end: null }] });
    expect(r.records.map((x) => x.level)).toEqual(["ok", "fail", "fail", "fail"]);
    expect(r.records[0].data).toEqual({ code: "v5:6101:2026-08", account: "6101", month: "2026-08-01", amount: "85600000", basis: "payroll", note: "gaji Agustus" });
    expect(r.rows[1].action).toMatch(/tumpang tindih dengan jadwal seed-bunga/);
    expect(r.rows[2].action).toMatch(/bukan beban berdriver tetap/);
    expect(r.rows[3].action).toBe("COA × bulan ganda di file");
  });
  it("faktur: batch harus ada; tie ke GL (C23) atau tetap sementara", () => {
    const g: Grid = [["no_faktur", "tanggal", "pemasok", "batch", "kg", "nilai"], ["PI-1", "2026-08-27", "AGRO", "B260826", 7512, "184.795.200"], ["PI-2", "2026-08-27", "AGRO", "B260826", "", 1000], ["PI-3", "2026-08-27", "AGRO", "BX", "", 1000]];
    const r = validateUpload("supplier_invoice", g, { ...ctx, glByDoc: { "PI-1": "184795200.4" } });
    expect(r.records.map((x) => x.level)).toEqual(["ok", "warn", "fail"]);
    expect(r.records[0].data.tied).toBe("true");
    expect(r.rows[1].action).toBe("belum ada di jurnal: costing tetap sementara");
    expect(r.checks.find((c) => c.code === "C23")).toMatchObject({ level: "warn", detail: "1 dari 3" });
  });
});
