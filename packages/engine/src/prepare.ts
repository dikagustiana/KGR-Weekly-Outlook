/**
 * Normalise one week's inputs and compute the derived columns of the input sheets
 * (T_Penjualan G/J/N/O/P, T_Penerimaan H/K/L/M, T_Batch R–AD, I_Stok_Awal C, T_GL J–S, I_TB D–F).
 */
import { D, Dn, Decimal, ZERO, ONE, div, type Num } from "./decimal";
import { addDays, mondayOf, type ISODate } from "./dates";
import type {
  Batch,
  CashPlanRow,
  CoaMap,
  GlLine,
  ItemMap,
  OpeningStockRow,
  ReceiptLine,
  RunRateRow,
  SalesLine,
  SkuKey,
  TbRow,
  WeekInputs,
} from "./types";

export const KODE_BARU = "KODE BARU";
export const AKUN_BARU = "AKUN BARU";
export const UNKNOWN = "?";

/** Keys of the RPA products used by the breakeven formula (I_Parameter C28:C34). */
export const RPA_PRICE_KEYS = {
  karkasFresh: "RPA|Karkas|Fresh",
  karkasFrozen: "RPA|Karkas|Frozen",
  kepala: "RPA|Kepala|Fresh",
  ceker: "RPA|Ceker|Fresh",
  usus: "RPA|Usus|Fresh",
  hja: "RPA|HJA (Hati/Jantung/Ampela)|Fresh",
  lemak: "RPA|Lemak|Frozen",
} as const;

export interface Params {
  horizon: number;
  shrink: Decimal;
  freight: Decimal;
  maklon: Decimal;
  lbPrice: Decimal;
  minSpread: Decimal;
  ageLimit: Decimal;
  termsLb: number;
  termsTrading: number;
  termsFreightMaklon: number;
  yieldDefault: Yields;
  lastWeek: Record<"RPA" | "Trading", { kg: Decimal; revenue: Decimal; gp: Decimal }>;
  accurateSalesKg: Decimal | null;
  accurateOpeningValue: Decimal | null;
}

export interface Yields {
  karkas: Decimal;
  kepala: Decimal;
  ceker: Decimal;
  usus: Decimal;
  hja: Decimal;
  lemak: Decimal;
}

export interface MasterRow {
  key: string;
  segment: string;
  sku: string;
  form: string;
  group: string;
  refPrice: Decimal | null;
  buyPrice: Decimal | null;
  src: SkuKey;
}

export interface CoaRow {
  account: string;
  name: string;
  type: string;
  plLine: string | null;
  bsLine: string | null;
  cfCategory: string | null;
  isCash: boolean;
}

export interface SalesP {
  idx: number;
  src: SalesLine;
  date: ISODate | null;
  status: string;
  key: string;
  hasKg: boolean;
  kg: Decimal;
  price: Decimal;
  value: Decimal;
  hppActual: Decimal | null;
  segment: string;
  group: string;
  /** T_Penjualan P: 1 = counted in this week's figures. */
  counted: boolean;
}

export interface ReceiptP {
  idx: number;
  src: ReceiptLine;
  date: ISODate | null;
  status: string;
  source: string;
  key: string;
  hasKg: boolean;
  kg: Decimal;
  unitCost: Decimal;
  value: Decimal;
  segment: string;
  counted: boolean;
}

export interface OpeningP {
  idx: number;
  src: OpeningStockRow;
  key: string;
  kg: Decimal;
  value: Decimal;
  age: Decimal;
  kgOverAge: Decimal;
}

export interface BatchP {
  idx: number;
  src: Batch;
  date: ISODate | null;
  status: string;
  hasLb: boolean;
  lbKg: Decimal;
  lbPrice: Decimal;
  freight: Decimal;
  maklon: Decimal;
  processedKg: Decimal;
  hasProcessed: boolean;
  out: Record<keyof Batch["output"], Decimal>;
  /** R */ lbValue: Decimal;
  /** S */ totalCost: Decimal;
  /** T */ shrink: Decimal | null;
  /** U */ outputKg: Decimal;
  /** V */ yieldOutput: Decimal | null;
  /** W */ yieldKarkas: Decimal | null;
  /** X */ freshShare: Decimal | null;
  /** Y */ outputValue: Decimal;
  /** Z */ margin: Decimal;
  /** AA */ marginPerKgLb: Decimal | null;
  /** AB */ breakevenLb: Decimal | null;
  /** AC */ costPerKgOutput: Decimal | null;
  /** AD */ valuePerKgOutput: Decimal | null;
}

export interface GlP {
  idx: number;
  src: GlLine;
  date: ISODate | null;
  voucher: string;
  account: string | null;
  /** J: debit − credit */
  drCr: Decimal;
  /** K */ type: string;
  /** L */ plLine: string | null;
  /** M */ bsLine: string | null;
  /** N */ isCash: boolean;
  /** Q: counter account of a cash line */
  counterAccount: string | null;
  /** S: cash-flow category of a cash line */
  cfCategory: string | null;
}

export interface TbP {
  idx: number;
  src: TbRow;
  account: string;
  balance: Decimal;
  type: string;
  bsLine: string | null;
  plLine: string | null;
}

export interface CashPlanP {
  idx: number;
  src: CashPlanRow;
  date: ISODate | null;
  category: string | null;
  counterLine: string | null;
  hasAmount: boolean;
  amount: Decimal;
  /** F: inside [today, week end] */
  counted: boolean;
}

export interface RunRateP {
  plLine: string;
  monthly: Decimal;
  adjustment: Decimal;
  basis: string | null;
}

export interface Prepared {
  weekStart: ISODate;
  weekEnd: ISODate;
  today: ISODate;
  tbDate: ISODate;
  params: Params;
  prices: Record<keyof typeof RPA_PRICE_KEYS, Decimal>;
  master: MasterRow[];
  masterByKey: Map<string, MasterRow>;
  itemKey: Map<string, string>;
  /** I_Item rows in input order with their decision group (I_Item D; "KEY TIDAK ADA" when the key is not in I_Master). */
  items: { item_code: string; item_name: string | null; key: string; group: string }[];
  coa: Map<string, CoaRow>;
  opening: OpeningP[];
  sales: SalesP[];
  receipts: ReceiptP[];
  batches: BatchP[];
  gl: GlP[];
  tb: TbP[];
  runrate: RunRateP[];
  cashPlan: CashPlanP[];
  /** Yields used (I_Parameter C19:C24): this week's Aktual batches if any processed kg, else defaults. */
  yields: Yields;
  yieldsActual: Yields | null;
}

/** Excel MATCH/SUMIFS text comparison is case-insensitive. */
const norm = (s: string) => s.trim().toUpperCase();

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function int(v: Num): number {
  return D(v).toNumber();
}

export function prepare(inputs: WeekInputs): Prepared {
  const today = inputs.week.update_date;
  const weekStart = inputs.week.week_start ?? mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const P = inputs.parameters;
  const yd = P.yield_default;
  const params: Params = {
    horizon: int(P.horizon_fresh_days),
    shrink: D(P.target_shrink),
    freight: D(P.freight_plan_per_kg_lb),
    maklon: D(P.maklon_per_kg_processed),
    lbPrice: D(P.lb_price_today),
    minSpread: D(P.min_trading_spread),
    ageLimit: D(P.stock_age_limit_days),
    termsLb: int(P.terms_lb_days),
    termsTrading: int(P.terms_trading_days),
    termsFreightMaklon: int(P.terms_freight_maklon_days),
    yieldDefault: {
      karkas: D(yd.karkas), kepala: D(yd.kepala), ceker: D(yd.ceker),
      usus: D(yd.usus), hja: D(yd.hja), lemak: D(yd.lemak),
    },
    lastWeek: {
      RPA: { kg: D(P.last_week.RPA.kg), revenue: D(P.last_week.RPA.revenue), gp: D(P.last_week.RPA.gp) },
      Trading: { kg: D(P.last_week.Trading.kg), revenue: D(P.last_week.Trading.revenue), gp: D(P.last_week.Trading.gp) },
    },
    accurateSalesKg: Dn(P.accurate_sales_kg),
    accurateOpeningValue: Dn(P.accurate_opening_stock_value),
  };

  // I_Master
  const master: MasterRow[] = inputs.sku_keys
    .filter((m) => !isBlank(m.key))
    .map((m) => ({
      key: m.key, segment: m.segment, sku: m.sku, form: m.form, group: m.decision_group,
      refPrice: Dn(m.ref_sell_price), buyPrice: Dn(m.replacement_buy_price), src: m,
    }));
  const masterByKey = new Map<string, MasterRow>();
  for (const m of master) if (!masterByKey.has(norm(m.key))) masterByKey.set(norm(m.key), m);
  const lookupMaster = (key: string) => masterByKey.get(norm(key));

  // I_Item
  const itemKey = new Map<string, string>();
  for (const it of inputs.item_map as ItemMap[]) {
    if (!isBlank(it.item_code) && !itemKey.has(norm(it.item_code))) itemKey.set(norm(it.item_code), it.key);
  }
  const keyOf = (keyManual: string | null | undefined, itemCode: string | null): string => {
    if (!isBlank(keyManual)) return String(keyManual);
    if (isBlank(itemCode)) return "";
    return itemKey.get(norm(String(itemCode))) ?? KODE_BARU;
  };

  // I_COA
  const coa = new Map<string, CoaRow>();
  for (const c of inputs.coa_map as CoaMap[]) {
    const acc = String(c.account).trim();
    if (!coa.has(acc)) {
      coa.set(acc, {
        account: acc, name: c.name, type: c.type,
        plLine: c.pl_line ?? null, bsLine: c.bs_line ?? null,
        cfCategory: isBlank(c.cf_category_as_counter) ? null : (c.cf_category_as_counter as string),
        isCash: c.is_cash,
      });
    }
  }

  const segOf = (key: string) => (key === "" ? "" : lookupMaster(key)?.segment ?? UNKNOWN);
  const groupOf = (key: string) => (key === "" ? "" : lookupMaster(key)?.group ?? UNKNOWN);

  const inWeek = (d: ISODate | null) => d !== null && d >= weekStart && d <= weekEnd;

  // I_Stok_Awal
  const opening: OpeningP[] = inputs.opening_stock
    .map((r, idx) => ({
      idx, src: r,
      key: !isBlank(r.key_manual) ? String(r.key_manual) : isBlank(r.item_code) ? "" : keyOf(null, r.item_code),
      kg: D(r.kg), value: D(r.value), age: D(r.avg_age_days), kgOverAge: D(r.kg_over_age_limit),
    }));

  // T_Penerimaan
  const receipts: ReceiptP[] = inputs.receipt_lines.map((r, idx) => {
    const key = keyOf(r.key_manual, r.item_code);
    const hasKg = !isBlank(r.kg);
    const kg = D(r.kg);
    const unitCost = D(r.unit_cost);
    const status = (r.status ?? "").trim();
    const date = r.date ?? null;
    // M: =IF(I="","",IF(OR(A<C5,A>C6),0,IF(B="Aktual",1,IF(AND(B="Rencana",A>=C4),1,0))))
    const counted = hasKg && inWeek(date) && (status === "Aktual" || (status === "Rencana" && (date as string) >= today));
    return {
      idx, src: r, date, status, source: (r.receipt_source ?? "").trim(), key, hasKg, kg, unitCost,
      value: kg.times(unitCost), segment: segOf(key), counted,
    };
  });

  // T_Penjualan (HPP is added after the stock average cost is known — see stock.ts)
  const sales: SalesP[] = inputs.sales_lines.map((r, idx) => {
    const key = keyOf(r.key_manual, r.item_code);
    const hasKg = !isBlank(r.kg);
    const kg = D(r.kg);
    const price = D(r.price);
    const status = (r.status ?? "").trim();
    const date = r.date ?? null;
    // P: =IF(H="","",IF(OR(A<C5,A>C6),0,IF(B="Aktual",1,IF(AND(B="Order",A>=C4),1,0))))
    const counted = hasKg && inWeek(date) && (status === "Aktual" || (status === "Order" && (date as string) >= today));
    return {
      idx, src: r, date, status, key, hasKg, kg, price, value: kg.times(price),
      hppActual: Dn(r.hpp_actual ?? null), segment: segOf(key), group: groupOf(key), counted,
    };
  });

  // Reference prices (I_Parameter C28:C34 = IFERROR(INDEX(I_Master F, MATCH(key)), 0))
  const priceOf = (key: string) => lookupMaster(key)?.refPrice ?? ZERO;
  const prices = Object.fromEntries(
    Object.entries(RPA_PRICE_KEYS).map(([k, key]) => [k, priceOf(key)]),
  ) as Record<keyof typeof RPA_PRICE_KEYS, Decimal>;

  // T_Batch
  const batches: BatchP[] = inputs.batches.map((b, idx) => {
    const hasLb = !isBlank(b.lb_kg);
    const lbKg = D(b.lb_kg);
    const lbPrice = D(b.lb_price);
    const freight = D(b.freight);
    const maklon = D(b.maklon);
    const hasProcessed = !isBlank(b.processed_kg);
    const processedKg = D(b.processed_kg);
    const o = b.output;
    const out = {
      karkas_fresh: D(o.karkas_fresh), karkas_frozen: D(o.karkas_frozen), kepala: D(o.kepala), ceker: D(o.ceker),
      usus: D(o.usus), hja: D(o.hja), lemak: D(o.lemak), other: D(o.other),
    };
    const karkas = out.karkas_fresh.plus(out.karkas_frozen);
    const lbValue = lbKg.times(lbPrice);
    const totalCost = lbValue.plus(freight).plus(maklon);
    const outputKg = Object.values(out).reduce((s, v) => s.plus(v), ZERO);
    const outputValue = out.karkas_fresh.times(prices.karkasFresh)
      .plus(out.karkas_frozen.times(prices.karkasFrozen))
      .plus(out.kepala.times(prices.kepala))
      .plus(out.ceker.times(prices.ceker))
      .plus(out.usus.times(prices.usus))
      .plus(out.hja.times(prices.hja))
      .plus(out.lemak.times(prices.lemak));
    const margin = outputValue.minus(totalCost);
    const okProcessed = hasLb && hasProcessed && !processedKg.isZero();
    return {
      idx, src: b, date: b.date ?? null, status: (b.status ?? "").trim(), hasLb, lbKg, lbPrice, freight, maklon,
      processedKg, hasProcessed, out, lbValue, totalCost,
      shrink: hasLb && hasProcessed && !lbKg.isZero() ? ONE.minus(processedKg.div(lbKg)) : null,
      outputKg,
      yieldOutput: okProcessed ? outputKg.div(processedKg) : null,
      yieldKarkas: okProcessed ? karkas.div(processedKg) : null,
      freshShare: hasLb && !karkas.isZero() ? out.karkas_fresh.div(karkas) : null,
      outputValue,
      margin,
      marginPerKgLb: hasLb && !lbKg.isZero() ? margin.div(lbKg) : null,
      breakevenLb: hasLb && !lbKg.isZero() ? outputValue.minus(freight).minus(maklon).div(lbKg) : null,
      costPerKgOutput: hasLb && !outputKg.isZero() ? totalCost.div(outputKg) : null,
      valuePerKgOutput: hasLb && !outputKg.isZero() ? outputValue.div(outputKg) : null,
    };
  });

  // Yields (I_Parameter E19:E24) — SUMIFS over every Aktual row of T_Batch (no date filter, as in the Excel).
  const act = batches.filter((b) => b.status === "Aktual");
  const sumAct = (f: (b: BatchP) => Decimal) => act.reduce((s, b) => s.plus(f(b)), ZERO);
  const processedAct = sumAct((b) => b.processedKg);
  const yieldsActual: Yields | null = processedAct.isZero()
    ? null
    : {
        karkas: sumAct((b) => b.out.karkas_fresh).plus(sumAct((b) => b.out.karkas_frozen)).div(processedAct),
        kepala: sumAct((b) => b.out.kepala).div(processedAct),
        ceker: sumAct((b) => b.out.ceker).div(processedAct),
        usus: sumAct((b) => b.out.usus).div(processedAct),
        hja: sumAct((b) => b.out.hja).div(processedAct),
        lemak: sumAct((b) => b.out.lemak).div(processedAct),
      };
  const yields = yieldsActual ?? params.yieldDefault;

  // T_GL
  const gl: GlP[] = inputs.gl_lines.map((g, idx) => {
    const account = isBlank(g.account) ? null : String(g.account).trim();
    const c = account ? coa.get(account) : undefined;
    const type = account === null ? "" : c ? c.type : AKUN_BARU;
    return {
      idx, src: g, date: g.date ?? null, voucher: (g.voucher_no ?? "").trim(), account,
      drCr: D(g.debit).minus(D(g.credit)),
      type,
      plLine: type === "LabaRugi" ? c?.plLine ?? null : null,
      bsLine: type === "Neraca" ? c?.bsLine ?? null : null,
      isCash: account !== null && (c ? c.isCash : false),
      counterAccount: null,
      cfCategory: null,
    };
  });
  classifyCashLines(gl, coa);

  // I_TB
  const tb: TbP[] = inputs.tb_opening
    .filter((t) => !isBlank(t.account))
    .map((t, idx) => {
      const account = String(t.account).trim();
      const c = coa.get(account);
      const type = c ? c.type : AKUN_BARU;
      return {
        idx, src: t, account, balance: D(t.balance), type,
        bsLine: type === "Neraca" ? c?.bsLine ?? null : null,
        plLine: type === "LabaRugi" ? c?.plLine ?? null : null,
      };
    });

  const runrate: RunRateP[] = (inputs.runrate as RunRateRow[]).map((r) => ({
    plLine: r.pl_line, monthly: D(r.monthly_amount), adjustment: D(r.week_adjustment), basis: r.basis ?? null,
  }));

  const cashPlan: CashPlanP[] = (inputs.cash_plan as CashPlanRow[]).map((c, idx) => {
    const date = c.date ?? null;
    const hasAmount = !isBlank(c.amount);
    return {
      idx, src: c, date,
      category: isBlank(c.cf_category) ? null : (c.cf_category as string),
      counterLine: isBlank(c.bs_counter_line) ? null : (c.bs_counter_line as string),
      hasAmount, amount: D(c.amount),
      // F: =IF(E="","",IF(AND(A>=C4,A<=C6),1,0))
      counted: hasAmount && date !== null && date >= today && date <= weekEnd,
    };
  });

  const items = (inputs.item_map as ItemMap[]).map((it) => ({
    item_code: it.item_code, item_name: it.item_name ?? null, key: it.key,
    group: lookupMaster(it.key)?.group ?? "KEY TIDAK ADA",
  }));

  return {
    weekStart, weekEnd, today, tbDate: inputs.week.tb_opening_date, params, prices, master, masterByKey,
    itemKey, items, coa, opening, sales, receipts, batches, gl, tb, runrate, cashPlan, yields, yieldsActual,
  };
}

/**
 * T_GL Q/S: a cash line takes the category of its counter account = the non-cash line with the largest
 * absolute amount in the same voucher (first such line in sheet order, amounts compared rounded to Rp);
 * vouchers with only cash lines → "Transfer antar rekening"; a user override wins; unknown account → "?".
 */
export function classifyCashLines(gl: GlP[], coa: Map<string, CoaRow>): void {
  const maxByVoucher = new Map<string, Decimal>();
  const firstByKey = new Map<string, GlP>();
  for (const g of gl) {
    if (g.account === null || g.isCash) continue;
    const abs = g.drCr.abs();
    const cur = maxByVoucher.get(g.voucher);
    if (!cur || abs.greaterThan(cur)) maxByVoucher.set(g.voucher, abs);
    const k = `${g.voucher}|${abs.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()}`;
    if (!firstByKey.has(k)) firstByKey.set(k, g);
  }
  for (const g of gl) {
    if (!g.isCash) continue;
    const m = maxByVoucher.get(g.voucher) ?? ZERO; // MAXIFS with no match = 0
    const counter = firstByKey.get(`${g.voucher}|${m.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()}`);
    g.counterAccount = counter ? counter.account : "(tanpa lawan)";
    const override = g.src.cf_override;
    if (!isBlank(override)) g.cfCategory = String(override);
    else if (!counter) g.cfCategory = "Transfer antar rekening";
    else {
      const c = coa.get(counter.account as string);
      g.cfCategory = c ? c.cfCategory : UNKNOWN;
    }
  }
}

export { div };
