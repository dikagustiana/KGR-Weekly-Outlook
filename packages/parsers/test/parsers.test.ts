import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { computeWeek, snapshotJson, D } from "@kgr/engine";
import { loadFixtureWeek, repoRoot } from "@kgr/engine/fixtures";
import { parseDate, parseNumber, readWorkbook, parseWeekWorkbook, parseUpload, type Sheet } from "../src";

const root = repoRoot();
const ref = readFileSync(join(root, "reference", "KGR_Weekly_Outlook.xlsx"));
const fixtures = loadFixtureWeek("2026-08-24");

/** Build an in-memory xlsx from an array of arrays (what Accurate's "export to Excel" produces). */
function xlsx(rows: unknown[][], name = "Sheet1"): Sheet[] {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readWorkbook(buf, "export.xlsx");
}

describe("values", () => {
  it("numbers in id-ID and en-US notation, Excel serials and text dates", () => {
    expect(parseNumber("1.234.567,89")).toBe("1234567.89");
    expect(parseNumber("1,234,567.89")).toBe("1234567.89");
    expect(parseNumber("Rp 24.600")).toBe("24600");
    expect(parseNumber("2704,1")).toBe("2704.1");
    expect(parseNumber("(12.500)")).toBe("-12500");
    // PRD v6 K92: a dot with exactly three digits whose decimal reading is below 10 is ambiguous, never silently thousands
    expect(() => parseNumber("0.725")).toThrow(/ambigu: pakai koma untuk desimal \(0,725\)/);
    expect(() => parseNumber("(1.500)")).toThrow(/ambigu/);
    expect(parseNumber("0,725")).toBe("0.725");
    expect(parseNumber("1500")).toBe("1500");
    expect(parseNumber(-3874.34)).toBe("-3874.34");
    expect(parseNumber("")).toBeNull();
    expect(() => parseNumber("abc")).toThrow();
    expect(parseDate(46258)).toBe("2026-08-24");
    expect(parseDate("24/08/2026")).toBe("2026-08-24");
    expect(parseDate("2026-08-27 00:00:00")).toBe("2026-08-27");
    expect(parseDate("27 Agu 2026")).toBe("2026-08-27");
    expect(parseDate("27-Aug-26")).toBe("2026-08-27");
    expect(() => parseDate("31/02/2026")).toThrow();
  });
});

describe("KGR Weekly Outlook workbook import", () => {
  const parsed = parseWeekWorkbook(readWorkbook(ref, "KGR_Weekly_Outlook.xlsx"));

  it("reads the same input rows as the openpyxl fixtures", () => {
    expect(parsed.week).toEqual({ week_start: "2026-08-24", update_date: "2026-08-27", tb_opening_date: "2026-07-31" });
    const counts = (w: typeof parsed) => [w.sku_keys.length, w.item_map.length, w.coa_map.length, w.opening_stock.length, w.sales_lines.length,
      w.receipt_lines.length, w.batches.length, w.gl_lines.length, w.tb_opening.length, w.runrate.length, w.cash_plan.length];
    expect(counts(parsed)).toEqual(counts(fixtures));
    const numEq = (a: unknown, b: unknown) => (a === null || b === null ? a === b : D(a as string).equals(D(b as string)));
    parsed.sales_lines.forEach((s, i) => {
      const f = fixtures.sales_lines[i];
      expect([s.date, s.status, s.item_code, s.document_ref]).toEqual([f.date, f.status, f.item_code, f.document_ref]);
      expect(numEq(s.kg, f.kg) && numEq(s.price, f.price) && numEq(s.hpp_actual ?? null, f.hpp_actual ?? null)).toBe(true);
    });
    parsed.gl_lines.forEach((g, i) => {
      const f = fixtures.gl_lines[i];
      expect([g.date, g.voucher_no, g.account]).toEqual([f.date, f.voucher_no, f.account]);
      expect(numEq(g.debit, f.debit) && numEq(g.credit, f.credit)).toBe(true);
    });
  });

  it("gives a byte-identical outlook snapshot to the fixtures", () => {
    expect(snapshotJson(computeWeek(parsed))).toBe(snapshotJson(computeWeek(fixtures)));
  });
});

describe("Accurate exports", () => {
  it("Sales by Item Detail → sales_line Aktual (price from amount when missing), header detected below a title", () => {
    const act = fixtures.sales_lines.filter((s) => s.status === "Aktual");
    const rows = [
      ["PT Karya Gudang Rabat"], ["Rincian Penjualan per Barang"], [],
      ["Tanggal", "No. Faktur", "Nama Pelanggan", "Kode Barang", "Nama Barang", "Kuantitas", "Satuan", "Total Harga"],
      ...act.map((s) => [s.date, s.document_ref, s.customer ?? "", s.item_code, "", Number(s.kg), "KG", Number(D(s.kg).times(D(s.price)).toFixed(2))]),
      ["", "", "", "", "Total", act.reduce((a, s) => a + Number(s.kg), 0), "", ""],
    ];
    const r = parseUpload("accurate_sales", xlsx(rows));
    expect(r.detected?.headerRow).toBe(4);
    const out = r.sets[0].rows;
    expect(out.length).toBe(act.length);
    out.forEach((o, i) => {
      expect(o.status).toBe("Aktual");
      expect(o.item_code).toBe(act[i].item_code);
      expect(D(o.kg as string).equals(D(act[i].kg))).toBe(true);
      expect(D(o.price as string).minus(D(act[i].price)).abs().lessThan(0.0001)).toBe(true);
    });
    expect(new Set(out.map((o) => o.line_key)).size).toBe(out.length);
    expect(r.dateFrom).toBe("2026-08-24");
  });

  it("General Ledger → gl_line; undated rows excluded; line keys per voucher", () => {
    const gl = fixtures.gl_lines.slice(0, 50);
    const rows = [
      ["Tanggal", "No. Sumber", "Tipe Sumber", "No. Akun", "Nama Akun", "Keterangan", "Debit", "Kredit", "Pihak"],
      ...gl.map((g) => [g.date, g.voucher_no, g.voucher_type, Number(g.account), g.account_name, g.description, g.debit ? Number(g.debit) : null, g.credit ? Number(g.credit) : null, g.party]),
      [null, "ADJ-99", "Journal Voucher", 7200003, "x", "penyesuaian belum bertanggal", 100, null, null],
    ];
    const r = parseUpload("accurate_journal", xlsx(rows));
    expect(r.sets[0].rows.length).toBe(50);
    expect(r.issues.join(" ")).toContain("1 baris tanpa tanggal diabaikan");
    expect(r.sets[0].rows[1].line_key).toBe(`${gl[1].voucher_no}|2`);
    const sum = r.sets[0].rows.reduce((a, g) => a.plus(D(g.debit as string)).minus(D(g.credit as string)), D(0));
    const exp = gl.reduce((a, g) => a.plus(D(g.debit)).minus(D(g.credit)), D(0));
    expect(sum.equals(exp)).toBe(true);
  });

  it("General Ledger 'Daftar Histori GL' header (Nilai Debit / Nilai Kredit, kolom berselang kosong) → debit/credit terpetakan", () => {
    const rows = [
      ["", "Tanggal", "", "Tipe Sumber", "", "No. Sumber", "", "No. Akun", "", "Nama Akun", "", "Keterangan", "", "Nilai Debit", "", "Nilai Kredit"],
      ["", "01 Sep 2026", "", "Bukti Jurnal", "", "MJ26090001", "", "5100014", "", "Other COGS", "", "desc", "", "307500,00", "", "0,00"],
    ];
    const r = parseUpload("accurate_journal", xlsx(rows));
    expect(r.detected).not.toBeNull();
    expect(r.sets[0].rows.length).toBe(1);
    expect(r.sets[0].rows[0].debit).toBe("307500.00");
    expect(r.sets[0].rows[0].credit).toBe("0.00");
  });

  it("BT-1: a GL sheet whose debit/credit (or date/account) columns cannot be mapped throws — never debit/credit null", () => {
    // "Nilai Mutasi D/K" is not a known header: before BT-1 this parsed with debit = credit = null and no issue
    const unmapped = [["Tanggal", "No. Sumber", "No. Akun", "Nilai Mutasi D", "Nilai Mutasi K"], ["01 Sep 2026", "MJ26090001", "5100014", "307500", "0"]];
    expect(() => parseUpload("accurate_journal", xlsx(unmapped))).toThrow(/Kolom wajib jurnal tidak terpetakan: Debit, Kredit/);
    const noAccount = [["Tanggal", "No. Sumber", "Debit", "Kredit"], ["01 Sep 2026", "MJ26090001", "307500", "0"]];
    expect(() => parseUpload("accurate_journal", xlsx(noAccount))).toThrow(/Kolom wajib jurnal tidak terpetakan: .*Akun/);
    // a manual mapping that leaves Kredit out is refused the same way
    expect(() => parseUpload("accurate_journal", xlsx(unmapped), { mapping: { debit: 3, credit: null } })).toThrow(/Kredit/);
  });

  it("BT-1: the Accurate export with 'Kode Perkiraan' / 'Tanggal Jurnal' / 'Debet' (sheet 'Agt 26' of the FS workbook) maps every GL column", () => {
    const rows = [["Tanggal Jurnal", "No Jurnal", "Kode Perkiraan", "Nama Perkiraan", "Keterangan", "Debet", "Kredit", "Customers/Vendors Name", "Source Type"],
      ["01 Aug 2026", "MJ26080001", 5100013, "Other COGS - Handling In", "Uang Bongkar", 102565, 0, null, "Journal Voucher"]];
    const r = parseUpload("accurate_journal", xlsx(rows));
    expect(r.sets[0].rows[0]).toMatchObject({ date: "2026-08-01", voucher_no: "MJ26080001", account: "5100013", debit: "102565", credit: "0", voucher_type: "Journal Voucher" });
  });

  it("BT-1: a GL line with neither debit nor credit is held, and undated lines are reported with their sums and kinds", () => {
    const rows = [
      ["Tanggal", "No. Sumber", "Tipe Sumber", "No. Akun", "Nilai Debit", "Nilai Kredit"],
      ["01 Sep 2026", "MJ1", "Bukti Jurnal", "5100014", "100", "0"],
      ["01 Sep 2026", "MJ1", "Bukti Jurnal", "2102002", "0", "100"],
      ["01 Sep 2026", "MJ2", "Bukti Jurnal", "5100014", "", ""],
      ["", "DI-01", "Penyesuaian", "5100001", "250", "0"],
      ["", "DI-01", "Penyesuaian", "1104001", "0", "250"],
    ];
    const r = parseUpload("accurate_journal", xlsx(rows));
    expect(r.sets[0].rows.map((x) => x.voucher_no)).toEqual(["MJ1", "MJ1"]);
    expect(r.issues.join(" ")).toContain("1 baris tanpa debit dan kredit ditahan");
    expect(r.issues.join(" ")).toContain("2 baris tanpa tanggal diabaikan: Σ debit 250,00, Σ kredit 250,00; tipe Penyesuaian 2");
  });

  it("Trial balance from debit/credit columns must sum to zero", () => {
    const r = parseUpload("accurate_tb", xlsx([["No. Akun", "Nama Akun", "Debit", "Kredit"], ["1101001", "Kas", 100, null], ["2101001", "Utang", null, 90]]));
    expect(r.sets[0].rows.map((t) => t.balance)).toEqual(["100", "-90"]);
    expect(r.issues.join(" ")).toContain("Neraca saldo tidak nol");
  });

  it("Inventory ledger → HPP per DO line, receipts, opening stock with FIFO age at the Sunday cut-off", () => {
    const rows = [
      ["Kode Barang", "Nama Barang", "Tanggal", "No. Sumber", "Tipe", "Kts Masuk", "Nilai Masuk", "Kts Keluar", "Nilai Keluar", "Saldo Kts", "Saldo Nilai"],
      ["TRD0010", "BLP Frozen", "2026-07-01", "Saldo awal", "Saldo Awal", 100, 4_000_000, 0, 0, 100, 4_000_000],
      ["TRD0010", "BLP Frozen", "2026-08-10", "GR-1", "Penerimaan Barang", 50, 2_500_000, 0, 0, 150, 6_500_000],
      ["TRD0010", "BLP Frozen", "2026-08-20", "DO-1", "Pengiriman Pesanan", 0, 0, 120, 5_200_000, 30, 1_300_000],
      ["TRD0010", "BLP Frozen", "2026-08-25", "DO-2", "Pengiriman Pesanan", 0, 0, 10, 433_333, 20, 866_667],
    ];
    const r = parseUpload("accurate_inventory", xlsx(rows), { weekStart: "2026-08-24", stockAgeLimit: 30 });
    const by = Object.fromEntries(r.sets.map((s) => [s.target, s.rows]));
    expect(by.sales_hpp.map((h) => [h.document_ref, h.hpp])).toEqual([["DO-1", "5200000.00"], ["DO-2", "433333.00"]]);
    expect(by.receipt_line.map((x) => [x.document_ref, x.kg, x.unit_cost])).toEqual([["GR-1", "50", "50000"]]);
    // FIFO: 100 (1 Jul) + 50 (10 Aug) − 120 → 30 kg left, all from 10 Aug → age 14 days, none over 30 days
    expect(by.opening_stock).toEqual([expect.objectContaining({ item_code: "TRD0010", kg: "30", value: "1300000.00", avg_age_days: "14.00", kg_over_age_limit: "0.00" })]);
  });

  it("CSV in house notation (semicolon, decimal comma) → orders", () => {
    const csv = "Tanggal;Pelanggan;Kode item;kg;Harga Rp/kg\n27/08/2026;Erwin;TRD0010;1.234,5;43.086\n";
    const r = parseUpload("orders", readWorkbook(new TextEncoder().encode(csv), "orders.csv"));
    expect(r.sets[0].rows[0]).toMatchObject({ date: "2026-08-27", status: "Order", kg: "1234.5", price: "43086", item_code: "TRD0010" });
  });

  it("Ops batch costing → batch Aktual and Produksi RPA receipts at cost per kg output", () => {
    const b = fixtures.batches[0];
    const o = b.output;
    const rows = [
      ["Tanggal potong", "No. PO / batch", "Pemasok", "kg LB dibeli", "Harga LB Rp/kg", "Angkut Rp", "Maklon Rp", "kg diproses",
        "Karkas fresh kg", "Karkas frozen kg", "Kepala kg", "Ceker kg", "Usus kg", "HJA kg", "Lemak kg", "Lainnya kg"],
      [b.date, b.batch_ref, b.supplier, b.lb_kg, b.lb_price, b.freight, b.maklon, b.processed_kg, o.karkas_fresh, o.karkas_frozen, o.kepala, o.ceker, o.usus, o.hja, o.lemak, o.other].map((x) => (typeof x === "string" && /^[\d.]+$/.test(x) ? Number(x) : x)),
    ];
    const r = parseUpload("ops_batch", xlsx(rows), { makeProductionReceipts: true });
    const by = Object.fromEntries(r.sets.map((s) => [s.target, s.rows]));
    expect(by.batch[0]).toMatchObject({ status: "Aktual", lb_kg: "12211.6", out_karkas_fresh: "6186.3", source: "Ops" });
    expect(by.receipt_line.length).toBe(7);
    // cost per kg output = total cost ÷ output kg (T_Batch AC)
    expect(Number(by.receipt_line[0].unit_cost)).toBeCloseTo(31735.4621, 3);
    expect(by.receipt_line.reduce((a, x) => a + Number(x.kg), 0)).toBeCloseTo(10495.9, 6);
  });

  it("asks for a manual mapping when required columns are missing (a journal throws instead, BT-1)", () => {
    expect(() => parseUpload("accurate_journal", xlsx([["A", "B"], [1, 2]]))).toThrow(/Kolom wajib jurnal tidak terpetakan: Tanggal, Akun, Debit, Kredit/);
    const r = parseUpload("accurate_tb", xlsx([["A", "B"], [1, 2]]));
    expect(r.detected).toBeNull();
    expect(r.issues[0]).toContain("Kolom wajib tidak ditemukan");
  });
});
