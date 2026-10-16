/**
 * A workbook (SheetJS) → the grid the shared validation reads (PRD v5 §4.9): first sheet, raw cell values (numbers stay
 * numbers, Excel dates stay serial days), empty cells null. Used by the browser (mini build) and the tests; no I/O.
 */
import type { Cell, Grid } from "@kgr/engine";

export interface SheetLib {
  read(data: ArrayBuffer | Uint8Array, opts: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(ws: unknown, opts: { header: 1; raw: true; defval: null; blankrows: false }): unknown[][] };
}

const cell = (v: unknown): Cell => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : String(v));

export function workbookGrid(lib: SheetLib, bytes: ArrayBuffer | Uint8Array): Grid {
  const wb = lib.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!ws) return [];
  return lib.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }).map((r) => r.map(cell));
}
