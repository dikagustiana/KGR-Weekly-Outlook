/**
 * PRD v5 §4.2–4.4 (K27, K28): demand of karkas per size → weight class of the live bird → kg LB, per ship date and per
 * cut date. Pure functions, decimal.js.
 *
 *   open_kg[line]  = (kg − fulfilled − cancelled, never below 0) × the weight of its status (R49); forecasts enter as
 *                    STD lines per date. The weighting is the caller's (kg of a SizedLine is already weighted)
 *   net_kg[size]   = weighted kg × the key's net share (v4 netting per key, AFTER the weighting: stock carries no size)
 *   class[size]    = size_class_map(size); no size, or a size not mapped → class STD (C50)
 *   kg_LB[class]   = Σ net_kg ÷ yield_karkas[class] (no yield for the class → the STD yield, C42)
 *   heads[size]    = net_kg ÷ (size + 0,05): the midpoint of "Uk x.x" (O3); no size: kg LB ÷ average LB kg of STD
 *   by-products    = kg_LB[class] × yield_bp[class]; they never add kg LB (C41)
 * The heads are what the kg LB means, not a decision variable (K28 replaces v4 K1's heads).
 */
import { D, Decimal, ZERO, div, max, sum, type Num } from "./decimal";
import { addDays, type ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";
import { effectiveForecasts, type DemandWeights, type ForecastLine } from "./demand";
import { outstandingKg, type OrderQty } from "./delivery";

/** "Karkas Uk 1.3 Fresh Grade A" → 1,30 kg per head of karkas; null without "Uk x.x". */
export function sizeKgOf(name: string | null | undefined): Decimal | null {
  const m = /\bUk\.?\s*(\d+)[.,](\d+)/i.exec(name ?? "");
  return m ? D(`${m[1]}.${m[2]}`) : null;
}

export const NO_SIZE = "tanpa";
/**
 * Size code of a line (key of demand_class_weekly): "Uk 1.3", "Uk 1.25" or "tanpa". PRD v5.1 R31: two decimals as
 * size_kg holds them (1.25 and 1.30 are two sizes, never one "Uk 1.3"); a one-decimal size reads as before.
 */
export const sizeCode = (size: Num | null | undefined) => (size === null || size === undefined || size === "" ? NO_SIZE : `Uk ${D(size).toFixed(2).replace(/(\.\d)0$/, "$1")}`);

/**
 * One line of the class demand. `kg` is the open kg already weighted by its status (R49). `forecast`: a forecast line has no
 * size by nature — it is STD need, not a PO line missing its size, so C50 does not count it.
 */
export interface SizedLine { ship_date: ISODate; key: string; size_kg: Num | null; kg: Num; forecast?: boolean }

/**
 * R49 (A-UI-9): the open kg of a PO line × the weight of its status — (kg − fulfilled − cancelled, never below 0) × 100 %
 * Confirmed / `tentative_weight` / `forecast_weight`. A Tentative 100 kg line is 70 kg; a Confirmed 100 kg with 60 kg
 * delivered is 40 kg. The stock netting comes after (toClassLB `netShare`).
 */
export function weightedOpenKg(o: OrderQty & { demand_status: string | null }, weights: DemandWeights): Decimal {
  const w = o.demand_status === "Tentative" ? D(weights.tentative) : o.demand_status === "Forecast" ? D(weights.forecast) : D(1);
  return outstandingKg(o).times(w);
}

/**
 * R49: the forecast of the week as STD lines per date, never at the week start alone. The K2 rule (a key with a Sales
 * forecast ignores the statistical one) and `forecast_weight` apply; the weekly kg is spread over the seven days of the
 * week like the heads of the v4 plan (splitHeadsByDay), the last day taking the rounding so the days add up exactly.
 */
export function forecastLinesByDate(x: { forecasts: ForecastLine[]; weekStart: ISODate; weight: Num; keys: (key: string) => boolean }): SizedLine[] {
  const perKey = new Map<string, Decimal>();
  for (const f of effectiveForecasts(x.forecasts, x.weekStart)) {
    if (!x.keys(f.key)) continue;
    perKey.set(f.key, (perKey.get(f.key) ?? ZERO).plus(D(f.kg)));
  }
  const out: SizedLine[] = [];
  for (const [key, kg] of [...perKey].sort(([a], [b]) => a.localeCompare(b))) {
    const total = kg.times(D(x.weight));
    if (!total.gt(0)) continue;
    const each = total.div(7).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    let left = total;
    for (let i = 0; i < 7; i++) {
      const part = i === 6 ? left : each;
      left = left.minus(part);
      if (part.gt(0)) out.push({ ship_date: addDays(x.weekStart, i), key, size_kg: null, kg: part.toFixed(6), forecast: true });
    }
  }
  return out;
}

export interface ClassSetup {
  /** size_class_map in force: class of a karkas size; null = not mapped. */
  classOf: (size: Decimal) => string | null;
  /** Karkas yield of a class (yield_matrix, pattern karkas); null = none for that class. */
  yieldKarkas: (cls: string) => Num | null;
  /** Average live weight of a class (weight_class.avg_kg); used for lines without a size. */
  avgKg: (cls: string) => Num | null;
  /** O3: midpoint of "Uk x.x" = x.x + offset (default 0,05). */
  midOffset: Num;
  /** Class of the lines without a size or with a size not mapped (default STD). */
  fallback: string;
}

export interface ClassDemandRow {
  ship_date: ISODate;
  size_code: string;
  size_kg: Decimal | null;
  weight_class: string;
  /** false = no size, or a size without a class (C50). */
  mapped: boolean;
  /** true = the class has no karkas yield of its own; the fallback class's yield was used (C42). */
  yieldFallback: boolean;
  /** Open kg × status weight, before the stock netting. */
  po_kg: Decimal;
  net_kg: Decimal;
  /** R50: the kg of PO lines (not forecasts) of this row without a size or with a size not mapped — the C50 quality flag, apart from the need. */
  unsized_kg: Decimal;
  /** kg LB per head (midpoint ÷ yield, or the class average). */
  lb_per_head: Decimal | null;
  kg_lb: Decimal;
  /** Unrounded. */
  heads: Decimal;
}

export interface ClassTotal { weight_class: string; net_kg: Decimal; kg_lb: Decimal; heads: Decimal; lb_per_head: Decimal | null; sizes: string[] }

export interface ClassDemand {
  rows: ClassDemandRow[];
  /** Per size over the week (the step-1 table). */
  bySize: { size_code: string; size_kg: Decimal | null; weight_class: string; mapped: boolean; po_kg: Decimal; net_kg: Decimal; lb_per_head: Decimal | null; kg_lb: Decimal; heads: Decimal }[];
  byClass: ClassTotal[];
  total: { po_kg: Decimal; net_kg: Decimal; kg_lb: Decimal; heads: Decimal; lb_per_head: Decimal | null };
  /** PO karkas without a size (C50), per ship date. */
  unsized: { ship_date: ISODate; kg: Decimal }[];
}

/**
 * K28: karkas demand per ship date × size → class → kg LB and heads. The kg of a line is the open weighted kg (R49);
 * `netShare` is the stock netting of its key (net ÷ weighted, v4), applied after the weighting.
 */
export function toClassLB(x: { lines: SizedLine[]; netShare?: (key: string) => Num; setup: ClassSetup }): ClassDemand {
  const s = x.setup;
  const fbYield = s.yieldKarkas(s.fallback);
  const acc = new Map<string, ClassDemandRow>();
  for (const l of x.lines) {
    const size = l.size_kg === null || l.size_kg === undefined || l.size_kg === "" ? null : D(l.size_kg);
    const mappedCls = size ? s.classOf(size) : null;
    const cls = mappedCls ?? s.fallback;
    // R31: accumulate per size as stored (two decimals); the code is what the screen and the mart key show
    const k = `${l.ship_date}|${size === null ? NO_SIZE : size.toFixed(2)}`;
    const o = acc.get(k) ?? {
      ship_date: l.ship_date, size_code: sizeCode(size), size_kg: size, weight_class: cls, mapped: mappedCls !== null, yieldFallback: false,
      po_kg: ZERO, net_kg: ZERO, unsized_kg: ZERO, lb_per_head: null, kg_lb: ZERO, heads: ZERO,
    };
    const share = x.netShare ? D(x.netShare(l.key)) : D(1);
    o.po_kg = o.po_kg.plus(D(l.kg));
    o.net_kg = o.net_kg.plus(D(l.kg).times(share));
    if (mappedCls === null && !l.forecast) o.unsized_kg = o.unsized_kg.plus(D(l.kg));
    acc.set(k, o);
  }
  const rows = [...acc.values()].map((r) => {
    const own = s.yieldKarkas(r.weight_class);
    const y = own ?? fbYield;
    const kgLb = y === null || D(y).isZero() ? ZERO : r.net_kg.div(D(y));
    let heads = ZERO, lbPerHead: Decimal | null = null;
    if (r.size_kg && r.mapped) {
      const mid = r.size_kg.plus(D(s.midOffset));
      heads = r.net_kg.div(mid);
      lbPerHead = y === null || D(y).isZero() ? null : mid.div(D(y));
    } else {
      const avg = s.avgKg(r.weight_class) ?? s.avgKg(s.fallback);
      heads = avg === null || D(avg).isZero() ? ZERO : kgLb.div(D(avg));
      lbPerHead = avg === null ? null : D(avg);
    }
    return { ...r, yieldFallback: own === null, kg_lb: kgLb, heads, lb_per_head: lbPerHead };
  }).sort((a, b) => a.ship_date.localeCompare(b.ship_date) || order(a.size_code) - order(b.size_code));
  const sizes = new Map<string, ClassDemand["bySize"][number]>();
  for (const r of rows) {
    const o = sizes.get(r.size_code) ?? { size_code: r.size_code, size_kg: r.size_kg, weight_class: r.weight_class, mapped: r.mapped, po_kg: ZERO, net_kg: ZERO, lb_per_head: r.lb_per_head, kg_lb: ZERO, heads: ZERO };
    o.po_kg = o.po_kg.plus(r.po_kg); o.net_kg = o.net_kg.plus(r.net_kg); o.kg_lb = o.kg_lb.plus(r.kg_lb); o.heads = o.heads.plus(r.heads);
    sizes.set(r.size_code, o);
  }
  const bySize = [...sizes.values()].sort((a, b) => order(a.size_code) - order(b.size_code));
  const classes = new Map<string, ClassTotal>();
  for (const r of bySize) {
    const o = classes.get(r.weight_class) ?? { weight_class: r.weight_class, net_kg: ZERO, kg_lb: ZERO, heads: ZERO, lb_per_head: null, sizes: [] };
    o.net_kg = o.net_kg.plus(r.net_kg); o.kg_lb = o.kg_lb.plus(r.kg_lb); o.heads = o.heads.plus(r.heads); o.sizes.push(r.size_code);
    classes.set(r.weight_class, o);
  }
  const byClass = [...classes.values()].map((c) => ({ ...c, lb_per_head: c.heads.isZero() ? null : c.kg_lb.div(c.heads) }));
  const t = { po_kg: sum(bySize.map((r) => r.po_kg)), net_kg: sum(bySize.map((r) => r.net_kg)), kg_lb: sum(bySize.map((r) => r.kg_lb)), heads: sum(bySize.map((r) => r.heads)) };
  const unsizedMap = new Map<string, Decimal>();
  for (const r of rows) if (r.unsized_kg.gt(0)) unsizedMap.set(r.ship_date, (unsizedMap.get(r.ship_date) ?? ZERO).plus(r.unsized_kg));
  return {
    rows, bySize, byClass, total: { ...t, lb_per_head: t.heads.isZero() ? null : t.kg_lb.div(t.heads) },
    unsized: [...unsizedMap].sort(([a], [b]) => a.localeCompare(b)).map(([ship_date, kg]) => ({ ship_date, kg })),
  };
}

const order = (code: string) => (code === NO_SIZE ? 1e9 : Number(code.replace(/^Uk /, "")) * 100);

/** By-products the kg LB of each class yields, and what the orders still miss (C41: buy trading or reduce orders). */
export function classByProducts(x: { byClass: { weight_class: string; kg_lb: Num }[]; yieldOf: (cls: string, unit: string) => Num | null; net: { unit: string; kg: Num }[] }): { unit: string; net_kg: Decimal; output_kg: Decimal; shortfall_kg: Decimal }[] {
  return x.net.map((n) => {
    const output = sum(x.byClass.map((c) => { const y = x.yieldOf(c.weight_class, n.unit); return y === null ? ZERO : D(c.kg_lb).times(D(y)); }));
    return { unit: n.unit, net_kg: D(n.kg), output_kg: output, shortfall_kg: max(ZERO, D(n.kg).minus(output)) };
  });
}

export interface DailyClassRow {
  cut_date: ISODate;
  ship_date: ISODate;
  karkas_kg: Decimal;
  kg_lb: Decimal;
  heads: Decimal;
  /** Heads and kg LB per class (sized lines), and the heads of the lines without a size. */
  byClass: { weight_class: string; kg_lb: Decimal; heads: Decimal }[];
  unsizedHeads: Decimal;
}

/** §4.4: cut H − lead time of each ship date; the need of each cut date per class. */
export function dailyClassPlan(x: { demand: ClassDemand; leadTimeDays: number }): DailyClassRow[] {
  const dates = [...new Set(x.demand.rows.map((r) => r.ship_date))].sort();
  return dates.map((ship) => {
    const rs = x.demand.rows.filter((r) => r.ship_date === ship);
    const cls = new Map<string, { kg_lb: Decimal; heads: Decimal }>();
    // R50: the unmapped (STD) lines are a class of their own for C58 — their kg LB needs supply too
    for (const r of rs) {
      const o = cls.get(r.weight_class) ?? { kg_lb: ZERO, heads: ZERO };
      cls.set(r.weight_class, { kg_lb: o.kg_lb.plus(r.kg_lb), heads: o.heads.plus(r.heads) });
    }
    return {
      cut_date: addDays(ship, -x.leadTimeDays), ship_date: ship, karkas_kg: sum(rs.map((r) => r.net_kg)), kg_lb: sum(rs.map((r) => r.kg_lb)), heads: sum(rs.map((r) => r.heads)),
      byClass: [...cls].map(([weight_class, v]) => ({ weight_class, ...v })), unsizedHeads: sum(rs.filter((r) => !r.mapped).map((r) => r.heads)),
    };
  });
}

/** §4.3 for a plan of kg LB: karkas output, surplus over the demand, frozen planned and the downgrade (Rp, positive). */
export function weekClassPlan(x: { kgLb: Num; demandKarkasKg: Num; yieldKarkas: Num; priceFresh: Num | null; priceFrozen: Num | null }): { output_kg: Decimal; surplus_kg: Decimal; frozen_kg: Decimal; downgrade: Decimal | null } {
  const output = D(x.kgLb).times(D(x.yieldKarkas));
  const surplus = max(ZERO, output.minus(D(x.demandKarkasKg)));
  const gap = x.priceFresh === null || x.priceFrozen === null ? null : max(ZERO, D(x.priceFresh).minus(D(x.priceFrozen)));
  return { output_kg: output, surplus_kg: surplus, frozen_kg: surplus, downgrade: gap === null ? null : surplus.times(gap) };
}

// ------------------------------------------------------------------------------------------------ C50, C51, C58

/** C50: PO lines of karkas RPA without a size (or a size without a class): counted at STD, shown red. PERIKSA. */
export function c50(d: ClassDemand): ControlV3 {
  const kg = sum(d.unsized.map((u) => u.kg));
  return {
    code: "C50", module: "M3", name: "Baris PO karkas RPA punya ukuran yang terpetakan ke kelas", value: kg, comparator: ZERO, difference: kg,
    status: kg.gt(0) ? "PERIKSA" : "LULUS", action: kg.gt(0) ? "Commercial melengkapi ukuran di PO (atau PPIC memetakan ukuran ke kelas); sementara dihitung kelas STD" : "",
    detail: d.unsized.map((u) => `kirim ${u.ship_date}: ${u.kg.toFixed(0)} kg tanpa kelas`),
  };
}

/** C51: a weight class used in yields, supply or an upload that is not registered (weight_class). GAGAL for that row. */
export function c51(x: { registered: string[]; used: { source: string; weight_class: string }[] }): ControlV3 {
  const known = new Set(x.registered);
  const bad = x.used.filter((u) => !known.has(u.weight_class));
  const codes = [...new Set(bad.map((b) => `${b.weight_class} (${b.source})`))];
  return {
    code: "C51", module: "M3", name: "Kelas berat di yield / supply / upload terdaftar", value: D(bad.length), comparator: ZERO, difference: D(bad.length),
    status: bad.length ? "GAGAL" : "LULUS", action: bad.length ? "Daftarkan kelas di master kelas berat, atau perbaiki baris upload" : "", detail: codes,
  };
}

/**
 * C58: LB supply per class and cut date below the need of that class. PERIKSA (copy to batch only with a reason).
 * R50: STD (the PO lines without a size) is a class of its own; a supply without a class is ignored (O20) and the
 * message says how many kg that is. Nothing entered at all = BELUM DIISI; a cut date with supply but none of the class
 * (or STD with any supply entered, since no class supply covers lines without a size) = supply 0 < need = PERIKSA.
 */
export function c58(x: { need: { cut_date: ISODate; weight_class: string; kg_lb: Num }[]; supply: { date: ISODate; weight_class: string | null; kg_lb: Num }[]; fallback?: string }): ControlV3 {
  const fb = x.fallback ?? "STD";
  const short: string[] = [];
  let missing = 0;
  for (const n of x.need) {
    const s = x.supply.filter((q) => q.date === n.cut_date && q.weight_class === n.weight_class);
    if (!s.length) {
      if (x.supply.some((q) => q.date === n.cut_date) || (n.weight_class === fb && x.supply.length > 0)) short.push(`${n.cut_date} ${n.weight_class}: supply 0 < kebutuhan ${D(n.kg_lb).toFixed(0)} kg LB`);
      else missing++;
      continue;
    }
    const got = sum(s.map((q) => D(q.kg_lb)));
    if (got.lt(D(n.kg_lb))) short.push(`${n.cut_date} ${n.weight_class}: supply ${got.toFixed(0)} < kebutuhan ${D(n.kg_lb).toFixed(0)} kg LB`);
  }
  const noClassKg = sum(x.supply.filter((q) => q.weight_class === null).map((q) => D(q.kg_lb)));
  const status = short.length ? "PERIKSA" : missing && x.need.length ? "BELUM DIISI" : "LULUS";
  return {
    code: "C58", module: "M3", name: "Supply LB per kelas menutup kebutuhan kelas", value: D(short.length), comparator: ZERO, difference: D(short.length), status,
    action: status === "LULUS" ? "" : status === "BELUM DIISI" ? "Purchasing mengisi supply LB per kelas per tanggal potong" : "Tambah supply kelas itu atau tulis alasan sebelum salin ke batch",
    detail: [...short, ...(missing ? [`${missing} kombinasi tanggal × kelas belum punya supply`] : []), ...(noClassKg.gt(0) ? [`${noClassKg.toFixed(0)} kg tanpa kelas (supply tanpa kelas diabaikan, O20)`] : [])],
  };
}

/** kg LB per class of a cut date (for C58 and the supply tile). */
export function needByCutDate(rows: DailyClassRow[]): { cut_date: ISODate; weight_class: string; kg_lb: Decimal }[] {
  return rows.flatMap((r) => r.byClass.map((c) => ({ cut_date: r.cut_date, weight_class: c.weight_class, kg_lb: c.kg_lb })));
}

/** Net share per key (net ÷ demand) from v4 netting, for toClassLB. */
export function netShareOf(rows: { key: string; weighted_kg: Num; net_kg: Num }[]): (key: string) => Decimal {
  const m = new Map(rows.map((r) => [r.key, D(r.weighted_kg).isZero() ? ZERO : div(D(r.net_kg), D(r.weighted_kg))]));
  return (key) => m.get(key) ?? D(1);
}
