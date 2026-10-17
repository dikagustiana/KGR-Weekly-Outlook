import "server-only";
/**
 * v3 additions to the weekly management view (PRD v3 §6): headline tiles (month outlook vs budget, lowest cash of
 * 13 weeks, SKUs to sell today) and the sections Input, COGS, cash, demand, accuracy. Every number comes from the data
 * marts or the engine. Input and COGS come from the week's own engine result, so they show with every module off.
 */
import {
  addDays, cogsBySegment, computeLedger, demandTotals, firstOfMonth, inputSummary, monthSummary, rollForward, urgentStock,
  type CogsSegment, type Decimal, type InputSummary, type MonthSummary, type RollForward, type WeekResult,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { WeekRow } from "../data";
import type { ModuleSettings } from "../modules-core";
import { groupsOfWeek, loadCostingWeek } from "./costing";
import { loadLedgerSources } from "./ledger";
import { plDaily } from "./monthly";
import { bsInventoryYesterday } from "./week";
import type { Row } from "./uploads";
import { must, mustRows } from "../loader";

export interface ManagementV3 {
  any: boolean;
  month: { first: string; summary: MonthSummary; budget: { revenue: Decimal | null; gp: Decimal | null } } | null;
  cash: { date: string; closing: string | null; lowest: string | null; lowestDate: string | null; weeks: Row[] } | null;
  urgent: ({ date: string } & ReturnType<typeof urgentStock>) | null;
  input: InputSummary | null;
  cogs: { segments: CogsSegment[]; groups: ReturnType<typeof groupsOfWeek> | null; roll: RollForward | null } | null;
  demand: { totals: ReturnType<typeof demandTotals>; heads: number | null; planVersion: number | null; rows: number } | null;
  accuracy: { month: string; rows: Row[] } | null;
}

export async function managementV3(sb: Supa, week: WeekRow, settings: ModuleSettings, r: WeekResult): Promise<ManagementV3> {
  const on = (k: keyof ModuleSettings) => settings[k]?.enabled === true;
  const out: ManagementV3 = { any: true, month: null, cash: null, urgent: null, input: null, cogs: null, demand: null, accuracy: null };
  // Input and COGS are always part of the management view (PRD v3 §6: "tidak boleh hilang"), from the week's engine
  // result; M1 (COGS/kg per group) and M2 (inventory roll-forward) enrich them when their flags are on
  out.input = inputSummary(r);
  const groups = on("m1_costing") ? groupsOfWeek(await loadCostingWeek(sb, week)) : null;
  let roll: RollForward | null = null;
  if (on("m2_ledger")) {
    const src = await loadLedgerSources(sb);
    if (src) roll = rollForward(computeLedger(src.inputs), week.week_start, addDays(week.update_date, -1), bsInventoryYesterday(r));
  }
  out.cogs = { segments: cogsBySegment(r), groups, roll };
  if (on("m4_monthly")) {
    const first = firstOfMonth(week.update_date);
    const [rows, mo] = await Promise.all([plDaily(sb, first), sb.from("month_outlook").select("budget_revenue, budget_gp, budget_nibt, id").eq("month", first).maybeSingle()]);
    const m = (mo.data ?? null) as Row | null;
    if (rows.length) {
      const summary = monthSummary(rows, first, m ? { revenue: m.budget_revenue as string | null, gp: m.budget_gp as string | null, nibt: m.budget_nibt as string | null } : null, "0.10");
      out.month = { first, summary, budget: { revenue: summary.budget.revenue, gp: summary.budget.gp } };
    }
    // accuracy of the last month with a FINAL version
    const fin = must(await sb.from("month_outlook").select("id, month").eq("status", "final").order("month", { ascending: false }).limit(1).maybeSingle(), "management.fin") as Row | null;
    if (fin) {
      const acc = mustRows(await sb.from("outlook_accuracy").select("*").eq("month_outlook_id", String((fin as Row).id)), "management.accuracy") as Row[];
      out.accuracy = { month: String((fin as Row).month), rows: acc };
    }
  }
  if (on("m6_cash")) {
    const c = must(await sb.from("cash_position_daily").select("*").lte("date", week.update_date).order("date", { ascending: false }).limit(1).maybeSingle(), "management.cash") as Row | null;
    if (c) {
      const cr = c as Row;
      out.cash = { date: String(cr.date), closing: cr.total_closing === null ? null : String(cr.total_closing), lowest: cr.lowest_next_13w === null ? null : String(cr.lowest_next_13w), lowestDate: cr.lowest_date ? String(cr.lowest_date) : null, weeks: [] };
    }
  }
  if (on("m7_commercial")) {
    const d = must(await sb.from("commercial_daily").select("date").lte("date", week.update_date).order("date", { ascending: false }).limit(1).maybeSingle(), "management.commercial_date") as Row | null;
    if (d) {
      const date = String((d as Row).date);
      const rows = mustRows(await sb.from("commercial_daily").select("urgency, free_fresh_kg, free_frozen_kg, cost_per_kg_ma, downgrade_risk_rp").eq("date", date), "management.commercial_rows") as Row[];
      out.urgent = { date, ...urgentStock(rows.map((x) => ({ urgency: x.urgency as string | null, free_fresh_kg: x.free_fresh_kg as string | null, free_frozen_kg: x.free_frozen_kg as string | null, cost_per_kg_ma: x.cost_per_kg_ma as string | null, downgrade_risk_rp: x.downgrade_risk_rp as string | null }))) };
    }
  }
  if (on("m3_planning")) {
    const rows = mustRows(await sb.from("demand_weekly").select("*").eq("week_start", week.week_start), "management.demand_weekly") as Row[];
    const plan = must(await sb.from("plan_week").select("version, head_count").eq("week_start", week.week_start).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle(), "management.plan_week") as Row | null;
    const rs = rows;
    out.demand = {
      totals: demandTotals(rs.map((x) => ({ confirmed_kg: x.confirmed_kg as string, tentative_kg: x.tentative_kg as string, forecast_kg: x.forecast_kg as string, weighted_kg: x.weighted_kg as string, stock_free_kg: x.stock_free_kg as string, net_kg: x.net_kg as string }))),
      heads: plan ? Number((plan as Row).head_count) : null, planVersion: plan ? Number((plan as Row).version) : null, rows: rs.length,
    };
  }
  return out;
}
