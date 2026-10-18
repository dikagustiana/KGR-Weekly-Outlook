import "server-only";
/**
 * Everything the v3 modules add to one week: their controls (C21–C40) and their snapshot keys. Only modules whose
 * flag is on contribute — with every flag off the weekly snapshot and release are exactly v1.
 */
import type { ControlV3, V3Snapshot, WeekResult } from "@kgr/engine";
import type { Supa } from "../supabase";
import type { WeekRow } from "../data";
import type { ModuleSettings } from "../modules-core";
import type { Role } from "../roles";
import { groupsOfWeek, loadCostingWeek, weekCostingControls } from "./costing";
import { v5CostingControls } from "../v5/costing";
import { ledgerForWeek } from "./ledger";
import { demandWeekly, loadPlanning, weekPlanningControls } from "./planning";
import { dayControls, loadDayAllocation } from "./allocation";
import { loadMonthDrivers } from "./drivers";
import { monthView, plDaily } from "./monthly";
import { loadCash } from "./cash";
import { computeCommercial } from "./commercial";
import { weekFloorControls } from "./discount";
import { firstOfMonth, monthSummary } from "@kgr/engine";

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

/**
 * `role` is the role of the session `sb` runs as (omit it for the service client or a release by Admin/Finance). Q-v5.2-15 (A1c):
 * for Sales the planning block is left out — no demand rows, no plan, no C28/C30 — because they do not read plan_week,
 * demand_weekly or plan_day as of B6: a Sales reader gets a snapshot without those keys, never one with zeros for them.
 */
export async function v3ForWeek(sb: Supa, week: WeekRow, settings: ModuleSettings, v1?: WeekResult, role?: Role): Promise<WeekV3> {
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
    // v5 §4.1: C53 (WP late), C54 (cost above ratio × reference price), C57 (cut date without an LB price decision)
    if (settings.v5_costing?.enabled) controls.push(...await v5CostingControls(sb, week, week.update_date, new Date().toISOString()));
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
  if (settings.m3_planning?.enabled && role !== "sales") {
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
  if (settings.m5_drivers?.enabled) {
    // fixed-cost drivers of the update date's month, journal through the day before (C33 / C34)
    const m = await loadMonthDrivers(sb, week.update_date.slice(0, 7), week.update_date);
    controls.push(...m.controls);
    snapshot.drivers = { month: m.month, through: m.through, fixed: m.fixed.map((l) => ({ pl_line: l.pl_line, scheduled: l.scheduled, actual_mtd: l.actual_mtd, outlook: l.outlook, missing: l.missing })) };
  }
  if (settings.m4_monthly?.enabled) {
    // monthly outlook of the update date's month, from the data mart (C32 + snapshot key monthly)
    const first = firstOfMonth(week.update_date);
    const [rows, mv] = await Promise.all([plDaily(sb, first), monthView(sb, first)]);
    controls.push(...mv.controls);
    const sm = monthSummary(rows, first, null, "0.10");
    snapshot.monthly = {
      month: first, last_actual: sm.lastActual, actual: sm.actual, forecast: sm.forecast, outlook: sm.outlook, share_po: sm.sharePo,
      versions: mv.versions.map((v) => ({ version: v.version, revenue: v.revenue, gp: v.gp, nibt: v.nibt, sha256: v.snapshot_sha256 })),
    };
  }
  if (settings.m6_cash?.enabled) {
    // cash position on the update date, 13-week low, CCC, solvency (C35–C37)
    const c = await loadCash(sb, week.update_date, { m4: settings.m4_monthly?.enabled === true });
    controls.push(...c.controls);
    snapshot.cash = { date: c.date, closing: c.projection.startClosing, lowest_13w: c.projection.lowest, lowest_date: c.projection.lowestDate, weeks: c.projection.weeks.map((w) => ({ week_start: w.week_start, closing: w.closing, lowest: w.lowest })) };
    snapshot.ccc = c.ccc ? { dio: c.ccc.dio, dso: c.ccc.dso, dpo: c.ccc.dpo, ccc: c.ccc.ccc, working_capital: c.ccc.workingCapital, window_days: c.cccWindowDays } : null;
    snapshot.solvency = c.solvency;
  }
  if (settings.m7_commercial?.enabled && settings.m2_ledger?.enabled) {
    // commercial view on the update date (C39 / C40); snapshot keeps the ranking without the specific lot cost
    const c = await computeCommercial(sb, week.update_date);
    controls.push(...c.controls);
    snapshot.commercial = { date: c.date, stock_date: c.stockDate, rows: c.rows.map((r) => ({ rank: r.rank, key: r.key, urgency: r.urgency, free_kg: r.free_fresh_kg.plus(r.free_frozen_kg), price_floor: r.price_floor, priority_score: r.priority_score })) };
  }
  if (settings.m7_approval?.enabled && settings.m7_commercial?.enabled) controls.push(...await weekFloorControls(sb, week)); // C38
  if (controls.length) snapshot.controls_v3 = controls;
  return { controls, snapshot };
}
