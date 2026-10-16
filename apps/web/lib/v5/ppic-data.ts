import "server-only";
/**
 * PRD v5 §4.2–4.4 on the server (flag v5_ppic_class): sizes of the PO karkas lines (sales_line.size_kg →
 * item_map.size_kg → "Uk x.x" in the item name, O4), size_class_map, karkas yield per class and the v4 netting per key
 * into @kgr/engine toClassLB / dailyClassPlan / classByProducts; plan cost of the need at the LB price decided last
 * (planCost mode rencana); C50, C51, C58. The demand builder writes demand_class_weekly; the PPIC page reads this.
 */
import {
  D, addDays, batchBasisInputs, mondayOf, c50, c51, c58, classByProducts, dailyClassPlan, needBasisOutputs, needByCutDate, netShareOf, planCost, registeredClasses, sizeKgOf, tariffPerKgLb, toClassLB, weekClassPlan,
  type ClassDemand, type ControlV3, type DailyClassRow, type Decimal, type PlanCostResult, type SizedLine, type WeekResult,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll, listWeeks } from "../data";
import { martReplace, registerBuilder } from "../rebuild-registry";
import type { Row } from "../v3/uploads";
import { computeDemand, loadPlanning, ppicBlockers, ppicWeekControls, proposePlan, type PlanningSources } from "../v3/planning";
import type { PpicClassInfo, PpicV5Input } from "./ppic";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
/** O3: midpoint of "Uk x.x" = x.x + 0,05 (PRD §11 default). */
export const SIZE_MID_OFFSET = "0.05";
const FALLBACK = "STD";
const BY_PRODUCTS = ["HJA (Hati/Jantung/Ampela)", "Usus", "Kepala", "Ceker", "Lemak"];

export async function v5PpicOn(sb: Supa): Promise<boolean> {
  const { data } = await sb.from("app_setting").select("value").eq("key", "v5_ppic_class").maybeSingle();
  return ((data as Row | null)?.value as { enabled?: boolean } | undefined)?.enabled === true;
}

export interface ClassSources {
  demand: ClassDemand;
  daily: DailyClassRow[];
  classes: PpicClassInfo[];
  /** Ship dates of the karkas lines (the horizon of the class demand). */
  ship: { from: string; to: string } | null;
  controls: ControlV3[];
  yieldOf: (cls: string, unit: string) => string | null;
}

/** K28 for the week of `src`: karkas PO lines with their size → class demand and the daily need per class. */
export async function loadClassDemand(sb: Supa, src: PlanningSources): Promise<ClassSources> {
  const ws = src.week.week_start;
  const karkasKeys = [...src.keys.entries()].filter(([, k]) => k.segment === "RPA" && k.sku === "Karkas" && k.form !== "frozen").map(([key]) => key);
  const lines0 = src.orders.filter((o) => karkasKeys.includes(o.key) && o.delivery_date);
  const ids = lines0.map((o) => o.id);
  const [items, sized, classes, map] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, item_name, size_kg").is("deleted_at", null).range(a, b)),
    ids.length ? fetchAll<Row>((a, b) => sb.from("sales_line").select("id, size_kg").in("id", ids).not("size_kg", "is", null).range(a, b)) : Promise.resolve([] as Row[]),
    fetchAll<Row>((a, b) => sb.from("weight_class").select("code, min_kg, max_kg, avg_kg, sort_order").order("sort_order").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("size_class_map").select("size_kg, weight_class, effective_from, effective_to").is("deleted_at", null).lte("effective_from", ws).order("effective_from").range(a, b)),
  ]);
  const item = new Map(items.map((i) => [String(i.item_code), i]));
  const lineSize = new Map(sized.map((r) => [String(r.id), s(r.size_kg)]));
  const sizeOf = (o: (typeof lines0)[number]): string | null => {
    const it = o.item_code ? item.get(o.item_code) : undefined;
    return lineSize.get(o.id) ?? s(it?.size_kg) ?? sizeKgOf(s(it?.item_name))?.toFixed(2) ?? null;
  };
  const inForce = map.filter((m) => !m.effective_to || String(m.effective_to) >= ws);
  const latest = new Map<string, string>();
  for (const m of inForce) latest.set(D(String(m.size_kg)).toFixed(2), String(m.weight_class));
  const yieldOf = (cls: string, unit: string) => src.yieldRows.find((y) => y.weight_class === cls && y.cut_pattern === "karkas" && y.key === unit)?.yield_pct ?? null;
  const avg = new Map(classes.map((c) => [String(c.code), s(c.avg_kg)]));
  const { demand: v4 } = computeDemand(src, FALLBACK);
  const lines: SizedLine[] = lines0.map((o) => ({ ship_date: o.delivery_date!, key: o.key, size_kg: sizeOf(o), kg: o.kg }));
  const demand = toClassLB({
    lines, netShare: netShareOf(v4.rows),
    setup: { classOf: (sz) => latest.get(sz.toFixed(2)) ?? null, yieldKarkas: (c) => yieldOf(c, "Karkas"), avgKg: (c) => avg.get(c) ?? null, midOffset: SIZE_MID_OFFSET, fallback: FALLBACK },
  });
  const daily = dailyClassPlan({ demand, leadTimeDays: src.leadTimeDays });
  // C51: registered = PPIC gave the class numbers (v5/0 seeds K/S/B codes without; same rule as the upload check)
  const registered = registeredClasses(classes.map((c) => ({ code: String(c.code), min_kg: s(c.min_kg), max_kg: s(c.max_kg), avg_kg: s(c.avg_kg) })));
  const used = [
    ...src.yieldRows.map((y) => ({ source: "yield", weight_class: y.weight_class })),
    ...src.lbSupply.filter((l) => s(l.weight_class)).map((l) => ({ source: "supply LB", weight_class: String(l.weight_class) })),
    ...inForce.map((m) => ({ source: "peta ukuran", weight_class: String(m.weight_class) })),
  ];
  const supply = src.lbSupply.filter((l) => l.status === "confirmed" || l.status === "received").map((l) => ({ date: String(l.date), weight_class: s(l.weight_class), kg_lb: s(l.kg) ?? "0" }));
  const ships = [...new Set(lines.map((l) => l.ship_date))].sort();
  return {
    demand, daily, yieldOf, ship: ships.length ? { from: ships[0], to: ships[ships.length - 1] } : null,
    classes: classes.map((c) => ({ code: String(c.code), min_kg: s(c.min_kg), max_kg: s(c.max_kg), avg_kg: s(c.avg_kg) })),
    controls: [c50(demand), c51({ registered, used }), c58({ need: needByCutDate(daily), supply })],
  };
}

/** demand_class_weekly rows of the week (mart). */
export function demandClassRows(weekStart: string, d: ClassDemand): Row[] {
  return d.rows.map((r) => ({
    week_start: weekStart, ship_date: r.ship_date, size_code: r.size_code, size_kg: r.size_kg?.toFixed(2) ?? null, weight_class: r.weight_class,
    net_kg: r.net_kg.toFixed(2), kg_lb: r.kg_lb.toFixed(2), heads: r.heads.toFixed(2),
  }));
}

/** Everything the PPIC v5 page shows. */
export async function loadPpicV5(sb: Supa, x: { src: PlanningSources; result: WeekResult; base: string; versi: "need" | "batch"; canPlan: boolean; c45: ControlV3 }): Promise<PpicV5Input> {
  const { src, result } = x;
  const w = src.week, ws = w.week_start, we = addDays(ws, 6);
  const cs = await loadClassDemand(sb, src);
  const next = addDays(ws, 7);
  const [decision, commits, lists, plans, param] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("lb_price_decision").select("date, price, decided_at").gte("date", ws).lte("date", we).order("decided_at", { ascending: false }).range(a, b)).catch(() => [] as Row[]),
    fetchAll<Row>((a, b) => sb.from("sales_commitment").select("status").eq("week_start", next).range(a, b)).catch(() => [] as Row[]),
    fetchAll<Row>((a, b) => sb.from("price_list_week").select("locked_at").eq("week_start", next).range(a, b)).catch(() => [] as Row[]),
    fetchAll<Row>((a, b) => sb.from("surplus_response").select("plan_week_id").range(a, b)).catch(() => [] as Row[]),
    sb.from("parameter").select("commitment_lock_dow, commitment_lock_time, cut_off_time").eq("week_id", w.id).maybeSingle(),
  ]);
  const p = (param.data ?? {}) as Row;
  const lbDecided = s(decision[0]?.price);
  const lbPrice = lbDecided ?? (src.v1.lbPriceToday && src.v1.lbPriceToday !== "0" ? src.v1.lbPriceToday : null);
  const price = (k: string) => src.prices.get(k) ?? null;
  const d = cs.demand;
  const fresh = d.rows.filter((r) => r.mapped).reduce((a, r) => a.plus(r.net_kg), D(0));
  const na = d.rows.filter((r) => !r.mapped).reduce((a, r) => a.plus(r.net_kg), D(0));
  const tariff = tariffPerKgLb({ freightPerKgLb: src.v1.freight, maklonPerKgProcessed: src.v1.maklon, shrink: src.v1.shrink });
  const stdYield = (u: string) => cs.yieldOf(FALLBACK, u);
  let needCost: PlanCostResult | null = null;
  const needOutputs = d.total.kg_lb.gt(0) ? needBasisOutputs({
    kgLb: d.total.kg_lb.toFixed(4),
    demand: [{ key: "RPA|Karkas|Fresh", kg: fresh.toFixed(2), priceRef: price("RPA|Karkas|Fresh") }, ...(na.gt(0) ? [{ key: "RPA|Karkas|n/a", kg: na.toFixed(2), priceRef: price("RPA|Karkas|n/a") ?? price("RPA|Karkas|Fresh") }] : [])],
    byProducts: BY_PRODUCTS.filter((u) => stdYield(u) !== null).map((u) => ({ key: `RPA|${u}|Fresh`, yield: stdYield(u)!, priceRef: price(`RPA|${u}|Fresh`) })),
  }) : null;
  if (lbPrice && needOutputs) needCost = planCost({ status: "rencana", kgLb: d.total.kg_lb.toFixed(4), lbPrice, tariffPerKgLb: tariff.toFixed(4), outputs: needOutputs });
  const { demand: v4 } = computeDemand(src, FALLBACK);
  const bp = classByProducts({ byClass: d.byClass, yieldOf: (c, u) => cs.yieldOf(c, u) ?? stdYield(u), net: v4.unitNet.filter((u) => BY_PRODUCTS.includes(u.key)).map((u) => ({ unit: u.key, kg: u.kg })) });
  const b2 = result.block2;
  const karkasStd = stdYield("Karkas");
  const wp = karkasStd ? weekClassPlan({ kgLb: b2.lbPlannedInHorizon, demandKarkasKg: d.total.net_kg, yieldKarkas: karkasStd, priceFresh: price("RPA|Karkas|Fresh"), priceFrozen: price("RPA|Karkas|Frozen") }) : null;
  const latestPlan = src.plans[0];
  const horizon = (o: { delivery_date: string | null }) => !!o.delivery_date && !!cs.ship && o.delivery_date >= cs.ship.from && o.delivery_date <= cs.ship.to;
  const inH = src.orders.filter(horizon);
  const seg = (k: string) => src.keys.get(k)?.segment ?? "";
  const sumKg = (xs: typeof inH) => xs.reduce((a, o) => a.plus(D(o.kg)), D(0));
  const todayRows = src.orders.filter((o) => o.delivery_date === w.update_date);
  const p4 = proposePlan(src, { classCode: FALLBACK });
  const controls = [...ppicWeekControls(src, p4, w.update_date), x.c45, ...cs.controls];
  const lockDow = Number(p.commitment_lock_dow ?? 5);
  const deadline = addDays(ws, lockDow - 1);
  const block = (codes: { code: string; status: string }[]) => codes.map((c) => `${c.code} ${c.status}`);
  const c58 = cs.controls.find((c) => c.code === "C58")!;
  return {
    week: { start: ws, end: w.week_end, update: w.update_date }, base: x.base, versi: x.versi,
    demand: d, daily: cs.daily, classes: cs.classes,
    karkas: { freshKg: fresh, naKg: na, frozenOrderKg: v4.rows.filter((r) => r.key === "RPA|Karkas|Frozen").reduce((a, r) => a.plus(r.weighted_kg), D(0)), frozenCovered: v4.rows.filter((r) => r.key === "RPA|Karkas|Frozen").every((r) => r.net_kg.isZero()), stockFreshKg: null, stockFreshAgeDays: null },
    po: { from: cs.ship?.from ?? ws, to: cs.ship?.to ?? we, kg: sumKg(inH), rpaKg: sumKg(inH.filter((o) => seg(o.key) === "RPA")), tradingKg: sumKg(inH.filter((o) => seg(o.key) === "Trading")), tentativeKg: sumKg(inH.filter((o) => o.demand_status === "Tentative")) },
    byProducts: bp.map((b) => ({ unit: b.unit, net_kg: b.net_kg, output_kg: b.output_kg, shortfall_kg: b.shortfall_kg })), needCost,
    // K25 (Manajemen): the two bases of the LB simulation — the need of the POs, and the batches planned in the horizon
    sim: {
      tariff, need: needOutputs ? { kgLb: d.total.kg_lb, outputs: needOutputs } : null,
      batch: D(b2.lbPlannedInHorizon).gt(0) && price("RPA|Karkas|Frozen") ? batchBasisInputs({ kgLb: b2.lbPlannedInHorizon, karkasAtRisk: b2.karkasAtRiskOfFreezing, frozenPrice: price("RPA|Karkas|Frozen")!, valuePerKgLb: b2.valuePerKgLbAtPlanShare }) : null,
    },
    lbPrice: { price: lbPrice ? D(lbPrice) : null, source: lbDecided ? "keputusan Direktur Operasional" : "harga hari ini (parameter)" },
    batch: D(b2.lbPlannedInHorizon).gt(0) && wp ? {
      kgLb: D(b2.lbPlannedInHorizon), batches: result.block6.rows.find((r) => r.status === "Rencana")?.batches ?? 0, margin: D(b2.expectedMarginOfPlan), surplusKg: wp.surplus_kg, downgrade: wp.downgrade,
      threshold: D(src.threshold), priceFresh: price("RPA|Karkas|Fresh") ? D(price("RPA|Karkas|Fresh")!) : null, priceFrozen: price("RPA|Karkas|Frozen") ? D(price("RPA|Karkas|Frozen")!) : null,
    } : null,
    fromCommercial: {
      commitment: commits.some((c) => c.status === "locked") ? "dikunci" : "belum dikunci", deadline: `${deadline.slice(8, 10)}/${deadline.slice(5, 7)} ${String(p.commitment_lock_time ?? "17:00").slice(0, 5).replace(":", ".")}`,
      priceList: lists.length && lists.every((l) => l.locked_at) ? "dikunci" : "belum",
      surplus: !wp || wp.surplus_kg.isZero() ? "tidak ada surplus" : latestPlan && plans.some((r) => String(r.plan_week_id) === String(latestPlan.id)) ? "dijawab" : "menunggu",
      spotFreshKg: null,
    },
    capacity: new Map([...src.capacity].map(([k, v]) => [k, v.cut_capacity_head])),
    supply: src.lbSupply.filter((l) => l.status === "confirmed" || l.status === "received").map((l) => ({ date: String(l.date), weight_class: s(l.weight_class), kg_lb: D(s(l.kg) ?? "0") })),
    controls,
    today: { poKg: sumKg(todayRows), poValue: todayRows.reduce((a, o) => a.plus(D(o.kg).times(D(o.price ?? 0))), D(0)), cutOffTime: String(p.cut_off_time ?? "14:00").slice(0, 5).replace(":", "."), allocHref: `/hari/${w.update_date}/alokasi` },
    block6: result.block6, canPlan: x.canPlan,
    saveBlockers: block(ppicBlockers(controls, "save")),
    copyBlockers: [...block(ppicBlockers(controls, "copy")), ...(c58.status === "LULUS" ? [] : [`C58 ${c58.status}`])],
  };
}

/** plan_week_class rows of a saved plan: kg LB and heads per class of the need (§4.3). */
export function planWeekClassRows(planId: string, d: ClassDemand): Row[] {
  return d.byClass.map((c) => ({ plan_week_id: planId, weight_class: c.weight_class, cut_pattern: "karkas", kg_lb: c.kg_lb.toFixed(2), heads: Number(c.heads.toFixed(0)) }));
}

export type { Decimal };

// ------------------------------------------------------------------------------------------------ mart builder

let built = new Set<string>();

/** demand_class_weekly for the week of `date` (flag v5_ppic_class, after the M3 demand builder). */
export async function buildDemandClassDay(sb: Supa, date: string): Promise<string> {
  const ws = mondayOf(date);
  if (built.has(ws)) return `minggu ${ws} sudah dibangun`;
  built.add(ws);
  const week = (await listWeeks(sb)).find((w) => w.week_start === ws);
  if (!week) return `minggu ${ws} belum ada`;
  const cs = await loadClassDemand(sb, await loadPlanning(sb, week));
  const w = await martReplace(sb, "demand_class_weekly", ws, demandClassRows(ws, cs.demand));
  return `${cs.demand.rows.length} baris ukuran × tanggal, ${cs.demand.total.kg_lb.toFixed(0)} kg LB (${w.written} ditulis, ${w.deleted} dihapus)`;
}

registerBuilder({ module: "v5_ppic_class", name: "demand per kelas", begin: async () => { built = new Set(); }, build: buildDemandClassDay });
