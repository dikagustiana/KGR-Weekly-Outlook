/**
 * PRD v6 K77 (R119): a WeekResult stored whole as JSON (week_snapshot.result) and read back as the same object graph.
 * Unlike toSnapshot (fixed scale, Maps dropped) this codec is lossless: a Decimal keeps every significant digit, a Map
 * keeps its entries and order, so every page reads exactly what computeWeek returned (T29: snapshotJson of the decoded
 * result is byte-identical to snapshotJson of the computed one). Shared references (Prepared.masterByKey points at the
 * rows of Prepared.master) come back as equal copies, not the same object; nothing in the app compares them by identity.
 */
import { Decimal } from "./decimal";
import type { WeekResult } from "./week";

const TAG = "$k";

type Tagged =
  | { $k: "d"; v: string }
  | { $k: "m"; v: [unknown, unknown][] }
  | { $k: "s"; v: unknown[] }
  | { $k: "u" }
  | { $k: "n"; v: "NaN" | "Infinity" | "-Infinity" }
  | { $k: "o"; v: Record<string, unknown> };

function enc(v: unknown): unknown {
  if (v === undefined) return { [TAG]: "u" };
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  // isDecimal, not instanceof: a value made by another clone of decimal.js (e.g. a parser's) is a decimal too
  if (typeof v === "number") return Number.isFinite(v) ? v : { [TAG]: "n", v: String(v) };
  if (Decimal.isDecimal(v)) return { [TAG]: "d", v: v.isZero() && v.isNeg() ? "-0" : v.toString() };
  if (v instanceof Map) return { [TAG]: "m", v: [...v.entries()].map(([k, x]) => [enc(k), enc(x)]) };
  if (v instanceof Set) return { [TAG]: "s", v: [...v].map(enc) };
  if (Array.isArray(v)) return v.map(enc);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // an absent key reads back as undefined, as JSON would; a method (statements.pnl.get, .bs.get) is re-attached by decodeResult
      if (x === undefined || typeof x === "function") continue;
      out[k] = enc(x);
    }
    // a plain object that happens to have the tag key is wrapped, so it is never read as a tagged value
    return TAG in out ? { [TAG]: "o", v: out } : out;
  }
  throw new Error(`result-codec: tipe ${typeof v} tidak didukung`);
}

function dec(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(dec);
  const o = v as Record<string, unknown>;
  if (TAG in o) {
    const t = o as Tagged;
    switch (t.$k) {
      case "d": return new Decimal(t.v);
      case "m": return new Map(t.v.map(([k, x]) => [dec(k), dec(x)]));
      case "s": return new Set(t.v.map(dec));
      case "u": return undefined;
      case "n": return Number(t.v);
      case "o": {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(t.v)) out[k] = dec(x);
        return out;
      }
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = dec(x);
  return out;
}

/** The JSON value stored in week_snapshot.result (jsonb). */
export function encodeResult(r: WeekResult): unknown {
  return enc(r);
}

/** The WeekResult a page reads from week_snapshot.result, with the lookup methods of the statements put back. */
export function decodeResult(json: unknown): WeekResult {
  const r = dec(json) as WeekResult;
  const st = r.statements as unknown as { pnl?: { lines: { line: string }[]; get?: unknown }; bs?: { lines: { line: string }[]; get?: unknown } };
  if (st?.pnl) st.pnl.get = lookup(st.pnl.lines, "Baris laba rugi tidak dikenal");
  if (st?.bs) st.bs.get = lookup(st.bs.lines, "Pos neraca tidak dikenal");
  return r;
}

/** The same lookup as statements.ts: by line name, an unknown name throws. */
function lookup<L extends { line: string }>(lines: L[], msg: string) {
  const by = new Map(lines.map((l) => [l.line, l]));
  return (line: string): L => {
    const l = by.get(line);
    if (!l) throw new Error(`${msg}: ${line}`);
    return l;
  };
}
