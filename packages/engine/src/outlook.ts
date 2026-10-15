/** PRD §5.2–5.5 — O_Outlook blocks 1–7. */
import { D, Decimal, ONE, ZERO, div, max, min } from "./decimal";
import { addDays, weekDays, type ISODate } from "./dates";
import { fixed, pct } from "./format";
import type { BatchP, Prepared } from "./prepare";
import type { SalesValued, StockResult } from "./stock";

/* ------------------------------------------------------------------ Block 1 */

export interface SummaryRow {
  segment: "RPA" | "Trading" | "TOTAL KGR";
  kgActual: Decimal;
  revenueActual: Decimal;
  gpActual: Decimal;
  kgOrder: Decimal;
  revenueOrder: Decimal;
  gpOrder: Decimal;
  kgProjection: Decimal;
  revenueProjection: Decimal;
  gpProjection: Decimal;
  gpPerKg: Decimal;
  gpPct: Decimal;
  gpPerKgLastWeek: Decimal;
  deltaGpPerKg: Decimal;
}

export function weekSummary(p: Prepared, sales: SalesValued[]): SummaryRow[] {
  const agg = (seg: string, status: string) => {
    const xs = sales.filter((s) => s.counted && s.segment === seg && s.status === status);
    return {
      kg: xs.reduce((a, s) => a.plus(s.kg), ZERO),
      rev: xs.reduce((a, s) => a.plus(s.value), ZERO),
      gp: xs.reduce((a, s) => a.plus(s.gp), ZERO),
    };
  };
  const build = (
    segment: SummaryRow["segment"],
    a: { kg: Decimal; rev: Decimal; gp: Decimal },
    o: { kg: Decimal; rev: Decimal; gp: Decimal },
    last: { kg: Decimal; gp: Decimal },
  ): SummaryRow => {
    const kgP = a.kg.plus(o.kg);
    const revP = a.rev.plus(o.rev);
    const gpP = a.gp.plus(o.gp);
    const gpPerKg = div(gpP, kgP);
    const lastPerKg = div(last.gp, last.kg);
    return {
      segment, kgActual: a.kg, revenueActual: a.rev, gpActual: a.gp, kgOrder: o.kg, revenueOrder: o.rev,
      gpOrder: o.gp, kgProjection: kgP, revenueProjection: revP, gpProjection: gpP, gpPerKg,
      gpPct: div(gpP, revP), gpPerKgLastWeek: lastPerKg, deltaGpPerKg: gpPerKg.minus(lastPerKg),
    };
  };
  const lw = p.params.lastWeek;
  const rA = agg("RPA", "Aktual"), rO = agg("RPA", "Order");
  const tA = agg("Trading", "Aktual"), tO = agg("Trading", "Order");
  const add = (x: typeof rA, y: typeof rA) => ({ kg: x.kg.plus(y.kg), rev: x.rev.plus(y.rev), gp: x.gp.plus(y.gp) });
  return [
    build("RPA", rA, rO, lw.RPA),
    build("Trading", tA, tO, lw.Trading),
    build("TOTAL KGR", add(rA, tA), add(rO, tO), { kg: lw.RPA.kg.plus(lw.Trading.kg), gp: lw.RPA.gp.plus(lw.Trading.gp) }),
  ];
}

/* ------------------------------------------------------------------ Block 2 */

export type RpaRecommendationCode = "TUNDA / NEGOSIASI" | "KURANGI" | "POTONG HANYA SESUAI ORDER" | "LANJUT";

/** Management View v2 R4: the recommendation as one action from {TUNDA, NEGOSIASI ≤ Rp X, BELI, POTONG N kg}. */
export type RpaActionKind = "TUNDA" | "NEGOSIASI" | "BELI" | "POTONG";

export interface RpaAction {
  kind: RpaActionKind;
  /** NEGOSIASI: highest live-bird price that still breaks even on today's cutting plan (B21). */
  targetPrice: Decimal | null;
  /** POTONG: kg live bird to cut. */
  kg: Decimal | null;
  /** `[AKSI]: [alasan satu klausa]` */
  text: string;
}

export interface RpaDecision {
  /** B12 */ lbPriceToday: Decimal;
  /** B13 */ freshOrdersInHorizon: Decimal;
  /** B14 */ freshStockToday: Decimal;
  /** B15 */ netFreshNeed: Decimal;
  /** B16 */ lbMaxWithoutFrozen: Decimal;
  /** B17 */ lbPlannedInHorizon: Decimal;
  /** B18 */ karkasAtRiskOfFreezing: Decimal;
  /** B19 */ freshShareOfPlan: Decimal;
  /** B20 */ valuePerKgLbAtPlanShare: Decimal;
  /** B21 */ breakevenAtPlanShare: Decimal;
  /** B22 */ breakevenAt100Fresh: Decimal;
  /** B23 */ marginPerKgLb: Decimal;
  /** B24 */ expectedMarginOfPlan: Decimal;
  /** B25 */ frozenPriceGap: Decimal;
  /** B26 */ recommendation: RpaRecommendationCode;
  recommendationText: string;
  /** The same recommendation as a single action (R4); reads only the figures above. */
  action: RpaAction;
  horizonFrom: ISODate;
  horizonTo: ISODate;
  yieldsUsed: "aktual" | "default";
}

/** V(f) = (1 − s)[y_k (f P_f + (1 − f) P_z) + Σ y_i P_i] */
export function valuePerKgLb(p: Prepared, f: Decimal): Decimal {
  const y = p.yields;
  const pr = p.prices;
  const karkasPrice = f.times(pr.karkasFresh).plus(ONE.minus(f).times(pr.karkasFrozen));
  const byProducts = y.kepala.times(pr.kepala)
    .plus(y.ceker.times(pr.ceker))
    .plus(y.usus.times(pr.usus))
    .plus(y.hja.times(pr.hja))
    .plus(y.lemak.times(pr.lemak));
  return ONE.minus(p.params.shrink).times(y.karkas.times(karkasPrice).plus(byProducts));
}

export function breakevenLb(p: Prepared, f: Decimal): Decimal {
  const s = p.params.shrink;
  return valuePerKgLb(p, f).minus(p.params.freight).minus(p.params.maklon.times(ONE.minus(s)));
}

export function rpaDecision(p: Prepared, stock: StockResult): RpaDecision {
  const s = p.params.shrink;
  const yk = p.yields.karkas;
  const H = p.params.horizon;
  const from = p.today;
  const to = addDays(p.today, H - 1);
  const FRESH = "RPA|KARKAS|FRESH";

  const fresh = p.sales
    .filter((x) => x.key.trim().toUpperCase() === FRESH && x.status === "Order" && x.date !== null && x.date >= from && x.date <= to)
    .reduce((a, x) => a.plus(x.kg), ZERO);
  const stockFresh = stock.byKey.get(FRESH)?.stockToday ?? ZERO;
  const net = max(ZERO, fresh.minus(stockFresh));
  const perLb = ONE.minus(s).times(yk);
  const lbMax = perLb.isZero() ? ZERO : net.div(perLb);
  const planned = p.batches
    .filter((b) => b.status === "Rencana" && b.date !== null && b.date >= from && b.date <= to)
    .reduce((a, b) => a.plus(b.lbKg), ZERO);
  const atRisk = max(ZERO, planned.minus(lbMax)).times(perLb);
  const f = planned.isZero() ? ONE : min(ONE, div(net, planned.times(perLb), ONE));
  const v = valuePerKgLb(p, f);
  const be = breakevenLb(p, f);
  const be100 = breakevenLb(p, ONE);
  const lb = p.params.lbPrice;
  const margin = be.minus(lb);

  let code: RpaRecommendationCode;
  let text: string;
  if (lb.greaterThan(be100)) {
    code = "TUNDA / NEGOSIASI";
    text = `TUNDA / NEGOSIASI: harga LB ${fixed(lb)} di atas breakeven 100% fresh ${fixed(be100)} — setiap kg LB rugi walau semua karkas laku fresh`;
  } else if (planned.greaterThan(lbMax.plus(0.5))) {
    code = "KURANGI";
    text = `KURANGI potong ke maksimum ${fixed(lbMax)} kg LB (rencana ${fixed(planned)} kg) supaya karkas tidak jadi frozen`;
  } else if (margin.lessThan(0)) {
    code = "POTONG HANYA SESUAI ORDER";
    text = `POTONG HANYA SESUAI ORDER: margin per kg LB negatif (${fixed(margin)})`;
  } else {
    code = "LANJUT";
    text = "LANJUT sesuai rencana: harga LB di bawah breakeven dan kebutuhan fresh tertutup";
  }

  return {
    lbPriceToday: lb, freshOrdersInHorizon: fresh, freshStockToday: stockFresh, netFreshNeed: net,
    lbMaxWithoutFrozen: lbMax, lbPlannedInHorizon: planned, karkasAtRiskOfFreezing: atRisk, freshShareOfPlan: f,
    valuePerKgLbAtPlanShare: v, breakevenAtPlanShare: be, breakevenAt100Fresh: be100, marginPerKgLb: margin,
    expectedMarginOfPlan: margin.times(planned), frozenPriceGap: atRisk.times(p.prices.karkasFresh.minus(p.prices.karkasFrozen)),
    recommendation: code, recommendationText: text, action: rpaAction(code, lb, be, lbMax, planned), horizonFrom: from, horizonTo: to,
    yieldsUsed: p.yieldsActual ? "aktual" : "default",
  };
}

/**
 * R4 mapping of the Excel recommendation (B26) to one action. TUNDA / NEGOSIASI becomes NEGOSIASI with the
 * breakeven of today's cutting plan (B21) as the target price; TUNDA only when there is no positive target.
 * KURANGI and POTONG HANYA SESUAI ORDER cut the live bird that the fresh orders need (B16); LANJUT cuts the plan (B17).
 */
export function rpaAction(code: RpaRecommendationCode, lb: Decimal, breakevenPlan: Decimal, lbMax: Decimal, planned: Decimal): RpaAction {
  switch (code) {
    case "TUNDA / NEGOSIASI":
      return breakevenPlan.greaterThan(0)
        ? { kind: "NEGOSIASI", targetPrice: breakevenPlan, kg: null,
            text: `NEGOSIASI ≤ Rp ${fixed(breakevenPlan)}: harga live bird hari ini Rp ${fixed(lb)} di atas breakeven rencana potong` }
        : { kind: "TUNDA", targetPrice: null, kg: null, text: "TUNDA: harga live bird di atas breakeven dan tidak ada harga target" };
    case "KURANGI":
      return { kind: "POTONG", targetPrice: null, kg: lbMax,
        text: `POTONG ${fixed(lbMax)} kg LB: rencana ${fixed(planned)} kg melebihi kebutuhan karkas fresh` };
    case "POTONG HANYA SESUAI ORDER":
      return { kind: "POTONG", targetPrice: null, kg: lbMax,
        text: `POTONG ${fixed(lbMax)} kg LB: margin per kg live bird negatif, potong hanya untuk order` };
    case "LANJUT":
      return { kind: "POTONG", targetPrice: null, kg: planned,
        text: `POTONG ${fixed(planned)} kg LB: harga di bawah breakeven dan kebutuhan fresh tertutup` };
  }
}

/* ------------------------------------------------------------------ Block 3 */

export type TradingRecommendationCode = "BELI" | "BELI (isi harga)" | "TAHAN" | "JUAL STOK" | "CEK HARGA" | "Cukup" | "-";

export interface TradingRow {
  key: string;
  /** label as in O_Outlook column A: SKU|Form */
  label: string;
  /** B */ stockToday: Decimal;
  /** C */ ordersRestOfWeek: Decimal;
  /** D */ plannedReceipts: Decimal;
  /** E */ netNeed: Decimal;
  /** F */ sellPrice: Decimal;
  sellPriceFromOrders: boolean;
  /** G (null = kosong) */ buyPrice: Decimal | null;
  /** H (null = tidak dihitung) */ spread: Decimal | null;
  /** I */ spreadPct: Decimal | null;
  /** J */ avgStockCost: Decimal;
  /** K */ recommendation: TradingRecommendationCode;
  recommendationText: string;
}

export function tradingDecisions(p: Prepared, stock: StockResult): TradingRow[] {
  const rows: TradingRow[] = [];
  for (const m of p.master.filter((x) => x.segment === "Trading")) {
    const K = m.key.trim().toUpperCase();
    const st = stock.byKey.get(K);
    const B = st?.stockToday ?? ZERO;
    const C = st?.ordersRestOfWeek ?? ZERO;
    const Dp = p.receipts
      .filter((r) => r.key.trim().toUpperCase() === K && r.status === "Rencana" && r.date !== null && r.date >= p.today && r.date <= p.weekEnd)
      .reduce((a, r) => a.plus(r.kg), ZERO);
    const E = max(ZERO, C.minus(B).minus(Dp));
    const ords = p.sales.filter((x) => x.key.trim().toUpperCase() === K && x.status === "Order" && x.date !== null && x.date >= p.today);
    const ordKg = ords.reduce((a, x) => a.plus(x.kg), ZERO);
    const ordVal = ords.reduce((a, x) => a.plus(x.value), ZERO);
    const fromOrders = !ordKg.isZero();
    const F = fromOrders ? ordVal.div(ordKg) : m.refPrice ?? ZERO;
    const G = m.buyPrice;
    const H = G === null || G.isZero() || F.isZero() ? null : F.minus(G);
    const I = H === null ? null : H.div(F);
    const J = st?.avgCost ?? ZERO;

    let code: TradingRecommendationCode;
    let text: string;
    if (E.greaterThan(0.5)) {
      if (H === null) {
        code = "BELI (isi harga)";
        text = `BELI ${fixed(E)} kg — isi harga beli pengganti`;
      } else if (H.greaterThanOrEqualTo(p.params.minSpread)) {
        code = "BELI";
        text = `BELI ${fixed(E)} kg (spread ${fixed(H)}/kg)`;
      } else {
        code = "TAHAN";
        text = `TAHAN: spread ${fixed(H)}/kg di bawah minimum — naikkan harga jual atau cari pemasok`;
      }
    } else if (B.greaterThan(0.5) && C.lessThanOrEqualTo(0.5)) {
      code = "JUAL STOK";
      text = `JUAL STOK: ${fixed(B)} kg tanpa order`;
    } else if (C.greaterThan(0.5) && J.greaterThan(0) && F.lessThan(J)) {
      code = "CEK HARGA";
      text = `CEK HARGA: order ${fixed(F)}/kg di bawah biaya stok ${fixed(J)}/kg`;
    } else if (B.greaterThan(0.5)) {
      code = "Cukup";
      text = `Cukup — sisa ${fixed(B.minus(C).plus(Dp))} kg setelah order`;
    } else {
      code = "-";
      text = "-";
    }
    rows.push({
      key: m.key, label: `${m.sku}|${m.form}`, stockToday: B, ordersRestOfWeek: C, plannedReceipts: Dp, netNeed: E,
      sellPrice: F, sellPriceFromOrders: fromOrders, buyPrice: G, spread: H, spreadPct: I, avgStockCost: J,
      recommendation: code, recommendationText: text,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ Block 4 */

export interface StockActionRow {
  status: "KURANG" | "JUAL" | "PERHATIAN";
  label: string;
  keys: number;
  kgToday: Decimal;
  value: Decimal;
}

export function stockActions(stock: StockResult): StockActionRow[] {
  const labels = {
    KURANG: "KURANG (stok minus di minggu ini)",
    JUAL: "JUAL (tanpa order minggu ini)",
    PERHATIAN: "PERHATIAN (di atas batas umur)",
  } as const;
  return (["KURANG", "JUAL", "PERHATIAN"] as const).map((st) => {
    const xs = stock.rows.filter((r) => r.status === st);
    return {
      status: st, label: labels[st], keys: xs.length,
      kgToday: xs.reduce((a, r) => a.plus(r.stockToday), ZERO),
      value: xs.reduce((a, r) => a.plus(r.valueToday), ZERO),
    };
  });
}

/* ------------------------------------------------------------------ Block 5 */

export interface CashOutRow {
  date: ISODate;
  liveBird: Decimal;
  trading: Decimal;
  total: Decimal;
  basis: "aktual" | "rencana";
}

/**
 * Block 5 — cash out for live bird (batch LB value dated d − terms_lb, any status) and trading purchases
 * (counted Beli Trading receipts dated d − terms_trading), exactly as O_Outlook B50:C56.
 */
export function cashOut(p: Prepared): { rows: CashOutRow[]; total: CashOutRow } {
  const rows = weekDays(p.weekStart).map((d) => {
    const lbDate = addDays(d, -p.params.termsLb);
    const trDate = addDays(d, -p.params.termsTrading);
    const liveBird = p.batches.filter((b) => b.date === lbDate).reduce((a, b) => a.plus(b.lbValue), ZERO);
    const trading = p.receipts
      .filter((r) => r.source === "Beli Trading" && r.date === trDate && r.counted)
      .reduce((a, r) => a.plus(r.value), ZERO);
    return { date: d, liveBird, trading, total: liveBird.plus(trading), basis: (d < p.today ? "aktual" : "rencana") as CashOutRow["basis"] };
  });
  const total = rows.reduce(
    (a, r) => ({ ...a, liveBird: a.liveBird.plus(r.liveBird), trading: a.trading.plus(r.trading), total: a.total.plus(r.total) }),
    { date: "", liveBird: ZERO, trading: ZERO, total: ZERO, basis: "rencana" as const },
  );
  return { rows, total };
}

/* ------------------------------------------------------------------ Block 6 */

export interface BatchKpiRow {
  status: "Aktual" | "Rencana";
  batches: number;
  lbKg: Decimal;
  avgLbPrice: Decimal | null;
  shrink: Decimal | null;
  karkasYield: Decimal | null;
  freshPct: Decimal | null;
  margin: Decimal;
  marginPerKgLb: Decimal | null;
  costPerKgOutput: Decimal | null;
  valuePerKgOutput: Decimal | null;
  breakevenLb: Decimal | null;
}

export interface BatchKpi {
  rows: BatchKpiRow[];
  target: { shrink: Decimal; karkasYield: Decimal; breakevenLb100Fresh: Decimal };
}

export function batchKpi(p: Prepared, breakeven100: Decimal): BatchKpi {
  const rows = (["Aktual", "Rencana"] as const).map((st) => {
    const xs: BatchP[] = p.batches.filter((b) => b.status === st && b.date !== null && b.date >= p.weekStart && b.date <= p.weekEnd);
    const S = (f: (b: BatchP) => Decimal) => xs.reduce((a, b) => a.plus(f(b)), ZERO);
    const lb = S((b) => b.lbKg);
    const processed = S((b) => b.processedKg);
    const fresh = S((b) => b.out.karkas_fresh);
    const frozen = S((b) => b.out.karkas_frozen);
    const out = S((b) => b.outputKg);
    const value = S((b) => b.outputValue);
    const margin = S((b) => b.margin);
    const has = !lb.isZero();
    return {
      status: st, batches: xs.length, lbKg: lb,
      avgLbPrice: has ? S((b) => b.lbValue).div(lb) : null,
      shrink: has ? ONE.minus(processed.div(lb)) : null,
      karkasYield: processed.isZero() ? null : fresh.plus(frozen).div(processed),
      freshPct: fresh.plus(frozen).isZero() ? null : fresh.div(fresh.plus(frozen)),
      margin,
      marginPerKgLb: has ? margin.div(lb) : null,
      costPerKgOutput: out.isZero() ? null : S((b) => b.totalCost).div(out),
      valuePerKgOutput: out.isZero() ? null : value.div(out),
      breakevenLb: has ? value.minus(S((b) => b.freight)).minus(S((b) => b.maklon)).div(lb) : null,
    };
  });
  return { rows, target: { shrink: p.params.shrink, karkasYield: p.params.yieldDefault.karkas, breakevenLb100Fresh: breakeven100 } };
}

/* ------------------------------------------------------------------ Block 7 */

export interface Alert {
  code: string;
  text: string;
}

export function alerts(
  p: Prepared,
  stock: StockResult,
  rpa: RpaDecision,
  trading: TradingRow[],
  kpi: BatchKpi,
): Alert[] {
  const out: Alert[] = [];
  const pastOrders = p.sales.filter((s) => s.status === "Order" && s.date !== null && s.date < p.today && s.kg.greaterThan(0)).length;
  if (pastOrders > 0) {
    out.push({ code: "ORDER_LEWAT", text: `${pastOrders} baris order sudah lewat tanggal tapi belum terkirim — ubah jadi Aktual atau geser tanggal` });
  }
  const newCodes = p.sales.filter((s) => s.key === "KODE BARU").length
    + p.receipts.filter((r) => r.key === "KODE BARU").length
    + p.opening.filter((o) => o.key === "KODE BARU").length;
  if (newCodes > 0) out.push({ code: "KODE_BARU", text: "Ada kode item baru — tambahkan ke I_Item" });
  const neg = stock.rows.filter((r) => r.lowest.lessThan(-0.5)).length;
  if (neg > 0) out.push({ code: "STOK_MINUS", text: `${neg} SKU diproyeksikan stok minus — lihat O_Stok` });
  const noPrice = stock.rows.filter((r) => r.stockToday.greaterThan(0.5) && (r.refPrice === null || r.refPrice.isZero())).length;
  if (noPrice > 0) out.push({ code: "HARGA_KOSONG", text: "Harga acuan kosong untuk SKU yang masih ada stok — isi di I_Master" });
  const act = kpi.rows[0];
  if (act.batches > 0 && act.shrink !== null && act.shrink.greaterThan(p.params.shrink)) {
    out.push({ code: "SHRINK", text: `Shrink aktual minggu ini ${pct(act.shrink)} di atas target ${pct(p.params.shrink)}` });
  }
  if (rpa.lbPriceToday.greaterThan(rpa.breakevenAt100Fresh)) {
    out.push({ code: "LB_DI_ATAS_BREAKEVEN", text: "Harga LB hari ini di atas breakeven 100% fresh" });
  }
  const tahan = trading.filter((t) => t.recommendation === "TAHAN").length;
  if (tahan > 0) out.push({ code: "TAHAN", text: `${tahan} SKU trading butuh stok tapi spread di bawah minimum` });
  return out;
}

export { D };
