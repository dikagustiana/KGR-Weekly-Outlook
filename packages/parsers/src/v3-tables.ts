/**
 * v3 tabular uploads (PRD v3 §5). Same header detection and value parsing as the v1 kinds (tables.ts), but kept in
 * their own list: each kind belongs to a module whose feature flag decides whether it is offered at all.
 */
import type { Sheet } from "./workbook";
import { F, detect, extract, type Detected, type FieldDef, type Mapping, type ParsedRow } from "./tables";

export type V3TableKind = "cost_pool_pi" | "stock_card" | "po_lines" | "forecast_sales" | "yield_matrix" | "lb_supply" | "cash_balance" | "cash_plan_daily";

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
  {
    // PRD v3 §5: tgl_po, no_po, customer, kode_item, kg, harga, tgl_kirim, status_demand, sales_rep
    kind: "po_lines",
    fields: [
      F("po_date", "Tgl PO", "date", ["tgl_po", "tanggal po", "tgl po", "po date", "tanggal"], true),
      F("po_ref", "No. PO", "text", ["no_po", "no po", "nomor po", "po no", "po number", "po"], true),
      F("customer", "Pelanggan", "text", ["customer", "pelanggan", "pembeli"]),
      F("item_code", "Kode item", "text", ["kode_item", "kode item", "kode barang", "kode", "item code", "sku"]),
      F("key_manual", "Key manual", "text", ["key", "key manual"]),
      F("kg", "kg", "number", ["kg", "qty", "kuantitas", "berat"], true),
      F("price", "Harga Rp/kg", "number", ["harga", "harga rpkg", "price", "harga jual"]),
      F("delivery_date", "Tgl kirim", "date", ["tgl_kirim", "tanggal kirim", "tgl kirim", "delivery date", "kirim"], true),
      F("demand_status", "Status demand", "text", ["status_demand", "status demand", "status", "demand status"]),
      F("sales_rep", "Sales", "text", ["sales_rep", "sales rep", "sales", "salesman", "marketing"]),
    ],
  },
  {
    // minggu, kode_item, sales_rep, kg, harga (+ customer / basis optional)
    kind: "forecast_sales",
    fields: [
      F("week_start", "Minggu", "date", ["minggu", "week", "week start", "senin", "tanggal minggu"], true),
      F("item_code", "Kode item", "text", ["kode_item", "kode item", "kode barang", "kode", "item code", "sku"]),
      F("key_manual", "Key manual", "text", ["key", "key manual"]),
      F("sales_rep", "Sales", "text", ["sales_rep", "sales rep", "sales", "salesman"]),
      F("customer", "Pelanggan", "text", ["customer", "pelanggan"]),
      F("kg", "kg", "number", ["kg", "qty", "kuantitas", "forecast kg"], true),
      F("price_expected", "Harga Rp/kg", "number", ["harga", "harga rpkg", "price", "harga harapan"]),
      F("basis", "Dasar", "text", ["basis", "dasar", "keterangan", "catatan"]),
    ],
  },
  {
    // PPIC: kelas berat, pola potong, SKU (key / nama SKU / komponen), yield % of live weight
    kind: "yield_matrix",
    fields: [
      F("weight_class", "Kelas berat", "text", ["weight_class", "kelas berat", "kelas", "size", "ukuran"], true),
      F("cut_pattern", "Pola potong", "text", ["cut_pattern", "pola potong", "pola", "pattern"], true),
      F("key", "SKU / key", "text", ["key", "sku", "komponen", "part", "produk"], true),
      F("yield_pct", "Yield", "number", ["yield_pct", "yield", "yield %", "persen", "%"], true),
      F("effective_from", "Berlaku mulai", "date", ["effective_from", "berlaku mulai", "mulai", "dari"]),
      F("effective_to", "Berlaku sampai", "date", ["effective_to", "berlaku sampai", "sampai"]),
    ],
  },
  {
    // Purchasing: tawaran / konfirmasi LB per tanggal × pemasok
    kind: "lb_supply",
    fields: [
      F("date", "Tanggal", "date", ["tanggal", "tgl", "date", "tanggal kirim"], true),
      F("supplier", "Pemasok", "text", ["pemasok", "supplier", "vendor"], true),
      F("weight_class", "Kelas berat", "text", ["weight_class", "kelas berat", "kelas", "size"]),
      F("head_count", "Ekor", "number", ["head_count", "ekor", "jumlah ekor", "heads"]),
      F("kg", "kg", "number", ["kg", "berat", "kg lb"]),
      F("price_per_kg", "Harga Rp/kg", "number", ["price_per_kg", "harga", "harga rpkg", "price"]),
      F("status", "Status", "text", ["status"]),
    ],
  },
  {
    // Template kas harian, sheet "Saldo": tanggal, no_rekening, saldo_awal, saldo_akhir, catatan (PRD v3 §4.7)
    kind: "cash_balance",
    fields: [
      F("date", "Tanggal", "date", ["tanggal", "tgl", "date"], true),
      F("account_no", "No. rekening", "text", ["no_rekening", "no rekening", "rekening", "account", "account no", "akun bank"], true),
      F("opening", "Saldo awal", "number", ["saldo_awal", "saldo awal", "opening", "awal"]),
      F("closing", "Saldo akhir", "number", ["saldo_akhir", "saldo akhir", "closing", "akhir"], true),
      F("note", "Catatan", "text", ["catatan", "keterangan", "note"]),
    ],
  },
  {
    // sheet "Rencana": tanggal, no_rekening, kategori_cf, deskripsi, jumlah (+ masuk / − keluar), id_jadwal_tetap
    kind: "cash_plan_daily",
    fields: [
      F("date", "Tanggal", "date", ["tanggal", "tgl", "date"], true),
      F("account_no", "No. rekening", "text", ["no_rekening", "no rekening", "rekening", "account"]),
      F("cf_category", "Kategori arus kas", "text", ["kategori_cf", "kategori cf", "kategori arus kas", "kategori", "category"]),
      F("description", "Deskripsi", "text", ["deskripsi", "keterangan", "uraian", "description"]),
      F("amount", "Jumlah", "number", ["jumlah", "amount", "nilai", "nominal"], true),
      F("fixed_cost_schedule_id", "ID jadwal tetap", "text", ["id_jadwal_tetap", "id jadwal tetap", "jadwal", "schedule"]),
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

/** PO demand status from Sales' CSV (English or Indonesian); empty = Confirmed (PRD v3 §4.1 default). */
export function normDemandStatus(v: string | null | undefined): "Confirmed" | "Tentative" | "Forecast" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "" || /^(confirmed|confirm|pasti|fix|firm|ok)$/.test(s)) return "Confirmed";
  if (/^(tentative|tentatif|belum pasti|kemungkinan|maybe)$/.test(s)) return "Tentative";
  if (/^(forecast|perkiraan|ramalan|proyeksi)$/.test(s)) return "Forecast";
  return null;
}

/** LB supply status; empty = offer. */
export function normSupplyStatus(v: string | null | undefined): "offer" | "confirmed" | "received" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "" || /^(offer|tawaran|penawaran|tawar)$/.test(s)) return "offer";
  if (/^(confirmed|confirm|konfirmasi|pasti|deal)$/.test(s)) return "confirmed";
  if (/^(received|diterima|terima|datang)$/.test(s)) return "received";
  return null;
}

/** Yield as a fraction of live weight: "18" / "18%" → 0.18, "0.18" → 0.18 (text in, text out; no float math). */
export function yieldFraction(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const t = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const [i, f = ""] = t.replace("-", "").split(".");
  if (Number(i) < 1 || (Number(i) === 1 && /^0*$/.test(f))) return t;
  // shift the decimal point two places left
  const digits = (i + f).replace(/^0+(?=\d)/, "");
  const point = i.length - 2;
  const pad = point <= 0 ? "0." + "0".repeat(-point) + digits.replace(/^0+/, "") : digits.slice(0, point) + "." + digits.slice(point);
  return pad.replace(/\.?0+$/, "") || "0";
}
