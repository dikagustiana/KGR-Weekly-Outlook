/**
 * PRD v5 §4.6 (K24, K26): the Commercial loop. Pure functions, decimal.js.
 *
 *   free stock         = lot balance − allocation reservations (commercial_daily, v4 M7)
 *   floor              = cost per kg of the SKU (any status, labelled), markup default 0 (v5/1 priceFloorV5)
 *   holding loss / day = stock value × storage expense last month ÷ inventory at its end ÷ days of that month
 *   loss at reference  = max(0, cost − reference price) × kg
 *   commitments (K26)  = per SKU fresh / frozen kg and price for next week; once locked (Friday 17.00 by the commercial
 *                        lead) the kg not covered by POs become Confirmed demand of the Monday plan
 */
import { D, Decimal, ZERO, div, max, sum, type Num } from "./decimal";
import { addDays, type ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";
import type { OrderLine } from "./demand";

/** Storage tariff per day (a share of stock value): storage expense ÷ inventory at the month end ÷ days. */
export function holdingRate(x: { storageExpense: Num | null; inventoryEnd: Num | null; days: number }): Decimal | null {
  if (x.storageExpense === null || x.inventoryEnd === null || x.storageExpense === undefined || x.inventoryEnd === undefined) return null;
  const inv = D(x.inventoryEnd);
  if (inv.isZero() || x.days <= 0) return null;
  return D(x.storageExpense).abs().div(inv.abs()).div(x.days);
}

export type SellUrgency = "jual_hari_ini" | "di_atas_umur" | "jual_minggu_ini" | "aman";

export interface StockSellItem {
  key: string;
  form: string | null;
  free_kg: Num;
  oldest_age_days: number | null;
  over_age_kg: Num | null;
  urgency: string | null;
  cost_per_kg: Num | null;
  cost_status: string | null;
  price_ref: Num | null;
  /** C54 of the commercial mart (cost per kg above cost_anomaly_ratio × reference price). */
  cost_check?: boolean | null;
}

export interface StockSellRow extends Omit<StockSellItem, "free_kg" | "cost_per_kg" | "price_ref" | "over_age_kg"> {
  free_kg: Decimal;
  over_age_kg: Decimal;
  cost_per_kg: Decimal | null;
  price_ref: Decimal | null;
  /** kg × cost (stock value at cost); null without a cost. */
  value: Decimal | null;
  margin_per_kg: Decimal | null;
  holding_per_day: Decimal | null;
  below_cost: boolean;
  /** (cost − reference) × kg when the reference is below the cost, else 0. */
  loss_at_ref: Decimal;
}

const dn = (v: Num | null | undefined) => (v === null || v === undefined || v === "" ? null : D(v));

export function stockSellRows(items: StockSellItem[], rate: Num | null): StockSellRow[] {
  const r = dn(rate);
  return items.filter((i) => D(i.free_kg).gt(0)).map((i) => {
    const kg = D(i.free_kg), cost = dn(i.cost_per_kg), ref = dn(i.price_ref);
    const value = cost === null ? null : kg.times(cost);
    const below = cost !== null && ref !== null && ref.lt(cost);
    return {
      ...i, free_kg: kg, over_age_kg: D(i.over_age_kg ?? 0), cost_per_kg: cost, price_ref: ref, value,
      margin_per_kg: cost !== null && ref !== null ? ref.minus(cost) : null,
      holding_per_day: value !== null && r !== null ? value.times(r) : null,
      below_cost: below, loss_at_ref: below ? cost!.minus(ref!).times(kg) : ZERO,
    };
  });
}

export interface StockSummary {
  value: Decimal; kg: Decimal; skus: number;
  fresh: { kg: Decimal; value: Decimal; skus: number };
  below: { skus: number; loss: Decimal };
  holdingPerDay: Decimal | null;
  /** SKUs without a cost (value unknown, never 0). */
  missingCost: number;
}

export function stockSummary(rows: StockSellRow[]): StockSummary {
  const val = (xs: StockSellRow[]) => sum(xs.map((x) => x.value ?? ZERO));
  const fresh = rows.filter((x) => x.urgency === "jual_hari_ini");
  const below = rows.filter((x) => x.below_cost);
  const hold = rows.filter((x) => x.holding_per_day !== null);
  return {
    value: val(rows), kg: sum(rows.map((x) => x.free_kg)), skus: rows.length,
    fresh: { kg: sum(fresh.map((x) => x.free_kg)), value: val(fresh), skus: fresh.length },
    below: { skus: below.length, loss: sum(below.map((x) => x.loss_at_ref)) },
    holdingPerDay: hold.length ? sum(hold.map((x) => x.holding_per_day!)) : null,
    missingCost: rows.filter((x) => x.cost_per_kg === null).length,
  };
}

export type StockFilter = "all" | "hari" | "batas" | "below";
export function filterRows(rows: StockSellRow[], f: StockFilter): StockSellRow[] {
  return rows.filter((r) => f === "all" || (f === "hari" ? r.urgency === "jual_hari_ini" : f === "batas" ? r.urgency === "di_atas_umur" : r.below_cost));
}

// ------------------------------------------------------------------------------------------------ K26 commitments

export interface Commitment { key: string; fresh_kg: Num; frozen_kg: Num; price: Num | null; status: "draft" | "locked" | "superseded"; version: number }

/** Base key of a SKU ("RPA|Karkas|Fresh" → "RPA|Karkas"): the key of a commitment and of a price list row. */
export const baseKey = (key: string) => key.replace(/\|(Fresh|Frozen|n\/a)$/, "");

/** K26: the locked commitments of the week as Confirmed demand: the kg a key's POs of the week do not cover yet, on Monday. */
export function commitmentDemand(x: { commitments: Commitment[]; orders: { key: string; kg: Num }[]; weekStart: ISODate }): OrderLine[] {
  const po = new Map<string, Decimal>();
  for (const o of x.orders) po.set(o.key, (po.get(o.key) ?? ZERO).plus(D(o.kg)));
  const out: OrderLine[] = [];
  for (const c of x.commitments.filter((q) => q.status === "locked")) {
    for (const [form, kg] of [["Fresh", c.fresh_kg], ["Frozen", c.frozen_kg]] as const) {
      const key = `${c.key}|${form}`;
      const extra = max(ZERO, D(kg).minus(po.get(key) ?? ZERO));
      if (extra.gt(0)) out.push({ ref: `commitment:${key}:v${c.version}`, key, delivery_date: x.weekStart, demand_status: "Confirmed", kg: extra.toFixed(2), price: c.price === null ? null : String(c.price), customer: "komitmen Commercial" });
    }
  }
  return out;
}

/** Deadline of the commitments of week `nextWeekStart`: the day `dow` (ISO, 5 = Friday) of the week before, at `time` WIB. */
export function commitmentDeadline(nextWeekStart: ISODate, dow: number, time: string): string {
  return `${addDays(nextWeekStart, dow - 8)}T${time.slice(0, 5)}:00+07:00`;
}

/** C52: next week's commitments not locked at the deadline (drafts left, or none locked). BELUM DIISI; before it N/A. */
export function c52(x: { now: string; deadline: string; commitments: Pick<Commitment, "key" | "status">[] }): ControlV3 {
  const drafts = x.commitments.filter((c) => c.status === "draft");
  const locked = x.commitments.filter((c) => c.status === "locked");
  const due = Date.parse(x.now) >= Date.parse(x.deadline);
  const bad = due && (drafts.length > 0 || locked.length === 0);
  return {
    code: "C52", module: "M7", name: "Komitmen minggu depan dikunci pada tenggat", value: D(drafts.length), comparator: ZERO, difference: D(drafts.length),
    status: !due ? "N/A" : bad ? "BELUM DIISI" : "LULUS",
    action: bad ? "Kepala Sales mengunci komitmen; sampai itu rencana Senin memakai PO saja" : "",
    detail: bad ? [locked.length ? `${drafts.length} SKU masih draft` : "belum ada komitmen terkunci", ...drafts.map((d) => d.key)] : [],
  };
}

// ------------------------------------------------------------------------------------------------ spot

export interface SpotRow { key: string; free_kg: Decimal; floor: Decimal | null; price_ref: Decimal | null; price_frozen: Decimal | null; downgrade: Decimal | null; belowCost: boolean }

/** Fresh SKUs to sell today before the cut-off; the drop when the rest is blasted = (reference − frozen price) × kg. */
export function spotRows(rows: StockSellRow[], frozenPrice: (key: string) => Num | null): SpotRow[] {
  return rows.filter((r) => r.urgency === "jual_hari_ini" && r.free_kg.gt(0)).map((r) => {
    const z = dn(frozenPrice(r.key));
    return { key: r.key, free_kg: r.free_kg, floor: r.cost_per_kg, price_ref: r.price_ref, price_frozen: z, downgrade: r.price_ref !== null && z !== null ? max(ZERO, r.price_ref.minus(z)).times(r.free_kg) : null, belowCost: r.below_cost };
  });
}

/** kg of the week per base key (POs and sales): "Minggu ini" next to the commitment form. */
export function kgByBaseKey(lines: { key: string; kg: Num }[]): Map<string, Decimal> {
  const m = new Map<string, Decimal>();
  for (const l of lines) m.set(baseKey(l.key), (m.get(baseKey(l.key)) ?? ZERO).plus(D(l.kg)));
  return m;
}

export const shareOf = (a: Num, b: Num) => (D(b).isZero() ? null : div(D(a), D(b)));
