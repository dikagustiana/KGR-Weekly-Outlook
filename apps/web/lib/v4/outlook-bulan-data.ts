import "server-only";
/**
 * Reads for the page "Outlook bulan" (PRD v4 §6.2, K17): the data mart pl_daily_v4 of the month (or the rows frozen in
 * the selected locked version), the register, the budget, the versions, the accuracy of the last FINAL month and the
 * solvency. Nothing here sums a number; the model (outlook-bulan.ts) asks @kgr/engine.
 */
import { D, accuracyV4, addDays, firstOfMonth, isCogsLine, isRevenueLine, monthEnd, plRowsFromMart, type BudgetRow, type CumulativeMetric, type LockBlocker, type RegisterRow, type VersionDayV4 } from "@kgr/engine";
import type { FixedSource } from "../v5/pl-tiles";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import { must, mustRows } from "../loader";
import type { AccuracyInput, OutlookBulanInput, VersionRow } from "./outlook-bulan";
import { costingModeOf, isModuleOn, type CostingRowsMode, type ModuleSettings } from "../modules-core";
import { v5CostingMode } from "../v5/pl";
import { forecastCostText, type ForecastCostLabel } from "../v5/forecast-cost-core";
import type { Role } from "../roles";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export interface OutlookBulanExtra {
  /** What stops V1 from being locked now (written by the rebuild job into data_status month_lock). */
  blockers: LockBlocker[];
  controls: { code: string; status: string }[];
  lockDate: string | null;
  builtAt: string | null;
  registerIds: { id: string; code: string; status: string; agreedAt: string | null }[];
  budgetVersion: number | null;
  budgetRows: BudgetRow[];
  cutOffOverride: string | null;
  hasV1: boolean;
  hasV2: boolean;
  hasFinal: boolean;
}

const MART_COLS = "date, segment, pl_line, basis, actual, forecast, kg, anomaly";

export async function loadOutlookBulan(sb: Supa, x: {
  first: string; today: string; role: Role; settings: ModuleSettings; selected: string | null;
  /** v5 views from the query string (?pl=rr|wk, ?cm=revenue|cogs|gp|nibt|nibt_after). */
  pl?: string | null; cm?: string | null;
}): Promise<{ input: OutlookBulanInput; extra: OutlookBulanExtra }> {
  const first = firstOfMonth(x.first), last = monthEnd(first);
  const mo = must(await sb.from("month_outlook").select("*").eq("month", first).maybeSingle(), "month_outlook");
  const outlook = (mo as Row | null) ?? null;
  const moId = s(outlook?.id);

  const [mart, verRows, regRows, budRows, lockRow, monthsRows, param] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("pl_daily_v4").select(MART_COLS).gte("date", first).lte("date", last).order("date").order("basis").order("pl_line").order("segment").range(a, b)),
    moId ? fetchAll<Row>((a, b) => sb.from("month_outlook_version").select("version, cut_off_date, locked_at, snapshot_sha256, revenue, gp, nibt, snapshot").eq("month_outlook_id", moId).order("version").order("id").range(a, b)) : Promise.resolve([] as Row[]),
    moId ? fetchAll<Row>((a, b) => sb.from("assumption_register").select("*").eq("month_outlook_id", moId).is("deleted_at", null).order("code").order("id").range(a, b)) : Promise.resolve([] as Row[]),
    fetchAll<Row>((a, b) => sb.from("budget").select("version, segment, metric, value").eq("month", first).is("deleted_at", null).order("id").range(a, b)),
    sb.from("data_status").select("note, built_at").eq("table_name", "month_lock").eq("scope", first).maybeSingle(),
    sb.from("month_outlook").select("month").order("month", { ascending: false }).limit(12),
    sb.from("week").select("id").lte("week_start", last).order("week_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const wk = must(param, "week (parameter)") as Row | null;
  const par = wk ? must(await sb.from("parameter").select("runrate_window_days, forecast_tolerance_pct").eq("week_id", String(wk.id)).maybeSingle(), "parameter") : null;

  const p = (par ?? {}) as Row;
  const tolerance = s(p.forecast_tolerance_pct) ?? "0.10";
  const windowDays = Number(p.runrate_window_days ?? 7);

  // versions: V1 / V2 / FINAL with the days frozen in a v4 snapshot (rule_version v4-…)
  const versions: VersionRow[] = verRows.map((v) => {
    const snap = (v.snapshot ?? null) as { days?: VersionDayV4[]; rule_version?: string } | null;
    return {
      version: String(v.version), cutOff: String(v.cut_off_date ?? first), revenue: s(v.revenue), gp: s(v.gp), nibt: s(v.nibt),
      lockedAt: s(v.locked_at), sha: s(v.snapshot_sha256), days: snap?.rule_version && Array.isArray(snap.days) ? snap.days : null,
    };
  });
  const rank = (v: string) => (v === "FINAL" ? 3 : v === "V2" ? 2 : 1);
  versions.sort((a, b) => rank(a.version) - rank(b.version));
  const selected = x.selected && versions.some((v) => v.version === x.selected) ? x.selected : null;

  // rows: the live mart, or the rows frozen in the selected version (only when it carries v4 rows)
  let rowsRaw: Row[] = mart;
  let fixedRaw: Row[] = mart.filter((r) => r.basis === "fixed_estimate");
  let effectiveSelected: string | null = null;
  // R66 (K63): a locked version keeps the definition of its journal columns (absent = 'cogs'); the live page follows the setting
  let selectedMode: CostingRowsMode = "cogs";
  if (selected) {
    const snap = (verRows.find((v) => String(v.version) === selected)?.snapshot ?? null) as { rows?: Row[]; fixed_estimate?: Row[]; costing_rows_mode?: string } | null;
    if (snap?.rows?.length && s((snap.rows[0] as Row).segment)) { rowsRaw = snap.rows; fixedRaw = snap.fixed_estimate ?? []; effectiveSelected = selected; selectedMode = costingModeOf({ costing_rows_mode: snap.costing_rows_mode }); }
  }
  const rows = rowsRaw.length ? plRowsFromMart(rowsRaw as never) : null;

  const lock = must(lockRow, "data_status month_lock") as Row | null;
  let lockNote: { blockers?: LockBlocker[]; controls?: { code: string; status: string }[]; cutOff?: string; lockDate?: string } = {};
  // K56: a note that is not the JSON the lock wrote is shown as a blocker, never read as "nothing blocks"
  try { lockNote = lock?.note ? JSON.parse(String(lock.note)) : {}; } catch (e) { lockNote = { blockers: [{ code: "NOTE", text: `catatan kunci tidak terbaca: ${(e as Error).message}` }] }; }
  const lastActual = rows ? rows.filter((r) => r.actual !== null).reduce<string>((m, r) => (r.date > m ? r.date : m), "") : "";
  const cutOff = s(outlook?.cut_off_date) ?? lockNote.cutOff ?? (lastActual || addDays(first, -1));

  const register: RegisterRow[] = regRows.map((r) => ({
    code: String(r.code), name: String(r.name), value_num: s(r.value_num), value_text: s(r.value_text), basis: s(r.basis), owner: s(r.owner),
    agreed_at: s(r.agreed_at), deviation_note: s(r.deviation_note), status: String(r.status) as RegisterRow["status"],
  }));

  const latestV = budRows.reduce((m, r) => Math.max(m, Number(r.version)), 0);
  const budgetRows: BudgetRow[] = budRows.filter((r) => Number(r.version) === latestV).map((r) => ({ segment: String(r.segment), metric: String(r.metric) as BudgetRow["metric"], value: String(r.value) }));

  const monthSet = new Set<string>([first, ...mustRows<Row>(monthsRows, "month_outlook (bulan)").map((m) => String(m.month))]);
  const months = [...monthSet].sort().slice(-6).map((m) => ({ first: m, href: `/m/${m.slice(0, 7)}` }));

  // accuracy of the last month with a FINAL version
  let accuracy: AccuracyInput | null = null;
  {
    const f = must(await sb.from("month_outlook_version").select("month_outlook_id, revenue, gp, nibt, month_outlook!inner(month)").eq("version", "FINAL").order("locked_at", { ascending: false }).limit(1).maybeSingle(), "month_outlook_version FINAL") as (Row & { month_outlook: { month: string } }) | null;
    if (f && f.revenue !== null) {
      const id = String(f.month_outlook_id);
      const [vs, adj, daily] = await Promise.all([
        fetchAll<Row>((a, b) => sb.from("month_outlook_version").select("version, revenue, gp, nibt").eq("month_outlook_id", id).neq("version", "FINAL").order("version").order("id").range(a, b)),
        fetchAll<Row>((a, b) => sb.from("closing_adjustment").select("pl_line, amount").eq("month_outlook_id", id).eq("posted", true).is("deleted_at", null).order("id").range(a, b)),
        fetchAll<Row>((a, b) => sb.from("forecast_accuracy_daily").select("date, day_kind, diff, version").eq("month_outlook_id", id).order("date").order("segment").order("version").range(a, b)),
      ]);
      if (vs.length) {
        const sumAdj = (pred: (l: string) => boolean) => adj.filter((a) => pred(String(a.pl_line))).reduce((acc, a) => acc.plus(D(String(a.amount))), D(0));
        const lines = accuracyV4({
          final: { revenue: String(f.revenue), gp: s(f.gp), nibt: s(f.nibt) },
          adjustments: { revenue: sumAdj(isRevenueLine).toFixed(2), gp: sumAdj((l) => isRevenueLine(l) || isCogsLine(l)).toFixed(2), nibt: sumAdj(() => true).toFixed(2) },
          versions: vs.map((v) => ({ version: String(v.version), revenue: s(v.revenue), gp: s(v.gp), nibt: s(v.nibt) })),
        });
        const version = String(vs[0].version);
        const kind = (k: string) => {
          const r = daily.filter((d) => String(d.version) === version && String(d.day_kind) === k);
          // a total over days is known only when every day has its difference; one blank day makes it unknown (null), never a smaller number
          return r.length ? { n: new Set(r.map((d) => String(d.date))).size, diff: r.every((d) => d.diff !== null && d.diff !== undefined) ? r.reduce((a, d) => a.plus(D(String(d.diff))), D(0)).toFixed(2) : null } : null;
        };
        // R38: the fixed-cost estimate the version carried in its snapshot (v5_pl at the lock); none = null, never 0
        const snap = must(await sb.from("month_outlook_version").select("snapshot").eq("month_outlook_id", id).eq("version", version).maybeSingle(), "month_outlook_version snapshot") as Row | null;
        const fe = ((snap?.snapshot ?? null) as { fixed_estimate?: { actual: string | null; forecast: string | null }[] } | null)?.fixed_estimate;
        const feParts = (fe ?? []).flatMap((r) => [r.actual, r.forecast]).filter((v): v is string => v !== null && v !== undefined);
        const fixedOfVersion = feParts.length ? feParts.reduce((acc, v) => acc.plus(D(v)), D(0)).toFixed(2) : null;
        accuracy = { month: String(f.month_outlook.month), version, lines: lines.filter((l) => l.version === version), poDays: kind("po"), runrateDays: kind("runrate"), fixedOfVersion };
      }
    }
  }

  const on = { m6: isModuleOn(x.settings.m6_cash, x.role) };
  let solvency: OutlookBulanInput["solvency"] = null;
  if (on.m6) {
    const [svR, cashR] = await Promise.all([
      sb.from("solvency_monthly").select("*").lte("month", last).order("month", { ascending: false }).limit(1).maybeSingle(),
      // PRD v5.1 R21: a day built without any bank balance is no cash position (kas-data noBalance): never Rp 0
      sb.from("cash_position_daily").select("date, total_closing").not("total_closing", "is", null).gt("accounts", 0).lte("date", x.today < last ? x.today : last).order("date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const v = must(svR, "solvency_monthly") as Row | null, cash = must(cashR, "cash_position_daily");
    if (v && v.equity !== null && v.paid_in_capital !== null) {
      solvency = { label: new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(v.month)}T00:00:00Z`)), equity: String(v.equity), paidIn: String(v.paid_in_capital), affiliate: s(v.affiliate_payable), months: s(v.months_to_negative_equity), basis: s(v.basis_nibt), cash: s((cash as Row | null)?.total_closing) };
    }
  }

  // PRD v5 §4.7 (flag v5_pl): the same rows with the fixed-cost estimate, its sources as the month builder recorded them
  const v5On = isModuleOn(x.settings.v5_pl, x.role);
  const mode: CostingRowsMode = !v5On ? "cogs" : effectiveSelected ? selectedMode : await v5CostingMode(sb);
  const base = `/m/${first.slice(0, 7)}`;
  const pl: "rr" | "wk" = x.pl === "wk" ? "wk" : "rr";
  const cm = (["revenue", "cogs", "gp", "nibt", "nibt_after"] as const).find((m) => m === x.cm) ?? "revenue";
  const href = (q: { pl?: string; cm?: string }) => {
    const p = new URLSearchParams();
    if (effectiveSelected) p.set("versi", effectiveSelected);
    const np = q.pl ?? pl, nc = q.cm ?? cm;
    if (np !== "rr") p.set("pl", np);
    if (nc !== "revenue") p.set("cm", nc);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const v5 = v5On && rows ? {
    rows: [...rows, ...plRowsFromMart(fixedRaw.filter((r) => r.basis === "fixed_estimate") as never, { fixedEstimate: true })],
    fixed: ((lockNote as { fixed?: FixedSource[] }).fixed ?? []), pl, cm: cm as CumulativeMetric, href, mode,
    // R67: the label of the forecast COGS of the live month (the month builder's note); a locked version has no such note
    forecastText: effectiveSelected ? null : forecastCostText((lockNote as { forecastCost?: ForecastCostLabel }).forecastCost),
  } : null;

  const input: OutlookBulanInput = {
    first, today: x.today, cutOff, tolerance, windowDays, rows, base: `/m/${first.slice(0, 7)}`, months, budget: budgetRows, register, versions,
    selected: effectiveSelected, accuracy, solvency, on, v5,
    pdfHref: `/api/m/${first.slice(0, 7)}/pdf${effectiveSelected ? `?version=${effectiveSelected}` : ""}`,
  };
  const extra: OutlookBulanExtra = {
    blockers: lockNote.blockers ?? [], controls: lockNote.controls ?? [], lockDate: lockNote.lockDate ?? null, builtAt: s(lock?.built_at),
    registerIds: regRows.filter((r) => String(r.status) !== "superseded").map((r) => ({ id: String(r.id), code: String(r.code), status: String(r.status), agreedAt: s(r.agreed_at) })),
    budgetVersion: latestV || null, budgetRows, cutOffOverride: s(outlook?.cut_off_date),
    hasV1: versions.some((v) => v.version === "V1"), hasV2: versions.some((v) => v.version === "V2"), hasFinal: versions.some((v) => v.version === "FINAL"),
  };
  return { input, extra };
}
