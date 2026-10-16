/** SheetJS mini build (xlsx 0.18.5, Apache-2.0): read .xlsx, write the templates. Loaded on demand by the Input screen. */
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
