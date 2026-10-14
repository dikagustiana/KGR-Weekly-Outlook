import DecimalBase from "decimal.js";

/**
 * Decimal arithmetic for money, kg and ratios. Never use JS floats for money.
 * Precision 40 significant digits, half-away-from-zero rounding (Excel ROUND).
 */
export const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

/** Anything a decimal can be built from. Numbers are converted via their shortest string form. */
export type Num = Decimal | string | number;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function D(v: Num | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return ZERO;
  if (v instanceof Decimal) return v;
  return new Decimal(typeof v === "number" ? String(v) : v.trim());
}

/** Like D(), but keeps "blank" (null) — Excel distinguishes an empty input from 0 in IF(x="",...) tests. */
export function Dn(v: Num | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  return D(v);
}

export function sum(values: Iterable<Decimal>): Decimal {
  let s = ZERO;
  for (const v of values) s = s.plus(v);
  return s;
}

export function sumBy<T>(rows: readonly T[], f: (r: T) => Decimal, where?: (r: T) => boolean): Decimal {
  let s = ZERO;
  for (const r of rows) if (!where || where(r)) s = s.plus(f(r));
  return s;
}

export function max(a: Decimal, b: Decimal): Decimal {
  return a.greaterThan(b) ? a : b;
}

export function min(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

/** a / b, or `fallback` when b = 0 (Excel IF(b=0, fallback, a/b) / IFERROR). */
export function div(a: Decimal, b: Decimal, fallback: Decimal = ZERO): Decimal {
  return b.isZero() ? fallback : a.div(b);
}

/** Excel ROUND(x, 0): half away from zero; never returns negative zero. */
export function round0(x: Decimal): Decimal {
  const r = x.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return r.isZero() ? ZERO : r;
}

/** Serialise for snapshots and JSON: fixed scale, no exponent, "-0" normalised. */
export function toFixedString(x: Decimal | null, dp = 6): string | null {
  if (x === null) return null;
  const s = x.toFixed(dp, Decimal.ROUND_HALF_UP);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}
