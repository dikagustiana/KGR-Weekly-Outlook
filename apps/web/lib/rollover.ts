import "server-only";
import { addDays, computeWeek, toFixedString, type WeekResult } from "@kgr/engine";
import type { Supa } from "./supabase";
import { fetchAll, loadWeek, type WeekRow } from "./data";
import { applyChanges, WriteError } from "./write";

type Row = Record<string, unknown>;

/**
 * Monday rollover (PRD §2 weekly routine): create the next week from the latest one.
 * Copies parameters, prices, run-rate (adjustment reset), TB; opening stock is carried from last week's
 * projected Sunday closing per key (flagged until the inventory valuation upload lands); last week's summary
 * comes from the latest released snapshot (or the live projection when nothing was released).
 */
export async function rolloverWeek(sb: Supa, prev: WeekRow): Promise<{ weekStart: string; carried: number; moved: number }> {
  const loaded = await loadWeek(sb, prev.week_start);
  if (!loaded) throw new WriteError("Minggu sebelumnya tidak ditemukan");
  const nextStart = addDays(prev.week_start, 7);
  const { data: exists } = await sb.from("week").select("id").eq("week_start", nextStart).maybeSingle();
  if (exists) throw new WriteError(`Minggu ${nextStart} sudah ada`);

  // last-week summary: released snapshot first, else live projection
  let lw: { RPA: Row; Trading: Row };
  let lwSource: string;
  const { data: rel } = await sb.from("release").select("snapshot, released_at").eq("week_id", prev.id).order("released_at", { ascending: false }).limit(1).maybeSingle();
  if (rel) {
    const b1 = (rel.snapshot as { block1: Row[] }).block1;
    const seg = (s: string) => b1.find((x) => x.segment === s) as Row;
    lw = { RPA: seg("RPA"), Trading: seg("Trading") };
    lwSource = `rilis ${prev.week_start} (${String(rel.released_at).slice(0, 16)})`;
  } else {
    const r = computeWeek({ ...loaded.inputs, week: { ...loaded.inputs.week, update_date: addDays(prev.week_start, 7) } });
    const pick = (s: WeekResult["block1"][number]) => ({ kgProjection: toFixedString(s.kgProjection, 2), revenueProjection: toFixedString(s.revenueProjection, 2), gpProjection: toFixedString(s.gpProjection, 2) });
    lw = { RPA: pick(r.block1[0]), Trading: pick(r.block1[1]) };
    lwSource = `proyeksi live ${prev.week_start} (belum dirilis)`;
  }
  const { data: wk, error } = await sb.from("week").insert({
    week_start: nextStart, update_date: nextStart, tb_opening_date: prev.tb_opening_date,
    lw_rpa_kg: lw.RPA.kgProjection, lw_rpa_revenue: lw.RPA.revenueProjection, lw_rpa_gp: lw.RPA.gpProjection,
    lw_trading_kg: lw.Trading.kgProjection, lw_trading_revenue: lw.Trading.revenueProjection, lw_trading_gp: lw.Trading.gpProjection,
    lw_source: lwSource, opening_stock_flag: "dibawa dari proyeksi minggu lalu — menunggu upload Inventory Valuation",
  }).select("id").single();
  if (error) throw new WriteError(error.message);
  const wid = (wk as { id: string }).id;

  const p = { ...loaded.db.parameter };
  delete p.week_id; delete p.updated_at; delete p.updated_by;
  p.accurate_sales_kg = null; p.accurate_opening_stock_value = null;
  const e1 = await sb.from("parameter").insert({ ...p, week_id: wid });
  if (e1.error) throw new WriteError(`parameter: ${e1.error.message}`);
  const prices = loaded.db.prices.map((x) => ({ week_id: wid, key: x.key, ref_sell_price: x.ref_sell_price, replacement_buy_price: x.replacement_buy_price, note: x.note }));
  if (prices.length) {
    const e2 = await sb.from("sku_price").insert(prices);
    if (e2.error) throw new WriteError(`sku_price: ${e2.error.message}`);
  }
  const rr = loaded.db.runrate.map((x) => ({ week_id: wid, pl_line: x.pl_line, monthly_amount: x.monthly_amount, week_adjustment: 0, basis: x.basis, seq: x.seq }));
  if (rr.length) {
    const e3 = await sb.from("runrate").insert(rr);
    if (e3.error) throw new WriteError(`runrate: ${e3.error.message}`);
  }
  await applyChanges(sb, "tb_opening", loaded.db.tb.map((t, i) => ({ week_id: wid, seq: i + 1, account: t.account, name: t.name, balance: t.balance, source: t.source })));

  // opening stock carried per key from last week's projected Sunday closing
  const res = computeWeek({ ...loaded.inputs, week: { ...loaded.inputs.week, update_date: addDays(prev.week_start, 7) } });
  const carried = res.stock.rows
    .filter((s) => !s.closing[6].isZero())
    .map((s, i) => ({
      week_id: wid, seq: i + 1, item_code: null, item_name: null, key_manual: s.key, kg: toFixedString(s.closing[6], 2),
      value: toFixedString(s.closing[6].times(s.avgCost), 2),
      avg_age_days: s.avgAgeDays === null ? null : toFixedString(s.avgAgeDays.plus(7), 2),
      kg_over_age_limit: toFixedString(s.kgOverAgeLimit.greaterThan(s.closing[6]) ? s.closing[6] : s.kgOverAgeLimit, 2),
      note: "dibawa dari proyeksi akhir minggu lalu (menunggu Inventory Valuation)", source: "Ops",
    }));
  await applyChanges(sb, "opening_stock", carried);

  // orders / plans already entered for dates in the new week move with it
  const inNext = (d: unknown) => typeof d === "string" && d >= nextStart && d <= addDays(nextStart, 6);
  const strip = (r: Row) => {
    const { id: _id, week_id: _w, created_at: _c, created_by: _cb, updated_at: _u, updated_by: _ub, deleted_at: _d, deleted_by: _db, ...rest } = r;
    return { ...rest, week_id: wid };
  };
  let moved = 0;
  for (const [table, rows, keep] of [
    ["sales_line", loaded.db.sales, (r: Row) => r.status === "Order"],
    ["receipt_line", loaded.db.receipts, (r: Row) => r.status === "Rencana"],
    ["batch", loaded.db.batches, (r: Row) => r.status === "Rencana"],
    ["cash_plan", loaded.db.cashPlan, () => true],
  ] as [string, Row[], (r: Row) => boolean][]) {
    const xs = rows.filter((r) => inNext(r.date) && keep(r)).map(strip);
    if (xs.length) moved += (await applyChanges(sb, table, xs)).inserted;
  }
  await sb.from("week").update({ status: "closed" }).eq("id", prev.id);
  return { weekStart: nextStart, carried: carried.length, moved };
}

export async function weekIdOf(sb: Supa, weekStart: string): Promise<string> {
  const { data } = await sb.from("week").select("id").eq("week_start", weekStart).maybeSingle();
  if (!data) throw new WriteError(`Minggu ${weekStart} tidak ada`);
  return (data as { id: string }).id;
}

export { fetchAll };
