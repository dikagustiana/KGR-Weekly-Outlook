/**
 * M3 — allocation (PRD v3 §4.4 step 7). Pure functions, decimal.js.
 *
 * allocateFEFO: the PO lines delivering on a date (Confirmed first, then delivery date, then value) take lots of their
 * own key, oldest origin first, among the lots still sellable on that date (fresh within its window, frozen within its
 * age limit). cutoffBlasts: at the cut-off time the fresh kg that neither today's allocations nor the open orders of the
 * coming days (within the fresh window) will take is blasted to frozen. stockAllocationRecon reproduces
 * KGR_Demand_Forecast.xlsx B_Alokasi_Stok (on-hand per SKU mapped to customers).
 */
import { D, Decimal, ZERO, div, max, min, sum, type Num } from "./decimal";
import { diffDays, type ISODate } from "./dates";
import type { LedgerResult } from "./ledger";
import { outstandingKg } from "./delivery";

export interface AllocOrder {
  ref: string;
  key: string;
  delivery_date: ISODate | null;
  demand_status: string | null;
  kg: Num;
  fulfilled_kg?: Num | null;
  /** K7: kg cancelled on the line (sales_line.cancelled_kg). */
  cancelled_kg?: Num | null;
  price?: Num | null;
}

export interface AllocLot {
  lot_ref: string;
  key: string;
  form: "fresh" | "frozen";
  kg: Num;
  origin_date: ISODate;
}

export interface AllocWindows {
  freshHours: (key: string) => number;
  frozenDays: (key: string) => number;
}

export interface AllocationRow {
  sales_ref: string;
  lot_ref: string;
  key: string;
  kg: Decimal;
}

export interface FefoResult {
  allocations: AllocationRow[];
  unallocated: { sales_ref: string; key: string; kg: Decimal }[];
  /** Lots after this allocation (and the existing ones), FEFO order. */
  lotsLeft: { lot_ref: string; key: string; form: "fresh" | "frozen"; kg: Decimal; origin_date: ISODate }[];
}

const RANK: Record<string, number> = { Confirmed: 0, Tentative: 1, Forecast: 2 };

/** Still sellable on the date: fresh age (hours) within the window, frozen age (days) within the limit. */
export function sellableOn(lot: { key: string; form: "fresh" | "frozen"; origin_date: ISODate }, date: ISODate, w: AllocWindows): boolean {
  const age = diffDays(date, lot.origin_date);
  if (age < 0) return false;
  return lot.form === "fresh" ? age * 24 <= w.freshHours(lot.key) : age <= w.frozenDays(lot.key);
}

const fefo = (a: { origin_date: string; lot_ref: string }, b: { origin_date: string; lot_ref: string }) =>
  a.origin_date < b.origin_date ? -1 : a.origin_date > b.origin_date ? 1 : a.lot_ref.localeCompare(b.lot_ref);

export function allocateFEFO(x: {
  date: ISODate;
  orders: AllocOrder[];
  lots: AllocLot[];
  /** Allocations that stay (manual, or of delivered lines): they hold lot kg and cover their order. */
  existing?: { sales_ref: string; lot_ref: string; kg: Num }[];
  windows: AllocWindows;
}): FefoResult {
  const left = new Map<string, Decimal>(x.lots.map((l) => [l.lot_ref, D(l.kg)]));
  const covered = new Map<string, Decimal>();
  for (const e of x.existing ?? []) {
    left.set(e.lot_ref, (left.get(e.lot_ref) ?? ZERO).minus(D(e.kg)));
    covered.set(e.sales_ref, (covered.get(e.sales_ref) ?? ZERO).plus(D(e.kg)));
  }
  const value = (o: AllocOrder) => D(o.kg).times(D(o.price ?? 0));
  const orders = x.orders.filter((o) => o.delivery_date === x.date).sort((a, b) =>
    (RANK[a.demand_status ?? "Confirmed"] ?? 0) - (RANK[b.demand_status ?? "Confirmed"] ?? 0)
    || String(a.delivery_date).localeCompare(String(b.delivery_date))
    || value(b).cmp(value(a)) || a.ref.localeCompare(b.ref));
  const lots = x.lots.filter((l) => sellableOn(l, x.date, x.windows)).slice().sort(fefo);
  const allocations: AllocationRow[] = [];
  const unallocated: FefoResult["unallocated"] = [];
  for (const o of orders) {
    let need = max(ZERO, outstandingKg(o).minus(covered.get(o.ref) ?? ZERO));
    if (!need.gt(0)) continue;
    for (const l of lots) {
      if (!need.gt(0)) break;
      if (l.key !== o.key) continue;
      const avail = left.get(l.lot_ref) ?? ZERO;
      if (!avail.gt(0)) continue;
      const kg = min(need, avail);
      allocations.push({ sales_ref: o.ref, lot_ref: l.lot_ref, key: o.key, kg });
      left.set(l.lot_ref, avail.minus(kg));
      need = need.minus(kg);
    }
    if (need.gt(0)) unallocated.push({ sales_ref: o.ref, key: o.key, kg: need });
  }
  const lotsLeft = x.lots.slice().sort(fefo).map((l) => ({ lot_ref: l.lot_ref, key: l.key, form: l.form, kg: left.get(l.lot_ref) ?? ZERO, origin_date: l.origin_date }));
  return { allocations, unallocated, lotsLeft };
}

export interface CutoffBlast {
  lot_ref: string;
  key_from: string;
  key_to: string;
  kg: Decimal;
  /** (fresh − frozen reference price) × kg. */
  rp_downgrade: Decimal;
  blast_cost: Decimal;
}

/**
 * Cut-off (PRD v3 §4.4 step 7): fresh kg left after today's allocation, minus what the open orders of the coming days
 * can still take while the lot is fresh (FEFO on their delivery dates), is blasted to the frozen key.
 */
export function cutoffBlasts(x: {
  date: ISODate;
  lotsLeft: { lot_ref: string; key: string; form: "fresh" | "frozen"; kg: Num; origin_date: ISODate }[];
  futureOrders: { key: string; delivery_date: ISODate; kg: Num; fulfilled_kg?: Num | null; cancelled_kg?: Num | null }[];
  windows: AllocWindows;
  frozenKeyOf: (key: string) => string;
  price: (key: string) => Num | null;
  blastCostPerKg: Num;
}): CutoffBlast[] {
  const fresh = x.lotsLeft.filter((l) => l.form === "fresh" && D(l.kg).gt(0)).slice().sort(fefo);
  const left = new Map(fresh.map((l) => [l.lot_ref, D(l.kg)]));
  for (const o of x.futureOrders.filter((q) => q.delivery_date > x.date).slice().sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))) {
    let need = outstandingKg(o);
    for (const l of fresh) {
      if (!need.gt(0)) break;
      if (l.key !== o.key || !sellableOn(l, o.delivery_date, x.windows)) continue;
      const kg = min(need, left.get(l.lot_ref)!);
      left.set(l.lot_ref, left.get(l.lot_ref)!.minus(kg));
      need = need.minus(kg);
    }
  }
  const out: CutoffBlast[] = [];
  for (const l of fresh) {
    const kg = left.get(l.lot_ref)!;
    if (!kg.gt(0)) continue;
    const to = x.frozenKeyOf(l.key);
    const pf = x.price(l.key), pz = x.price(to);
    const gap = pf === null || pz === null ? ZERO : max(ZERO, D(pf).minus(D(pz)));
    out.push({ lot_ref: l.lot_ref, key_from: l.key, key_to: to, kg, rp_downgrade: gap.times(kg), blast_cost: kg.times(D(x.blastCostPerKg)) });
  }
  return out;
}

/**
 * Lot kg available for allocation on a date: every actual movement before the date and today's stock-in, but not
 * today's sales whose lots are named by an allocation (the allocation itself holds those kg).
 */
export function lotsForAllocation(led: LedgerResult, date: ISODate, allocatedSales: Set<string>): AllocLot[] {
  const kg = new Map<string, Decimal>();
  for (const m of led.movements) {
    if (m.planned || m.date > date) continue;
    if (m.date === date && m.type === "out_sale" && m.sales_ref !== null && allocatedSales.has(m.sales_ref)) continue;
    kg.set(m.lot_ref, (kg.get(m.lot_ref) ?? ZERO).plus(m.kg));
  }
  return led.lots.filter((l) => !l.planned && l.origin_date <= date && (kg.get(l.ref) ?? ZERO).gt(0) && !l.ref.startsWith("deficit:"))
    .map((l) => ({ lot_ref: l.ref, key: l.key, form: l.form, kg: kg.get(l.ref)!, origin_date: l.origin_date }));
}

// ------------------------------------------------------------------------------------------------ B_Alokasi_Stok

export interface StockReconRow {
  sku: string;
  on_hand: Decimal;
  allocated: Decimal;
  remaining: Decimal;
  pct: Decimal;
  status: "OVER — cek alokasi" | "—" | "Ada sisa" | "Full";
}

/** B_Alokasi_Stok sections 2–4: allocation value, reconciliation per SKU, recap per customer. */
export function stockAllocationRecon(x: {
  stock: { sku: string; kg: Num }[];
  allocations: { sku: string; customer: string | null; kg: Num | null; price: Num | null }[];
  customers: string[];
}): { rows: StockReconRow[]; totals: { on_hand: Decimal; allocated: Decimal; remaining: Decimal; value: Decimal }; perCustomer: { customer: string; kg: Decimal; value: Decimal }[] } {
  const val = (a: { kg: Num | null; price: Num | null }) => (a.kg === null || a.kg === undefined || a.kg === "" || a.price === null || a.price === undefined || a.price === "" ? ZERO : D(a.kg).times(D(a.price)));
  const rows = x.stock.map((s): StockReconRow => {
    const on = D(s.kg);
    const al = sum(x.allocations.filter((a) => a.sku === s.sku).map((a) => D(a.kg ?? 0)));
    const rem = on.minus(al);
    return { sku: s.sku, on_hand: on, allocated: al, remaining: rem, pct: on.isZero() ? ZERO : div(al, on), status: al.gt(on) ? "OVER — cek alokasi" : on.isZero() ? "—" : rem.gt(0) ? "Ada sisa" : "Full" };
  });
  return {
    rows,
    totals: { on_hand: sum(rows.map((r) => r.on_hand)), allocated: sum(rows.map((r) => r.allocated)), remaining: sum(rows.map((r) => r.remaining)), value: sum(x.allocations.map(val)) },
    perCustomer: x.customers.map((c) => ({ customer: c, kg: sum(x.allocations.filter((a) => a.customer === c).map((a) => D(a.kg ?? 0))), value: sum(x.allocations.filter((a) => a.customer === c).map(val)) })),
  };
}
