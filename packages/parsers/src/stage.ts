/** Turn parsed rows into rows of the target tables (staging), one function per upload kind. */
import { D, Decimal, toFixedString } from "@kgr/engine";
import type { Sheet } from "./workbook";
import { detect, extract, kindDef, type Detected, type KindDef, type Mapping, type ParsedRow, type UploadKind } from "./tables";

export type Target = "sales_line" | "receipt_line" | "batch" | "gl_line" | "tb_opening" | "opening_stock" | "cash_plan" | "sales_hpp";

export interface StagedSet {
  target: Target;
  rows: Record<string, unknown>[];
}

export interface ParseResult {
  kind: UploadKind;
  def: KindDef;
  detected: Detected | null;
  rows: ParsedRow[];
  sets: StagedSet[];
  issues: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

export interface ParseOptions {
  mapping?: Mapping;
  /** Monday of the week the upload is for (opening stock cut-off and FIFO age). */
  weekStart?: string;
  stockAgeLimit?: number;
  /** ops_batch: also create Produksi RPA receipts at the batch's cost per kg output. */
  makeProductionReceipts?: boolean;
}

/** Output columns of a batch → key of the received product. */
export const OUTPUT_KEYS: Record<string, string> = {
  out_karkas_fresh: "RPA|Karkas|Fresh",
  out_karkas_frozen: "RPA|Karkas|Frozen",
  out_kepala: "RPA|Kepala|Fresh",
  out_ceker: "RPA|Ceker|Fresh",
  out_usus: "RPA|Usus|Fresh",
  out_hja: "RPA|HJA (Hati/Jantung/Ampela)|Fresh",
  out_lemak: "RPA|Lemak|Fresh",
};

const r4 = (x: Decimal | null) => (x === null ? null : toFixedString(x, 4)!.replace(/\.?0+$/, "") || "0");
const per = (amount: string | null, kg: string | null): string | null => {
  if (amount === null || kg === null || D(kg).isZero()) return null;
  return r4(D(amount).div(D(kg)));
};

function lineKeys(rows: ParsedRow[], key: (v: Record<string, string | null>) => string): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = key(r.values);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}|${n}`;
  });
}

export function parseUpload(kind: UploadKind, sheets: Sheet[], opts: ParseOptions = {}): ParseResult {
  const def = kindDef(kind);
  let detected = detect(sheets, def);
  if (opts.mapping && detected) detected = { ...detected, mapping: { ...detected.mapping, ...opts.mapping } };
  if (opts.mapping && !detected && sheets[0]) {
    detected = { sheet: sheets[0].name, headerRow: 1, columns: (sheets[0].rows[0] ?? []).map((c) => String(c ?? "")), mapping: opts.mapping, score: 0 };
  }
  const issues: string[] = [];
  if (!detected) {
    issues.push(`Kolom wajib tidak ditemukan: ${def.fields.filter((f) => f.required).map((f) => f.label).join(", ")}. Pilih kolom secara manual.`);
    return { kind, def, detected: null, rows: [], sets: [], issues, dateFrom: null, dateTo: null };
  }
  const rows = extract(sheets, def, detected);
  const ok = rows.filter((r) => r.issues.length === 0);
  const sets: StagedSet[] = [];
  const v = (r: ParsedRow) => r.values;

  switch (kind) {
    case "accurate_sales":
    case "ops_sales":
    case "orders": {
      const src = def.source;
      const keys = lineKeys(ok, (x) => `${x.document_ref ?? ""}|${x.item_code ?? x.key_manual ?? ""}`);
      sets.push({
        target: "sales_line",
        rows: ok.map((r, i) => ({
          date: v(r).date, status: kind === "orders" ? "Order" : "Aktual", document_ref: v(r).document_ref, customer: v(r).customer ?? null,
          item_code: v(r).item_code, key_manual: v(r).key_manual ?? null, kg: v(r).kg,
          price: v(r).price ?? per(v(r).amount ?? null, v(r).kg), hpp_actual: v(r).hpp_actual ?? null, source: src,
          line_key: keys[i], _item_name: v(r).item_name ?? null,
        })),
      });
      break;
    }
    case "accurate_receipts":
    case "ops_receipts":
    case "receipts_plan": {
      const keys = lineKeys(ok, (x) => `${x.document_ref ?? ""}|${x.item_code ?? x.key_manual ?? ""}`);
      sets.push({
        target: "receipt_line",
        rows: ok.map((r, i) => ({
          date: v(r).date, status: kind === "receipts_plan" ? "Rencana" : "Aktual",
          receipt_source: kind === "ops_receipts" ? "Beli Trading" : normaliseSource(v(r).receipt_source ?? null),
          document_ref: v(r).document_ref, supplier: v(r).supplier ?? null, item_code: v(r).item_code, key_manual: v(r).key_manual ?? null,
          kg: v(r).kg, unit_cost: v(r).unit_cost ?? per(v(r).amount ?? null, v(r).kg), source: def.source, line_key: keys[i],
          _item_name: v(r).item_name ?? null,
        })),
      });
      break;
    }
    case "accurate_stock_balance":
    case "ops_stock_count":
      sets.push({
        target: "opening_stock",
        rows: ok.map((r) => ({
          item_code: v(r).item_code, item_name: v(r).item_name ?? null, kg: v(r).kg, value: v(r).value ?? null,
          avg_age_days: v(r).avg_age_days ?? null, kg_over_age_limit: v(r).kg_over_age_limit ?? null,
          note: kind === "ops_stock_count" ? "stock count EOD — nilai = biaya rata-rata terakhir" : v(r).note ?? null,
          source: def.source,
        })),
      });
      break;
    case "accurate_journal": {
      const dated = rows.filter((r) => r.values.date !== null);
      const undated = rows.length - dated.length;
      if (undated > 0) issues.push(`${undated} baris tanpa tanggal diabaikan (penyesuaian akhir bulan belum bertanggal)`);
      const good = dated.filter((r) => r.issues.filter((i) => !i.startsWith("Tanggal")).length === 0);
      const keys = lineKeys(good, (x) => `${x.voucher_no ?? ""}`);
      sets.push({
        target: "gl_line",
        rows: good.map((r, i) => ({
          date: v(r).date, voucher_no: v(r).voucher_no, voucher_type: v(r).voucher_type ?? null, account: v(r).account,
          account_name: v(r).account_name ?? null, description: v(r).description ?? null, debit: v(r).debit ?? null,
          credit: v(r).credit ?? null, party: v(r).party ?? null, line_key: keys[i], source: "Accurate",
        })),
      });
      break;
    }
    case "accurate_tb": {
      const tb = ok.map((r) => ({
        account: v(r).account, name: v(r).name ?? null,
        balance: v(r).balance ?? (v(r).debit !== null || v(r).credit !== null ? r4(D(v(r).debit).minus(D(v(r).credit))) : null),
        source: "Accurate",
      }));
      const total = tb.reduce((a, t) => a.plus(D(t.balance as string | null)), D(0));
      if (total.abs().greaterThan(1)) issues.push(`Neraca saldo tidak nol: selisih ${total.toFixed(2)} (kontrol 12)`);
      sets.push({ target: "tb_opening", rows: tb });
      break;
    }
    case "ops_batch":
    case "batch_plan": {
      const batches = ok.map((r) => {
        const x = v(r);
        const lbPrice = x.lb_price ?? per(x.lb_value ?? null, x.lb_kg);
        return {
          date: x.date, status: kind === "batch_plan" ? "Rencana" : "Aktual", batch_ref: x.batch_ref ?? null, supplier: x.supplier ?? null,
          lb_kg: x.lb_kg, lb_price: lbPrice, freight: x.freight ?? null, maklon: x.maklon ?? null, processed_kg: x.processed_kg ?? null,
          out_karkas_fresh: x.out_karkas_fresh ?? null, out_karkas_frozen: x.out_karkas_frozen ?? null, out_kepala: x.out_kepala ?? null,
          out_ceker: x.out_ceker ?? null, out_usus: x.out_usus ?? null, out_hja: x.out_hja ?? null, out_lemak: x.out_lemak ?? null,
          out_other: x.out_other ?? null, source: def.source, document_ref: x.batch_ref ?? null,
        };
      });
      sets.push({ target: "batch", rows: batches });
      if (kind === "ops_batch" && opts.makeProductionReceipts) {
        const rec: Record<string, unknown>[] = [];
        for (const b of batches) {
          const totalCost = D(b.lb_kg).times(D(b.lb_price)).plus(D(b.freight)).plus(D(b.maklon));
          const outKg = Object.keys(OUTPUT_KEYS).concat("out_other").reduce((a, k) => a.plus(D((b as Record<string, string | null>)[k])), D(0));
          if (outKg.isZero()) continue;
          const unit = r4(totalCost.div(outKg));
          for (const [col, key] of Object.entries(OUTPUT_KEYS)) {
            const kg = (b as Record<string, string | null>)[col];
            if (kg === null || D(kg).isZero()) continue;
            rec.push({
              date: b.date, status: "Aktual", receipt_source: "Produksi RPA", document_ref: b.batch_ref, supplier: b.supplier,
              item_code: null, key_manual: key, kg, unit_cost: unit, source: "Ops", line_key: `${b.batch_ref ?? b.date}|${key}|1`,
            });
          }
        }
        sets.push({ target: "receipt_line", rows: rec });
      }
      break;
    }
    case "cash_plan":
      sets.push({
        target: "cash_plan",
        rows: ok.map((r) => ({
          date: v(r).date, cf_category: v(r).cf_category, bs_counter_line: v(r).bs_counter_line, description: v(r).description ?? null,
          amount: v(r).amount, source: "Manual",
        })),
      });
      break;
    case "accurate_inventory":
      sets.push(...inventoryLedger(ok, opts, issues));
      break;
  }

  const dates = sets.flatMap((s) => s.rows.map((r) => r.date as string | null)).filter((d): d is string => !!d).sort();
  const bad = rows.filter((r) => r.issues.length > 0).length;
  if (bad > 0) issues.push(`${bad} baris punya masalah dan tidak akan disimpan`);
  return { kind, def, detected, rows, sets, issues, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null };
}

function normaliseSource(s: string | null): string | null {
  if (!s) return null;
  const n = s.toLowerCase();
  if (n.includes("produksi") || n.includes("rpa")) return "Produksi RPA";
  if (n.includes("trading") || n.includes("beli")) return "Beli Trading";
  return s;
}

type MoveType = "opening" | "receipt" | "do" | "adjust";

function moveType(t: string | null, qin: Decimal, qout: Decimal): MoveType {
  const n = (t ?? "").toLowerCase();
  if (/saldo awal|opening|beginning/.test(n)) return "opening";
  if (/delivery|pengiriman|penjualan|sales|\bdo\b|faktur/.test(n)) return "do";
  if (/receive|penerimaan|grn|pembelian|purchase|terima/.test(n)) return "receipt";
  if (/adjust|penyesuaian|opname/.test(n)) return "adjust";
  return qin.greaterThan(0) ? "receipt" : qout.greaterThan(0) ? "do" : "adjust";
}

/**
 * Inventory valuation ledger: DO rows → HPP aktual per (document, item); receipts → receipt_line Aktual;
 * balance at the Sunday before the week → opening_stock, with FIFO age from receipt dates.
 */
function inventoryLedger(rows: ParsedRow[], opts: ParseOptions, issues: string[]): StagedSet[] {
  const hpp = new Map<string, { document_ref: string; item_code: string; hpp: Decimal; kg: Decimal }>();
  const receipts: Record<string, unknown>[] = [];
  const byItem = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    const it = r.values.item_code!;
    byItem.set(it, [...(byItem.get(it) ?? []), r]);
  }
  const cutoff = opts.weekStart ? addDays(opts.weekStart, -1) : null;
  const opening: Record<string, unknown>[] = [];
  const limit = opts.stockAgeLimit ?? 30;
  const recKeys = new Map<string, number>();

  for (const [item, list] of byItem) {
    const sorted = [...list].sort((a, b) => (a.values.date ?? "").localeCompare(b.values.date ?? "") || a.rowNo - b.rowNo);
    const layers: { date: string; kg: Decimal }[] = [];
    let balQty: Decimal | null = null;
    let balVal: Decimal | null = null;
    let seenBeforeCutoff = false;
    for (const r of sorted) {
      const x = r.values;
      const qin = D(x.qty_in), qout = D(x.qty_out);
      const t = moveType(x.type ?? null, qin, qout);
      const date = x.date!;
      const before = cutoff !== null && date <= cutoff;
      if (before) seenBeforeCutoff = true;
      if (t === "do" && qout.greaterThan(0) && x.document_ref) {
        const k = `${x.document_ref}|${item}`;
        const a = hpp.get(k) ?? { document_ref: x.document_ref, item_code: item, hpp: D(0), kg: D(0) };
        a.hpp = a.hpp.plus(D(x.value_out));
        a.kg = a.kg.plus(qout);
        hpp.set(k, a);
      }
      if (t === "receipt" && qin.greaterThan(0)) {
        const k = `${x.document_ref ?? date}|${item}`;
        const n = (recKeys.get(k) ?? 0) + 1;
        recKeys.set(k, n);
        receipts.push({
          date, status: "Aktual", receipt_source: null, document_ref: x.document_ref, supplier: null, item_code: item, key_manual: null,
          kg: x.qty_in, unit_cost: x.value_in ? r4(D(x.value_in).div(qin)) : null, source: "Accurate", line_key: `${k}|${n}`,
        });
      }
      if (!before) continue;
      // FIFO layers up to the cut-off
      if (qin.greaterThan(0)) layers.push({ date, kg: qin });
      let out = qout;
      while (out.greaterThan(0) && layers.length > 0) {
        const l = layers[0];
        if (l.kg.lessThanOrEqualTo(out)) { out = out.minus(l.kg); layers.shift(); }
        else { l.kg = l.kg.minus(out); out = D(0); }
      }
      if (x.qty_balance !== null) balQty = D(x.qty_balance);
      if (x.value_balance !== null) balVal = D(x.value_balance);
    }
    if (cutoff && seenBeforeCutoff) {
      const kg = balQty ?? layers.reduce((a, l) => a.plus(l.kg), D(0));
      if (kg.isZero()) continue;
      const layerKg = layers.reduce((a, l) => a.plus(l.kg), D(0));
      const age = layerKg.isZero()
        ? null
        : layers.reduce((a, l) => a.plus(l.kg.times(diffDays(opts.weekStart!, l.date))), D(0)).div(layerKg);
      const over = layers.filter((l) => diffDays(opts.weekStart!, l.date) > limit).reduce((a, l) => a.plus(l.kg), D(0));
      opening.push({
        item_code: item, item_name: list[0].values.item_name ?? null, kg: r4(kg), value: balVal === null ? null : toFixedString(balVal, 2),
        avg_age_days: age === null ? null : toFixedString(age, 2), kg_over_age_limit: toFixedString(over, 2),
        note: "Inventory Valuation (FIFO umur dari tanggal terima)", source: "Accurate",
      });
    }
  }
  if (!cutoff) issues.push("Minggu tidak diketahui — stok awal tidak dibuat dari ledger");
  return [
    { target: "sales_hpp", rows: [...hpp.values()].map((h) => ({ document_ref: h.document_ref, item_code: h.item_code, hpp: toFixedString(h.hpp, 2), kg: toFixedString(h.kg, 2) })) },
    { target: "receipt_line", rows: receipts },
    ...(opening.length > 0 ? [{ target: "opening_stock" as Target, rows: opening }] : []),
  ];
}

function addDays(d: string, n: number): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(a) - t(b)) / 86_400_000);
}
