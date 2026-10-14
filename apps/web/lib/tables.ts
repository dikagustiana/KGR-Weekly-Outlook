/** Editable input tables (PRD §4) — column definitions shared by the forms and the server actions. */
import { CF_CATEGORIES, BS_ASSETS, BS_LIABILITIES, BS_EQUITY } from "@kgr/engine";
import { can, type Area, type Role } from "./roles";

export type ColType = "date" | "number" | "text" | "select" | "item" | "key";

export interface ColDef {
  name: string;
  label: string;
  type: ColType;
  options?: readonly string[];
  dp?: number;
  required?: boolean;
  width?: number;
}

export interface TableDef {
  table: "sales_line" | "receipt_line" | "batch" | "cash_plan" | "opening_stock";
  label: string;
  cols: ColDef[];
  /** Which permission area a row belongs to (decides who may write it). */
  area: (row: Record<string, unknown>) => Area;
  defaults?: Record<string, unknown>;
}

const D = (name: string, label: string, required = false): ColDef => ({ name, label, type: "date", required, width: 130 });
const NUM = (name: string, label: string, dp = 2, required = false): ColDef => ({ name, label, type: "number", dp, required, width: 100 });
const TXT = (name: string, label: string, width = 140): ColDef => ({ name, label, type: "text", width });

export const BS_LINES = [...BS_ASSETS, ...BS_LIABILITIES, ...BS_EQUITY.filter((x) => x !== "Current year profit")] as const;

export const TABLES: Record<TableDef["table"], TableDef> = {
  sales_line: {
    table: "sales_line", label: "Penjualan (T_Penjualan)",
    cols: [D("date", "Tanggal", true), { name: "status", label: "Status", type: "select", options: ["Order", "Aktual"], required: true, width: 90 },
      TXT("document_ref", "No. dokumen"), TXT("customer", "Pelanggan"), { name: "item_code", label: "Kode item", type: "item", width: 110 },
      { name: "key_manual", label: "Key manual (opsional)", type: "key", width: 180 }, NUM("kg", "kg", 2, true), NUM("price", "Harga Rp/kg", 2, true),
      NUM("hpp_actual", "HPP aktual Rp (opsional)", 0)],
    area: (r) => (r.status === "Order" ? "orders" : "sales_actual"),
    defaults: { status: "Order" },
  },
  receipt_line: {
    table: "receipt_line", label: "Penerimaan (T_Penerimaan)",
    cols: [D("date", "Tanggal", true), { name: "status", label: "Status", type: "select", options: ["Rencana", "Aktual"], required: true, width: 90 },
      { name: "receipt_source", label: "Sumber", type: "select", options: ["Beli Trading", "Produksi RPA"], required: true, width: 120 },
      TXT("document_ref", "No. dokumen / PO"), TXT("supplier", "Pemasok"), { name: "item_code", label: "Kode item", type: "item", width: 110 },
      { name: "key_manual", label: "Key manual (opsional)", type: "key", width: 180 }, NUM("kg", "kg", 2, true), NUM("unit_cost", "Rp/kg", 2, true)],
    area: (r) => (r.status === "Aktual" && r.source === "Accurate" ? "receipts_actual" : r.receipt_source === "Produksi RPA" ? "receipts_production" : "receipts_trading"),
    defaults: { status: "Rencana", receipt_source: "Beli Trading" },
  },
  batch: {
    table: "batch", label: "Batch potong (T_Batch)",
    cols: [D("date", "Tanggal potong", true), { name: "status", label: "Status", type: "select", options: ["Rencana", "Aktual"], required: true, width: 90 },
      TXT("batch_ref", "No. PO / batch", 130), TXT("supplier", "Pemasok", 110), NUM("lb_kg", "kg LB dibeli", 1, true), NUM("lb_price", "Harga LB Rp/kg", 2, true),
      NUM("freight", "Angkut Rp", 0), NUM("maklon", "Maklon Rp", 0), NUM("processed_kg", "kg diproses", 1), NUM("out_karkas_fresh", "Karkas fresh kg", 1),
      NUM("out_karkas_frozen", "Karkas frozen kg", 1), NUM("out_kepala", "Kepala kg", 1), NUM("out_ceker", "Ceker kg", 1), NUM("out_usus", "Usus kg", 1),
      NUM("out_hja", "HJA kg", 1), NUM("out_lemak", "Lemak kg", 1), NUM("out_other", "Lainnya kg", 1)],
    area: () => "batch",
    defaults: { status: "Rencana" },
  },
  cash_plan: {
    table: "cash_plan", label: "Rencana kas (T_Kas_Rencana)",
    cols: [D("date", "Tanggal", true), { name: "cf_category", label: "Kategori arus kas", type: "select", options: CF_CATEGORIES, required: true, width: 230 },
      { name: "bs_counter_line", label: "Pos neraca lawan", type: "select", options: BS_LINES, required: true, width: 210 }, TXT("description", "Keterangan", 280),
      NUM("amount", "Jumlah Rp (+ masuk / − keluar)", 0, true)],
    area: () => "cash_plan",
  },
  opening_stock: {
    table: "opening_stock", label: "Stok awal minggu (I_Stok_Awal)",
    cols: [{ name: "item_code", label: "Kode item", type: "item", width: 110 }, TXT("item_name", "Nama item", 200), { name: "key_manual", label: "Key (hanya baris dibawa)", type: "key", width: 180 },
      NUM("kg", "kg", 2, true), NUM("value", "Nilai Rp", 0, true), NUM("avg_age_days", "Umur rata-rata (hari)", 1), NUM("kg_over_age_limit", "kg di atas batas umur", 2), TXT("note", "Catatan", 180)],
    area: () => "opening_stock",
  },
};

export function canWriteRow(role: Role | null | undefined, def: TableDef, row: Record<string, unknown>): boolean {
  return can(role, def.area(row));
}

export function canAdd(role: Role | null | undefined, def: TableDef): boolean {
  const probes: Record<string, unknown>[] =
    def.table === "sales_line" ? [{ status: "Order" }, { status: "Aktual" }]
    : def.table === "receipt_line" ? [{ receipt_source: "Beli Trading" }, { receipt_source: "Produksi RPA" }]
    : [{}];
  return probes.some((p) => can(role, def.area(p)));
}
