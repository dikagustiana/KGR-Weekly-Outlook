/** Cell value helpers: numbers in id-ID or en-US notation, Excel serial dates, free-text dates. */

export type Cell = string | number | boolean | null;

const ID_MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, nopember: 11, november: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function text(v: Cell | undefined): string | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") return numberToString(v);
  return String(v).trim();
}

/** Shortest round-trip decimal string without exponent. */
export function numberToString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Angka tidak valid: ${n}`);
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(12).replace(/\.?0+$/, "");
  return s;
}

/**
 * Parse a number written as 1234.5, 1.234,5 (id-ID), 1,234.5 (en-US), "Rp 24.600", "(1.234)" or "-1.234".
 * Returns a decimal string (never a float) or null when blank. Throws on text that is not a number, and (PRD v6 K92) on a
 * dot followed by exactly three digits whose decimal reading is below 10 ("0.725", "1.500"): ambiguous.
 */
export function parseNumber(v: Cell | undefined): string | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") return numberToString(v);
  if (typeof v === "boolean") throw new Error(`Bukan angka: ${v}`);
  let s = String(v).trim().replace(/\s/g, "").replace(/^rp\.?/i, "").replace(/kg$/i, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s === "" || s === "-") return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
    else s = s.replace(/,/g, ""); // 1,234.56
  } else if (lastComma >= 0) {
    // one comma = decimal comma (id-ID, the house format); several commas = en-US thousands
    s = s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    if (parts.length > 2) s = s.replace(/\./g, ""); // 1.234.567 (id thousands)
    else if (parts[1].length === 3 && /^\d{1,3}$/.test(parts[0])) {
      // PRD v6 K92: "0.725" or "1.500" is ambiguous (decimal point, or thousands?) when the decimal reading is below 10:
      // refused with a sentence that says how to write it; 24.600 (≥ 10 either way) stays id-ID thousands
      if (Number(parts[0]) < 10) throw new Error(`Angka "${v}" ambigu: pakai koma untuk desimal (${parts[0]},${parts[1]}) atau tulis ribuan tanpa titik (${parts[0]}${parts[1]})`);
      s = s.replace(".", ""); // 24.600 → id thousands
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Bukan angka: "${v}"`);
  s = s.replace(/^0+(?=\d)/, "");
  return (neg && !/^0(\.0+)?$/.test(s) ? "-" : "") + s;
}

/** Excel serial (1900 date system) → ISO date. */
export function serialToISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse a date cell: Excel serial, ISO, "2026-08" (first of month), dd/mm/yyyy, dd-mm-yyyy, "24 Agu 2026", "24-Aug-26". */
export function parseDate(v: Cell | undefined): string | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") return serialToISO(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // "2026-08" (a month, budget sheets) → its first day
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], 1);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return iso(year(+m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})/);
  if (m && ID_MONTHS[m[2].toLowerCase()]) return iso(year(+m[3]), ID_MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && ID_MONTHS[m[1].toLowerCase()]) return iso(+m[3], ID_MONTHS[m[1].toLowerCase()], +m[2]);
  throw new Error(`Tanggal tidak dikenali: "${s}"`);
}

function year(y: number) {
  return y < 100 ? 2000 + y : y;
}

function iso(y: number, m: number, d: number): string {
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Tanggal tidak valid: ${y}-${m}-${d}`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) throw new Error(`Tanggal tidak valid: ${y}-${m}-${d}`);
  return dt.toISOString().slice(0, 10);
}

/** Normalised header text for alias matching. */
export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[ \s]+/g, " ")
    .replace(/[^a-z0-9#% ]/g, "")
    .trim();
}
