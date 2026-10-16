import "server-only";
/**
 * Reads for the page "Minggu ini" (PRD v4 §6.1, K17): the week's engine result (weekly engine, as the preparer view
 * and the PDF) and the data marts of the modules that are on. Nothing here sums or computes a number; the model
 * (minggu-ini.ts) asks @kgr/engine.
 */
import { D, addDays, demandTotals, plRowsFromMart, weekCash, type ControlV3 } from "@kgr/engine";
import type { WeekCtx } from "../page";
import { supabaseServer } from "../supabase";
import { isModuleOn, moduleSettings } from "../modules";
import { weekPlRows } from "./week-pl";
import { v4On } from "./nav";
import type { MingguIniInput, StockMart } from "./minggu-ini";
import { firstOfMonth, monthEnd, monthSummary, monthSummaryV4, vsBudget, type BudgetRow } from "@kgr/engine";
import { fetchAll } from "../data";
import { plDaily } from "../v3/monthly";
import type { FixedSource } from "../v5/pl-tiles";
import { loadManagementV5 } from "../v5/management-data";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Technical sheet names (I_…, O_…, T_…) never reach the management view (§9.4). */
export function plainName(name: string): string {
  return name.replace(/\s*\((?:[^()]*\b[IOT]_[A-Za-z_]+[^()]*)\)/g, "").replace(/\b[IOT]_[A-Za-z_]+\b/g, "").replace(/\s{2,}/g, " ").trim();
}

export async function loadMingguIni(ctx: WeekCtx, sp: Record<string, string | undefined>): Promise<MingguIniInput> {
  const settings = await moduleSettings();
  const role = ctx.viewer.role;
  const on = {
    m1: isModuleOn(settings.m1_costing, role), m2: isModuleOn(settings.m2_ledger, role), m3: isModuleOn(settings.m3_planning, role),
    m4: isModuleOn(settings.m4_monthly, role), m6: isModuleOn(settings.m6_cash, role),
  };
  const sb = await supabaseServer();
  const r = ctx.computed.result;
  const w = ctx.week;
  const yesterday = addDays(w.update_date, -1);

  const plMart = v4On(settings, role) ? await weekPlRows(sb, w.week_start) : [];
  const plRows = plMart.length ? plRowsFromMart(plMart as never) : null;

  // Δ vs last week: last week's released projection when there is a release, else its journal (weekly P&L)
  let lastWeek: MingguIniInput["lastWeek"] = null;
  const prev = ctx.weeks.find((x) => x.week_start === addDays(w.week_start, -7));
  if (prev) {
    const { data } = await sb.from("release").select("snapshot").eq("week_id", prev.id).order("released_at", { ascending: false }).limit(1).maybeSingle();
    const lines = ((data as Row | null)?.snapshot as { pnl?: { lines?: { line: string; values: Record<string, string> }[] } } | undefined)?.pnl?.lines;
    const get = (l: string) => lines?.find((x) => x.line === l)?.values?.projection ?? null;
    if (lines && get("GROSS PROFIT") !== null) {
      lastWeek = { revenue: D(get("TOTAL REVENUE") ?? 0), gp: D(get("GROSS PROFIT")!), nibt: D(get("NET INCOME") ?? 0), basis: "rilis" };
    }
  }
  if (!lastWeek) {
    const p = r.statements.pnl;
    lastWeek = { revenue: p.get("TOTAL REVENUE").values.lastWeek, gp: p.get("GROSS PROFIT").values.lastWeek, nibt: p.get("NET INCOME").values.lastWeek, basis: "jurnal" };
  }

  let stock: StockMart | null = null;
  if (on.m2) {
    const { data: last } = await sb.from("sku_balance_daily").select("date").lte("date", yesterday).order("date", { ascending: false }).limit(1).maybeSingle();
    const date = s((last as Row | null)?.date);
    if (date) {
      const [keys, lots] = await Promise.all([
        sb.from("sku_balance_daily").select("key, over_age_kg, cost_per_kg_ma").eq("date", date).limit(2000),
        sb.from("lot_balance_daily").select("key, kg, age_days, cost_per_kg_ma").eq("date", date).limit(5000),
      ]);
      const info: StockMart["info"] = {};
      for (const k of r.stock.rows) info[k.key] = { ordersRest: k.ordersRestOfWeek.toFixed(2), refPrice: k.refPrice === null ? null : k.refPrice.toFixed(2) };
      stock = {
        date,
        keys: ((keys.data ?? []) as Row[]).map((k) => ({ key: String(k.key), over_age_kg: s(k.over_age_kg), cost_per_kg_ma: s(k.cost_per_kg_ma) })),
        lots: ((lots.data ?? []) as Row[]).map((l) => ({ key: String(l.key), kg: String(l.kg), age_days: l.age_days === null ? null : Number(l.age_days), cost_per_kg_ma: s(l.cost_per_kg_ma) })),
        info,
      };
    }
  }

  let cashMart: MingguIniInput["cashMart"] = null, solvency: MingguIniInput["solvency"] = null;
  /** Balances without new affiliate funding, for the decision "Pendanaan kas" (PRD v5 §6.1). */
  let noFunding: { date: string; closing: string | null }[] | null = null;
  if (on.m6) {
    const { data } = await sb.from("cash_position_daily").select("date, total_closing, projected_closing, closing_without_affiliate, accounts").gte("date", w.week_start).lte("date", w.week_end).order("date");
    const rows = (data ?? []) as Row[];
    // a mart day without any bank balance (no template kas harian yet) is not a balance of zero: the weekly cash flow stays
    if (rows.some((c) => Number(c.accounts ?? 0) > 0)) {
      // a day before the first upload stays without a balance (null, never 0) even when later days have one
      const has = (c: Row) => Number(c.accounts ?? 0) > 0;
      cashMart = rows.map((c) => ({ date: String(c.date), closing: has(c) ? s(c.total_closing) ?? s(c.projected_closing) : null, planned: String(c.date) >= w.update_date || s(c.total_closing) === null }));
      noFunding = rows.map((c) => ({ date: String(c.date), closing: has(c) ? s(c.closing_without_affiliate) ?? s(c.total_closing) ?? s(c.projected_closing) : null }));
    }
    const { data: sv } = await sb.from("solvency_monthly").select("*").lte("month", w.update_date).order("month", { ascending: false }).limit(1).maybeSingle();
    const v = sv as Row | null;
    if (v && v.equity !== null && v.paid_in_capital !== null) {
      solvency = { label: String(v.month).slice(0, 7), equity: String(v.equity), paidIn: String(v.paid_in_capital), affiliate: s(v.affiliate_payable) ?? "0", months: s(v.months_to_negative_equity), interest: null };
    }
  }

  let month: MingguIniInput["month"] = null;
  let v5Pl: MingguIniInput["v5Pl"] = null;
  if (on.m4) {
    const first = firstOfMonth(w.update_date);
    const MONTH = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    // "Satu angka": the same mart and the same engine call as the page Outlook bulan (pl_daily_v4, monthSummaryV4, budget)
    const [v4, bud] = await Promise.all([
      fetchAll<Row>((a, b) => sb.from("pl_daily_v4").select("date, segment, pl_line, basis, actual, forecast, kg, anomaly").gte("date", first).lte("date", monthEnd(first)).range(a, b)),
      fetchAll<Row>((a, b) => sb.from("budget").select("version, metric, value").eq("month", first).is("deleted_at", null).range(a, b)),
    ]);
    if (v4.length && isModuleOn(settings.v5_pl, role)) {
      // PRD v5 §4.7: the same month rows with the fixed-cost estimate; cut-off and nominal sources from the month builder
      const { data: lk } = await sb.from("data_status").select("note").eq("table_name", "month_lock").eq("scope", first).maybeSingle();
      let note: { cutOff?: string; fixed?: FixedSource[] } = {};
      try { note = (lk as Row | null)?.note ? JSON.parse(String((lk as Row).note)) : {}; } catch { note = {}; }
      const pl = sp.pl === "rr" ? "rr" : "wk";
      const href = (p: "rr" | "wk") => {
        const qs = new URLSearchParams(Object.entries({ mode: sp.mode, hari: sp.hari, segmen: sp.segmen, sku: sp.sku, pl: p === "wk" ? undefined : p }).filter((e): e is [string, string] => !!e[1])).toString();
        return `/minggu-ini/${w.week_start}${qs ? `?${qs}` : ""}`;
      };
      v5Pl = { first, cutOff: note.cutOff ?? yesterday, rows: plRowsFromMart(v4 as never, { fixedEstimate: true }), fixed: note.fixed ?? [], pl, href };
    }
    if (v4.length) {
      const sum = monthSummaryV4(plRowsFromMart(v4 as never), first, "0.10");
      const latest = bud.reduce((m, r) => Math.max(m, Number(r.version)), 0);
      const budget = latest ? bud.filter((r) => Number(r.version) === latest).map((r) => ({ segment: "Total", metric: String(r.metric) as BudgetRow["metric"], value: String(r.value) })) : [];
      const vb = vsBudget({ outlook: sum.outlook, actual: sum.actual, budget, remainingWorkingDays: sum.remainingWorkingDays });
      const line = (m: string) => vb?.lines.find((l) => l.metric === m) ?? null;
      month = {
        label: MONTH[Number(first.slice(5, 7)) - 1], revenue: sum.outlook.revenue.toFixed(2), gp: sum.outlook.gp.toFixed(2),
        gpPct: sum.outlook.revenue.isZero() ? null : sum.outlook.gp.div(sum.outlook.revenue).toFixed(6),
        budgetRevenue: line("revenue")?.budget.toFixed(2) ?? null, budgetGp: line("gp")?.budget.toFixed(2) ?? null,
      };
    } else {
      const [rows, mo] = await Promise.all([plDaily(sb, first), sb.from("month_outlook").select("budget_revenue, budget_gp, budget_nibt").eq("month", first).maybeSingle()]);
      const m = (mo.data ?? null) as Row | null;
      if (rows.length) {
        const sum = monthSummary(rows, first, m ? { revenue: s(m.budget_revenue), gp: s(m.budget_gp), nibt: s(m.budget_nibt) } : null, "0.10");
        month = {
          label: MONTH[Number(first.slice(5, 7)) - 1], revenue: sum.outlook.revenue.toFixed(2), gp: sum.outlook.gp.toFixed(2),
          gpPct: sum.outlook.revenue.isZero() ? null : sum.outlook.gp.div(sum.outlook.revenue).toFixed(6),
          budgetRevenue: sum.budget.revenue === null ? null : sum.budget.revenue.toFixed(2), budgetGp: sum.budget.gp === null ? null : sum.budget.gp.toFixed(2),
        };
      }
    }
  }

  let demand: MingguIniInput["demand"] = null;
  if (on.m3) {
    const [{ data: rows }, { data: plan }, { data: varRows }] = await Promise.all([
      sb.from("demand_weekly").select("*").eq("week_start", w.week_start),
      sb.from("plan_week").select("version, head_count").eq("week_start", w.week_start).is("deleted_at", null).order("version", { ascending: false }).limit(1).maybeSingle(),
      sb.from("plan_variance_daily").select("variance_kg").gte("date", w.week_start).lte("date", w.week_end),
    ]);
    const rs = (rows ?? []) as Row[];
    if (rs.length) {
      const t = demandTotals(rs.map((x) => ({ confirmed_kg: s(x.confirmed_kg), tentative_kg: s(x.tentative_kg), forecast_kg: s(x.forecast_kg), weighted_kg: s(x.weighted_kg), stock_free_kg: s(x.stock_free_kg), net_kg: s(x.net_kg) })));
      const vr = (varRows ?? []) as Row[];
      demand = {
        confirmed: t.confirmed.toFixed(2), tentative: t.tentative.toFixed(2), forecast: t.forecast.toFixed(2), weighted: t.weighted.toFixed(2), fromStock: t.stock.toFixed(2), net: t.net.toFixed(2),
        // heads of the binding main product per cut pattern (K1: by-products never bind), as the demand rebuild wrote them
        heads: rs.some((x) => x.binding === true && x.heads !== null) ? rs.filter((x) => x.binding === true && x.heads !== null).reduce((a, x) => a + Math.ceil(Number(x.heads)), 0) : null,
        planHeads: plan ? Number((plan as Row).head_count) : null,
        variance: vr.length ? vr.reduce((a, x) => a.plus(D(s(x.variance_kg) ?? 0)), D(0)).toFixed(2) : null,
      };
    }
  }

  // controls not filled in (v1 list), named without technical sheet names
  const controlsV3: ControlV3[] = r.controls.controls.filter((k) => k.status === "BELUM DIISI").map((k) => ({
    code: `Kontrol ${k.no}`, module: "M1", name: plainName(k.name), value: k.value, comparator: k.comparator, difference: k.difference, status: k.status, action: k.action, detail: [],
  }));

  // PRD v5 §6.1 (flag v5_management): LB simulation, decisions waiting, loop status, source labels (K36)
  if (!noFunding) {
    // the weekly cash flow: the lowest day of the week, less the affiliate funding the week counts on (weekCash)
    const wc = weekCash(r);
    noFunding = [{ date: wc.lowest.date, closing: wc.lowestWithoutAffiliate.toFixed(2) }];
  }
  const v5Mgmt = isModuleOn(settings.v5_management, role) ? await loadManagementV5(sb, w, r, sp, noFunding) : null;

  const mode = sp.mode === "aktual" ? "aktual" : "proyeksi";
  const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    r, week: { start: w.week_start, end: w.week_end, update: w.update_date, status: w.status },
    weeks: ctx.weeks.map((x) => ({ start: x.week_start, end: x.week_end, status: x.status })),
    base: `/minggu-ini/${w.week_start}`,
    release: ctx.lastRelease ? { releasedAt: ctx.lastRelease.released_at, counts: ctx.lastRelease.controls?.counts ?? null } : null,
    mode, hari: iso(sp.hari), segmen: sp.segmen === "RPA" || sp.segmen === "Trading" ? sp.segmen : null, sku: sp.sku ?? null,
    on, plRows, lastWeek, stock, cashMart, month, solvency, demand, groups: null, roll: null, controlsV3, v5Pl, v5Mgmt,
    pdfHref: `/api/w/${w.week_start}/pdf`,
  };
}
