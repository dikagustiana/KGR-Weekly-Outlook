/**
 * K7 partial deliveries (PRD v4 §0.1 K7, §3.1 P3.1, P3.8). Pure: an order line, its deliveries and cancellations in,
 * the outstanding kg and the effect of one more delivery out. The database keeps the same rule in a trigger
 * (20261017000100 tg_delivery_sync); this is the check the form runs first so the message names the numbers.
 */
import { D, Decimal, ZERO, max, type Num } from "./decimal";

export interface OrderQty {
  kg: Num;
  /** Σ delivery.kg (sales_line.fulfilled_kg). */
  fulfilled_kg?: Num | null;
  cancelled_kg?: Num | null;
}

/** outstanding = kg − Σ delivered − cancelled, never below 0. */
export function outstandingKg(o: OrderQty): Decimal {
  return max(ZERO, D(o.kg).minus(D(o.fulfilled_kg ?? 0)).minus(D(o.cancelled_kg ?? 0)));
}

export interface DeliveryCheck {
  ok: boolean;
  /** Outstanding before and after this delivery. */
  before: Decimal;
  after: Decimal;
  /** The delivery closes the line (outstanding 0): the v1 status becomes Aktual. */
  closes: boolean;
  error: string | null;
}

export function deliveryCheck(o: OrderQty, kg: Num | null | undefined): DeliveryCheck {
  const before = outstandingKg(o);
  if (kg === null || kg === undefined || kg === "" || !D(kg).isFinite() || !D(kg).gt(0)) {
    return { ok: false, before, after: before, closes: false, error: "Isi kg yang terkirim (lebih dari 0)" };
  }
  const q = D(kg);
  if (q.gt(before)) {
    return { ok: false, before, after: before, closes: false, error: `Terkirim ${q.toFixed(2)} kg melebihi sisa order ${before.toFixed(2)} kg` };
  }
  const after = before.minus(q);
  return { ok: true, before, after, closes: after.isZero(), error: null };
}
