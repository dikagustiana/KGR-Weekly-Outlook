/**
 * Input of the PPIC page "Rencana" (§6.4) from fixtures/plan-2026-08-24 (Lampiran B.3): the K1 demand of the example
 * week, the engine's weekly and daily plan (no capacity rows: C47), placeholder yields (C42), block 2 of the weekly
 * engine for the economics. Node only: fixture harness and page-model tests.
 */
import { D, computeWeek, dailyPlan, demandByDay, ppicBlockers, ppicControls, proposeWeekPlan, splitHeadsByDay, stepGates, type ControlV3 } from "@kgr/engine";
import { planDemand, planInp, planOrders, planWeek, unitOfKey } from "../../../packages/engine/test/plan-fixture";
import type { RencanaInput } from "../lib/v4/rencana";

export function rencanaFixture(opts: { reasons?: string[] } = {}): RencanaInput {
  const d = planDemand();
  const proposal = proposeWeekPlan({ heads: d.heads, unitNet: d.unitNet, yields: planInp.yields, avgLbKg: planInp.weight_class.avg_kg, prices: {}, threshold: "25000000", patternOrder: planInp.pattern_order });
  const byDay = demandByDay({ orders: planOrders(), forecasts: [], weights: planInp.weights, weekStart: "2026-08-24", isCut: (k) => unitOfKey(k) !== null });
  const needs = splitHeadsByDay({ weekHeads: proposal.plan.head_count, weekStart: "2026-08-24", ...byDay });
  const days = dailyPlan({ weekHeads: proposal.plan.head_count, needs, leadTimeDays: 1, weekStart: "2026-08-24", limits: Array.from({ length: 7 }, (_, i) => ({ date: `2026-08-${24 + i}`, cut_capacity_head: null, lb_supply_heads: null })) });
  const controls: ControlV3[] = [
    ...ppicControls({
      weekStart: "2026-08-24", demand: d, buyPrice: () => null, yieldNotes: planInp.yields.map((y) => y.note),
      surplus: Object.entries(proposal.plan.surplus_kg_by_key).map(([key, kg]) => ({ key, kg: kg.toFixed(2), fresh: null, frozen: null })),
      planDates: days.rows.filter((r) => r.head_count > 0).map((r) => r.date), capacity: () => null, historyDays: new Map(), forecastKeys: new Set(),
    }),
    { code: "C45", module: "M2", name: "Mart stok terbaru", value: D(0), comparator: null, difference: null, status: "LULUS", action: "", detail: [] },
  ];
  const reasons = (opts.reasons ?? []).map((code) => ({ code, reason: "kekurangan dibeli trading" }));
  const bl = (a: "save" | "approve" | "copy") => ppicBlockers(controls, a).map((b) => `${b.code} ${b.status}`);
  return {
    week: { start: "2026-08-24", update: "2026-08-27" }, demand: d, proposal, days, cls: { code: "STD", avg_kg: planInp.weight_class.avg_kg }, supplyHeads: 0,
    saved: null, savedDays: [], capacity: () => null, lbSupply: () => null, controls, gates: stepGates(controls, reasons.map((r) => r.code)), reasons,
    block2: computeWeek(planWeek).block2, variance: [], blockers: { save: bl("save"), approve: bl("approve"), copy: bl("copy") }, alokasiHref: "/hari/2026-08-27/alokasi",
    buyPrice: () => null,
  };
}
