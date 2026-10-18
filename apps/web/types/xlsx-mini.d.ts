/**
 * SheetJS builds loaded on demand by the Input screen (Apache-2.0): the mini build reads .xlsx and writes the templates; the core
 * build (R78) also reads the legacy .xls (BIFF) that the mini build cannot ("parse_xlscfb is not defined"). Same API in 0.18.5 and 0.20.3.
 */
declare module "xlsx/dist/xlsx.mini.min.js" {
  interface WorkBook { SheetNames: string[]; Sheets: Record<string, unknown> }
  const XLSX: {
    read(data: ArrayBuffer | Uint8Array, opts: { type: "array" }): WorkBook;
    write(wb: WorkBook, opts: { type: "array"; bookType: "xlsx" }): ArrayBuffer;
    utils: {
      sheet_to_json(ws: unknown, opts: { header: 1; raw: true; defval: null; blankrows: false }): unknown[][];
      aoa_to_sheet(rows: unknown[][]): unknown;
      book_new(): WorkBook;
      book_append_sheet(wb: WorkBook, ws: unknown, name: string): void;
    };
  };
  export default XLSX;
}
declare module "xlsx/dist/xlsx.core.min.js" {
  import XLSX from "xlsx/dist/xlsx.mini.min.js";
  export default XLSX;
}
