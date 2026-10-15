/**
 * v3 tabular uploads (PRD v3 §5). Same header detection and value parsing as the v1 kinds (tables.ts), but kept in
 * their own list: each kind belongs to a module whose feature flag decides whether it is offered at all.
 */
import type { Sheet } from "./workbook";
import { F, detect, extract, type Detected, type FieldDef, type Mapping, type ParsedRow } from "./tables";

export type V3TableKind = "cost_pool_pi" | "stock_card";

export interface V3TableDef {
  kind: V3TableKind;
  fields: FieldDef[];
}

export const V3_TABLES: V3TableDef[] = [
  {
    kind: "cost_pool_pi",
    fields: [
      F("date", "Tanggal", "date", ["tgl", "tanggal faktur", "tgl faktur", "tanggal pi", "invoice date", "date"], true),
      F("document_ref", "No. PI", "text", ["no pi", "nomor pi", "no faktur", "no invoice", "faktur", "no sumber", "nomor", "no bukti", "document"], true),
      F("supplier", "Pemasok", "text", ["pemasok", "supplier", "vendor", "nama pemasok"]),
      F("account", "Akun", "text", ["akun", "no akun", "kode akun", "account"]),
      F("description", "Keterangan", "text", ["keterangan", "deskripsi", "description", "memo", "uraian"]),
      F("amount", "Jumlah Rp", "number", ["jumlah", "jumlah rp", "total", "nilai", "amount", "dpp", "subtotal"], true),
      F("batch_ref", "Batch", "text", ["batch", "no batch", "batch ref", "sheet wp", "pot"]),
      F("component", "Komponen", "text", ["komponen", "component", "jenis biaya"]),
    ],
  },
  {
    kind: "stock_card",
    fields: [
      F("date", "Tanggal saldo", "date", ["tanggal", "tgl", "per tanggal", "tanggal saldo", "date", "as of"], true),
      F("item_code", "Kode item", "text", ["kode barang", "kode", "kode #", "no barang", "item no", "item code", "kode item"], true),
      F("item_name", "Nama item", "text", ["nama barang", "nama", "deskripsi barang", "item description", "description"]),
      F("kg", "Saldo kg", "number", ["saldo kts", "saldo kuantitas", "saldo qty", "kuantitas", "qty", "kts", "kg", "saldo"], true),
      F("value", "Saldo nilai", "number", ["saldo nilai", "nilai", "nilai rp", "value", "total nilai", "saldo rp"]),
    ],
  },
];

export function v3TableDef(kind: V3TableKind): V3TableDef {
  const d = V3_TABLES.find((x) => x.kind === kind);
  if (!d) throw new Error(`Jenis upload v3 tidak dikenal: ${kind}`);
  return d;
}

export interface V3TableParse {
  detected: Detected | null;
  rows: ParsedRow[];
  issues: string[];
}

export function parseV3Table(kind: V3TableKind, sheets: Sheet[], mapping?: Mapping): V3TableParse {
  const def = v3TableDef(kind);
  let detected = detect(sheets, def);
  if (mapping && detected) detected = { ...detected, mapping: { ...detected.mapping, ...mapping } };
  if (!detected) {
    return { detected: null, rows: [], issues: [`Kolom wajib tidak ditemukan: ${def.fields.filter((f) => f.required).map((f) => f.label).join(", ")}`] };
  }
  const rows = extract(sheets, def, detected);
  return { detected, rows, issues: rows.filter((r) => r.issues.length).slice(0, 20).map((r) => `Baris ${r.rowNo}: ${r.issues.join("; ")}`) };
}
