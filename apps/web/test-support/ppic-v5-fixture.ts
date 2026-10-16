/**
 * Input of the PPIC v5 screen (PRD v5 §6.3) from fixtures/plan-2026-08-24 (v5 block: illustrative K/S/B map of
 * Lampiran B.3, placeholder yields) and the example week, without Supabase. Node only.
 */
import {
  D, classByProducts, computeWeek, dailyClassPlan, needBasisOutputs, netShareOf, planCost, sizeKgOf, tariffPerKgLb, toClassLB, weekClassPlan, type SizedLine,
} from "@kgr/engine";
import { planDemand, planInp, planOrders, planWeek } from "../../../packages/engine/test/plan-fixture";
import type { PpicV5Input } from "../lib/v5/ppic";

type V5In = { size_class_map: { size_kg: string; weight_class: string }[]; yield_karkas: Record<string, string>; avg_kg: Record<string, string>; mid_offset: string; fallback_class: string; lead_time_days: number; karkas_keys: string[] };

export function ppicV5Fixture(versi: "need" | "batch" = "need"): PpicV5Input {
  const v5 = (planInp as unknown as { v5: V5In }).v5;
  const r = computeWeek(planWeek);
  const demand = planDemand();
  const names = new Map((planWeek.item_map as unknown as { item_code: string; item_name: string | null }[]).map((i) => [i.item_code, i.item_name]));
  const codeOf = new Map((planWeek.sales_lines as unknown as { row: number; item_code: string | null }[]).map((s) => [String(s.row), s.item_code]));
  const orders = planOrders().filter((o) => o.delivery_date && o.delivery_date >= "2026-08-27" && o.delivery_date <= "2026-08-29");
  const lines: SizedLine[] = orders.filter((o) => v5.karkas_keys.includes(o.key)).map((o) => ({ ship_date: o.delivery_date!, key: o.key, size_kg: sizeKgOf(names.get(codeOf.get(o.ref) ?? "") ?? null), kg: o.kg }));
  const cd = toClassLB({
    lines, netShare: netShareOf(demand.rows),
    setup: { classOf: (s) => v5.size_class_map.find((m) => D(m.size_kg).eq(s))?.weight_class ?? null, yieldKarkas: (c) => v5.yield_karkas[c] ?? null, avgKg: (c) => v5.avg_kg[c] ?? null, midOffset: v5.mid_offset, fallback: v5.fallback_class },
  });
  const price = (k: string) => planWeek.sku_keys.find((s) => s.key === k)?.ref_sell_price ?? null;
  const yields = (planInp.yields as { pattern: string; key: string; yield_pct: string }[]).filter((y) => y.pattern === "karkas");
  const by = ["HJA (Hati/Jantung/Ampela)", "Usus", "Kepala", "Ceker", "Lemak"];
  const params = planWeek.parameters as unknown as Record<string, string>;
  const tariff = tariffPerKgLb({ freightPerKgLb: params.freight_plan_per_kg_lb, maklonPerKgProcessed: params.maklon_per_kg_processed, shrink: params.target_shrink });
  const fresh = cd.rows.filter((x) => x.mapped).reduce((a, x) => a.plus(x.net_kg), D(0)), na = cd.rows.filter((x) => !x.mapped).reduce((a, x) => a.plus(x.net_kg), D(0));
  const needCost = planCost({
    status: "rencana", kgLb: cd.total.kg_lb.toFixed(4), lbPrice: "24600", tariffPerKgLb: tariff.toFixed(4),
    outputs: needBasisOutputs({ kgLb: cd.total.kg_lb.toFixed(4), demand: [{ key: "RPA|Karkas|Fresh", kg: fresh.toFixed(2), priceRef: price("RPA|Karkas|Fresh") }, { key: "RPA|Karkas|n/a", kg: na.toFixed(2), priceRef: price("RPA|Karkas|n/a") }],
      byProducts: by.map((u) => ({ key: `RPA|${u}|Fresh`, yield: yields.find((y) => y.key === u)!.yield_pct, priceRef: price(`RPA|${u}|Fresh`) })) }),
  });
  const net = demand.unitNet.filter((u) => by.includes(u.key)).map((u) => ({ unit: u.key, kg: u.kg }));
  const bp = classByProducts({ byClass: cd.byClass, yieldOf: (_c, u) => yields.find((y) => y.key === u)?.yield_pct ?? null, net });
  const b2 = r.block2;
  const wp = weekClassPlan({ kgLb: b2.lbPlannedInHorizon, demandKarkasKg: cd.total.net_kg, yieldKarkas: v5.yield_karkas.STD, priceFresh: price("RPA|Karkas|Fresh"), priceFrozen: price("RPA|Karkas|Frozen") });
  const seg = (s: string) => planWeek.sku_keys.find((k) => k.key === s)?.segment ?? "";
  const sumKg = (xs: typeof orders) => xs.reduce((a, o) => a.plus(D(o.kg)), D(0));
  return {
    week: { start: "2026-08-24", end: "2026-08-30", update: "2026-08-27" }, base: "/w/2026-08-24/rencana", versi,
    demand: cd, daily: dailyClassPlan({ demand: cd, leadTimeDays: v5.lead_time_days }),
    classes: [{ code: "K", min_kg: null, max_kg: null, avg_kg: null }, { code: "S", min_kg: null, max_kg: null, avg_kg: null }, { code: "B", min_kg: null, max_kg: null, avg_kg: null }, { code: "STD", min_kg: null, max_kg: null, avg_kg: "2.000" }],
    karkas: { freshKg: fresh, naKg: na, frozenOrderKg: D("4228"), frozenCovered: true, stockFreshKg: null, stockFreshAgeDays: null },
    po: { from: "2026-08-27", to: "2026-08-29", kg: sumKg(orders), rpaKg: sumKg(orders.filter((o) => seg(o.key) === "RPA")), tradingKg: sumKg(orders.filter((o) => seg(o.key) === "Trading")), tentativeKg: D(0) },
    byProducts: bp.map((b) => ({ unit: b.unit, shortfall_kg: b.shortfall_kg })), needCost, lbPrice: { price: D(24600), source: "harga hari ini (parameter)" },
    batch: { kgLb: D(b2.lbPlannedInHorizon), batches: 2, margin: D(b2.expectedMarginOfPlan), surplusKg: wp.surplus_kg, downgrade: wp.downgrade, threshold: D("25000000"), priceFresh: D(price("RPA|Karkas|Fresh")!), priceFrozen: D(price("RPA|Karkas|Frozen")!) },
    fromCommercial: { commitment: "belum dikunci", deadline: "Jum 28 Agu 17.00", priceList: "belum", surplus: "menunggu", spotFreshKg: null },
    capacity: new Map(), supply: [], controls: [{ code: "C42", module: "M3", name: "yield", value: D(0), comparator: null, difference: null, status: "PERIKSA", action: "", detail: [] }],
    today: { poKg: sumKg(orders.filter((o) => o.delivery_date === "2026-08-27")), poValue: orders.filter((o) => o.delivery_date === "2026-08-27").reduce((a, o) => a.plus(D(o.kg).times(D(o.price ?? 0))), D(0)), cutOffTime: "14.00", allocHref: "/hari/2026-08-27/alokasi" },
    block6: r.block6, canPlan: true, saveBlockers: ["C42 PERIKSA"], copyBlockers: ["C42 PERIKSA", "C58 BELUM DIISI"],
  };
}
