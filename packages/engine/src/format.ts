/** House number format (id-ID): period for thousands, comma for decimals — Rp 24.600; 6,3%. */
import { Decimal, round0 } from "./decimal";

function group(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Excel FIXED(x, dp) rendered in the house format. */
export function fixed(x: Decimal, dp = 0): string {
  const r = dp === 0 ? round0(x) : x.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  const s = r.abs().toFixed(dp);
  const [i, f] = s.split(".");
  const neg = r.isNegative() && !r.isZero();
  return `${neg ? "-" : ""}${group(i)}${f ? "," + f : ""}`;
}

export function pct(x: Decimal, dp = 1): string {
  return `${fixed(x.times(100), dp)}%`;
}

export function rp(x: Decimal): string {
  return `Rp ${fixed(x, 0)}`;
}

/** Millions with one decimal, e.g. −47,6 jt. */
export function jt(x: Decimal, dp = 1): string {
  return `${fixed(x.div(1_000_000), dp)} jt`;
}
