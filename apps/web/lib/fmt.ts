/** House number format via Intl.NumberFormat('id-ID'): Rp 24.600; 6,3%. Display only — maths stays in decimals. */
import type { Decimal } from "@kgr/engine";

const cache = new Map<string, Intl.NumberFormat>();
function nf(dp: number) {
  const k = String(dp);
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat("id-ID", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    cache.set(k, f);
  }
  return f;
}

type DecLike = Decimal | number | string | null | undefined;

function toNum(v: DecLike, dp: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = typeof v === "string" ? v : v.toFixed(dp);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function num(v: DecLike, dp = 0): string {
  const n = toNum(v, dp);
  if (n === null) return "";
  const r = nf(dp).format(n);
  return r === "-0" ? "0" : r.replace(/^-0(,0+)?$/, (m) => m.slice(1));
}

export function pct(v: DecLike, dp = 1): string {
  const n = toNum(v, 8);
  return n === null ? "" : `${num(n * 100, dp)}%`;
}

export function rp(v: DecLike): string {
  const s = num(v, 0);
  return s === "" ? "" : `Rp ${s}`;
}

export function jt(v: DecLike, dp = 1): string {
  const n = toNum(v, 2);
  return n === null ? "" : `${num(n / 1e6, dp)} jt`;
}

/**
 * K16 (PRD v4 §5.1): Rp juta with one decimal and the minus sign U+2212, the only unit of the management view.
 * jtV4(−67.528.109) = "−67,5"; rpJt = "Rp −67,5 jt". Missing values are never 0: they render as the given text.
 */
export function jtV4(v: DecLike, dp = 1): string {
  const n = toNum(v, 2);
  return n === null ? "" : minus(num(n / 1e6, dp));
}

export function rpJt(v: DecLike, missing = "belum diisi"): string {
  const s = jtV4(v);
  return s === "" ? missing : `Rp ${s} jt`;
}

export function pctV4(v: DecLike, dp = 1): string {
  const s = pct(v, dp);
  return minus(s);
}

/** ASCII hyphen-minus → U+2212 at the start of a number. */
export function minus(s: string): string {
  return s.replace(/^-/, "\u2212");
}

/** Billions in the house short form: 2.782.158.916 → "2,78 M". */
export function mrd(v: DecLike, dp = 2): string {
  const n = toNum(v, 2);
  return n === null ? "" : `${num(n / 1e9, dp)} M`;
}

export function isNeg(v: DecLike): boolean {
  const n = toNum(v, 6);
  return n !== null && n < -0.0000005;
}

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function tgl(iso: string | null | undefined, withDay = false): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${withDay ? DAYS[dow] + " " : ""}${d} ${MONTHS[m - 1]} ${y}`;
}

export function tglShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
