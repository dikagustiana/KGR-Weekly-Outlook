/**
 * Tabular uploads (PRD §7): Accurate exports and confirmed operational documents.
 * Header rows are detected from column-name aliases (Indonesian and English Accurate labels and the
 * KGR template's own headers); the wizard can override the detected column for any field.
 */
import type { Sheet } from "./workbook";
import { isBlank, norm, parseDate, parseNumber, text, type Cell } from "./values";

export type UploadKind =
  | "accurate_sales"
  | "accurate_receipts"
  | "accurate_inventory"
  | "accurate_stock_balance"
  | "accurate_journal"
  | "accurate_tb"
  | "ops_batch"
  | "ops_sales"
  | "ops_receipts"
  | "ops_stock_count"
  | "orders"
  | "receipts_plan"
  | "batch_plan"
  | "cash_plan";

export interface FieldDef {
  field: string;
  label: string;
  aliases: string[];
  required?: boolean;
  type: "date" | "number" | "text";
}

export interface KindDef {
  kind: UploadKind;
  label: string;
  source: "Accurate" | "Ops" | "Manual";
  target: string;
  description: string;
  roles: string[];
  fields: FieldDef[];
}

export const F = (field: string, label: string, type: FieldDef["type"], aliases: string[], required = false): FieldDef => ({
  field, label, type, aliases: [label, field, ...aliases], required,
});

const DATE = (req = true) => F("date", "Tanggal", "date", ["tgl", "date", "tanggal faktur", "tgl faktur", "invoice date", "tanggal transaksi", "tgl transaksi", "tanggal kirim", "tgl sj", "tanggal sj", "tanggal potong", "cut date", "tanggal terima"], req);
const DOC = (req = false) => F("document_ref", "No. dokumen", "text", ["no dokumen", "no faktur", "nomor faktur", "no invoice", "invoice no", "invoice", "faktur", "no sumber", "nomor", "no bukti", "source no", "no sj", "nomor sj", "surat jalan", "no do", "do", "no grn", "grn", "no penerimaan", "no po", "po", "no po batch", "dokumen", "document", "no transaksi"], req);
const ITEM = (req = true) => F("item_code", "Kode item", "text", ["kode barang", "kode", "kode #", "no barang", "item no", "item code", "kode item", "sku code", "item"], req);
const ITEM_NAME = F("item_name", "Nama item", "text", ["nama barang", "deskripsi barang", "item description", "description", "nama", "keterangan barang", "nama item accurate"]);
const KG = (label = "kg", req = true) => F("kg", label, "number", ["kuantitas", "qty", "quantity", "kts", "jumlah barang", "berat", "kg", "berat kg", "kg dibeli", "volume"], req);
const PRICE = F("price", "Harga Rp/kg", "number", ["harga", "harga satuan", "@harga", "unit price", "price", "harga jual", "harga rpkg", "rpkg"]);
const AMOUNT = F("amount", "Nilai Rp", "number", ["total", "jumlah", "amount", "total harga", "nilai", "nilai rp", "subtotal", "total rp"]);
const KEY = F("key_manual", "Key manual", "text", ["key", "key manual opsional", "key dipakai"]);

export const KINDS: KindDef[] = [
  {
    kind: "accurate_sales", label: "Accurate — Sales by Item Detail", source: "Accurate", target: "sales_line",
    description: "Penjualan aktual (faktur). Order dengan nomor dokumen yang sama menjadi Aktual.",
    roles: ["admin", "inventory_accounting"],
    fields: [DATE(), DOC(true), F("customer", "Pelanggan", "text", ["nama pelanggan", "customer", "customer name", "pembeli"]), ITEM(), ITEM_NAME, KG(), F("unit", "Satuan", "text", ["unit", "uom"]), PRICE, AMOUNT,
      F("hpp_actual", "HPP aktual Rp", "number", ["hpp", "hpp aktual", "cost", "nilai hpp", "cogs"])],
  },
  {
    kind: "accurate_receipts", label: "Accurate — Goods Receipt (penerimaan barang)", source: "Accurate", target: "receipt_line",
    description: "Penerimaan aktual (GRN). Sumber (Produksi RPA / Beli Trading) dari segmen key item.",
    roles: ["admin", "inventory_accounting"],
    fields: [DATE(), DOC(true), F("supplier", "Pemasok", "text", ["nama pemasok", "supplier", "vendor", "pemasok"]), ITEM(), ITEM_NAME, KG(),
      F("unit_cost", "Rp/kg", "number", ["harga satuan", "unit cost", "harga", "biaya per kg", "harga beli"]), AMOUNT],
  },
  {
    kind: "accurate_inventory", label: "Accurate — Inventory Valuation (ledger / kartu stok)", source: "Accurate", target: "inventory_ledger",
    description: "Baris DO → HPP aktual per baris penjualan; GRN → penerimaan aktual; saldo hari Minggu → stok awal (umur FIFO).",
    roles: ["admin", "inventory_accounting"],
    fields: [ITEM(), ITEM_NAME, DATE(), DOC(true), F("type", "Tipe", "text", ["tipe", "type", "tipe transaksi", "jenis", "source type", "tipe sumber"]),
      F("qty_in", "Kts masuk", "number", ["kts masuk", "qty in", "masuk", "kuantitas masuk", "qty masuk"]),
      F("value_in", "Nilai masuk", "number", ["nilai masuk", "value in", "biaya masuk"]),
      F("qty_out", "Kts keluar", "number", ["kts keluar", "qty out", "keluar", "kuantitas keluar", "qty keluar"]),
      F("value_out", "Nilai keluar", "number", ["nilai keluar", "value out", "biaya keluar", "hpp"]),
      F("qty_balance", "Saldo kts", "number", ["saldo kts", "qty balance", "saldo kuantitas", "saldo qty", "saldo"]),
      F("value_balance", "Saldo nilai", "number", ["saldo nilai", "value balance", "nilai saldo", "saldo rp"])],
  },
  {
    kind: "accurate_stock_balance", label: "Accurate — Inventory Valuation (saldo per item, Senin)", source: "Accurate", target: "opening_stock",
    description: "Stok awal minggu per kode item: kg, nilai, umur rata-rata, kg di atas batas umur.",
    roles: ["admin", "inventory_accounting"],
    fields: [ITEM(), ITEM_NAME, KG("kg", true), F("value", "Nilai Rp", "number", ["nilai", "nilai rp", "value", "saldo nilai", "total nilai", "amount"], true),
      F("avg_age_days", "Umur rata-rata (hari)", "number", ["umur", "umur rata rata", "umur ratarata hari", "age", "avg age"]),
      F("kg_over_age_limit", "kg di atas batas umur", "number", ["kg di atas batas umur", "kg over age", "over age"]),
      F("note", "Catatan", "text", ["catatan", "note", "keterangan"])],
  },
  {
    kind: "accurate_journal", label: "Accurate — General Ledger / Journal", source: "Accurate", target: "gl_line",
    description: "Baris jurnal. Upload ulang rentang tanggal yang sama mengganti baris rentang itu (idempotent). Baris tanpa tanggal diabaikan.",
    roles: ["admin", "inventory_accounting"],
    fields: [DATE(), F("voucher_no", "No. sumber", "text", ["no sumber", "nomor sumber", "source no", "no bukti", "no voucher", "voucher", "nomor", "no transaksi", "no jurnal"], true),
      F("voucher_type", "Tipe", "text", ["tipe sumber", "source type", "tipe", "tipe transaksi", "jenis"]),
      F("account", "Akun", "text", ["no akun", "kode akun", "nomor akun", "account no", "account", "akun", "kode perkiraan", "no perkiraan"], true),
      F("account_name", "Nama akun", "text", ["nama akun", "account name", "nama perkiraan"]),
      F("description", "Keterangan", "text", ["keterangan", "deskripsi", "description", "memo", "catatan"]),
      F("debit", "Debit", "number", ["debit", "debet", "dr", "nilai debit", "nilai debet"]), F("credit", "Kredit", "number", ["kredit", "credit", "cr", "nilai kredit", "nilai credit"]),
      F("party", "Pihak", "text", ["pihak", "party", "nama pelanggan pemasok", "pelangganpemasok", "nama"])],
  },
  {
    kind: "accurate_tb", label: "Accurate — Trial Balance (neraca saldo)", source: "Accurate", target: "tb_opening",
    description: "Neraca saldo per tanggal saldo awal; harus berjumlah nol; mengganti TB minggu ini.",
    roles: ["admin", "inventory_accounting"],
    fields: [F("account", "Akun", "text", ["no akun", "kode akun", "nomor akun", "account no", "account", "akun"], true),
      F("name", "Nama akun", "text", ["nama akun", "account name", "nama perkiraan", "nama"]),
      F("balance", "Saldo Rp (debit +)", "number", ["saldo", "saldo akhir", "balance", "ending balance", "saldo rp debit"]),
      F("debit", "Debit", "number", ["debit", "debet", "saldo debit"]), F("credit", "Kredit", "number", ["kredit", "credit", "saldo kredit"])],
  },
  {
    kind: "ops_batch", label: "Ops — Batch costing (Pot_ISA)", source: "Ops", target: "batch",
    description: "Batch aktual dari ops (timbangan live bird, biaya, output per produk). Opsi: buat penerimaan Produksi RPA di biaya per kg output.",
    roles: ["admin", "ppic"],
    fields: [DATE(), F("batch_ref", "No. PO / batch", "text", ["no po", "po", "no po batch", "batch", "no batch", "nomor po"]),
      F("supplier", "Pemasok", "text", ["pemasok", "supplier", "vendor"]),
      F("lb_kg", "kg LB dibeli", "number", ["kg lb", "kg lb dibeli", "live bird kg", "lb kg", "berat lb", "live bird kg ops"], true),
      F("lb_price", "Harga LB Rp/kg", "number", ["harga lb", "harga lb rpkg", "lb price", "harga live bird"]),
      F("lb_value", "Nilai LB Rp", "number", ["nilai lb", "live bird rp", "nilai live bird"]),
      F("freight", "Angkut Rp", "number", ["angkut", "angkut rp", "freight", "freight rp", "ongkos angkut"]),
      F("maklon", "Maklon Rp", "number", ["maklon", "maklon rp", "jasa potong"]),
      F("processed_kg", "kg diproses", "number", ["kg diproses", "processed", "processed kg", "kg proses"]),
      F("out_karkas_fresh", "Karkas fresh kg", "number", ["karkas fresh", "karkas fresh kg"]),
      F("out_karkas_frozen", "Karkas frozen kg", "number", ["karkas frozen", "karkas frozen kg"]),
      F("out_kepala", "Kepala kg", "number", ["kepala", "kepala kg"]), F("out_ceker", "Ceker kg", "number", ["ceker", "ceker kg"]),
      F("out_usus", "Usus kg", "number", ["usus", "usus kg"]), F("out_hja", "HJA kg", "number", ["hja", "hja kg", "hati jantung ampela"]),
      F("out_lemak", "Lemak kg", "number", ["lemak", "lemak kg"]), F("out_other", "Lainnya kg", "number", ["lainnya", "lainnya kg", "other"])],
  },
  {
    kind: "ops_sales", label: "Ops — Data penjualan / surat jalan", source: "Ops", target: "sales_line",
    description: "Pengiriman yang sudah ditandatangani (Aktual pada tanggal SJ); diganti baris Accurate dengan dokumen yang sama.",
    roles: ["admin", "inventory_accounting", "sales"],
    fields: [DATE(), DOC(true), F("customer", "Pelanggan", "text", ["pelanggan", "customer", "pembeli", "nama pelanggan"]), ITEM(false), KEY, ITEM_NAME, KG(), PRICE, AMOUNT],
  },
  {
    kind: "ops_receipts", label: "Ops — Konfirmasi pembelian trading (GRN ops)", source: "Ops", target: "receipt_line",
    description: "Penerimaan Beli Trading yang disepakati; diganti GRN Accurate dengan dokumen yang sama.",
    roles: ["admin", "inventory_accounting", "purchasing"],
    fields: [DATE(), DOC(true), F("supplier", "Pemasok", "text", ["pemasok", "supplier", "vendor"]), ITEM(false), KEY, ITEM_NAME, KG(),
      F("unit_cost", "Rp/kg", "number", ["harga", "harga beli", "rpkg", "unit cost", "harga sepakat"]), AMOUNT],
  },
  {
    kind: "ops_stock_count", label: "Ops — Stock count EOD (SOP 4)", source: "Ops", target: "opening_stock",
    description: "Stok awal kg saja bila Inventory Valuation terlambat; nilai = biaya rata-rata terakhir; ditandai sampai valuation masuk.",
    roles: ["admin", "inventory_accounting"],
    fields: [ITEM(), ITEM_NAME, KG("kg", true)],
  },
  {
    kind: "orders", label: "Order sales (CSV / Excel)", source: "Manual", target: "sales_line",
    description: "Order pelanggan (Status = Order, tanggal kirim rencana).",
    roles: ["admin", "sales"],
    fields: [DATE(), DOC(), F("customer", "Pelanggan", "text", ["pelanggan", "customer", "pembeli"]), ITEM(false), KEY, KG(), PRICE],
  },
  {
    kind: "receipts_plan", label: "Rencana terima (CSV / Excel)", source: "Manual", target: "receipt_line",
    description: "Rencana penerimaan (Produksi RPA / Beli Trading).",
    roles: ["admin", "ppic", "purchasing"],
    fields: [DATE(), F("receipt_source", "Sumber", "text", ["sumber", "source"]), DOC(), F("supplier", "Pemasok", "text", ["pemasok", "supplier"]),
      ITEM(false), KEY, KG(), F("unit_cost", "Rp/kg", "number", ["harga", "rpkg", "unit cost", "biaya"])],
  },
  {
    kind: "batch_plan", label: "Rencana potong (CSV / Excel)", source: "Manual", target: "batch",
    description: "Batch rencana (kg LB, harga penawaran, output perkiraan).",
    roles: ["admin", "ppic"],
    fields: [],
  },
  {
    kind: "cash_plan", label: "Rencana kas (CSV / Excel)", source: "Manual", target: "cash_plan",
    description: "Penerimaan dan pembayaran di luar model (+ masuk / − keluar).",
    roles: ["admin", "finance", "purchasing"],
    fields: [DATE(), F("cf_category", "Kategori arus kas", "text", ["kategori", "kategori arus kas", "category"], true),
      F("bs_counter_line", "Pos neraca lawan", "text", ["pos neraca lawan", "pos lawan", "counter", "pos neraca"], true),
      F("description", "Keterangan", "text", ["keterangan", "deskripsi", "description"]),
      F("amount", "Jumlah Rp", "number", ["jumlah", "jumlah rp", "amount", "nilai", "jumlah rp masuk keluar"], true)],
  },
];
// batch_plan shares the batch fields
KINDS.find((k) => k.kind === "batch_plan")!.fields = KINDS.find((k) => k.kind === "ops_batch")!.fields;

export function kindDef(kind: UploadKind): KindDef {
  const k = KINDS.find((x) => x.kind === kind);
  if (!k) throw new Error(`Jenis upload tidak dikenal: ${kind}`);
  return k;
}

export type Mapping = Record<string, number | null>;

export interface Detected {
  sheet: string;
  headerRow: number; // 1-based
  columns: string[];
  mapping: Mapping;
  score: number;
}

/** Find the header row and map fields to columns. */
export function detect(sheets: Sheet[], def: Pick<KindDef, "fields">): Detected | null {
  let best: Detected | null = null;
  for (const s of sheets) {
    const limit = Math.min(s.rows.length, 40);
    for (let r = 0; r < limit; r++) {
      const row = s.rows[r] ?? [];
      const cols = row.map((c) => norm(c));
      const mapping: Mapping = {};
      let score = 0;
      const used = new Set<number>();
      for (const f of def.fields) {
        const al = f.aliases.map(norm);
        let idx = cols.findIndex((c, i) => !used.has(i) && c !== "" && al.includes(c));
        if (idx < 0) idx = cols.findIndex((c, i) => !used.has(i) && c !== "" && al.some((a) => a.length >= 4 && c.startsWith(a)));
        mapping[f.field] = idx >= 0 ? idx : null;
        if (idx >= 0) { used.add(idx); score += f.required ? 2 : 1; }
      }
      const reqOk = def.fields.filter((f) => f.required).every((f) => mapping[f.field] !== null);
      if (reqOk && (!best || score > best.score)) {
        best = { sheet: s.name, headerRow: r + 1, columns: row.map((c) => text(c) ?? ""), mapping, score };
      }
    }
  }
  return best;
}

export interface ParsedRow {
  rowNo: number;
  values: Record<string, string | null>;
  issues: string[];
}

/** Extract typed records below the header using a mapping (detected or overridden by the user). */
export function extract(sheets: Sheet[], def: Pick<KindDef, "fields">, d: Detected): ParsedRow[] {
  const s = sheets.find((x) => x.name === d.sheet)!;
  const out: ParsedRow[] = [];
  let blankRun = 0;
  for (let r = d.headerRow; r < s.rows.length; r++) {
    const row = s.rows[r] ?? [];
    const cells: Record<string, Cell> = {};
    for (const f of def.fields) {
      const idx = d.mapping[f.field];
      cells[f.field] = idx === null || idx === undefined ? null : (row[idx] ?? null);
    }
    if (Object.values(cells).every(isBlank)) {
      if (++blankRun > 20) break;
      continue;
    }
    blankRun = 0;
    const values: Record<string, string | null> = {};
    const issues: string[] = [];
    for (const f of def.fields) {
      const c = cells[f.field];
      try {
        values[f.field] = f.type === "date" ? parseDate(c) : f.type === "number" ? parseNumber(c) : text(c);
      } catch (e) {
        values[f.field] = null;
        issues.push(`${f.label}: ${(e as Error).message}`);
      }
      if (f.required && values[f.field] === null && !issues.some((i) => i.startsWith(f.label))) issues.push(`${f.label} kosong`);
    }
    // total / subtotal lines in Accurate reports carry no date or document
    const label = Object.values(cells).map((c) => norm(c)).join(" ");
    if (/\b(total|subtotal|grand total|jumlah total)\b/.test(label) && issues.length > 0) continue;
    out.push({ rowNo: r + 1, values, issues });
  }
  return out;
}
