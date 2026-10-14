/** Read .xlsx / .xls / .csv into plain row arrays with SheetJS (values only; dates stay Excel serials). */
import * as XLSX from "xlsx";
import type { Cell } from "./values";

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName = ""): Sheet[] {
  const isText = /\.(csv|txt|tsv)$/i.test(fileName);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = isText
    ? XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: true, cellDates: false, FS: detectDelimiter(bytes) })
    : XLSX.read(bytes, { type: "array", cellDates: false, cellNF: false, cellText: false, dense: false });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true }) as Cell[][];
    return { name, rows };
  });
}

function detectDelimiter(bytes: Uint8Array): string {
  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 4000)).split(/\r?\n/)[0] ?? "";
  const counts = [";", ",", "\t", "|"].map((d) => [d, head.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** 1-based cell access like openpyxl: cell(sheet, row, col). */
export function cell(sheet: Sheet, row: number, col: number): Cell {
  const r = sheet.rows[row - 1];
  if (!r) return null;
  const v = r[col - 1];
  return v === undefined ? null : v;
}

export function sheetByName(sheets: Sheet[], name: string): Sheet | undefined {
  return sheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
}
