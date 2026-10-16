import { describe, expect, it } from "vitest";
import { budgetMonthFirst, normBudgetMetric, normDayBasis, normDemandStatus, normSupplyStatus, parseV3Table, yieldFraction, type Sheet } from "../src";

const sheet = (rows: (string | number | null)[][]): Sheet[] => [{ name: "Sheet1", rows }];

describe("M3 uploads (PRD v3 §5)", () => {
  it("po_lines: tgl_po, no_po, customer, kode_item, kg, harga, tgl_kirim, status_demand, sales_rep", () => {
    const r = parseV3Table("po_lines", sheet([
      ["tgl_po", "no_po", "customer", "kode_item", "kg", "harga", "tgl_kirim", "status_demand", "sales_rep"],
      ["2026-09-01", "PO-001", "PT A", "JLB0790", "1.250,5", "34.000", "2026-09-03", "Tentative", "Budi"],
      ["2026-09-01", "PO-001", "PT A", "JLB0791", "100", "30000", "2026-09-04", "", "Budi"],
    ]));
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].values).toMatchObject({ po_date: "2026-09-01", po_ref: "PO-001", item_code: "JLB0790", kg: "1250.5", price: "34000", delivery_date: "2026-09-03", demand_status: "Tentative", sales_rep: "Budi" });
    expect(normDemandStatus(r.rows[1].values.demand_status)).toBe("Confirmed");
  });

  it("forecast_sales: minggu, kode_item, sales_rep, kg, harga", () => {
    const r = parseV3Table("forecast_sales", sheet([["minggu", "kode_item", "sales_rep", "kg", "harga"], ["2026-09-07", "JLB0790", "Budi", "500", "33000"]]));
    expect(r.rows[0].values).toMatchObject({ week_start: "2026-09-07", item_code: "JLB0790", sales_rep: "Budi", kg: "500", price_expected: "33000" });
  });

  it("yield_matrix and lb_supply; yield in % or fraction", () => {
    const y = parseV3Table("yield_matrix", sheet([["kelas berat", "pola potong", "sku", "yield"], ["STD", "boneless", "BLD", "18"], ["STD", "boneless", "BLP", "0,13"]]));
    expect(y.rows.map((r) => yieldFraction(r.values.yield_pct))).toEqual(["0.18", "0.13"]);
    expect(yieldFraction("73.67")).toBe("0.7367");
    expect(yieldFraction("5")).toBe("0.05");
    expect(yieldFraction("1")).toBe("1");
    expect(yieldFraction("100")).toBe("1");
    const l = parseV3Table("lb_supply", sheet([["tanggal", "pemasok", "kelas", "ekor", "harga", "status"], ["2026-09-08", "ISA", "STD", "1500", "19000", "konfirmasi"]]));
    expect(l.rows[0].values).toMatchObject({ date: "2026-09-08", supplier: "ISA", weight_class: "STD", head_count: "1500", price_per_kg: "19000" });
    expect(normSupplyStatus(l.rows[0].values.status)).toBe("confirmed");
    expect(normSupplyStatus("??")).toBeNull();
    expect(normDemandStatus("tentatif")).toBe("Tentative");
    expect(normDemandStatus("xyz")).toBeNull();
  });
});

describe("M6 template kas harian (2 sheets)", () => {
  it("Saldo and Rencana sheets are read by their own kinds", () => {
    const sheets: Sheet[] = [
      { name: "Saldo", rows: [["tanggal", "no_rekening", "saldo_awal", "saldo_akhir", "catatan"], ["2026-10-13", "BCA-1", "100.000.000", "90.000.000", ""]] },
      { name: "Rencana", rows: [["tanggal", "no_rekening", "kategori_cf", "deskripsi", "jumlah", "id_jadwal_tetap"], ["2026-10-14", "BCA-1", "Bayar karyawan", "Gaji", "-80.000.000", ""]] },
    ];
    const b = parseV3Table("cash_balance", sheets);
    expect(b.detected?.sheet).toBe("Saldo");
    expect(b.rows[0].values).toMatchObject({ date: "2026-10-13", account_no: "BCA-1", opening: "100000000", closing: "90000000" });
    const p = parseV3Table("cash_plan_daily", sheets);
    expect(p.detected?.sheet).toBe("Rencana");
    expect(p.rows[0].values).toMatchObject({ date: "2026-10-14", cf_category: "Bayar karyawan", amount: "-80000000" });
  });
});

describe("reference/templates/Template_Kas_Harian.xlsx (scripts/make_cash_template.py)", () => {
  it("the generated template is read by cash_balance and cash_plan_daily", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { repoRoot } = await import("@kgr/engine/fixtures");
    const { readWorkbook } = await import("../src");
    const wb = readWorkbook(readFileSync(join(repoRoot(), "reference", "templates", "Template_Kas_Harian.xlsx")), "Template_Kas_Harian.xlsx");
    expect(parseV3Table("cash_balance", wb).detected?.sheet).toBe("Saldo");
    expect(parseV3Table("cash_plan_daily", wb).detected?.sheet).toBe("Rencana");
  });
});

describe("M5 template 8.3 and budget uploads (PRD v4 §3.3, §4.4)", () => {
  it("fixed_cost: COA, nominal, berlaku dari/sampai, basis bagi, jadwal posting, dasar, pemilik", () => {
    const r = parseV3Table("fixed_cost", sheet([
      ["COA", "Nominal per bulan", "Berlaku dari", "Berlaku sampai", "Basis bagi", "Jadwal posting", "Dasar", "Pemilik", "Catatan"],
      ["6-1100", "85.565.549", "2026-08-01", "2026-08-31", "hari kalender", 25, "payroll Agustus", "HR", ""],
      ["6-2100", "94.482.500", "2026-11-01", "", "kerja", 1, "kontrak sewa RPA Rawa Terate", "GA", "grace 2 bulan"],
    ]));
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].values).toMatchObject({ account: "6-1100", amount_per_month: "85565549", start_date: "2026-08-01", end_date: "2026-08-31", posting_day: "25", basis_doc: "payroll Agustus", owner: "HR" });
    expect(normDayBasis(r.rows[0].values.day_basis)).toBe("calendar");
    expect(normDayBasis(r.rows[1].values.day_basis)).toBe("working");
    expect(normDayBasis("mingguan")).toBeNull();
    expect(normDayBasis("")).toBe("calendar");
  });

  it("budget: bulan × segmen × metrik", () => {
    const r = parseV3Table("budget", sheet([["Bulan", "Segmen", "Metrik", "Nilai"], ["2026-08", "RPA", "Revenue", "5.000.000.000"], ["2026-08-17", "Trading", "volume", "120000"], ["2026-13", "RPA", "gp", "1"]]));
    expect(r.rows[0].values).toMatchObject({ month: "2026-08-01", segment: "RPA", metric: "Revenue", value: "5000000000" });
    expect(r.rows[1].values.month).toBe("2026-08-17");
    expect(budgetMonthFirst("2026-08")).toBe("2026-08-01");
    expect(budgetMonthFirst("2026-08-17")).toBe("2026-08-01");
    expect(budgetMonthFirst("2026-13")).toBeNull();
    expect(normBudgetMetric("Revenue")).toBe("revenue");
    expect(normBudgetMetric("volume")).toBe("kg");
    expect(normBudgetMetric("laba kotor")).toBe("gp");
    expect(normBudgetMetric("NIBT")).toBe("nibt");
    expect(normBudgetMetric("lain")).toBeNull();
  });
});
