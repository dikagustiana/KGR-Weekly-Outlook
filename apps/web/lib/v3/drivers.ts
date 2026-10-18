import "server-only";
/**
 * M5 cost drivers per month (PRD v3 §4.6): fixed_cost_schedule + coa_map drivers + journal actuals → engine
 * monthFixedOutlook / driverControls. This file loads rows and writes Finance's edits; the numbers come from @kgr/engine.
 */
import {
  addDays, carryForwardFixed, costActualByLine, daysInMonth, driverControls, firstOfMonth, fixedFreshnessControl, isISODate, monthFixedOutlook, toFixedString,
  type CarriedRow, type ControlV3, type Decimal, type FixedCostRow, type FixedOutlookLine,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import type { Row } from "./uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export interface MonthDrivers {
  month: string;
  first: string;
  last: string;
  /** Last journal day counted (yesterday for the running month). */
  through: string;
  schedule: (FixedCostRow & Row)[];
  coa: Row[];
  actual: Record<string, Decimal>;
  fixed: FixedOutlookLine[];
  /** PRD v4 K6 / C43: fixed rows that carried last month's nominal into this month ("belum diperbarui"). */
  carried: CarriedRow[];
  controls: ControlV3[];
}

export function monthStart(m: string): string | null {
  const d = /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : m;
  return isISODate(d) ? firstOfMonth(d) : null;
}

export async function loadMonthDrivers(sb: Supa, month: string, today: string): Promise<MonthDrivers> {
  const first = monthStart(month)!;
  const last = addDays(first, daysInMonth(first) - 1);
  const yday = addDays(today, -1);
  const through = yday < last ? yday : last;
  const [sched, coa, gl] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("fixed_cost_schedule").select("*").is("deleted_at", null).order("pl_line").order("start_date").order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, name, type, pl_line, driver_type, rp_per_kg, intercompany, driver_basis").eq("type", "LabaRugi").is("deleted_at", null).order("account").range(a, b)),
    through >= first
      ? fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", first).lte("date", through).order("id").range(a, b))
      : Promise.resolve([] as Row[]),
  ]);
  const schedule = sched.map((r) => ({
    ...r, id: String(r.id), code: s(r.code), pl_line: String(r.pl_line), description: String(r.description), amount_per_month: s(r.amount_per_month),
    start_date: String(r.start_date), end_date: s(r.end_date), amortize: r.amortize === true, prepaid_total: s(r.prepaid_total), intercompany: r.intercompany === true, active: r.active === true,
    day_basis: (r.day_basis === "working" ? "working" : "calendar") as "calendar" | "working", posting_day: r.posting_day === null || r.posting_day === undefined ? null : Number(r.posting_day),
    basis_doc: s(r.basis_doc), owner: s(r.owner), version: r.version === null || r.version === undefined ? 1 : Number(r.version), account: s(r.account),
  }));
  const actual = costActualByLine(gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) })),
    coa.map((c) => ({ account: String(c.account), pl_line: s(c.pl_line) })), first, through);
  // K6: a fixed row without an input for this month carries last month's nominal, labelled (C43)
  const cf = carryForwardFixed(schedule, first);
  const fixed = monthFixedOutlook(cf.schedule, Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, v.toFixed(2)])), first);
  const costLines = coa.filter((c) => c.pl_line && !String(c.pl_line).startsWith("Revenue") && c.pl_line !== "Other Income").map((c) => ({ pl_line: String(c.pl_line), driver_type: s(c.driver_type) }));
  return { month: first.slice(0, 7), first, last, through, schedule, coa, actual, fixed, carried: cf.carried, controls: [...driverControls({ costLines, fixed }), fixedFreshnessControl(cf.carried)] };
}
