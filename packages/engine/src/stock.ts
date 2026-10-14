/** PRD §5.1 — stock projection per key (sheet O_Stok). */
import { Decimal, ZERO, div, round0 } from "./decimal";
import { diffDays, weekDays, type ISODate } from "./dates";
import type { Prepared, SalesP } from "./prepare";

export type StockStatusCode = "KURANG" | "JUAL" | "PERHATIAN" | "CEK HARGA" | "-";

export interface StockRow {
  key: string;
  /** B Kelompok */ group: string;
  /** C Segmen */ segment: string;
  /** D */ openingKg: Decimal;
  /** E */ openingValue: Decimal;
  /** F (null when no opening kg) */ avgAgeDays: Decimal | null;
  /** G */ kgOverAgeLimit: Decimal;
  /** H–N closing per day Monday..Sunday */ closing: Decimal[];
  /** O */ receiptsKg: Decimal;
  /** P */ receiptsValue: Decimal;
  /** Q */ avgCost: Decimal;
  /** R */ salesAndOrdersKg: Decimal;
  /** S */ stockToday: Decimal;
  /** T */ ordersRestOfWeek: Decimal;
  /** U */ stockMinusOrders: Decimal;
  /** V */ lowest: Decimal;
  /** W (null = harga acuan kosong) */ refPrice: Decimal | null;
  /** X */ marginAtRef: Decimal | null;
  /** Y */ valueToday: Decimal;
  /** Z */ status: StockStatusCode;
  statusText: string;
}

export interface StockResult {
  days: ISODate[];
  rows: StockRow[];
  byKey: Map<string, StockRow>;
}

const fmtInt = (x: Decimal) => round0(x).toFixed(0);

export function computeStock(p: Prepared): StockResult {
  const days = weekDays(p.weekStart);
  const rows: StockRow[] = [];
  const norm = (s: string) => s.trim().toUpperCase();

  // Index rows by key once.
  const groupBy = <T extends { key: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const k = norm(x.key);
      const a = m.get(k);
      if (a) a.push(x);
      else m.set(k, [x]);
    }
    return m;
  };
  const openingBy = groupBy(p.opening);
  const receiptsBy = groupBy(p.receipts.filter((r) => r.counted));
  const salesCountedBy = groupBy(p.sales.filter((s) => s.counted));
  const ordersBy = groupBy(p.sales.filter((s) => s.status === "Order" && s.date !== null && s.date >= p.today && s.date <= p.weekEnd));

  for (const m of p.master) {
    const k = norm(m.key);
    const op = openingBy.get(k) ?? [];
    const rc = receiptsBy.get(k) ?? [];
    const sc = salesCountedBy.get(k) ?? [];
    const od = ordersBy.get(k) ?? [];

    const openingKg = op.reduce((s, r) => s.plus(r.kg), ZERO);
    const openingValue = op.reduce((s, r) => s.plus(r.value), ZERO);
    const kgOverAgeLimit = op.reduce((s, r) => s.plus(r.kgOverAge), ZERO);
    const avgAgeDays = openingKg.lessThanOrEqualTo(0)
      ? null
      : op.reduce((s, r) => s.plus(r.kg.times(r.age)), ZERO).div(openingKg);

    const closing: Decimal[] = [];
    let prev = openingKg;
    for (const d of days) {
      const inKg = rc.filter((r) => r.date === d).reduce((s, r) => s.plus(r.kg), ZERO);
      const outKg = sc.filter((s) => s.date === d).reduce((s, r) => s.plus(r.kg), ZERO);
      prev = prev.plus(inKg).minus(outKg);
      closing.push(prev);
    }

    const receiptsKg = rc.reduce((s, r) => s.plus(r.kg), ZERO);
    const receiptsValue = rc.reduce((s, r) => s.plus(r.value), ZERO);
    const base = openingKg.plus(receiptsKg);
    const avgCost = base.lessThanOrEqualTo(0) ? ZERO : openingValue.plus(receiptsValue).div(base);
    const salesAndOrdersKg = sc.reduce((s, r) => s.plus(r.kg), ZERO);

    // S: today <= Monday → opening; today > Sunday → Sunday closing; else closing of yesterday.
    let stockToday: Decimal;
    if (p.today <= p.weekStart) stockToday = openingKg;
    else if (p.today > p.weekEnd) stockToday = closing[6];
    else stockToday = closing[diffDays(p.today, p.weekStart) - 1];

    const ordersRestOfWeek = od.reduce((s, r) => s.plus(r.kg), ZERO);
    const lowest = closing.reduce((a, b) => (b.lessThan(a) ? b : a));
    const refPrice = m.refPrice;
    const marginAtRef = refPrice === null ? null : refPrice.minus(avgCost);
    const valueToday = stockToday.times(avgCost);

    let status: StockStatusCode;
    let statusText: string;
    if (lowest.lessThan(-0.5)) {
      status = "KURANG";
      statusText = `KURANG: stok minus ${fmtInt(lowest.neg())} kg — beli/potong atau geser order`;
    } else if (stockToday.greaterThan(0.5) && ordersRestOfWeek.lessThanOrEqualTo(0) && kgOverAgeLimit.greaterThan(0.5)) {
      status = "JUAL";
      statusText = `JUAL: ${fmtInt(stockToday)} kg tanpa order, sebagian > batas umur`;
    } else if (stockToday.greaterThan(0.5) && ordersRestOfWeek.lessThanOrEqualTo(0)) {
      status = "JUAL";
      statusText = `JUAL: ${fmtInt(stockToday)} kg tanpa order minggu ini`;
    } else if (kgOverAgeLimit.greaterThan(0.5)) {
      status = "PERHATIAN";
      statusText = `PERHATIAN: ${fmtInt(kgOverAgeLimit)} kg di atas batas umur`;
    } else if (marginAtRef !== null && marginAtRef.lessThan(0) && ordersRestOfWeek.greaterThan(0)) {
      status = "CEK HARGA";
      statusText = "Order di bawah biaya rata-rata — cek harga";
    } else {
      status = "-";
      statusText = "-";
    }

    rows.push({
      key: m.key, group: m.group, segment: m.segment, openingKg, openingValue, avgAgeDays, kgOverAgeLimit,
      closing, receiptsKg, receiptsValue, avgCost, salesAndOrdersKg, stockToday, ordersRestOfWeek,
      stockMinusOrders: stockToday.minus(ordersRestOfWeek), lowest, refPrice, marginAtRef, valueToday,
      status, statusText,
    });
  }
  const byKey = new Map<string, StockRow>();
  for (const r of rows) if (!byKey.has(norm(r.key))) byKey.set(norm(r.key), r);
  return { days, rows, byKey };
}

/** T_Penjualan L/M: HPP = HPP aktual (Accurate DO) if given, else kg × weekly average cost of the key. */
export interface SalesValued extends SalesP {
  hpp: Decimal;
  gp: Decimal;
}

export function valueSales(p: Prepared, stock: StockResult): SalesValued[] {
  return p.sales.map((s) => {
    const avg = stock.byKey.get(s.key.trim().toUpperCase())?.avgCost ?? ZERO;
    const hpp = s.hppActual ?? s.kg.times(avg);
    return { ...s, hpp, gp: s.value.minus(hpp) };
  });
}

export { div };
