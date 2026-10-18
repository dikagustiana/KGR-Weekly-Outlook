/**
 * A workbook (SheetJS) → the grid the shared validation reads (PRD v5 §4.9): first sheet, raw cell values (numbers stay
 * numbers, Excel dates stay serial days), empty cells null. Used by the browser (mini build for .xlsx, core build for the
 * legacy .xls, R78) and the tests; no I/O.
 */
import type { Cell, Grid } from "@kgr/engine";

export interface SheetLib {
  read(data: ArrayBuffer | Uint8Array, opts: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(ws: unknown, opts: { header: 1; raw: true; defval: null; blankrows: false }): unknown[][] };
}

/**
 * PRD v5.2 R78: a legacy Excel file (.xls, BIFF in a compound document: D0 CF 11 E0 A1 B1 1A E1). The mini build of SheetJS
 * cannot read it, so the panel loads the core build for it — by content, since an Accurate export is often named .xlsx
 * while it is an .xls inside.
 */
export function isLegacyXls(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x);
}

const cell = (v: unknown): Cell => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : String(v));

export function workbookGrid(lib: SheetLib, bytes: ArrayBuffer | Uint8Array): Grid {
  const wb = lib.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!ws) return [];
  return lib.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }).map((r) => r.map(cell));
}
