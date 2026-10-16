/**
 * M1 — costing per batch → SKU (PRD v3 §4.2). Pure functions, decimal.js.
 *
 * Relative sales value (the WP's column L, `202609_Data_COGS_LB.xlsx`):
 *   sales_value_i = kg_i × price_ref_i
 *   share_i       = sales_value_i / Σ sales_value
 *   allocated_i   = share_i × total_cost_batch            (Excel: ((K/K_total) × F_total) / (F+I) per kg)
 *   cost_per_kg_i = allocated_i / kg_i
 * A secondary pool (the WP's "Biaya BL", allocated only over the items named "Boneless …": Excel
 * `(K/SUMIF(H,"*Boneless*",K)) × F6 / I`) is spread the same way over its member rows.
 * Mode 'own' (RPA sendiri from Nov 2026) adds overhead = head_count × avg_lb_kg (or kg LB) × rate per kg LB;
 * idle capacity is a period cost (idleCapacity), never inside cost_per_kg.
 */
import { D, Decimal, ZERO, div, max, min, sum, type Num } from "./decimal";

export type CostMode = "maklon" | "own";
export type ByProductMethod = "joint" | "nrv";
export type CostComponent = "LB" | "freight" | "maklon" | "labour" | "overhead" | "blast" | "other";

export interface CostingBatch {
  ref: string;
  date?: string | null;
  mode: CostMode;
  lb_kg?: Num | null;
  head_count?: Num | null;
  avg_lb_kg?: Num | null;
  processed_kg?: Num | null;
}

export interface CostingOutput {
  ref: string;
  key?: string | null;
  item_code?: string | null;
  name?: string | null;
  kg: Num;
  /** Price list Rp/kg of the cut week (sku_price / WP price list). Null = no price: the row gets no cost. */
  price_ref: Num | null;
  /** By-product (kepala, ceker, usus, HJA, lemak …): valued at NRV when byProductMethod = 'nrv'. */
  by_product?: boolean;
  /** Secondary pools the row takes a share of (e.g. "boneless"). */
  pools?: string[];
}

export interface CostLine {
  component: CostComponent;
  amount: Num;
  /** null / "main" = the whole batch; otherwise the name of a secondary pool. */
  pool?: string | null;
  document_ref?: string | null;
  account?: string | null;
}

export interface OverheadRate {
  rate_per_kg_lb: Num;
  basis_kg?: Num | null;
  /** PRD v4 §3.5: overhead per head instead of per kg LB (used when the batch has a head count). */
  rate_per_head?: Num | null;
}

export interface AllocationOptions {
  byProductMethod: ByProductMethod;
  /** Selling cost per kg for the NRV test and NRV by-product valuation (default 0). */
  sellingCostPerKg?: Num;
}

export interface AllocateInput {
  batch: CostingBatch;
  outputs: CostingOutput[];
  costLines: CostLine[];
  overheadRate?: OverheadRate | null;
  options: AllocationOptions;
}

export interface AllocationLine {
  ref: string;
  key: string | null;
  item_code: string | null;
  kg: Decimal;
  priceRef: Decimal | null;
  salesValue: Decimal;
  /** Share of the main pool (0 for by-products valued at NRV). */
  share: Decimal;
  allocatedCost: Decimal;
  costPerKg: Decimal;
  byProductMethod: ByProductMethod;
  nrvFloor: Decimal | null;
  nrvWritedown: Decimal;
}

export interface PoolResult {
  name: string;
  cost: Decimal;
  salesValue: Decimal;
  allocated: Decimal;
  members: number;
}

export interface AllocationResult {
  batchRef: string;
  mode: CostMode;
  method: "relative_sales_value";
  totalCost: Decimal;
  overheadCost: Decimal;
  totalAllocated: Decimal;
  /** totalCost − totalAllocated (control C21: ≤ Rp 1). */
  diff: Decimal;
  outputKg: Decimal;
  costPerKgOutput: Decimal;
  pools: PoolResult[];
  lines: AllocationLine[];
  issues: string[];
}

const MAIN = "main";

/** WP cost label → component (header rows A3:A5 of a Pot_* sheet, and PI narratives). */
export function costComponentOf(label: string): CostComponent {
  const l = label.toLowerCase();
  if (/live\s*bird|ayam hidup|\blb\b/.test(l)) return "LB";
  if (/ekspedisi|angkut|freight|kirim|transport/.test(l)) return "freight";
  if (/potong|maklon|jasa rpa/.test(l)) return "maklon";
  if (/tkl|tenaga kerja|labou?r|gaji/.test(l)) return "labour";
  if (/blast|biaya bl\b|boneless/.test(l)) return "blast";
  if (/overhead|sewa|listrik|air\b/.test(l)) return "overhead";
  return "other";
}

/** The WP's secondary pool membership: Excel SUMIF(H:H,"*Boneless*") on the item name. */
export function poolsOfItemName(name: string | null | undefined): string[] {
  return name && /boneless/i.test(name) ? ["boneless"] : [];
}

/** kg LB the overhead rate applies to: head_count × avg_lb_kg when both are known, else kg LB. */
export function overheadBasisKg(b: CostingBatch): Decimal {
  if (b.head_count !== null && b.head_count !== undefined && b.avg_lb_kg !== null && b.avg_lb_kg !== undefined && D(b.avg_lb_kg).gt(0)) {
    return D(b.head_count).times(D(b.avg_lb_kg));
  }
  return D(b.lb_kg);
}

export function allocateBatch(x: AllocateInput): AllocationResult {
  const issues: string[] = [];
  const sellCost = D(x.options.sellingCostPerKg ?? 0);
  const perHead = x.overheadRate?.rate_per_head !== null && x.overheadRate?.rate_per_head !== undefined && x.overheadRate.rate_per_head !== "" && x.batch.head_count !== null && x.batch.head_count !== undefined;
  const overheadCost = x.batch.mode === "own" && x.overheadRate
    ? perHead ? D(x.batch.head_count!).times(D(x.overheadRate.rate_per_head!)) : overheadBasisKg(x.batch).times(D(x.overheadRate.rate_per_kg_lb))
    : ZERO;
  if (x.batch.mode === "own" && !x.overheadRate) issues.push("Mode RPA sendiri tanpa tarif overhead: overhead = 0");

  // pools
  const poolCost = new Map<string, Decimal>();
  for (const c of x.costLines) {
    const p = c.pool && c.pool !== MAIN ? c.pool : MAIN;
    poolCost.set(p, (poolCost.get(p) ?? ZERO).plus(D(c.amount)));
  }
  poolCost.set(MAIN, (poolCost.get(MAIN) ?? ZERO).plus(overheadCost));

  const outs = x.outputs.map((o) => {
    const kg = D(o.kg);
    const price = o.price_ref === null || o.price_ref === undefined || o.price_ref === "" ? null : D(o.price_ref);
    if (kg.gt(0) && (price === null || price.isZero())) issues.push(`${o.name ?? o.ref}: harga acuan kosong — tidak menerima biaya`);
    return { o, kg, price, sv: price === null ? ZERO : kg.times(price), alloc: ZERO, share: ZERO };
  });

  // secondary pools first (their members are known); a pool without members falls back to the main pool
  const pools: PoolResult[] = [];
  for (const [name, cost] of poolCost) {
    if (name === MAIN) continue;
    const members = outs.filter((r) => (r.o.pools ?? []).includes(name) && r.kg.gt(0));
    const sv = sum(members.map((r) => r.sv));
    if (sv.isZero()) {
      if (!cost.isZero()) issues.push(`Pool ${name}: tidak ada baris penerima — biaya masuk pool utama`);
      poolCost.set(MAIN, (poolCost.get(MAIN) ?? ZERO).plus(cost));
      pools.push({ name, cost, salesValue: ZERO, allocated: ZERO, members: 0 });
      continue;
    }
    let allocated = ZERO;
    for (const r of members) {
      const a = r.sv.div(sv).times(cost);
      r.alloc = r.alloc.plus(a);
      allocated = allocated.plus(a);
    }
    pools.push({ name, cost, salesValue: sv, allocated, members: members.length });
  }

  // main pool
  const mainCost = poolCost.get(MAIN) ?? ZERO;
  const priced = outs.filter((r) => r.kg.gt(0));
  let mainAllocated = ZERO;
  if (x.options.byProductMethod === "nrv" && priced.some((r) => r.o.by_product) && priced.some((r) => !r.o.by_product)) {
    // by-products at NRV (price − selling cost), capped at the pool; the rest by relative sales value over main products
    let nrvTotal = ZERO;
    for (const r of priced.filter((q) => q.o.by_product)) {
      const nrv = r.price === null ? ZERO : max(ZERO, r.price.minus(sellCost)).times(r.kg);
      const take = min(nrv, max(ZERO, mainCost.minus(nrvTotal)));
      r.alloc = r.alloc.plus(take);
      nrvTotal = nrvTotal.plus(take);
    }
    const main = priced.filter((q) => !q.o.by_product);
    const sv = sum(main.map((r) => r.sv));
    const rest = mainCost.minus(nrvTotal);
    for (const r of main) {
      r.share = div(r.sv, sv);
      r.alloc = r.alloc.plus(r.share.times(rest));
    }
    mainAllocated = nrvTotal.plus(sv.isZero() ? ZERO : rest);
  } else {
    const sv = sum(priced.map((r) => r.sv));
    for (const r of priced) {
      r.share = div(r.sv, sv);
      r.alloc = r.alloc.plus(r.share.times(mainCost));
    }
    mainAllocated = sv.isZero() ? ZERO : mainCost;
  }
  pools.unshift({ name: MAIN, cost: mainCost, salesValue: sum(priced.map((r) => r.sv)), allocated: mainAllocated, members: priced.length });
  if (priced.length === 0) issues.push("Batch tanpa output SKU — biaya belum teralokasi");

  const lines: AllocationLine[] = outs.map((r) => {
    const costPerKg = div(r.alloc, r.kg);
    const nrvFloor = r.price === null ? null : r.price.minus(sellCost);
    const nrvWritedown = nrvFloor !== null && r.kg.gt(0) && costPerKg.gt(nrvFloor) ? costPerKg.minus(nrvFloor).times(r.kg) : ZERO;
    return {
      ref: r.o.ref, key: r.o.key ?? null, item_code: r.o.item_code ?? null, kg: r.kg, priceRef: r.price, salesValue: r.sv,
      share: r.share, allocatedCost: r.alloc, costPerKg,
      byProductMethod: x.options.byProductMethod === "nrv" && r.o.by_product ? "nrv" : "joint",
      nrvFloor, nrvWritedown,
    };
  });
  const totalCost = sum(x.costLines.map((c) => D(c.amount))).plus(overheadCost);
  const totalAllocated = sum(lines.map((l) => l.allocatedCost));
  const outputKg = sum(lines.map((l) => l.kg));
  return {
    batchRef: x.batch.ref, mode: x.batch.mode, method: "relative_sales_value", totalCost, overheadCost, totalAllocated,
    diff: totalCost.minus(totalAllocated), outputKg, costPerKgOutput: div(totalAllocated, outputKg), pools, lines, issues,
  };
}

export interface GroupCost {
  group: string;
  kg: Decimal;
  cost: Decimal;
  costPerKg: Decimal;
  salesValue: Decimal;
}

/** COGS/kg per reporting group (sku_key.group_code, e.g. Karkas 0,9 + 1,0 → KARKAS). Unknown key → "TANPA GRUP". */
export function groupCostPerKg(lines: Pick<AllocationLine, "key" | "kg" | "allocatedCost" | "salesValue">[], groupOf: Map<string, string | null>): GroupCost[] {
  const m = new Map<string, GroupCost>();
  for (const l of lines) {
    const g = (l.key && groupOf.get(l.key)) || "TANPA GRUP";
    const a = m.get(g) ?? { group: g, kg: ZERO, cost: ZERO, costPerKg: ZERO, salesValue: ZERO };
    a.kg = a.kg.plus(l.kg);
    a.cost = a.cost.plus(l.allocatedCost);
    a.salesValue = a.salesValue.plus(l.salesValue);
    m.set(g, a);
  }
  return [...m.values()].map((g) => ({ ...g, costPerKg: div(g.cost, g.kg) })).sort((a, b) => a.group.localeCompare(b.group));
}

export interface CostPoolLineIn {
  component: CostComponent;
  amount: Num;
  batch_ref?: string | null;
  document_ref?: string | null;
  account?: string | null;
}

export interface CostPoolResult {
  totalPi: Decimal;
  totalGl: Decimal | null;
  /** PI − GL (control C23: ≤ Rp 1). Null when no GL total is known. */
  diff: Decimal | null;
  tied: boolean;
  byComponent: { component: CostComponent; amount: Decimal }[];
  direct: Decimal;
  period: Decimal;
}

/** Cost pool tie-out: Σ supplier invoices (+ accruals) vs Σ GL of the RPA cost accounts for the period (PRD v3 §4.2, Q2). */
export function computeCostPool(x: { lines: CostPoolLineIn[]; glTotal: Num | null }): CostPoolResult {
  const totalPi = sum(x.lines.map((l) => D(l.amount)));
  const totalGl = x.glTotal === null || x.glTotal === undefined || x.glTotal === "" ? null : D(x.glTotal);
  const diff = totalGl === null ? null : totalPi.minus(totalGl);
  const comps = new Map<CostComponent, Decimal>();
  for (const l of x.lines) comps.set(l.component, (comps.get(l.component) ?? ZERO).plus(D(l.amount)));
  return {
    totalPi, totalGl, diff, tied: diff !== null && diff.abs().lte(1),
    byComponent: [...comps.entries()].map(([component, amount]) => ({ component, amount })),
    direct: sum(x.lines.filter((l) => l.batch_ref).map((l) => D(l.amount))),
    period: sum(x.lines.filter((l) => !l.batch_ref).map((l) => D(l.amount))),
  };
}

/** Overhead rate per kg LB from a period pool (Σ period cost lines ÷ basis kg). */
export function overheadRateFrom(periodCost: Num, basisKg: Num): Decimal {
  return div(D(periodCost), D(basisKg));
}

/** Idle capacity (mode own): (basis − actual kg LB) × rate, a period cost on P&L line "Biaya kapasitas idle". */
export function idleCapacity(rate: OverheadRate, actualKgLb: Num): { idleKg: Decimal; idleCost: Decimal } {
  const basis = D(rate.basis_kg ?? 0);
  const idleKg = max(ZERO, basis.minus(D(actualKgLb)));
  return { idleKg, idleCost: idleKg.times(D(rate.rate_per_kg_lb)) };
}

/** Yield gap of a batch (control C22): Σ output kg vs processed kg (hasil potong). */
export function yieldGap(processedKg: Num | null | undefined, outputKg: Num): { gap: Decimal | null; gapPct: Decimal | null } {
  if (processedKg === null || processedKg === undefined || processedKg === "" || D(processedKg).isZero()) return { gap: null, gapPct: null };
  const gap = D(processedKg).minus(D(outputKg));
  return { gap, gapPct: gap.div(D(processedKg)) };
}
