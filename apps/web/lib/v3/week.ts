import "server-only";
/**
 * Everything the v3 modules add to one week: their controls (C21–C40) and their snapshot keys. Only modules whose
 * flag is on contribute — with every flag off the weekly snapshot and release are exactly v1.
 */
import type { ControlV3, V3Snapshot, WeekResult } from "@kgr/engine";
import type { Supa } from "../supabase";
import type { WeekRow } from "../data";
import type { ModuleSettings } from "../modules-core";
import { groupsOfWeek, loadCostingWeek, weekCostingControls } from "./costing";
import { ledgerForWeek } from "./ledger";
import { demandWeekly, loadPlanning, weekPlanningControls } from "./planning";
import { dayControls, loadDayAllocation } from "./allocation";

export interface WeekV3 {
  controls: ControlV3[];
  snapshot: V3Snapshot;
}

/** Inventory (product + trading) on the balance sheet yesterday, from the v1 statements of the week. */
export function bsInventoryYesterday(v1: WeekResult | undefined): string | null {
  if (!v1) return null;
  const v = v1.statements.bs.get("Inventory - Product").values.yesterday.plus(v1.statements.bs.get("Inventory - Trading").values.yesterday);
  return v.toFixed(2);
}

export async function v3ForWeek(sb: Supa, week: WeekRow, settings: ModuleSettings, v1?: WeekResult): Promise<WeekV3> {
  const controls: ControlV3[] = [];
  const snapshot: V3Snapshot = {};
  if (settings.m1_costing?.enabled) {
    const d = await loadCostingWeek(sb, week);
    const c = weekCostingControls(d);
    controls.push(...c);
    snapshot.costing = {
      batches: [...d.latestRun.values()].map((r) => ({
        batch_ref: d.batches.find((b) => b.id === r.batch_id)?.batch_ref ?? r.batch_id, mode: r.mode, status: r.status,
        total_cost: r.total_cost, total_allocated: r.total_allocated, diff: r.diff,
      })).sort((a, b) => String(a.batch_ref).localeCompare(String(b.batch_ref))),
      groups: groupsOfWeek(d),
    };
  }
  if (settings.m2_ledger?.enabled) {
    const l = await ledgerForWeek(sb, week, bsInventoryYesterday(v1));
    if (l) {
      controls.push(...l.controls);
      snapshot.ledger = l.balance ? {
        date: l.date, totalKg: l.balance.totalKg, totalCostMa: l.balance.totalCostMa, totalCostSi: l.balance.totalCostSi,
        perKey: l.balance.perKey.map((k) => ({ key: k.key, kg: k.kg, cost_ma: k.cost_ma, free_kg: k.free_kg, over_age_kg: k.over_age_kg })),
      } : null;
    }
  }
  if (settings.m3_planning?.enabled) {
    const src = await loadPlanning(sb, week);
    controls.push(...weekPlanningControls(src, week.update_date));
    snapshot.demand = (await demandWeekly(sb, week.week_start)).map((r) => ({
      key: r.key, confirmed_kg: r.confirmed_kg, tentative_kg: r.tentative_kg, forecast_kg: r.forecast_kg, weighted_kg: r.weighted_kg,
      stock_free_kg: r.stock_free_kg, net_kg: r.net_kg, heads: r.heads, binding: r.binding,
    }));
    const p = src.plans[0];
    snapshot.plan = p ? {
      version: p.version, head_count: p.head_count, heads_needed: p.heads_needed, frozen_planned_kg: p.frozen_planned_kg,
      rp_downgrade: p.frozen_planned_rp_downgrade, approved_by: p.approved_by ?? null,
      days: src.planDays.map((d) => ({ date: d.date, head_count: d.head_count })),
    } : null;
  }
  if (settings.m3_planning?.enabled && settings.m2_ledger?.enabled) {
    // allocation of the outlook's update date (F3b): C29 / C31
    const d = await loadDayAllocation(sb, week.update_date);
    if (d) {
      controls.push(...dayControls(d));
      snapshot.allocation = {
        date: d.date, lines: d.orders.length, allocations: d.allocations.map((a) => ({ sales_line_id: a.sales_line_id, lot_ref: a.lot_ref, kg: a.kg, method: a.method })),
        unallocated: d.proposal.unallocated.map((u) => ({ sales_ref: u.sales_ref, key: u.key, kg: u.kg })), cutoff: d.cutoffDone.map((b) => ({ lot_ref: b.lot_ref_from, kg: b.kg, rp_downgrade: b.rp_downgrade })),
      };
    }
  }
  if (controls.length) snapshot.controls_v3 = controls;
  return { controls, snapshot };
}
