import { D, type Decimal } from "@kgr/engine";

/**
 * Σ of `key` over the rows, only when every row carries it: one blank row makes the total unknown (null, shown as
 * "belum diisi"), never the sum of the others (R64). No rows = the empty sum, 0.
 */
export function sumAllOrNull(rows: Record<string, unknown>[], key: string): Decimal | null {
  return rows.every((r) => r[key] !== null && r[key] !== undefined) ? rows.reduce((a, r) => a.plus(D(String(r[key]))), D(0)) : null;
}
