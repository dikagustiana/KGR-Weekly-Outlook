/**
 * PRD v5.2-A R68 (T15, K62, O27 a): the minimum mapping between lines of the app and rows of the FS (Management
 * Report of `09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx`), as DATA. The same shape is stored by Finance in
 * `fs_line_map(statement, row_no, app_line, sign, note)` (PRD v5.2-B, B-R86); the database rows replace this seed.
 *
 * Row numbers and labels are not guessed: they are the `pl[].row` / `bs[].row` and `line` of
 * `fixtures/fs-2026-09/inputs.json` (sheets "PL - Management Report" and "BS - Management Report"), checked by the test
 * `fs-recon.test.ts`. Unit: Rp. Sign convention of both sides: revenue and assets positive, costs negative (PL, as the
 * app's v1 sign); liabilities and equity positive (BS).
 */

export type FsStatement = "PL" | "BS";

/** One row of `fs_line_map`. `sign` multiplies the app amount before it is compared with the FS row. */
export interface FsMapEntry {
  statement: FsStatement;
  row_no: number;
  app_line: string;
  sign: 1 | -1;
  note?: string | null;
}

/** A map entry with the FS label it was checked against (the label is not a column of `fs_line_map`). */
export interface FsMapSeed extends FsMapEntry {
  fs_line: string;
}

/** App lines of the minimum mapping: stable key → label shown on the Rekonsiliasi page. */
export const APP_LINE_LABEL: Record<string, string> = {
  revenue: "Revenue (jurnal)",
  cogs: "COGS (jurnal)",
  gp: "Gross profit (jurnal)",
  opex: "Beban operasi (jurnal)",
  other: "Pendapatan dan beban lain (jurnal)",
  nibt: "NIBT (jurnal)",
  kas: "Kas dan setara kas",
  piutang_pihak_ketiga: "Piutang usaha pihak ketiga",
  piutang_pihak_berelasi: "Piutang usaha pihak berelasi",
  persediaan_produk: "Persediaan produk",
  persediaan_trading: "Persediaan trading",
  utang_dagang_pihak_ketiga: "Utang dagang pihak ketiga",
  utang_dagang_afiliasi: "Utang dagang afiliasi",
  utang_lain_afiliasi: "Utang lain pihak berelasi",
  ekuitas: "Total ekuitas",
};

/**
 * Minimum mapping (PRD v5.2-A R68): PL b.12 Revenue, b.13 COGS (memo mode: without the v5 rows "Selisih costing" and
 * "Biaya kapasitas idle", O24 b), b.15 GP, b.37 total opex, b.49 total other income (expense), b.51 NIBT; BS b.14 Kas,
 * b.17–18 piutang, b.23–24 persediaan, b.47–48 utang dagang, b.51 utang pihak berelasi, b.77 total ekuitas.
 * Every pair is the same definition on both sides (REVIEW-v5.1 §7 "yang bisa sama dengan FS").
 */
export const FS_MIN_MAP: FsMapSeed[] = [
  { statement: "PL", row_no: 12, fs_line: "Revenue", app_line: "revenue", sign: 1, note: "Σ Revenue - LB Main Product, LB By Product, Trading (jurnal + penyesuaian tutup buku)" },
  { statement: "PL", row_no: 13, fs_line: "Cost of Sales", app_line: "cogs", sign: 1, note: "Σ COGS dan Other COGS; mode memo (O24 b): tanpa Selisih costing dan Biaya kapasitas idle" },
  { statement: "PL", row_no: 15, fs_line: "GROSS PROFIT", app_line: "gp", sign: 1, note: "Revenue + COGS (mode memo: tanpa baris v5)" },
  { statement: "PL", row_no: 37, fs_line: "TOTAL OPERATING EXPENSES", app_line: "opex", sign: 1, note: "semua baris selain Revenue, COGS, dan pendapatan/beban lain (termasuk penyusutan dan pajak)" },
  { statement: "PL", row_no: 49, fs_line: "TOTAL OTHER INCOME (EXPENSE)", app_line: "other", sign: 1, note: "Interest Expense, Other Income, Other Expense" },
  { statement: "PL", row_no: 51, fs_line: "INCOME (LOSS) BEFORE TAX", app_line: "nibt", sign: 1, note: "NIBT jurnal; mode memo: tanpa NIBT manajemen" },
  { statement: "BS", row_no: 14, fs_line: "Cash and cash equivalents", app_line: "kas", sign: 1, note: "saldo kas dan bank akhir bulan (TB awal + jurnal)" },
  { statement: "BS", row_no: 17, fs_line: "Trade Receivables - Third Parties", app_line: "piutang_pihak_ketiga", sign: 1, note: null },
  { statement: "BS", row_no: 18, fs_line: "Trade Receivables - Related Parties", app_line: "piutang_pihak_berelasi", sign: 1, note: null },
  { statement: "BS", row_no: 23, fs_line: "Inventory - Product", app_line: "persediaan_produk", sign: 1, note: "saldo buku besar (bs_line Inventory - Product)" },
  { statement: "BS", row_no: 24, fs_line: "Inventory - Trading", app_line: "persediaan_trading", sign: 1, note: "saldo buku besar (bs_line Inventory - Trading)" },
  { statement: "BS", row_no: 47, fs_line: "Trade Payables - Third Parties", app_line: "utang_dagang_pihak_ketiga", sign: 1, note: null },
  { statement: "BS", row_no: 48, fs_line: "Trade Payables - Affiliates", app_line: "utang_dagang_afiliasi", sign: 1, note: null },
  { statement: "BS", row_no: 51, fs_line: "Other Payable - Related Parties", app_line: "utang_lain_afiliasi", sign: 1, note: "pinjaman dan utang lain afiliasi" },
  { statement: "BS", row_no: 77, fs_line: "TOTAL EQUITY", app_line: "ekuitas", sign: 1, note: "Shareholder Equity + Retained earnings + laba tahun berjalan" },
];

/** The `fs_line_map` columns of a seed row (what the database stores). */
export const fsMapEntries = (seed: FsMapSeed[] = FS_MIN_MAP): FsMapEntry[] =>
  seed.map(({ statement, row_no, app_line, sign, note }) => ({ statement, row_no, app_line, sign, note: note ?? null }));

/** "PL b.12": how a line is named in the table, the control detail and the docs. */
export const fsKey = (statement: FsStatement, row_no: number): string => `${statement} b.${row_no}`;
