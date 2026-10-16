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
import type { ControlV3 } from "./controls-v3";
import type { PlRowV4 } from "./week-outlook";
import type { LedgerResult } from "./ledger";

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
  /** PRD v5 K20: the cost status this run stands for (default final: invoices and cost pool). */
  status?: CostStatus;
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
  status: CostStatus;
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
    batchRef: x.batch.ref, mode: x.batch.mode, status: x.status ?? "final", method: "relative_sales_value", totalCost, overheadCost, totalAllocated,
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

// ================================================================================================ PRD v5 §4.1 (K20–K25)

/** K20: the status every cost per kg carries, lowest first. */
export type CostStatus = "rencana" | "estimasi" | "sementara" | "final";
export const COST_STATUS_ORDER: CostStatus[] = ["rencana", "estimasi", "sementara", "final"];
export const COST_STATUS_LABEL: Record<CostStatus, string> = { rencana: "rencana", estimasi: "estimasi", sementara: "sementara", final: "final" };

/** The lowest status of a set (a stock line is as provisional as its most provisional lot); null for none. */
export function lowestStatus(statuses: (CostStatus | null | undefined)[]): CostStatus | null {
  const known = statuses.filter((s): s is CostStatus => !!s);
  if (!known.length) return null;
  return known.reduce((a, b) => (COST_STATUS_ORDER.indexOf(b) < COST_STATUS_ORDER.indexOf(a) ? b : a));
}

/**
 * Status of a batch's cost (K20, K21): final once its invoices tie to the GL (M1 allocation posted, or the invoice
 * marked tied); sementara once the WP is in (H+1); estimasi from the cut date; rencana before it.
 */
export function costStatusOf(b: { date: string | null; wpReceivedAt?: string | null; allocationPosted?: boolean; invoiceStatus?: string | null }, today: string): CostStatus {
  if (b.allocationPosted || b.invoiceStatus === "tied") return "final";
  if (b.wpReceivedAt) return "sementara";
  if (b.date && b.date <= today) return "estimasi";
  return "rencana";
}

/** Freight + slaughter fee per kg LB of the plan (§4.1): freight per kg LB + maklon per kg processed × (1 − shrink). */
export function tariffPerKgLb(p: { freightPerKgLb: Num; maklonPerKgProcessed: Num; shrink: Num }): Decimal {
  return D(p.freightPerKgLb).plus(D(p.maklonPerKgProcessed).times(D(1).minus(D(p.shrink))));
}

export interface PlanOutput { key: string; kg: Num; priceRef: Num | null }

export interface PlanCostLine {
  key: string;
  kg: Decimal;
  priceRef: Decimal | null;
  value: Decimal;
  /** k × reference price; null without a reference price (never 0). */
  costPerKg: Decimal | null;
  cost: Decimal | null;
  /** Reference price − cost per kg. */
  marginPerKg: Decimal | null;
}

export interface PlanCostResult {
  status: CostStatus;
  kgLb: Decimal;
  lbPrice: Decimal;
  /** Freight + fee: kg LB × tariff, or the actual amounts when given. */
  tariffCost: Decimal;
  overhead: Decimal;
  costPool: Decimal;
  /** Σ kg × reference price (+ other value). */
  value: Decimal;
  /** cost pool ÷ value (joint, by-products included, K23); null when nothing is priced. */
  k: Decimal | null;
  gp: Decimal;
  /** LB price at which the value covers the cost: value ÷ kg LB − tariff − overhead ÷ kg LB. */
  breakeven: Decimal | null;
  marginPerKgLb: Decimal | null;
  lines: PlanCostLine[];
  missingPrice: string[];
  /** A batch with an unpriced SKU cannot become final (§4.1). */
  canBeFinal: boolean;
}

/**
 * Cost of a plan, a cut day or a WP (§4.1, the same formula in all four modes):
 *   cost_pool = kg_LB × LB price + kg_LB × tariff (or the actual freight + fee) + overhead
 *   value     = Σ kg_SKU × reference price (last week's locked price list, K24)
 *   k         = cost_pool ÷ value;  cost_per_kg_SKU = k × reference price
 */
export function planCost(x: {
  status: CostStatus;
  kgLb: Num;
  lbPrice: Num;
  tariffPerKgLb?: Num | null;
  /** Actual freight + slaughter fee of the batch (sementara / final); replaces kg LB × tariff. */
  directCost?: Num | null;
  overhead?: Num | null;
  outputs: PlanOutput[];
  /** Value of outputs not listed per SKU (Rp), e.g. "other by-products" of a plan basis. */
  extraValue?: Num | null;
}): PlanCostResult {
  const kgLb = D(x.kgLb), lbPrice = D(x.lbPrice), overhead = D(x.overhead ?? 0);
  const tariffCost = x.directCost !== null && x.directCost !== undefined && x.directCost !== "" ? D(x.directCost) : kgLb.times(D(x.tariffPerKgLb ?? 0));
  const costPool = kgLb.times(lbPrice).plus(tariffCost).plus(overhead);
  const missingPrice: string[] = [];
  const base = x.outputs.map((o) => {
    const kg = D(o.kg);
    const price = o.priceRef === null || o.priceRef === undefined || o.priceRef === "" || D(o.priceRef).isZero() ? null : D(o.priceRef);
    if (price === null && kg.gt(0)) missingPrice.push(o.key);
    return { key: o.key, kg, price, value: price === null ? ZERO : kg.times(price) };
  });
  const value = sum(base.map((b) => b.value)).plus(D(x.extraValue ?? 0));
  const k = value.isZero() ? null : costPool.div(value);
  const lines: PlanCostLine[] = base.map((b) => {
    const costPerKg = k === null || b.price === null ? null : k.times(b.price);
    return { key: b.key, kg: b.kg, priceRef: b.price, value: b.value, costPerKg, cost: costPerKg === null ? null : costPerKg.times(b.kg), marginPerKg: costPerKg === null || b.price === null ? null : b.price.minus(costPerKg) };
  });
  const perKgLb = (v: Decimal) => (kgLb.isZero() ? null : v.div(kgLb));
  const breakeven = kgLb.isZero() || value.isZero() ? null : value.minus(tariffCost).minus(overhead).div(kgLb);
  return {
    status: x.status, kgLb, lbPrice, tariffCost, overhead, costPool, value, k, gp: value.minus(costPool),
    breakeven, marginPerKgLb: value.isZero() ? null : perKgLb(value.minus(costPool)), lines, missingPrice, canBeFinal: missingPrice.length === 0,
  };
}

/** Outputs of the need basis (§4.1, K25): the demanded main products at their reference price and the by-products the kg LB yields. */
export function needBasisOutputs(x: { kgLb: Num; demand: PlanOutput[]; byProducts: { key: string; yield: Num; priceRef: Num | null }[] }): PlanOutput[] {
  return [...x.demand, ...x.byProducts.map((b) => ({ key: b.key, kg: D(x.kgLb).times(D(b.yield)), priceRef: b.priceRef }))];
}

/**
 * K25 batch basis (§4.1, Lampiran B.1): the kg LB planned in the horizon (v1 block 2), the karkas at risk of freezing
 * at the frozen reference price, and the rest of the plan's value per kg LB as other value.
 */
export function batchBasisInputs(x: { kgLb: Num; karkasAtRisk: Num; frozenPrice: Num; valuePerKgLb: Num }): { kgLb: Decimal; outputs: PlanOutput[]; extraValue: Decimal } {
  const atRisk = D(x.karkasAtRisk);
  return {
    kgLb: D(x.kgLb),
    outputs: [{ key: "RPA|Karkas|Frozen", kg: atRisk, priceRef: x.frozenPrice }],
    extraValue: D(x.valuePerKgLb).times(D(x.kgLb)).minus(atRisk.times(D(x.frozenPrice))),
  };
}

export interface LivebirdSimRow {
  price: Decimal;
  cogs: Decimal;
  gp: Decimal;
  /** gp ÷ value. */
  gpPct: Decimal | null;
  k: Decimal | null;
  marginPerKgLb: Decimal | null;
  skus: { key: string; kg: Decimal; priceRef: Decimal | null; costPerKg: Decimal | null; marginPerKg: Decimal | null }[];
}

export interface LivebirdSimulation {
  basis: "need" | "batch";
  kgLb: Decimal;
  value: Decimal;
  breakeven: Decimal | null;
  rows: LivebirdSimRow[];
}

/**
 * K25: what an LB price means for the plan's COGS, GP, cost per kg per SKU and margin per kg LB, at each price tried.
 * Mode rencana; a simulation, never a recommendation (no buy / wait label anywhere).
 */
export function simulateLivebird(x: { basis: "need" | "batch"; kgLb: Num; outputs: PlanOutput[]; extraValue?: Num | null; tariffPerKgLb: Num; overhead?: Num | null; prices: Num[] }): LivebirdSimulation {
  const rows = x.prices.map((p) => {
    const r = planCost({ status: "rencana", kgLb: x.kgLb, lbPrice: p, tariffPerKgLb: x.tariffPerKgLb, overhead: x.overhead, outputs: x.outputs, extraValue: x.extraValue });
    return {
      price: D(p), cogs: r.costPool, gp: r.gp, gpPct: r.value.isZero() ? null : r.gp.div(r.value), k: r.k, marginPerKgLb: r.marginPerKgLb,
      skus: r.lines.map((l) => ({ key: l.key, kg: l.kg, priceRef: l.priceRef, costPerKg: l.costPerKg, marginPerKg: l.marginPerKg })),
    };
  });
  const first = planCost({ status: "rencana", kgLb: x.kgLb, lbPrice: 0, tariffPerKgLb: x.tariffPerKgLb, overhead: x.overhead, outputs: x.outputs, extraValue: x.extraValue });
  return { basis: x.basis, kgLb: D(x.kgLb), value: first.value, breakeven: first.breakeven, rows };
}

// ------------------------------------------------------------------------------------------------ K22 revaluation

export interface RevalueLot {
  lot_ref: string;
  key: string | null;
  kgIn: Num;
  kgRemaining: Num;
  /** Cost per kg before (sementara) and after (final). */
  costFrom: Num;
  costTo: Num;
  statusFrom: CostStatus;
  statusTo: CostStatus;
  /** Sales out of the lot up to the final date (for restate_sale_date). */
  sales?: { date: string; kg: Num }[];
  /** kg sold up to the final date; default kg in − kg remaining (a lot blasted to frozen passes kg to its child lot, not to a sale). */
  kgSold?: Num;
}

/**
 * K22: when a lot's cost becomes final, Δ = final − provisional per kg. The part still in stock revalues the stock
 * (lot_revaluation); the part already sold goes to P&L line "Selisih costing" — on the final date (cogs_line, O1
 * default) or on each sale date (restate_sale_date). P&L sign: a higher cost is negative.
 */
export function revalueLots(x: { date: string; mode: "cogs_line" | "restate_sale_date"; lots: RevalueLot[] }): {
  rows: { date: string; lot_ref: string; key: string | null; cost_from: Decimal; cost_to: Decimal; kg_remaining: Decimal; kg_sold: Decimal; amount: Decimal; amount_sold: Decimal; status_from: CostStatus; status_to: CostStatus; sold_by_date: { date: string; kg: Decimal; amount: Decimal }[] }[];
  plRows: { date: string; pl_line: "Selisih costing"; amount: Decimal }[];
} {
  const rows = [];
  const pl = new Map<string, Decimal>();
  for (const l of x.lots) {
    const delta = D(l.costTo).minus(D(l.costFrom));
    if (delta.isZero()) continue;
    const kgRemaining = D(l.kgRemaining), kgSold = l.kgSold !== undefined ? D(l.kgSold) : max(ZERO, D(l.kgIn).minus(kgRemaining));
    rows.push({ date: x.date, lot_ref: l.lot_ref, key: l.key, cost_from: D(l.costFrom), cost_to: D(l.costTo), kg_remaining: kgRemaining, kg_sold: kgSold, amount: delta.times(kgRemaining), amount_sold: delta.times(kgSold), status_from: l.statusFrom, status_to: l.statusTo,
      sold_by_date: (l.sales ?? []).map((y) => ({ date: y.date, kg: D(y.kg), amount: delta.times(D(y.kg)) })) });
    if (x.mode === "cogs_line" || !l.sales?.length) {
      if (!kgSold.isZero()) pl.set(x.date, (pl.get(x.date) ?? ZERO).minus(delta.times(kgSold)));
    } else {
      for (const s of l.sales) pl.set(s.date, (pl.get(s.date) ?? ZERO).minus(delta.times(D(s.kg))));
    }
  }
  return { rows, plRows: [...pl.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, pl_line: "Selisih costing" as const, amount })) };
}

/** A batch whose M1 allocation was posted on finalDate, with the provisional cost per key it carried before (K22). */
export interface FinalBatch { batch_ref: string; finalDate: string; statusFrom: CostStatus; costFromByKey: Map<string, Decimal> }

const costFromOf = (m: Map<string, Decimal>, key: string) => m.get(key) ?? (key.endsWith("|n/a") ? m.get(key.replace(/\|n\/a$/, "|Fresh")) : undefined);

/**
 * K22 on the lot ledger: the lots of the batches that turned final on `date` (their blast children too, whose Δ is the
 * parent's), with kg remaining at the end of the day and kg sold up to it (sales per date for restate_sale_date).
 * A lot whose key had no provisional cost (no reference price) is left out: it never carried a provisional cost.
 */
export function finalLots(x: { led: LedgerResult; date: string; kgByLot: Map<string, Num>; finals: FinalBatch[] }): RevalueLot[] {
  const today = x.finals.filter((f) => f.finalDate === x.date);
  if (!today.length) return [];
  const byRef = new Map(x.led.lots.map((l) => [l.ref, l]));
  const out: RevalueLot[] = [];
  for (const f of today) {
    for (const l of x.led.lots.filter((y) => !y.planned && y.batch_ref === f.batch_ref)) {
      const parent = l.parent_ref ? byRef.get(l.parent_ref) : undefined;
      const src = parent && parent.batch_ref === f.batch_ref ? parent : l;
      const from = costFromOf(f.costFromByKey, src.key);
      if (from === undefined) continue;
      const delta = src.cost_per_kg_si.minus(from);
      const sales = new Map<string, Decimal>();
      for (const m of x.led.movements) if (m.lot_ref === l.ref && m.type === "out_sale" && !m.planned && m.date <= x.date) sales.set(m.date, (sales.get(m.date) ?? ZERO).plus(m.kg.neg()));
      out.push({
        lot_ref: l.ref, key: l.key, kgIn: l.kg_in, kgRemaining: D(x.kgByLot.get(l.ref) ?? 0), costFrom: l.cost_per_kg_si.minus(delta), costTo: l.cost_per_kg_si,
        statusFrom: f.statusFrom, statusTo: "final", kgSold: sum([...sales.values()]), sales: [...sales].sort(([a], [b]) => a.localeCompare(b)).map(([date, kg]) => ({ date, kg })),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Q63 idle capacity per day

/**
 * Idle capacity as a period cost per day (§4.1, Q63): the idle cost to date is max(0, basis × elapsed ÷ days − actual kg
 * LB to date) × rate; each day carries its increment (P&L sign, negative). Never inside cost per kg.
 */
export function idleCostDaily(x: { rate: { period_start: string; period_end: string; basis_kg: Num | null; rate_per_kg_lb: Num }; actualKgLbByDate: Map<string, Num>; dates: string[] }): { date: string; amount: Decimal }[] {
  if (x.rate.basis_kg === null || x.rate.basis_kg === undefined || x.rate.basis_kg === "") return [];
  const all: string[] = [];
  for (let d = x.rate.period_start; d <= x.rate.period_end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) all.push(d);
  const n = all.length, basis = D(x.rate.basis_kg), rate = D(x.rate.rate_per_kg_lb);
  let cum = ZERO, prevIdle = ZERO;
  const out: { date: string; amount: Decimal }[] = [];
  all.forEach((d, i) => {
    cum = cum.plus(D(x.actualKgLbByDate.get(d) ?? 0));
    const idle = max(ZERO, basis.times(i + 1).div(n).minus(cum)).times(rate);
    if (x.dates.includes(d)) out.push({ date: d, amount: idle.minus(prevIdle).neg() });
    prevIdle = idle;
  });
  return out;
}

/**
 * v5 rows of pl_daily_v4 (segment LB main): "Selisih costing" (K22, basis event) and "Biaya kapasitas idle" (Q63, basis
 * fixed), P&L sign (a cost is negative). Up to the cut-off they are actual, after it forecast.
 */
export function costingPlRows(x: { cutOff: string; from: string; to: string; selisih: { date: string; amount: Num }[]; idle: { date: string; amount: Num }[] }): PlRowV4[] {
  const out: PlRowV4[] = [];
  const add = (pl_line: string, basis: "event" | "fixed", rows: { date: string; amount: Num }[]) => {
    const byDate = new Map<string, Decimal>();
    for (const r of rows) if (r.date >= x.from && r.date <= x.to) byDate.set(r.date, (byDate.get(r.date) ?? ZERO).plus(D(r.amount)));
    for (const [date, v] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
      if (v.isZero()) continue;
      const actual = date <= x.cutOff;
      out.push({ date, segment: "LB main", pl_line, basis, actual: actual ? v : null, forecast: actual ? null : v, kg: null, anomaly: false });
    }
  };
  add("Selisih costing", "event", x.selisih);
  add("Biaya kapasitas idle", "fixed", x.idle);
  return out;
}

// ------------------------------------------------------------------------------------------------ C53, C54, C57

/** C53: an Aktual batch past its WP deadline (H+1 12.00) without WP. BELUM DIISI; holds the RPA GP of the release. */
export function c53(x: { batches: { ref: string; status: string | null; dueAt: string | null; wpReceivedAt: string | null }[]; now: string }): ControlV3 {
  const late = x.batches.filter((b) => b.status === "Aktual" && !b.wpReceivedAt && b.dueAt && b.dueAt < x.now);
  return {
    code: "C53", module: "M1", name: "WP potong masuk sebelum tenggat (H+1 12.00)", value: D(late.length), comparator: ZERO, difference: D(late.length),
    status: late.length ? "BELUM DIISI" : "LULUS", action: late.length ? "Cost Accounting mengunggah WP batch berikut; biaya/kg tetap estimasi" : "",
    detail: late.map((b) => `${b.ref} (tenggat ${b.dueAt!.slice(0, 16).replace("T", " ")})`),
  };
}

/** C54: cost per kg of a SKU above ratio × its reference price (§4.1; e.g. by-products valued at receipt cost). PERIKSA. */
export function c54(x: { rows: { key: string; costPerKg: Num | null; priceRef: Num | null }[]; ratio: Num }): ControlV3 & { keys: string[] } {
  const bad = x.rows.filter((r) => r.costPerKg !== null && r.costPerKg !== undefined && r.costPerKg !== "" && r.priceRef !== null && r.priceRef !== undefined && r.priceRef !== ""
    && D(r.priceRef).gt(0) && D(r.costPerKg).gt(D(r.priceRef).times(D(x.ratio))));
  return {
    code: "C54", module: "M1", name: `Biaya/kg SKU tidak lebih dari ${D(x.ratio).toString()} × harga acuan`, value: D(bad.length), comparator: ZERO, difference: D(bad.length),
    status: bad.length ? "PERIKSA" : "LULUS", action: bad.length ? "Periksa biaya SKU berikut (alokasi joint, biaya penerimaan); harga lantai tampil \"periksa biaya\"" : "",
    detail: bad.map((r) => `${r.key}: ${D(r.costPerKg!).toFixed(0)} vs harga ${D(r.priceRef!).toFixed(0)}`), keys: bad.map((r) => r.key),
  };
}

/** C57: a cut date without the operations director's LB price decision (K25). BELUM DIISI; holds "salin ke batch" for that day. */
export function c57(x: { cutDates: string[]; decisions: { date: string; weight_class?: string | null }[] }): ControlV3 & { dates: string[] } {
  const decided = new Set(x.decisions.map((d) => d.date));
  const missing = [...new Set(x.cutDates)].filter((d) => !decided.has(d)).sort();
  return {
    code: "C57", module: "M1", name: "Harga live bird tanggal potong sudah diputuskan", value: D(missing.length), comparator: ZERO, difference: D(missing.length),
    status: missing.length ? "BELUM DIISI" : "LULUS", action: missing.length ? "Direktur Operasional memutuskan harga dan volume LB; simulasi memakai harga terakhir berlabel" : "",
    detail: missing, dates: missing,
  };
}
