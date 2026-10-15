/**
 * M2 — lot ledger (PRD v3 §4.3). Pure: source rows → lots, movements, balances per lot and per SKU key.
 *
 *  - A lot = one receipt (production GRN / trading GRN), one opening-stock row, one blast conversion.
 *  - Outflows (DO / invoice) take lots FIFO per item code, then per key (Q6: Accurate DOs carry no lot → assumed),
 *    unless an explicit allocation (M3) names the lot.
 *  - Moving average per item code (Q11, Accurate's own method): ma = (cost balance + cost in) / (kg balance + kg in);
 *    outflows leave at the running MA. Specific identification per lot: outflows leave at the lot's own cost/kg.
 *  - Days before `today` use actual rows only; from `today` on, planned receipts (Rencana) and orders (Order) are
 *    added — the same split as the v1 O_Stok projection, so the per-key closing of every day equals O_Stok.
 */
import { D, Decimal, ZERO, div, max, sum, type Num } from "./decimal";
import { addDays, diffDays, type ISODate } from "./dates";
import { prepare } from "./prepare";
import type { WeekInputs } from "./types";

export type LotForm = "fresh" | "frozen";
export type LotOrigin = "batch" | "trading" | "opening" | "conversion";
export type MovementType = "in" | "out_sale" | "out_blast" | "in_blast" | "adjust" | "transfer" | "writedown";

export interface LedgerKeyInfo {
  key: string;
  form: LotForm;
  group_code?: string | null;
  fresh_window_hours?: number | null;
  frozen_age_limit_days?: number | null;
  /** Key a fresh lot becomes when it is blasted (RPA|Karkas|Fresh → RPA|Karkas|Frozen). */
  frozen_key?: string | null;
}

export interface LedgerOpening { ref: string; item_code: string | null; key: string | null; kg: Num | null; value: Num | null; avg_age_days: Num | null }
export interface LedgerReceipt {
  ref: string; date: ISODate | null; status: string | null; source: string | null; item_code: string | null; key: string | null;
  kg: Num | null; unit_cost: Num | null; document_ref?: string | null;
  /** Specific cost per kg of the batch × key from M1 (posted allocation); null = GRN unit cost. */
  cost_per_kg_si?: Num | null;
}
export interface LedgerSale { ref: string; date: ISODate | null; status: string | null; item_code: string | null; key: string | null; kg: Num | null; hpp_actual?: Num | null; document_ref?: string | null }
export interface LedgerAllocation { sales_ref: string; lot_ref: string; kg: Num }
export interface LedgerBlast { ref: string; date: ISODate; lot_ref: string; kg: Num; to_key?: string | null }
export interface LedgerAdjustment { ref: string; date: ISODate; lot_ref?: string | null; key: string; item_code?: string | null; kg: Num; cost_per_kg?: Num | null; note?: string | null }

export interface LedgerParams {
  blastCostPerKg: Num;
  defaultFreshWindowHours: number;
  defaultFrozenAgeLimitDays: number;
}

export interface LedgerInputs {
  /** Opening date: the opening-stock rows are the balance at the start of this day. */
  startDate: ISODate;
  /** First projected day (the outlook's update date). */
  today: ISODate;
  opening: LedgerOpening[];
  receipts: LedgerReceipt[];
  sales: LedgerSale[];
  allocations?: LedgerAllocation[];
  blasts?: LedgerBlast[];
  adjustments?: LedgerAdjustment[];
  keys: LedgerKeyInfo[];
  params: LedgerParams;
}

export interface LedgerLot {
  ref: string;
  key: string;
  item_code: string | null;
  form: LotForm;
  origin: LotOrigin;
  origin_date: ISODate;
  parent_ref: string | null;
  batch_ref: string | null;
  kg_in: Decimal;
  /** Specific cost of the lot (M1 allocation when posted, else the GRN cost). */
  cost_in: Decimal;
  cost_per_kg_si: Decimal;
  /** Book cost per kg (Accurate GRN / stock-card value): what enters the moving average. */
  cost_per_kg_book: Decimal;
  assumed: boolean;
  planned: boolean;
  note: string | null;
}

export interface LedgerMovement {
  ref: string;
  lot_ref: string;
  date: ISODate;
  type: MovementType;
  kg: Decimal;
  /** Specific identification (lot cost/kg). Signed like kg. */
  cost_si: Decimal;
  /** Moving average per item at the moment of the movement. Signed like kg. */
  cost_ma: Decimal;
  ref_table: string;
  ref_id: string;
  document_ref: string | null;
  sales_ref: string | null;
  assumed: boolean;
  planned: boolean;
}

export interface LedgerResult {
  startDate: ISODate;
  today: ISODate;
  lots: LedgerLot[];
  movements: LedgerMovement[];
  /** Per outflow (actual sales): the MA cost per kg the ledger charged, next to the Accurate HPP per kg. */
  saleCosts: { sales_ref: string; date: ISODate; item_code: string | null; key: string; kg: Decimal; maPerKg: Decimal; hppPerKg: Decimal | null; assumed: boolean }[];
  issues: string[];
}

const UNKNOWN_KEY = "?";

const isPlannedReceipt = (s: string | null) => s === "Rencana";
const isPlannedSale = (s: string | null) => s === "Order";

/** Order of movements inside one day: stock in first (opening, receipts, conversions), then adjustments, then out. */
const DAY_ORDER: Record<MovementType, number> = { in: 0, in_blast: 1, transfer: 2, adjust: 3, writedown: 4, out_blast: 5, out_sale: 6 };

interface Ev {
  date: ISODate;
  order: number;
  seq: number;
  kind: "lot" | "sale" | "blast" | "adjust";
  lot?: LedgerLot;
  sale?: LedgerSale;
  blast?: LedgerBlast;
  adj?: LedgerAdjustment;
  planned: boolean;
}

/** Fresh → frozen key by convention Segment|SKU|Fresh → Segment|SKU|Frozen, unless the master names one. */
export function frozenKeyOf(key: string, info?: LedgerKeyInfo): string {
  if (info?.frozen_key) return info.frozen_key;
  return key.endsWith("|Fresh") ? key.slice(0, -"|Fresh".length) + "|Frozen" : key;
}

export function formOfKey(key: string): LotForm {
  return key.endsWith("|Fresh") ? "fresh" : "frozen";
}

export function computeLedger(x: LedgerInputs): LedgerResult {
  const issues: string[] = [];
  const keyInfo = new Map(x.keys.map((k) => [k.key, k]));
  const lots: LedgerLot[] = [];
  const evs: Ev[] = [];
  let seq = 0;
  const keyOf = (k: string | null) => k ?? UNKNOWN_KEY;
  const form = (k: string) => keyInfo.get(k)?.form ?? formOfKey(k);

  for (const o of x.opening) {
    const kg = D(o.kg);
    if (kg.isZero() && D(o.value).isZero()) continue;
    const key = keyOf(o.key);
    const age = Math.round(D(o.avg_age_days).toNumber());
    const lot: LedgerLot = {
      ref: `opening:${o.ref}`, key, item_code: o.item_code, form: form(key), origin: "opening", origin_date: addDays(x.startDate, -age),
      parent_ref: null, batch_ref: null, kg_in: kg, cost_in: D(o.value), cost_per_kg_si: div(D(o.value), kg), cost_per_kg_book: div(D(o.value), kg), assumed: true, planned: false,
      note: "stok awal (kartu stok Accurate) — lot diduga",
    };
    lots.push(lot);
    evs.push({ date: x.startDate, order: -1, seq: seq++, kind: "lot", lot, planned: false });
  }
  for (const r of x.receipts) {
    if (!r.date || r.date < x.startDate) continue;
    const planned = isPlannedReceipt(r.status);
    if (planned && r.date < x.today) continue; // past-dated plan: not stock (v1 ignores it in the projection)
    const key = keyOf(r.key);
    const kg = D(r.kg);
    const book = D(r.unit_cost);
    const perKg = r.cost_per_kg_si !== null && r.cost_per_kg_si !== undefined && r.cost_per_kg_si !== "" ? D(r.cost_per_kg_si) : book;
    const lot: LedgerLot = {
      ref: `receipt:${r.ref}`, key, item_code: r.item_code, form: form(key), origin: r.source === "Beli Trading" ? "trading" : "batch",
      origin_date: r.date, parent_ref: null, batch_ref: r.source === "Produksi RPA" ? (r.document_ref ?? null) : null,
      kg_in: kg, cost_in: kg.times(perKg), cost_per_kg_si: perKg, cost_per_kg_book: book, assumed: false, planned, note: planned ? "rencana terima" : null,
    };
    lots.push(lot);
    evs.push({ date: r.date, order: DAY_ORDER.in, seq: seq++, kind: "lot", lot, planned });
  }
  for (const s of x.sales) {
    if (!s.date || s.date < x.startDate) continue;
    const planned = isPlannedSale(s.status);
    if (planned && s.date < x.today) continue;
    evs.push({ date: s.date, order: DAY_ORDER.out_sale, seq: seq++, kind: "sale", sale: s, planned });
  }
  for (const b of x.blasts ?? []) evs.push({ date: b.date, order: DAY_ORDER.out_blast, seq: seq++, kind: "blast", blast: b, planned: false });
  for (const a of x.adjustments ?? []) evs.push({ date: a.date, order: DAY_ORDER.adjust, seq: seq++, kind: "adjust", adj: a, planned: false });
  // actual rows of a day before planned rows of that day, then the fixed day order, then input order
  evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.planned === b.planned ? 0 : a.planned ? 1 : -1) || a.order - b.order || a.seq - b.seq));

  const lotBy = new Map<string, LedgerLot>();
  const remain = new Map<string, Decimal>();
  const byItem = new Map<string, LedgerLot[]>();
  const byKey = new Map<string, LedgerLot[]>();
  // moving average per item (or per key for rows without item code)
  const maBal = new Map<string, { kg: Decimal; cost: Decimal }>();
  const maKey = (item: string | null, key: string) => (item ? `item:${item.toUpperCase()}` : `key:${key}`);
  const movements: LedgerMovement[] = [];
  const saleCosts: LedgerResult["saleCosts"] = [];
  const explicit = new Map<string, LedgerAllocation[]>();
  for (const a of x.allocations ?? []) explicit.set(a.sales_ref, [...(explicit.get(a.sales_ref) ?? []), a]);

  const addLot = (lot: LedgerLot) => {
    lotBy.set(lot.ref, lot);
    remain.set(lot.ref, ZERO);
    if (lot.item_code) byItem.set(lot.item_code.toUpperCase(), [...(byItem.get(lot.item_code.toUpperCase()) ?? []), lot]);
    byKey.set(lot.key, [...(byKey.get(lot.key) ?? []), lot]);
  };
  const ma = (mk: string) => maBal.get(mk) ?? { kg: ZERO, cost: ZERO };
  const maPerKg = (mk: string) => {
    const b = ma(mk);
    return b.kg.gt(0) ? b.cost.div(b.kg) : ZERO;
  };
  const refsUsed = new Map<string, number>();
  const move = (lot: LedgerLot, date: ISODate, type: MovementType, kg: Decimal, costSi: Decimal, refTable: string, refId: string, extra: Partial<LedgerMovement> & { costMaIn?: Decimal } = {}) => {
    const mk = maKey(lot.item_code, lot.key);
    const b = ma(mk);
    let costMa: Decimal;
    const { costMaIn, ...rest } = extra;
    if (kg.gt(0)) {
      costMa = costMaIn ?? kg.times(lot.cost_per_kg_book); // stock in enters the average at its book (GRN) cost
      maBal.set(mk, { kg: b.kg.plus(kg), cost: b.cost.plus(costMa) });
    } else {
      const per = b.kg.gt(0) ? b.cost.div(b.kg) : lot.cost_per_kg_si;
      costMa = kg.times(per);
      const nk = b.kg.plus(kg);
      maBal.set(mk, { kg: nk, cost: nk.isZero() ? ZERO : b.cost.plus(costMa) });
    }
    remain.set(lot.ref, (remain.get(lot.ref) ?? ZERO).plus(kg));
    // stable reference (the data mart upserts on it): type + source row + lot, numbered only on a repeat
    const base = `${type}:${refTable}:${refId}:${lot.ref}`;
    const n = (refsUsed.get(base) ?? 0) + 1;
    refsUsed.set(base, n);
    const m: LedgerMovement = {
      ref: n === 1 ? base : `${base}#${n}`, lot_ref: lot.ref, date, type, kg, cost_si: costSi, cost_ma: costMa, ref_table: refTable, ref_id: refId,
      document_ref: null, sales_ref: null, assumed: false, planned: lot.planned, ...rest,
    };
    movements.push(m);
    return m;
  };
  const deficitLot = (key: string, item: string | null, date: ISODate): LedgerLot => {
    const ref = `deficit:${item ?? key}`;
    let lot = lotBy.get(ref);
    if (!lot) {
      lot = { ref, key, item_code: item, form: form(key), origin: "opening", origin_date: date, parent_ref: null, batch_ref: null,
        kg_in: ZERO, cost_in: ZERO, cost_per_kg_si: ZERO, cost_per_kg_book: ZERO, assumed: true, planned: false, note: "keluar melebihi stok (stok negatif)" };
      lots.push(lot);
      addLot(lot);
      issues.push(`${item ?? key}: keluar melebihi stok mulai ${date}`);
    }
    return lot;
  };
  /**
   * FIFO candidates, oldest first, available on the date. Q11: Accurate keeps stock per item, so a DO takes the lots
   * of its own item; the key's other lots are used only when the item never had a lot (no item code / item unknown).
   * An item that runs short goes negative on its deficit lot, as it does in Accurate.
   */
  const fifo = (item: string | null, key: string, date: ISODate, planned: boolean): LedgerLot[] => {
    const own = item ? (byItem.get(item.toUpperCase()) ?? []).filter((l) => l.key === key) : [];
    const pool = own;
    const rest = own.length ? [] : (byKey.get(key) ?? []);
    const ok = (l: LedgerLot) => l.origin_date <= date && (planned || !l.planned) && (remain.get(l.ref) ?? ZERO).gt(0);
    const order = (a: LedgerLot, b: LedgerLot) => (a.origin_date < b.origin_date ? -1 : a.origin_date > b.origin_date ? 1 : 0);
    return [...pool.filter(ok).sort(order), ...rest.filter(ok).sort(order)];
  };

  for (const e of evs) {
    if (e.kind === "lot") {
      addLot(e.lot!);
      const l = e.lot!;
      if (l.kg_in.isZero()) continue;
      move(l, e.date, "in", l.kg_in, l.cost_in, l.origin === "opening" ? "opening_stock" : "receipt_line", l.ref.split(":")[1], { assumed: l.assumed });
      continue;
    }
    if (e.kind === "sale") {
      const s = e.sale!;
      const key = keyOf(s.key);
      let left = D(s.kg);
      if (left.isZero()) continue;
      const hppPerKg = s.hpp_actual === null || s.hpp_actual === undefined || s.hpp_actual === "" ? null : div(D(s.hpp_actual), D(s.kg));
      let ma0: Decimal | null = null;
      const take = (lot: LedgerLot, kg: Decimal, assumed: boolean) => {
        const m = move(lot, s.date!, "out_sale", kg.neg(), kg.neg().times(lot.cost_per_kg_si), "sales_line", s.ref, { document_ref: s.document_ref ?? null, sales_ref: s.ref, assumed, planned: e.planned });
        if (ma0 === null && kg.gt(0)) ma0 = m.cost_ma.div(m.kg);
        left = left.minus(kg);
      };
      for (const a of explicit.get(s.ref) ?? []) {
        const lot = lotBy.get(a.lot_ref);
        if (!lot) { issues.push(`Alokasi ${s.ref}: lot ${a.lot_ref} tidak ada`); continue; }
        take(lot, D(a.kg), false);
      }
      if (left.gt(0)) {
        for (const lot of fifo(s.item_code, key, s.date!, e.planned)) {
          if (!left.gt(0)) break;
          const kg = Decimal.min(left, remain.get(lot.ref)!);
          take(lot, kg, true);
        }
      }
      if (left.gt(0)) take(deficitLot(key, s.item_code, s.date!), left, true);
      if (!e.planned) saleCosts.push({ sales_ref: s.ref, date: s.date!, item_code: s.item_code, key, kg: D(s.kg), maPerKg: ma0 ?? ZERO, hppPerKg, assumed: !(explicit.get(s.ref)?.length) });
      continue;
    }
    if (e.kind === "blast") {
      const b = e.blast!;
      const from = lotBy.get(b.lot_ref);
      if (!from) { issues.push(`Blast ${b.ref}: lot ${b.lot_ref} tidak ada`); continue; }
      const kg = D(b.kg);
      const out = move(from, b.date, "out_blast", kg.neg(), kg.neg().times(from.cost_per_kg_si), "blast_event", b.ref);
      const toKey = b.to_key ?? frozenKeyOf(from.key, keyInfo.get(from.key));
      const cost = kg.times(from.cost_per_kg_si).plus(kg.times(D(x.params.blastCostPerKg)));
      const lot: LedgerLot = {
        ref: `blast:${b.ref}`, key: toKey, item_code: null, form: "frozen", origin: "conversion", origin_date: b.date, parent_ref: from.ref,
        batch_ref: from.batch_ref, kg_in: kg, cost_in: cost, cost_per_kg_si: div(cost, kg),
        cost_per_kg_book: div(out.cost_ma.neg().plus(kg.times(D(x.params.blastCostPerKg))), kg), assumed: false, planned: false, note: `blast dari ${from.key}`,
      };
      lots.push(lot);
      addLot(lot);
      // the frozen lot enters the average of its key at the fresh lot's MA value + the blast cost
      move(lot, b.date, "in_blast", kg, cost, "blast_event", b.ref);
      continue;
    }
    if (e.kind === "adjust") {
      const a = e.adj!;
      const kg = D(a.kg);
      let lot = a.lot_ref ? lotBy.get(a.lot_ref) : undefined;
      if (!lot && kg.lt(0)) lot = fifo(a.item_code ?? null, a.key, a.date, false)[0];
      if (!lot) {
        const per = a.cost_per_kg !== null && a.cost_per_kg !== undefined ? D(a.cost_per_kg) : maPerKg(maKey(a.item_code ?? null, a.key));
        lot = { ref: `adjust:${a.ref}`, key: a.key, item_code: a.item_code ?? null, form: form(a.key), origin: "opening", origin_date: a.date, parent_ref: null,
          batch_ref: null, kg_in: ZERO, cost_in: ZERO, cost_per_kg_si: per, cost_per_kg_book: per, assumed: true, planned: false, note: a.note ?? "penyesuaian opname" };
        lots.push(lot);
        addLot(lot);
      }
      move(lot, a.date, "adjust", kg, kg.times(lot.cost_per_kg_si), "lot_movement", a.ref, { assumed: false, costMaIn: kg.gt(0) ? kg.times(lot.cost_per_kg_book) : undefined });
    }
  }
  return { startDate: x.startDate, today: x.today, lots, movements, saleCosts, issues };
}

export interface LotBalance {
  date: ISODate;
  lot_ref: string;
  key: string;
  form: LotForm;
  kg: Decimal;
  cost_si: Decimal;
  cost_per_kg_si: Decimal | null;
  cost_ma: Decimal;
  cost_per_kg_ma: Decimal | null;
  age_days: number;
  hours_to_cutoff: number | null;
  reserved_kg: Decimal;
  free_kg: Decimal;
  over_age: boolean;
}

export interface KeyBalance {
  date: ISODate;
  key: string;
  group_code: string | null;
  form: LotForm;
  kg: Decimal;
  free_kg: Decimal;
  reserved_kg: Decimal;
  cost_ma: Decimal;
  cost_per_kg_ma: Decimal | null;
  cost_si: Decimal;
  cost_per_kg_si: Decimal | null;
  oldest_age_days: number | null;
  over_age_kg: Decimal;
  lots: number;
}

export interface BalanceResult {
  date: ISODate;
  perLot: LotBalance[];
  perKey: KeyBalance[];
  totalKg: Decimal;
  totalCostMa: Decimal;
  totalCostSi: Decimal;
}

const EPS = new Decimal("0.005");

/**
 * Balance at the end of `date`. Movements dated after `date` that are planned outflows are the lot's reserved kg
 * (orders not delivered yet). MA value of a lot = kg × running MA of its item at the end of the day.
 */
export function balanceAt(r: LedgerResult, date: ISODate, keys: LedgerKeyInfo[], params: LedgerParams): BalanceResult {
  const info = new Map(keys.map((k) => [k.key, k]));
  const kg = new Map<string, Decimal>();
  const si = new Map<string, Decimal>();
  const reserved = new Map<string, Decimal>();
  const ma = new Map<string, { kg: Decimal; cost: Decimal }>();
  const lotBy = new Map(r.lots.map((l) => [l.ref, l]));
  const mk = (l: LedgerLot) => (l.item_code ? `item:${l.item_code.toUpperCase()}` : `key:${l.key}`);
  for (const m of r.movements) {
    const lot = lotBy.get(m.lot_ref)!;
    if (m.date <= date) {
      kg.set(m.lot_ref, (kg.get(m.lot_ref) ?? ZERO).plus(m.kg));
      si.set(m.lot_ref, (si.get(m.lot_ref) ?? ZERO).plus(m.cost_si));
      const b = ma.get(mk(lot)) ?? { kg: ZERO, cost: ZERO };
      ma.set(mk(lot), { kg: b.kg.plus(m.kg), cost: b.cost.plus(m.cost_ma) });
    } else if (m.planned && m.type === "out_sale") {
      reserved.set(m.lot_ref, (reserved.get(m.lot_ref) ?? ZERO).plus(m.kg.neg()));
    }
  }
  const perLot: LotBalance[] = [];
  for (const lot of r.lots) {
    const q = kg.get(lot.ref) ?? ZERO;
    const res = reserved.get(lot.ref) ?? ZERO;
    if (q.abs().lt(EPS) && res.isZero()) continue;
    if (lot.origin_date > date) continue;
    const b = ma.get(mk(lot)) ?? { kg: ZERO, cost: ZERO };
    const maPer = b.kg.abs().gt(EPS) ? b.cost.div(b.kg) : lot.cost_per_kg_si;
    const age = diffDays(date, lot.origin_date);
    const ki = info.get(lot.key);
    const window = ki?.fresh_window_hours ?? params.defaultFreshWindowHours;
    const limit = ki?.frozen_age_limit_days ?? params.defaultFrozenAgeLimitDays;
    const hours = lot.form === "fresh" ? window - age * 24 : null;
    const costSi = si.get(lot.ref) ?? ZERO;
    perLot.push({
      date, lot_ref: lot.ref, key: lot.key, form: lot.form, kg: q, cost_si: costSi, cost_per_kg_si: q.abs().gt(EPS) ? costSi.div(q) : null,
      cost_ma: q.times(maPer), cost_per_kg_ma: q.abs().gt(EPS) ? maPer : null, age_days: age, hours_to_cutoff: hours,
      reserved_kg: res, free_kg: max(ZERO, q.minus(res)), over_age: lot.form === "fresh" ? age * 24 > window : age > limit,
    });
  }
  const keysOut = new Map<string, KeyBalance>();
  for (const l of perLot) {
    const ki = info.get(l.key);
    const a = keysOut.get(l.key) ?? {
      date, key: l.key, group_code: ki?.group_code ?? null, form: l.form, kg: ZERO, free_kg: ZERO, reserved_kg: ZERO, cost_ma: ZERO,
      cost_per_kg_ma: null, cost_si: ZERO, cost_per_kg_si: null, oldest_age_days: null, over_age_kg: ZERO, lots: 0,
    };
    a.kg = a.kg.plus(l.kg); a.free_kg = a.free_kg.plus(l.free_kg); a.reserved_kg = a.reserved_kg.plus(l.reserved_kg);
    a.cost_ma = a.cost_ma.plus(l.cost_ma); a.cost_si = a.cost_si.plus(l.cost_si);
    if (l.kg.gt(EPS)) {
      a.lots++;
      a.oldest_age_days = a.oldest_age_days === null ? l.age_days : Math.max(a.oldest_age_days, l.age_days);
      if (l.over_age) a.over_age_kg = a.over_age_kg.plus(l.kg);
    }
    keysOut.set(l.key, a);
  }
  const perKey = [...keysOut.values()].map((k) => ({
    ...k, cost_per_kg_ma: k.kg.abs().gt(EPS) ? k.cost_ma.div(k.kg) : null, cost_per_kg_si: k.kg.abs().gt(EPS) ? k.cost_si.div(k.kg) : null,
  })).sort((a, b) => a.key.localeCompare(b.key));
  return {
    date, perLot, perKey, totalKg: sum(perKey.map((k) => k.kg)), totalCostMa: sum(perKey.map((k) => k.cost_ma)), totalCostSi: sum(perKey.map((k) => k.cost_si)),
  };
}

export interface StockCardRow { item_code: string; key: string | null; kg: Num; value?: Num | null }

/** C25–C27 inputs: assumed share of outflows, ledger kg vs Accurate stock card per key, MA value vs balance sheet. */
export function reconcile(x: {
  ledger: LedgerResult;
  balance: BalanceResult;
  stockCard: StockCardRow[] | null;
  bsInventory: Num | null;
  reconcilingItems?: { label: string; amount: Num }[];
}): {
  assumedPct: Decimal | null;
  assumedKg: Decimal;
  outKg: Decimal;
  cardDiffs: { key: string; ledgerKg: Decimal; cardKg: Decimal; diff: Decimal }[];
  bsDiff: Decimal | null;
  reconciling: Decimal;
} {
  const outs = x.ledger.movements.filter((m) => m.type === "out_sale" && !m.planned && m.date <= x.balance.date);
  const outKg = sum(outs.map((m) => m.kg.abs()));
  const assumedKg = sum(outs.filter((m) => m.assumed).map((m) => m.kg.abs()));
  let cardDiffs: { key: string; ledgerKg: Decimal; cardKg: Decimal; diff: Decimal }[] = [];
  if (x.stockCard) {
    const card = new Map<string, Decimal>();
    for (const c of x.stockCard) card.set(c.key ?? UNKNOWN_KEY, (card.get(c.key ?? UNKNOWN_KEY) ?? ZERO).plus(D(c.kg)));
    const keys = new Set([...card.keys(), ...x.balance.perKey.map((k) => k.key)]);
    cardDiffs = [...keys].sort().map((key) => {
      const ledgerKg = x.balance.perKey.find((k) => k.key === key)?.kg ?? ZERO;
      const cardKg = card.get(key) ?? ZERO;
      return { key, ledgerKg, cardKg, diff: ledgerKg.minus(cardKg) };
    });
  }
  const reconciling = sum((x.reconcilingItems ?? []).map((i) => D(i.amount)));
  const bsDiff = x.bsInventory === null || x.bsInventory === undefined || x.bsInventory === "" ? null : x.balance.totalCostMa.minus(D(x.bsInventory)).minus(reconciling);
  return { assumedPct: outKg.isZero() ? null : assumedKg.div(outKg), assumedKg, outKg, cardDiffs, bsDiff, reconciling };
}

/**
 * Ledger inputs for one week from the v1 week inputs, with the v1 key resolution (prepare) and the v1 "counted"
 * rows: actual rows of the week, plans and orders from the update date to the week end.
 */
export function ledgerInputsFromWeek(inputs: WeekInputs, extra: Partial<Pick<LedgerInputs, "allocations" | "blasts" | "adjustments">> & { params?: Partial<LedgerParams>; keyInfo?: Partial<LedgerKeyInfo>[] } = {}): LedgerInputs {
  const p = prepare(inputs);
  const info = new Map((extra.keyInfo ?? []).filter((k) => k.key).map((k) => [k.key!, k]));
  return {
    startDate: p.weekStart,
    today: p.today,
    opening: p.opening.map((o) => ({ ref: o.src.id ?? `row${o.src.row ?? o.idx}`, item_code: o.src.item_code ?? null, key: o.key, kg: o.kg, value: o.value, avg_age_days: o.age })),
    receipts: p.receipts.filter((r) => r.counted).map((r) => ({
      ref: r.src.id ?? `row${r.src.row ?? r.idx}`, date: r.date, status: r.status, source: r.source, item_code: r.src.item_code ?? null, key: r.key,
      kg: r.kg, unit_cost: r.unitCost, document_ref: r.src.document_ref ?? null,
    })),
    sales: p.sales.filter((s) => s.counted).map((s) => ({
      ref: s.src.id ?? `row${s.src.row ?? s.idx}`, date: s.date, status: s.status, item_code: s.src.item_code ?? null, key: s.key, kg: s.kg,
      hpp_actual: s.hppActual, document_ref: s.src.document_ref ?? null,
    })),
    allocations: extra.allocations, blasts: extra.blasts, adjustments: extra.adjustments,
    keys: inputs.sku_keys.map((k) => ({ key: k.key, form: formOfKey(k.key), ...info.get(k.key) })),
    params: { blastCostPerKg: 0, defaultFreshWindowHours: 48, defaultFrozenAgeLimitDays: 30, ...extra.params },
  };
}

/** The v1 key rule (prepare.ts keyOf): key_manual, else item_map by trimmed upper-case code, else "KODE BARU"; no code → "". */
export function keyResolver(itemMap: { item_code: string | null; key: string }[]): (keyManual: string | null | undefined, itemCode: string | null | undefined) => string {
  const norm = (s: string) => s.trim().toUpperCase();
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const m = new Map<string, string>();
  for (const it of itemMap) if (!blank(it.item_code) && !m.has(norm(String(it.item_code)))) m.set(norm(String(it.item_code)), it.key);
  return (keyManual, itemCode) => {
    if (!blank(keyManual)) return String(keyManual);
    if (blank(itemCode)) return "";
    return m.get(norm(String(itemCode))) ?? "KODE BARU";
  };
}
