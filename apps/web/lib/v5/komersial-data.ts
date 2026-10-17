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
import { computeForWeek, fetchAll, listWeeks } from "../data";
import { clock } from "../clock";
import { LoaderError, must, mustRows, tileData } from "../loader";
import { fail, type Failed } from "../v4/tile-errors";
import type { Row } from "../v3/uploads";
import { commercialMart } from "../v3/commercial";
import { assignedKeysFor, commercialView } from "../v3/commercial-view";
import { stockMartControl } from "../v3/stale";
import { loadPlanning } from "../v3/planning";
import { ROLE_LABEL } from "../roles";
import { loadPpicV5 } from "./ppic-data";
import { v5CostingSetting } from "./costing";
import { isModuleOn } from "../modules-core";
import type { CommitmentRow, KomersialV5Input } from "./komersial";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Storage tariff per day of the month before `date`; null without its journal or stock mart. */
async function storageRate(sb: Supa, date: string) {
  const first = addDays(firstOfMonth(date), -1).slice(0, 8) + "01";
  const last = addDays(firstOfMonth(date), -1);
  const [gl, coa, inv] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", first).lte("date", last).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, pl_line, segment").is("deleted_at", null).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sku_balance_daily").select("cost_ma").eq("date", last).range(a, b)),
  ]);
  if (!gl.length || !inv.length) return null;
  const lines = lineTotals(actualRowsV4({ gl: gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) })), coa: coa.map((c) => ({ account: String(c.account), pl_line: s(c.pl_line), segment: s(c.segment) })), from: first, to: last }));
  return holdingRate({ storageExpense: lines["Storage Expenses"] ?? null, inventoryEnd: sum(inv.map((r) => D(s(r.cost_ma) ?? "0"))), days: daysInMonth(first) });
}

const STOCK_TILES = ["headline", "c-stok", "c-hari", "c-bawah", "t-ranking", "t-spot"];

export async function loadKomersialV5(sb: Supa, viewer: Viewer, filter: StockFilter): Promise<KomersialV5Input> {
  // PRD v5.1 K38: the mart as of the data date; the commitment deadline (C52) against now; spot only when the data is today's
  const c = await clock(sb);
  const today = c.data;
  const sales = viewer.role === "sales";
  const failed: Failed = {};
  const weeks = await listWeeks(sb);
  const week = weeks.find((w) => w.week_start <= today && w.week_end >= today) ?? null;
  const next = week ? addDays(week.week_start, 7) : addDays(today, 7);
  const p = fail(failed, STOCK_TILES, await tileData("commercial: parameter minggu", async () =>
    (week ? (must(await sb.from("parameter").select("sales_sees_cost, cut_off_time, commitment_lock_dow, commitment_lock_time").eq("week_id", week.id).maybeSingle(), "parameter") ?? {}) : {}) as Row), {} as Row);
  const st = fail(failed, STOCK_TILES, await tileData("commercial: stok bebas (mart)", async () => {
    const [mart, own] = await Promise.all([
      // K53: the v5 cost columns only where v5_costing is on for this role
      commercialMart(sb, today, sales, isModuleOn(await v5CostingSetting(sb), viewer.role)),
      sb.from("sales_assignment").select("key").eq("active", true).eq("email", viewer.email.toLowerCase()).then((r) => mustRows<{ key: string | null }>(r, "sales_assignment")),
    ]);
    const overAge = sales || !mart.date ? new Map<string, string | null>()
      : new Map(mustRows<Row>(await sb.from("sku_balance_daily").select("key, over_age_kg").eq("date", mart.date), "sku_balance_daily").map((r) => [String(r.key), s(r.over_age_kg)]));
    return { mart, own, overAge };
  }), { mart: { date: null as string | null, rows: [] as Row[] }, own: [] as { key: string | null }[], overAge: new Map<string, string | null>() });
  const assigned = assignedKeysFor(viewer.role, st.own);
  // K43: an assignment covers every form of its base key, as the database guards and the v5 Sales view
  const scope = assigned === "all" ? "all" as const
    : new Set(st.mart.rows.map((r) => String(r.key)).filter((k) => [...assigned].some((a) => baseKey(a) === baseKey(k))));
  const view = commercialView(st.mart.rows, { role: viewer.role, salesSeesCost: p.sales_sees_cost !== false, assignedKeys: scope });
  const rate = sales ? null : fail(failed, ["c-simpan"], await tileData("commercial: tarif simpan", () => storageRate(sb, today)), null);
  const approvals = fail(failed, ["c-approval"], await tileData("commercial: approval diskon", async () => {
    const r = await sb.from("discount_approval").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (r.error) throw new LoaderError("discount_approval", r.error.message);
    return r.count ?? 0;
  }), 0);
  const all = stockSellRows(view.map((r) => ({
    key: r.key, form: r.form, free_kg: D(r.free_fresh_kg).plus(D(r.free_frozen_kg)).toFixed(2), oldest_age_days: r.oldest_age_days, over_age_kg: st.overAge.get(r.key) ?? "0",
    urgency: r.urgency, cost_per_kg: r.cost_per_kg ?? r.cost_per_kg_ma, cost_status: r.cost_status, price_ref: r.price_list, cost_check: r.cost_check,
  })), rate);
  const priceOf = new Map(view.map((r) => [r.key, r.price_list]));
  const frozen = (k: string) => priceOf.get(k.replace(/\|Fresh$/, "|Frozen")) ?? null;

  // K26 / K24: next week's commitments per base key (SKUs of this week's orders and sales, and those already committed)
  const cm = fail(failed, ["t-komitmen"], await tileData("commercial: komitmen minggu depan", async () => {
    const [commits, lists, orders, items] = await Promise.all([
      fetchAll<Row>((a, b) => sb.from("sales_commitment").select("key, fresh_kg, frozen_kg, price, status, version").eq("week_start", next).is("deleted_at", null).neq("status", "superseded").range(a, b)),
      fetchAll<Row>((a, b) => sb.from("price_list_week").select("key, price_fresh, price_frozen, price_frozen_source, locked_at").eq("week_start", next).is("deleted_at", null).range(a, b)),
      week ? fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, kg, status").in("status", ["Order", "Aktual"]).is("deleted_at", null).is("superseded_at", null).gte("date", week.week_start).lte("date", week.week_end).range(a, b)) : Promise.resolve([] as Row[]),
      fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).range(a, b)),
    ]);
    return { commits, lists, orders, items };
  }), { commits: [] as Row[], lists: [] as Row[], orders: [] as Row[], items: [] as Row[] });
  const keyOf = new Map(cm.items.map((i) => [String(i.item_code), String(i.key)]));
  const weekKg = kgByBaseKey(cm.orders.map((o) => ({ key: s(o.key_manual) ?? keyOf.get(String(o.item_code)) ?? "?", kg: s(o.kg) ?? "0" })).filter((o) => o.key.startsWith("RPA|")));
  const allowed = (k: string) => assigned === "all" || [...assigned].some((a) => baseKey(a) === k);
  const keys = [...new Set([...weekKg.keys(), ...cm.commits.map((x) => String(x.key))])].filter((k) => k.startsWith("RPA|") && allowed(k))
    .sort((a, b) => (weekKg.get(b)?.cmp(weekKg.get(a) ?? D(0)) ?? 0));
  const rows: CommitmentRow[] = keys.map((k) => {
    const cc = cm.commits.filter((x) => String(x.key) === k).sort((a, b) => Number(b.version) - Number(a.version))[0];
    const pl = cm.lists.find((l) => String(l.key) === k);
    return {
      key: k, thisWeekKg: weekKg.get(k) ?? null, fresh: s(cc?.fresh_kg), frozen: s(cc?.frozen_kg), price: s(cc?.price) ?? s(pl?.price_fresh), status: cc ? (String(cc.status) as "draft" | "locked") : "belum diisi", version: cc ? Number(cc.version) : null,
      priceFrozen: s(pl?.price_frozen), priceFrozenSource: (s(pl?.price_frozen_source) as "form" | "sku_price" | null) ?? null, listLocked: !!pl?.locked_at,
    };
  });
  const dow = Number(p.commitment_lock_dow ?? 5), time = String(p.commitment_lock_time ?? "17:00").slice(0, 5);
  const deadline = commitmentDeadline(next, dow, time);
  const dlDate = deadline.slice(0, 10);
  const controls = [c52({ now: c.now, deadline, commitments: cm.commits.map((x) => ({ key: String(x.key), status: String(x.status) as "draft" | "locked" })) })];

  // PPIC: surplus and by-product shortfall of the week (not for Sales: planning detail)
  const ppic: KomersialV5Input["ppic"] = sales || !week ? null : fail(failed, ["t-ppic"], await tileData("commercial: dari PPIC", async () => {
    const cw = await computeForWeek(week.week_start);
    if (!cw) return null;
    const src = await loadPlanning(sb, week);
    const x = await loadPpicV5(sb, { src, result: cw.result, base: "", versi: "batch", canPlan: false, c45: await stockMartControl(sb, addDays(week.week_start, -1)) });
    const latest = src.plans[0];
    const a = latest ? must(await sb.from("surplus_response").select("response, absorb_kg").eq("plan_week_id", String(latest.id)).is("deleted_at", null).order("responded_at", { ascending: false }).limit(1).maybeSingle(), "surplus_response") as Row | null : null;
    return {
      shipRange: `${Number(x.po.from.slice(8, 10))}–${Number(x.po.to.slice(8, 10))}/${x.po.to.slice(5, 7)}`, surplusKg: x.batch?.surplusKg ?? null, downgrade: x.batch?.downgrade ?? null,
      planCostKarkas: x.needCost?.lines.find((l) => l.key === "RPA|Karkas|Fresh")?.costPerKg ?? null, lbPrice: x.lbPrice.price,
      answered: a ? (a.response === "absorb" ? "sanggup serap semua" : a.response === "partial" ? `serap ${s(a.absorb_kg) ?? ""} kg` : "tidak sanggup, kurangi potong") : null,
      byProducts: x.byProducts.map((b) => ({ unit: b.unit, order: b.net_kg, output: b.output_kg, short: b.shortfall_kg })),
    };
  }), null);

  return {
    today, spotToday: today === c.wall, roleLabel: ROLE_LABEL[viewer.role], sales, base: "/komersial", filter, stockDate: st.mart.date,
    rows: filterRows(all, filter), summary: stockSummary(all), holdingRate: rate, approvalsWaiting: approvals, cutOffTime: String(p.cut_off_time ?? "14:00").slice(0, 5).replace(":", "."),
    commitment: {
      weekStart: next, weekEnd: addDays(next, 6), deadline: `${DAYS[new Date(`${dlDate}T00:00:00Z`).getUTCDay()]} ${Number(dlDate.slice(8, 10))}/${dlDate.slice(5, 7)} ${time.replace(":", ".")}`,
      rows, canEdit: ["admin", "sales", "commercial_lead"].includes(viewer.role), canLock: ["admin", "commercial_lead"].includes(viewer.role), priceListLocked: cm.lists.length > 0 && cm.lists.every((l) => l.locked_at),
    },
    ppic, spot: spotRows(all, frozen), controls, failed,
  };
}
