/**
 * Engine inputs. Row shapes mirror the database tables (PRD §4), which mirror the Excel sheets.
 * Amounts are decimal strings (or numbers converted via their shortest string); never floats in maths.
 */
import type { Num } from "./decimal";
import type { ISODate } from "./dates";

export type Segment = "RPA" | "Trading";
export type SalesStatus = "Aktual" | "Order";
export type ReceiptStatus = "Aktual" | "Rencana";
export type BatchStatus = "Aktual" | "Rencana";
export type ReceiptSource = "Produksi RPA" | "Beli Trading";
export type RowSource = "Accurate" | "Ops" | "Manual";

/** Optional provenance carried by every input row (PRD §4, §7). Ignored by the maths. */
export interface Provenance {
  id?: string;
  /** Row number in the Excel sheet the row came from (fixtures only). */
  row?: number;
  source?: RowSource;
  document_ref?: string | null;
}

export interface WeekInfo {
  week_start: ISODate;
  week_end?: ISODate;
  /** "today" = the update date of the outlook, never the server clock. */
  update_date: ISODate;
  tb_opening_date: ISODate;
}

export interface YieldSet {
  karkas: Num;
  kepala: Num;
  ceker: Num;
  usus: Num;
  hja: Num;
  lemak: Num;
}

export interface SegmentSummaryInput {
  kg: Num;
  revenue: Num;
  gp: Num;
}

/** I_Parameter */
export interface Parameters {
  horizon_fresh_days: Num;
  target_shrink: Num;
  freight_plan_per_kg_lb: Num;
  maklon_per_kg_processed: Num;
  lb_price_today: Num;
  min_trading_spread: Num;
  stock_age_limit_days: Num;
  terms_lb_days: Num;
  terms_trading_days: Num;
  terms_freight_maklon_days: Num;
  yield_default: YieldSet;
  last_week: { RPA: SegmentSummaryInput; Trading: SegmentSummaryInput };
  /** Control 8 comparator; null = BELUM DIISI. */
  accurate_sales_kg: Num | null;
  /** Control 9 comparator; null = BELUM DIISI. */
  accurate_opening_stock_value: Num | null;
}

/** I_Master */
export interface SkuKey {
  key: string;
  segment: string;
  sku: string;
  form: string;
  decision_group: string;
  ref_sell_price: Num | null;
  replacement_buy_price: Num | null;
  note?: string | null;
}

/** I_Item */
export interface ItemMap {
  item_code: string;
  item_name?: string | null;
  key: string;
}

export type CoaType = "LabaRugi" | "Neraca" | "Header";

/** I_COA */
export interface CoaMap {
  account: string;
  name: string;
  type: CoaType | string;
  pl_line: string | null;
  bs_line: string | null;
  cf_category_as_counter: string | null;
  is_cash: boolean;
  fs_mapping_reference?: string | null;
}

/** I_Stok_Awal */
export interface OpeningStockRow extends Provenance {
  item_code: string | null;
  item_name?: string | null;
  /** Only for rows carried from last week's projection per key (not in the Excel's I_Stok_Awal). */
  key_manual?: string | null;
  kg: Num | null;
  value: Num | null;
  avg_age_days: Num | null;
  kg_over_age_limit: Num | null;
  note?: string | null;
}

/** T_Penjualan */
export interface SalesLine extends Provenance {
  date: ISODate | null;
  status: SalesStatus | string | null;
  customer?: string | null;
  item_code: string | null;
  key_manual?: string | null;
  kg: Num | null;
  price: Num | null;
  hpp_actual?: Num | null;
}

/** T_Penerimaan */
export interface ReceiptLine extends Provenance {
  date: ISODate | null;
  status: ReceiptStatus | string | null;
  receipt_source: ReceiptSource | string | null;
  supplier?: string | null;
  item_code: string | null;
  key_manual?: string | null;
  kg: Num | null;
  unit_cost: Num | null;
}

export interface BatchOutput {
  karkas_fresh: Num | null;
  karkas_frozen: Num | null;
  kepala: Num | null;
  ceker: Num | null;
  usus: Num | null;
  hja: Num | null;
  lemak: Num | null;
  other: Num | null;
}

/** T_Batch */
export interface Batch extends Provenance {
  date: ISODate | null;
  status: BatchStatus | string | null;
  batch_ref?: string | null;
  supplier?: string | null;
  lb_kg: Num | null;
  lb_price: Num | null;
  freight: Num | null;
  maklon: Num | null;
  processed_kg: Num | null;
  output: BatchOutput;
}

/** T_GL */
export interface GlLine extends Provenance {
  date: ISODate | null;
  voucher_no: string | null;
  voucher_type?: string | null;
  account: string | null;
  account_name?: string | null;
  description?: string | null;
  debit: Num | null;
  credit: Num | null;
  party?: string | null;
  cf_override?: string | null;
}

/** I_TB */
export interface TbRow extends Provenance {
  account: string;
  name?: string | null;
  balance: Num | null;
}

/** I_RunRate */
export interface RunRateRow {
  pl_line: string;
  monthly_amount: Num | null;
  week_adjustment: Num | null;
  basis?: string | null;
}

/** T_Kas_Rencana */
export interface CashPlanRow extends Provenance {
  date: ISODate | null;
  cf_category: string | null;
  bs_counter_line: string | null;
  description?: string | null;
  amount: Num | null;
}

/** One week's complete input set. The engine is a pure function of this object. */
export interface WeekInputs {
  week: WeekInfo;
  parameters: Parameters;
  sku_keys: SkuKey[];
  item_map: ItemMap[];
  coa_map: CoaMap[];
  opening_stock: OpeningStockRow[];
  sales_lines: SalesLine[];
  receipt_lines: ReceiptLine[];
  batches: Batch[];
  gl_lines: GlLine[];
  tb_opening: TbRow[];
  runrate: RunRateRow[];
  cash_plan: CashPlanRow[];
  /**
   * Ops-sourced rows superseded by an Accurate row with the same document (PRD §7).
   * Not used in any calculation; only compared by control 20.
   */
  superseded_ops_rows?: { sales: SalesLine[]; receipts: ReceiptLine[] };
}
