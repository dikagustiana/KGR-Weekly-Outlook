import "server-only";
/**
 * Reads of the Commercial screen v5 (flag v5_commercial): the commercial mart (through the sales view for Sales, K32),
 * the storage tariff of last month (journal Storage Expenses ÷ stock value at its end ÷ days), next week's commitments
 * and price list (K24, K26), PPIC's surplus and by-product shortfall (the PPIC v5 loader, one number), C52.
 */
import {
  D, actualRowsV4, addDays, baseKey, c52, commitmentDeadline, daysInMonth, filterRows, firstOfMonth, holdingRate, kgByBaseKey, lineTotals, spotRows, stockSellRows, stockSummary, sum,
  type StockFilter,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { computeForWeek, dataToday, fetchAll, listWeeks } from "../data";
import type { Row } from "../v3/uploads";
import { commercialMart } from "../v3/commercial";
import { assignedKeysFor, commercialView } from "../v3/commercial-view";
import { jakartaNow } from "../v3/allocation";
import { stockMartControl } from "../v3/stale";
import { loadPlanning } from "../v3/planning";
import { ROLE_LABEL } from "../roles";
import { loadPpicV5 } from "./ppic-data";
import type { CommitmentRow, KomersialV5Input } from "./komersial";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Storage tariff per day of the month before `date`; null without its journal or stock mart. */
async function storageRate(sb: Supa, date: string) {
  const first = addDays(firstOfMonth(date), -1).slice(0, 8) + "01";
  const last = addDays(firstOfMonth(date), -1);
  const [gl, coa, inv] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", first).lte("date", last).range(a, b)).catch(() => [] as Row[]),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, pl_line, segment").is("deleted_at", null).range(a, b)).catch(() => [] as Row[]),
    fetchAll<Row>((a, b) => sb.from("sku_balance_daily").select("cost_ma").eq("date", last).range(a, b)).catch(() => [] as Row[]),
  ]);
  if (!gl.length || !inv.length) return null;
  const lines = lineTotals(actualRowsV4({ gl: gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) })), coa: coa.map((c) => ({ account: String(c.account), pl_line: s(c.pl_line), segment: s(c.segment) })), from: first, to: last }));
  return holdingRate({ storageExpense: lines["Storage Expenses"] ?? null, inventoryEnd: sum(inv.map((r) => D(s(r.cost_ma) ?? "0"))), days: daysInMonth(first) });
}

export async function loadKomersialV5(sb: Supa, viewer: Viewer, filter: StockFilter): Promise<KomersialV5Input> {
  const now = jakartaNow();
  const today = await dataToday(sb, now.date);
  const sales = viewer.role === "sales";
  const weeks = await listWeeks(sb);
  const week = weeks.find((w) => w.week_start <= today && w.week_end >= today) ?? null;
  const next = week ? addDays(week.week_start, 7) : addDays(today, 7);
  const [mart, asg, par, approvals, commits, lists, orders] = await Promise.all([
    commercialMart(sb, today, sales),
    sb.from("sales_assignment").select("key").eq("active", true).ilike("email", viewer.email),
    week ? sb.from("parameter").select("sales_sees_cost, cut_off_time, commitment_lock_dow, commitment_lock_time").eq("week_id", week.id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("discount_approval").select("id", { count: "exact", head: true }).eq("status", "pending"),
    fetchAll<Row>((a, b) => sb.from("sales_commitment").select("key, fresh_kg, frozen_kg, price, status, version").eq("week_start", next).is("deleted_at", null).neq("status", "superseded").range(a, b)).catch(() => [] as Row[]),
    fetchAll<Row>((a, b) => sb.from("price_list_week").select("key, price_fresh, locked_at").eq("week_start", next).range(a, b)).catch(() => [] as Row[]),
    week ? fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, kg, status").in("status", ["Order", "Aktual"]).is("deleted_at", null).is("superseded_at", null).gte("date", week.week_start).lte("date", week.week_end).range(a, b)).catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
  ]);
  const p = (par.data ?? {}) as Row;
  const own = ((asg.data ?? []) as { key: string | null }[]);
  const assigned = assignedKeysFor(viewer.role, own);
  const view = commercialView(mart.rows, { role: viewer.role, salesSeesCost: p.sales_sees_cost !== false, assignedKeys: assigned });
  const overAge = sales || !mart.date ? new Map<string, string | null>() : new Map(((await sb.from("sku_balance_daily").select("key, over_age_kg").eq("date", mart.date)).data ?? [] as Row[]).map((r: Row) => [String(r.key), s(r.over_age_kg)]));
  const rate = sales ? null : await storageRate(sb, today);
  const all = stockSellRows(view.map((r) => ({
    key: r.key, form: r.form, free_kg: D(r.free_fresh_kg).plus(D(r.free_frozen_kg)).toFixed(2), oldest_age_days: r.oldest_age_days, over_age_kg: overAge.get(r.key) ?? "0",
    urgency: r.urgency, cost_per_kg: r.cost_per_kg ?? r.cost_per_kg_ma, cost_status: r.cost_status, price_ref: r.price_list, cost_check: r.cost_check,
  })), rate);
  const priceOf = new Map(view.map((r) => [r.key, r.price_list]));
  const frozen = (k: string) => priceOf.get(k.replace(/\|Fresh$/, "|Frozen")) ?? null;

  // K26 / K24: next week's commitments per base key (SKUs of this week's orders and sales, and those already committed)
  const { data: items } = await sb.from("item_map").select("item_code, key").is("deleted_at", null);
  const keyOf = new Map(((items ?? []) as Row[]).map((i) => [String(i.item_code), String(i.key)]));
  const weekKg = kgByBaseKey(orders.map((o) => ({ key: s(o.key_manual) ?? keyOf.get(String(o.item_code)) ?? "?", kg: s(o.kg) ?? "0" })).filter((o) => o.key.startsWith("RPA|")));
  const allowed = (k: string) => assigned === "all" || [...assigned].some((a) => baseKey(a) === k);
  const keys = [...new Set([...weekKg.keys(), ...commits.map((c) => String(c.key))])].filter((k) => k.startsWith("RPA|") && allowed(k))
    .sort((a, b) => (weekKg.get(b)?.cmp(weekKg.get(a) ?? D(0)) ?? 0));
  const rows: CommitmentRow[] = keys.map((k) => {
    const c = commits.filter((x) => String(x.key) === k).sort((a, b) => Number(b.version) - Number(a.version))[0];
    const pl = lists.find((l) => String(l.key) === k);
    return { key: k, thisWeekKg: weekKg.get(k) ?? null, fresh: s(c?.fresh_kg), frozen: s(c?.frozen_kg), price: s(c?.price) ?? s(pl?.price_fresh), status: c ? (String(c.status) as "draft" | "locked") : "belum diisi", version: c ? Number(c.version) : null };
  });
  const dow = Number(p.commitment_lock_dow ?? 5), time = String(p.commitment_lock_time ?? "17:00").slice(0, 5);
  const deadline = commitmentDeadline(next, dow, time);
  const dlDate = deadline.slice(0, 10);
  const controls = [c52({ now: `${now.date}T${now.time}:00+07:00`, deadline, commitments: commits.map((c) => ({ key: String(c.key), status: String(c.status) as "draft" | "locked" })) })];

  // PPIC: surplus and by-product shortfall of the week (not for Sales: planning detail)
  let ppic: KomersialV5Input["ppic"] = null;
  if (!sales && week) {
    try {
      const c = await computeForWeek(week.week_start);
      if (c) {
        const src = await loadPlanning(sb, week);
        const x = await loadPpicV5(sb, { src, result: c.result, base: "", versi: "batch", canPlan: false, c45: await stockMartControl(sb, addDays(week.week_start, -1)) });
        const latest = src.plans[0];
        const { data: ans } = latest ? await sb.from("surplus_response").select("response, absorb_kg").eq("plan_week_id", String(latest.id)).is("deleted_at", null).order("responded_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
        const a = ans as Row | null;
        ppic = {
          shipRange: `${Number(x.po.from.slice(8, 10))}–${Number(x.po.to.slice(8, 10))}/${x.po.to.slice(5, 7)}`, surplusKg: x.batch?.surplusKg ?? null, downgrade: x.batch?.downgrade ?? null,
          planCostKarkas: x.needCost?.lines.find((l) => l.key === "RPA|Karkas|Fresh")?.costPerKg ?? null, lbPrice: x.lbPrice.price,
          answered: a ? (a.response === "absorb" ? "sanggup serap semua" : a.response === "partial" ? `serap ${s(a.absorb_kg) ?? ""} kg` : "tidak sanggup, kurangi potong") : null,
          byProducts: x.byProducts.map((b) => ({ unit: b.unit, order: b.net_kg, output: b.output_kg, short: b.shortfall_kg })),
        };
      }
    } catch { ppic = null; }
  }

  return {
    today, roleLabel: ROLE_LABEL[viewer.role], sales, base: "/komersial", filter, stockDate: mart.date,
    rows: filterRows(all, filter), summary: stockSummary(all), holdingRate: rate, approvalsWaiting: approvals.count ?? 0, cutOffTime: String(p.cut_off_time ?? "14:00").slice(0, 5).replace(":", "."),
    commitment: {
      weekStart: next, weekEnd: addDays(next, 6), deadline: `${DAYS[new Date(`${dlDate}T00:00:00Z`).getUTCDay()]} ${Number(dlDate.slice(8, 10))}/${dlDate.slice(5, 7)} ${time.replace(":", ".")}`,
      rows, canEdit: ["admin", "sales", "commercial_lead"].includes(viewer.role), canLock: ["admin", "commercial_lead"].includes(viewer.role), priceListLocked: lists.length > 0 && lists.every((l) => l.locked_at),
    },
    ppic, spot: spotRows(all, frozen), controls,
  };
}
