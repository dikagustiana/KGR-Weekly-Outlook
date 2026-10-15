/**
 * Upload kind `costing_wp` (PRD v3 §5): the batch costing working paper (format `202609_Data_COGS_LB.xlsx`),
 * one sheet per cut batch (`Pot_ISA30`, `Pot_AGRO22`, …). Only what the costing needs is read:
 *   header  — supplier, cut date, kg LB, kg hasil potong, ayam mati, cost lines (Live Bird / Biaya Ekspedisi /
 *             Biaya Potong, plus "Biaya BL"), document refs;
 *   rows    — product name, price list Rp/kg, kg (Non Blasting F + Qty I), item code, item name.
 * Header labels are matched by alias (the "mapping stored per sheet" of PLAN-v3 F1 is the label set below,
 * overridable per upload). Values only — formulas are not read; the engine recomputes column L.
 */
import { D, costComponentOf, poolsOfItemName, type AllocateInput, type ByProductMethod, type CostMode } from "@kgr/engine";
import type { Sheet } from "./workbook";
import { isBlank, norm, parseDate, parseNumber, text, type Cell } from "./values";

export interface WpCost {
  label: string;
  amount: string;
  document: string | null;
  pi: string | null;
}

export interface WpRow {
  row: number;
  product: string | null;
  price: string | null;
  unit: string | null;
  sku_fresh: string | null;
  kg_non_blasting: string | null;
  item_code: string | null;
  item_name: string | null;
  kg: string | null;
}

export interface WpBatch {
  sheet: string;
  header_row: number;
  total_row: number;
  supplier: string | null;
  date: string | null;
  lb_kg: string | null;
  processed_kg: string | null;
  dead_head: string | null;
  dead_kg: string | null;
  costs: WpCost[];
  cost_bl: string | null;
  total_cost: string | null;
  rows: WpRow[];
  issues: string[];
}

export interface WpLabels {
  supplier: string[];
  date: string[];
  lbKg: string[];
  processed: string[];
  bl: string[];
  productHeader: string[];
}

export const WP_LABELS: WpLabels = {
  supplier: ["supplier", "pemasok"],
  date: ["tgl potong", "tanggal potong", "tgl. potong"],
  lbKg: ["total kg lb", "kg lb", "total lb kg"],
  processed: ["hasil potong"],
  bl: ["biaya bl", "biaya blasting"],
  productHeader: ["produk"],
};

const cellAt = (s: Sheet, r: number, c: number): Cell => {
  const row = s.rows[r - 1];
  if (!row) return null;
  const v = row[c - 1];
  return v === undefined ? null : v;
};

const numOrNull = (v: Cell): string | null => {
  if (typeof v !== "number") return null;
  try { return parseNumber(v); } catch { return null; }
};

function findLabel(s: Sheet, labels: string[], maxRow: number): { r: number; c: number } | null {
  const al = labels.map(norm);
  for (let r = 1; r <= maxRow; r++) {
    const row = s.rows[r - 1] ?? [];
    for (let c = 1; c <= Math.min(row.length, 20); c++) {
      const v = row[c - 1];
      if (typeof v === "string" && al.includes(norm(v))) return { r, c };
    }
  }
  return null;
}

/** Parse one sheet; null when it is not a batch costing sheet (no "Produk" header or no cost total). */
export function parseWpSheet(s: Sheet, labels: WpLabels = WP_LABELS): WpBatch | null {
  const hdr = (() => {
    const al = labels.productHeader.map(norm);
    for (let r = 1; r <= Math.min(25, s.rows.length); r++) if (al.includes(norm(cellAt(s, r, 1)))) return r;
    return null;
  })();
  if (hdr === null) return null;
  const tot = hdr + 1;
  const total = numOrNull(cellAt(s, tot, 6));
  if (total === null) return null;
  const issues: string[] = [];
  const costs: WpCost[] = [];
  for (let r = 3; r < hdr; r++) {
    const lab = cellAt(s, r, 1), amt = cellAt(s, r, 2);
    if (typeof lab === "string" && lab.trim() && norm(lab) !== "total" && typeof amt === "number") {
      costs.push({ label: lab.trim(), amount: parseNumber(amt)!, document: text(cellAt(s, r, 7)), pi: text(cellAt(s, r, 8)) });
    }
  }
  const valRight = (lab: string[]) => {
    const p = findLabel(s, lab, hdr - 1);
    return p ? cellAt(s, p.r, p.c + 1) : null;
  };
  const dateCell = valRight(labels.date);
  let date: string | null = null;
  try { date = typeof dateCell === "number" || typeof dateCell === "string" ? parseDate(dateCell) : null; } catch { date = null; }
  if (!date) issues.push(`${s.name}: tanggal potong tidak terbaca`);
  const blPos = findLabel(s, labels.bl, hdr - 1);
  const procPos = findLabel(s, labels.processed, hdr - 1);
  const processed = procPos ? numOrNull(cellAt(s, procPos.r + 1, procPos.c)) : null;
  const deadHead = norm(cellAt(s, 4, 14)) === norm("Ayam Mati") ? numOrNull(cellAt(s, 5, 14)) : null;
  const deadKg = norm(cellAt(s, 4, 15)) === norm("KG Mati") ? numOrNull(cellAt(s, 5, 15)) : null;

  const rows: WpRow[] = [];
  for (let r = tot + 1; r <= s.rows.length; r++) {
    const a = cellAt(s, r, 1);
    if (typeof a === "string" && /^(dibuat|diperiksa|disetujui)/i.test(a.trim())) break;
    const f = numOrNull(cellAt(s, r, 6)), i = numOrNull(cellAt(s, r, 9));
    if (!(f && Number(f) !== 0) && !(i && Number(i) !== 0)) continue;
    const kgTot = Number(f ?? 0) + Number(i ?? 0);
    if (kgTot < 0) issues.push(`${s.name} baris ${r}: kg ≤ 0`);
    const nameCell = cellAt(s, r, 8);
    rows.push({
      row: r, product: text(a), price: numOrNull(cellAt(s, r, 2)), unit: text(cellAt(s, r, 3)), sku_fresh: text(cellAt(s, r, 5)),
      kg_non_blasting: f, item_code: text(cellAt(s, r, 7)), item_name: isBlank(nameCell) ? null : text(nameCell), kg: i,
    });
  }
  if (!rows.length) issues.push(`${s.name}: tidak ada hasil SKU (output kosong) — lot dan alokasi belum bisa dibentuk`);
  for (const r of rows) if (!r.item_code) issues.push(`${s.name} baris ${r.row}: ${r.product ?? "?"} tanpa kode item`);
  const outKg = rows.reduce((t, r) => t + Number(r.kg ?? 0) + Number(r.kg_non_blasting ?? 0), 0);
  if (processed && Number(processed) > 0 && rows.length) {
    const pct = outKg / Number(processed);
    if (Math.abs(1 - pct) > 0.02) issues.push(`${s.name}: Σ hasil SKU ${outKg.toFixed(2)} kg = ${(pct * 100).toFixed(1)}% dari hasil potong ${processed} kg (kontrol C22)`);
  }
  return {
    sheet: s.name, header_row: hdr, total_row: tot, supplier: text(valRight(labels.supplier)), date,
    lb_kg: numOrNull(valRight(labels.lbKg)), processed_kg: processed, dead_head: deadHead, dead_kg: deadKg,
    costs, cost_bl: blPos ? numOrNull(cellAt(s, blPos.r, blPos.c + 1)) : null, total_cost: total, rows, issues,
  };
}

export interface WpParseResult {
  batches: WpBatch[];
  skipped: string[];
  issues: string[];
}

/** All batch sheets of a WP workbook (sheet names starting with "Pot_" first; other sheets are tried too). */
export function parseCostingWorkbook(sheets: Sheet[], labels: WpLabels = WP_LABELS): WpParseResult {
  const batches: WpBatch[] = [];
  const skipped: string[] = [];
  for (const s of sheets) {
    const b = parseWpSheet(s, labels);
    if (b) batches.push(b);
    else if (/^pot_/i.test(s.name)) skipped.push(s.name);
  }
  const issues = batches.flatMap((b) => b.issues);
  if (!batches.length) issues.push("Tidak ada sheet batch (header 'Produk' + total biaya) di file ini");
  return { batches, skipped, issues };
}

/** Batch reference used as batch.batch_ref / line key: the sheet name (Pot_ISA30) — unique per WP file. */
export function wpBatchRef(b: Pick<WpBatch, "sheet" | "date">): string {
  return b.sheet.trim();
}

/** Engine input for one parsed WP batch. keyOf maps an item code to its SKU key (item_map); byProduct flags by-products. */
export function wpToAllocateInput(
  b: WpBatch,
  opts: { mode?: CostMode; byProductMethod?: ByProductMethod; keyOf?: (code: string | null) => string | null; byProduct?: (key: string | null) => boolean; priceOf?: (key: string | null, wpPrice: string | null) => string | null; sellingCostPerKg?: string } = {},
): AllocateInput {
  const keyOf = opts.keyOf ?? (() => null);
  return {
    batch: { ref: wpBatchRef(b), date: b.date, mode: opts.mode ?? "maklon", lb_kg: b.lb_kg, processed_kg: b.processed_kg },
    outputs: b.rows.map((r) => {
      const key = keyOf(r.item_code);
      return {
        ref: `${b.sheet}!${r.row}`, key, item_code: r.item_code, name: r.item_name ?? r.product,
        kg: D(r.kg_non_blasting).plus(D(r.kg)), price_ref: opts.priceOf ? opts.priceOf(key, r.price) : r.price,
        by_product: opts.byProduct ? opts.byProduct(key) : false, pools: poolsOfItemName(r.item_name),
      };
    }),
    costLines: [
      ...b.costs.map((c) => ({ component: costComponentOf(c.label), amount: c.amount, document_ref: c.pi ?? c.document })),
      ...(b.cost_bl ? [{ component: "blast" as const, amount: b.cost_bl, pool: "boneless", document_ref: null }] : []),
    ],
    options: { byProductMethod: opts.byProductMethod ?? "joint", sellingCostPerKg: opts.sellingCostPerKg },
  };
}
