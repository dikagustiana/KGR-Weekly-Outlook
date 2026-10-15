import { describe, expect, it } from "vitest";
import { normDemandStatus, normSupplyStatus, parseV3Table, yieldFraction, type Sheet } from "../src";

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
