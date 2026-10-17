import "server-only";
/**
 * M2 lot ledger — sources, rebuild (data mart writer) and reads (PRD v3 §4.3). The ledger is computed by
 * @kgr/engine (computeLedger, balanceAt, reconcile, ledgerControls); this file loads rows and writes the results.
 */
import {
  balanceAt, computeLedger, finalLots, keyResolver, ledgerControls, lowestStatus, reconcile, reconcileSplit, revalueLots, toFixedString, D, addDays,
  type CostStatus, type FinalBatch,
  type BalanceResult, type ControlV3, type Decimal, type LedgerInputs, type LedgerKeyInfo, type LedgerResult, type ReconPart, type StockCardRow,
} from "@kgr/engine";
import { parseV3Table } from "@kgr/parsers";
import type { Supa } from "../supabase";
import { fetchAll, fetchAllOrMissing, listWeeks, type WeekRow } from "../data";
import { mustRows } from "../loader";
import { WriteError } from "../write";
import { martReplace, registerBuilder } from "../rebuild-registry";
import { plan0, registerV3Kind, type Row } from "./uploads";
import { salesWithDeliveries } from "../v4/delivery-ledger";
import { costOfKey, v5CostingOn, v5LedgerCosts, type V5LedgerCosts } from "../v5/costing";

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const f = (x: Decimal | null | undefined, dp: number) => (x === null || x === undefined ? null : toFixedString(x, dp));

export interface LedgerSources {
  inputs: LedgerInputs;
  weeks: WeekRow[];
  latest: WeekRow;
  /** Stock-card snapshots per date: uploads, and the Monday opening stock of every later week (balance of the day before). */
  cards: Map<string, StockCardRow[]>;
  /** PRD v5 §4.1 (flag v5_costing): costing status and cost of the RPA batches; null = flag off (ebe4ad8 behaviour). */
  v5: V5LedgerCosts | null;
}

/** Everything the ledger needs, from the first week that has opening stock to the latest week's projection. */
export async function loadLedgerSources(sb: Supa): Promise<LedgerSources | null> {
  const weeks = (await listWeeks(sb)).slice().sort((a, b) => a.week_start.localeCompare(b.week_start));
  if (!weeks.length) return null;
  const latest = weeks[weeks.length - 1];
  const items = await fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).range(a, b));
  const keyOf = keyResolver(items.map((i) => ({ item_code: s(i.item_code), key: String(i.key) })));
  const opening = await fetchAll<Row>((a, b) => sb.from("opening_stock").select("id, week_id, item_code, key_manual, kg, value, avg_age_days")
    .is("deleted_at", null).is("superseded_at", null).range(a, b));
  const first = weeks.find((w) => opening.some((o) => o.week_id === w.id));
  if (!first) return null;
  // v5 K20–K23: an RPA batch without a posted allocation takes the planCost of its status (estimasi / sementara)
  const v5 = (await v5CostingOn(sb)) ? await v5LedgerCosts(sb, first.week_start, latest.update_date, latest.id) : null;
  const v5Cost = new Map(v5 ? v5.batches.map((b) => [b.batch_ref, b.costByKey]) : []);
  const [receipts, sales, blasts, manual, keys, param, cardsUp, allocs, m3alloc] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("receipt_line").select("id, week_id, date, status, receipt_source, item_code, key_manual, kg, unit_cost, document_ref")
      .is("deleted_at", null).is("superseded_at", null).gte("date", first.week_start).order("date").order("seq").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_line").select("id, week_id, date, status, item_code, key_manual, kg, cancelled_kg, hpp_actual, document_ref")
      .is("deleted_at", null).is("superseded_at", null).gte("date", first.week_start).order("date").order("seq").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("blast_event").select("id, date, lot_ref_from, key_to, kg").is("deleted_at", null).order("date").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("lot_movement").select("id, date, lot_ref, key, item_code, kg, cost, note").eq("ref_table", "manual").order("date").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sku_key").select("key, group_code, fresh_window_hours, frozen_age_limit_days").range(a, b)),
    sb.from("parameter").select("blast_cost_per_kg, fresh_window_hours_default, frozen_age_limit_days_default").eq("week_id", latest.id).maybeSingle(),
    fetchAll<Row>((a, b) => sb.from("stock_card_snapshot").select("date, item_code, kg, value").is("deleted_at", null).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("allocation_run").select("id, batch:batch_id(batch_ref), allocation_line(key, kg, allocated_cost)").eq("status", "posted").range(a, b)),
    // M3 allocations (F3b): which lot a PO line / DO takes. Missing table (M3 not migrated) = none.
    fetchAllOrMissing<Row>((a, b) => sb.from("allocation").select("sales_line_id, lot_ref, kg").is("deleted_at", null).range(a, b), "ledger.allocation"),
  ]);
  // K7 (PRD v4 irisan 3): deliveries recorded on open PO lines; missing table (v4 not migrated) = none
  const deliveries = await fetchAllOrMissing<Row>((a, b) => sb.from("delivery").select("id, sales_line_id, date, kg, document_ref").is("deleted_at", null).gte("date", first.week_start).order("date").range(a, b), "ledger.delivery");
  // M1 specific cost per batch × key (posted allocations), used as the lot's SI cost; MA stays on the GRN cost
  const si = new Map<string, { kg: ReturnType<typeof D>; cost: ReturnType<typeof D> }>();
  for (const r of allocs) {
    const ref = s((r.batch as Row | null)?.batch_ref);
    if (!ref) continue;
    for (const l of (r.allocation_line as Row[] | null) ?? []) {
      const k = `${ref}|${s(l.key)}`;
      const a = si.get(k) ?? { kg: D(0), cost: D(0) };
      si.set(k, { kg: a.kg.plus(D(s(l.kg))), cost: a.cost.plus(D(s(l.allocated_cost))) });
    }
  }
  const p = (param.data ?? {}) as Row;
  const isLatest = (wid: unknown) => wid === latest.id;
  const keyInfo: LedgerKeyInfo[] = keys.map((k) => ({
    key: String(k.key), form: String(k.key).endsWith("|Fresh") ? "fresh" : "frozen", group_code: s(k.group_code),
    fresh_window_hours: k.fresh_window_hours === null ? null : Number(k.fresh_window_hours),
    frozen_age_limit_days: k.frozen_age_limit_days === null ? null : Number(k.frozen_age_limit_days),
  }));
  const inputs: LedgerInputs = {
    startDate: first.week_start,
    today: latest.update_date,
    opening: opening.filter((o) => o.week_id === first.id).map((o) => ({
      ref: String(o.id), item_code: s(o.item_code), key: keyOf(s(o.key_manual), s(o.item_code)), kg: s(o.kg), value: s(o.value), avg_age_days: s(o.avg_age_days),
    })),
    // plans and orders only from the latest week (older weeks' undelivered plans are history, not stock)
    receipts: receipts.filter((r) => r.status === "Aktual" || isLatest(r.week_id)).map((r) => {
      const key = keyOf(s(r.key_manual), s(r.item_code));
      const c = r.receipt_source === "Produksi RPA" ? si.get(`${s(r.document_ref)}|${key}`) : undefined;
      const v = !c && v5 && r.receipt_source === "Produksi RPA" ? costOfKey(v5Cost.get(s(r.document_ref) ?? "") ?? new Map(), key) : undefined;
      return {
        ref: String(r.id), date: s(r.date), status: s(r.status), source: s(r.receipt_source), item_code: s(r.item_code), key, kg: s(r.kg),
        unit_cost: s(r.unit_cost), document_ref: s(r.document_ref), cost_per_kg_si: c && !c.kg.isZero() ? c.cost.div(c.kg).toFixed(4) : v ? v.toFixed(4) : null,
      };
    }),
    sales: salesWithDeliveries(sales.filter((r) => r.status === "Aktual" || isLatest(r.week_id)), deliveries, keyOf),
    blasts: blasts.map((b) => ({ ref: String(b.id), date: String(b.date), lot_ref: String(b.lot_ref_from), kg: String(b.kg), to_key: s(b.key_to) })),
    adjustments: manual.map((m) => ({
      ref: String(m.id), date: String(m.date), lot_ref: s(m.lot_ref), key: String(m.key), item_code: s(m.item_code), kg: String(m.kg),
      cost_per_kg: m.cost !== null && m.kg !== null && !D(s(m.kg)).isZero() ? D(s(m.cost)).div(D(s(m.kg))).abs().toFixed(4) : null, note: s(m.note),
    })),
    keys: keyInfo,
    params: {
      blastCostPerKg: s(p.blast_cost_per_kg) ?? "0",
      defaultFreshWindowHours: Number(p.fresh_window_hours_default ?? 48), defaultFrozenAgeLimitDays: Number(p.frozen_age_limit_days_default ?? 30),
    },
  };
  inputs.allocations = await ledgerAllocations(sb, m3alloc, inputs.sales);
  const cards = new Map<string, StockCardRow[]>();
  for (const c of cardsUp) {
    const d = String(c.date);
    cards.set(d, [...(cards.get(d) ?? []), { item_code: String(c.item_code), key: keyOf(null, s(c.item_code)), kg: String(c.kg), value: s(c.value) }]);
  }
  for (const w of weeks.filter((x) => x.week_start > first.week_start)) {
    const rows = opening.filter((o) => o.week_id === w.id);
    const d = addDays(w.week_start, -1);
    if (rows.length && !cards.has(d)) cards.set(d, rows.map((o) => ({ item_code: s(o.item_code) ?? "", key: keyOf(s(o.key_manual), s(o.item_code)), kg: s(o.kg) ?? "0", value: s(o.value) })));
  }
  return { inputs, weeks, latest, cards, v5 };
}

/**
 * M3 allocations as ledger input. An allocation names the sales line it was made for; when that line was later replaced
 * (an Accurate posting supersedes the Ops / delivered row), it follows to the active line with the same document and key.
 */
async function ledgerAllocations(sb: Supa, rows: Row[], sales: LedgerInputs["sales"]): Promise<NonNullable<LedgerInputs["allocations"]>> {
  if (!rows.length) return [];
  const active = new Set(sales.map((x) => x.ref));
  const lost = [...new Set(rows.map((r) => String(r.sales_line_id)).filter((id) => !active.has(id)))];
  const moved = new Map<string, string>();
  for (let i = 0; i < lost.length; i += 200) {
    const data = mustRows(await sb.from("sales_line").select("id, document_ref, item_code, key_manual").in("id", lost.slice(i, i + 200)), "ledger.lost_sales");
    for (const o of data as Row[]) {
      const to = sales.find((x) => x.status === "Aktual" && x.document_ref === s(o.document_ref) && (x.item_code ?? "").toUpperCase() === (s(o.item_code) ?? "").toUpperCase());
      if (to) moved.set(String(o.id), to.ref);
    }
  }
  return rows.map((r) => ({ sales_ref: moved.get(String(r.sales_line_id)) ?? String(r.sales_line_id), lot_ref: String(r.lot_ref), kg: String(r.kg) }))
    .filter((a) => active.has(a.sales_ref));
}

type Revaluation = { byDate: Map<string, ReturnType<typeof revalueLots>["rows"]>; pl: { date: string; amount: string }[] };
type Run = { src: LedgerSources; led: LedgerResult; revenueDates: Map<string, string>; ma: Map<string, Map<string, Decimal>>; reval?: Revaluation | null };
let run: Run | null = null;

/**
 * PRD v5.1 R40 (B.4): forget the ledger run kept by the last rebuild. A month lock outside a rebuild computes the
 * "Selisih costing" from a fresh run, not from a run left in this server process by an earlier rebuild.
 */
export function resetLedgerRun(): void { run = null; }

async function ensureRun(sb: Supa): Promise<Run | null> {
  if (run) return run;
  const src = await loadLedgerSources(sb);
  if (!src) return null;
  // PRD v4 §3.5 DI-01: an Ops DO line replaced by its Accurate invoice line keeps its date as the revenue date (K11)
  const ops = await fetchAll<Row>((a, b) => sb.from("sales_line").select("date, document_ref").eq("source", "Ops").eq("status", "Aktual")
    .not("superseded_at", "is", null).is("deleted_at", null).gte("date", src.inputs.startDate).range(a, b));
  const revenueDates = new Map<string, string>();
  for (const o of ops) {
    const d = s(o.document_ref), dt = s(o.date);
    if (d && dt && (!revenueDates.has(d) || dt < revenueDates.get(d)!)) revenueDates.set(d, dt);
  }
  run = { src, led: computeLedger(src.inputs), revenueDates, ma: new Map() };
  return run;
}

/**
 * K22 (flag v5_costing): the batches turned final since v5 costing runs, revalued on their final date — lot_revaluation
 * rows per date and the "Selisih costing" P&L amounts (revaluation_sold_mode). Computed once per rebuild run.
 */
function revaluationOf(r: Run): Revaluation | null {
  if (r.reval !== undefined) return r.reval;
  const v5 = r.src.v5;
  if (!v5) return (r.reval = null);
  // R40: without a start date (value.since) nothing is revalued
  const since = v5.since;
  const finals: FinalBatch[] = since === null ? [] : v5.batches.filter((b) => b.finalDate && b.provisional && b.finalDate >= since && b.finalDate >= r.src.inputs.startDate).map((b) => ({
    batch_ref: b.batch_ref, finalDate: b.finalDate!, statusFrom: b.provisional!.status,
    costFromByKey: new Map(b.provisional!.lines.filter((l) => l.costPerKg !== null).map((l) => [l.key, l.costPerKg!])),
  }));
  const byDate: Revaluation["byDate"] = new Map();
  const pl: Revaluation["pl"] = [];
  for (const d of [...new Set(finals.map((x) => x.finalDate))].sort()) {
    const bal = balanceAt(r.led, d, r.src.inputs.keys, r.src.inputs.params);
    const res = revalueLots({ date: d, mode: v5.mode, lots: finalLots({ led: r.led, date: d, kgByLot: new Map(bal.perLot.map((l) => [l.lot_ref, l.kg])), finals }) });
    byDate.set(d, res.rows);
    pl.push(...res.plRows.map((p) => ({ date: p.date, amount: p.amount.toFixed(2) })));
  }
  return (r.reval = { byDate, pl });
}

/** "Selisih costing" amounts (P&L sign) for the P&L builders; [] while v5_costing or the ledger is off. */
export async function v5SelisihCosting(sb: Supa): Promise<{ date: string; amount: string }[]> {
  // the ledger builder's run of this rebuild when it ran, else a fresh one (not kept: the M2 builder owns the cache)
  let r = run;
  if (!r) {
    const src = await loadLedgerSources(sb);
    if (!src?.v5) return [];
    r = { src, led: computeLedger(src.inputs), revenueDates: new Map(), ma: new Map() };
  }
  return revaluationOf(r)?.pl ?? [];
}

/** rebuildDay for M2: lots entering the ledger that day, that day's movements, balances per lot and per key. */
export async function buildLedgerDay(sb: Supa, date: string): Promise<string> {
  const r = await ensureRun(sb);
  if (!r) return "belum ada stok awal";
  const { src, led } = r;
  if (date < src.inputs.startDate) return "sebelum stok awal";
  const ledgerDate = (l: { origin: string; origin_date: string }) => (l.origin_date < src.inputs.startDate ? src.inputs.startDate : l.origin_date);
  // v5 K20: a lot carries the status of its batch's cost; opening stock, trading and adjustments are final
  const statusOfLot = (l: { batch_ref: string | null }): CostStatus => (l.batch_ref ? src.v5?.statusByBatch.get(l.batch_ref) ?? "final" : "final");
  const firstMove = new Map<string, string>();
  for (const m of led.movements) if (!m.planned && (!firstMove.has(m.lot_ref) || m.date < firstMove.get(m.lot_ref)!)) firstMove.set(m.lot_ref, m.date);
  const lots = led.lots.filter((l) => !l.planned && (firstMove.get(l.ref) ?? ledgerDate(l)) === date).map((l) => ({
    lot_ref: l.ref, batch_ref: l.batch_ref, key: l.key, item_code: l.item_code, form: l.form, origin: l.origin, origin_date: l.origin_date,
    ledger_date: date, parent_lot_ref: l.parent_ref, kg_in: f(l.kg_in, 2), cost_in: f(l.cost_in, 2), cost_per_kg_si: f(l.cost_per_kg_si, 4),
    cost_per_kg_book: f(l.cost_per_kg_book, 4), assumed: l.assumed, note: l.note,
    cost_status: src.v5 ? statusOfLot(l) : null,
  }));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lotKey = new Map(led.lots.map((l) => [l.ref, l]));
  // MA per kg of a key at the end of a day (DI-01: the COGS of a DO at the revenue date)
  const maAt = (day: string, key: string | null): Decimal | null => {
    if (!key) return null;
    if (!r.ma.has(day)) {
      const bal = balanceAt(led, day, src.inputs.keys, src.inputs.params);
      const m = new Map<string, { kg: Decimal; cost: Decimal }>();
      for (const k of bal.perKey) { const o = m.get(k.key) ?? { kg: D(0), cost: D(0) }; m.set(k.key, { kg: o.kg.plus(k.kg), cost: o.cost.plus(k.cost_ma) }); }
      r.ma.set(day, new Map([...m].filter(([, v]) => v.kg.gt(0)).map(([k, v]) => [k, v.cost.div(v.kg)])));
    }
    return r.ma.get(day)!.get(key) ?? null;
  };
  const moves = led.movements.filter((m) => !m.planned && m.date === date && m.ref_table !== "lot_movement").map((m) => {
    const key = lotKey.get(m.lot_ref)?.key ?? null;
    const rev = m.type === "out_sale" && m.document_ref ? r.revenueDates.get(m.document_ref) ?? null : null;
    const revenueDate = rev && rev < m.date ? rev : null;
    const ma = revenueDate ? maAt(revenueDate, key) : null;
    return {
      movement_ref: m.ref, lot_ref: m.lot_ref, date: m.date, type: m.type, kg: f(m.kg, 2), cost: f(m.cost_si, 2), cost_ma: f(m.cost_ma, 2),
      ref_table: m.ref_table, ref_id: m.ref_id, document_ref: m.document_ref, sales_line_id: m.sales_ref && uuid.test(m.sales_ref) ? m.sales_ref : null,
      key, item_code: lotKey.get(m.lot_ref)?.item_code ?? null, assumed: m.assumed, note: null,
      // DI-01: both values kept — cost_ma on the invoice date (the movement date), cost_ma_revenue on the DO date
      revenue_date: revenueDate, cost_ma_revenue: ma === null ? null : f(m.kg.times(ma), 2),
    };
  });
  const b = balanceAt(led, date, src.inputs.keys, src.inputs.params);
  const lotRows = b.perLot.map((l) => ({
    date, lot_ref: l.lot_ref, key: l.key, form: l.form, kg: f(l.kg, 2), cost_ma: f(l.cost_ma, 2), cost_per_kg_ma: f(l.cost_per_kg_ma, 4),
    cost_si: f(l.cost_si, 2), cost_per_kg_si: f(l.cost_per_kg_si, 4), age_days: l.age_days, hours_to_cutoff: l.hours_to_cutoff,
    reserved_kg: f(l.reserved_kg, 2), free_kg: f(l.free_kg, 2), over_age: l.over_age,
  }));
  const lotStatus = new Map(led.lots.map((l) => [l.ref, statusOfLot(l)]));
  const keyStatus = (key: string) => lowestStatus(b.perLot.filter((l) => l.key === key && l.kg.gt(0)).map((l) => lotStatus.get(l.lot_ref))) ?? "final";
  const keyRows = b.perKey.map((k) => ({
    date, key: k.key, group_code: k.group_code, form: k.form, kg: f(k.kg, 2), free_kg: f(k.free_kg, 2), reserved_kg: f(k.reserved_kg, 2),
    cost_ma: f(k.cost_ma, 2), cost_per_kg_ma: f(k.cost_per_kg_ma, 4), cost_si: f(k.cost_si, 2), cost_per_kg_si: f(k.cost_per_kg_si, 4),
    oldest_age_days: k.oldest_age_days, over_age_kg: f(k.over_age_kg, 2), lots: k.lots, projected: date >= src.inputs.today,
    // v5: the lowest status of the lots still in stock (rencana < estimasi < sementara < final); K55: the key is always
    // sent (null while v5_costing is off) so mart_replace clears a status an earlier build wrote
    cost_status: src.v5 ? keyStatus(k.key) : null,
  }));
  const w1 = await martReplace(sb, "lot", date, lots);
  const w2 = await martReplace(sb, "lot_movement", date, moves);
  const w3 = await martReplace(sb, "lot_balance_daily", date, lotRows);
  const w4 = await martReplace(sb, "sku_balance_daily", date, keyRows);
  // K22: lot_revaluation of the day (written only while v5_costing is on)
  const rv = src.v5 ? (revaluationOf(r)?.byDate.get(date) ?? []).map((x) => ({
    date, lot_ref: x.lot_ref, key: x.key, cost_from: f(x.cost_from, 4), cost_to: f(x.cost_to, 4), kg_remaining: f(x.kg_remaining, 2), kg_sold: f(x.kg_sold, 2),
    amount: f(x.amount, 2), amount_sold: f(x.amount_sold, 2), status_from: x.status_from, status_to: x.status_to,
    sold_by_date: x.sold_by_date.map((y) => ({ date: y.date, kg: f(y.kg, 2), amount: f(y.amount, 2) })),
  })) : null;
  const w5 = rv ? await martReplace(sb, "lot_revaluation", date, rv) : { written: 0, deleted: 0 };
  const wr = w1.written + w2.written + w3.written + w4.written + w5.written, del = w1.deleted + w2.deleted + w3.deleted + w4.deleted + w5.deleted;
  return `${keyRows.length} key, ${lotRows.length} lot, ${moves.length} mutasi${rv ? `, ${rv.length} revaluasi` : ""} (${wr} ditulis, ${del} dihapus)`;
}

registerBuilder({ module: "m2_ledger", name: "ledger", begin: async (sb) => { run = null; await ensureRun(sb); }, build: buildLedgerDay });

/** C25–C27 for one day (engine reconcile + ledgerControls). bsInventory/reconciling come from the week (v1 statements, D3). */
export function ledgerControlsAt(src: LedgerSources, led: LedgerResult, date: string, bsInventory: string | null, reconciling: { label: string; amount: string }[]): { controls: ControlV3[]; balance: BalanceResult; cardDate: string | null } {
  const balance = balanceAt(led, date, src.inputs.keys, src.inputs.params);
  const cardDate = [...src.cards.keys()].filter((d) => d <= date).sort().pop() ?? null;
  const cardBal = cardDate ? balanceAt(led, cardDate, src.inputs.keys, src.inputs.params) : null;
  const rc = reconcile({ ledger: led, balance, stockCard: null, bsInventory, reconcilingItems: reconciling });
  const rcCard = cardDate && cardBal ? reconcile({ ledger: led, balance: cardBal, stockCard: src.cards.get(cardDate)!, bsInventory: null }) : null;
  return {
    controls: ledgerControls({ ...rc, cardDiffs: rcCard ? rcCard.cardDiffs : null, cardDate }),
    balance, cardDate,
  };
}

export async function ledgerForWeek(sb: Supa, week: WeekRow, bsYesterday: string | null): Promise<{ controls: ControlV3[]; balance: BalanceResult | null; date: string } | null> {
  const src = await loadLedgerSources(sb);
  if (!src) return null;
  const led = computeLedger(src.inputs);
  const date = addDays(week.update_date, -1);
  const fixes = mustRows(await sb.from("data_fix").select("fix_id, amount, status").eq("week_id", week.id).eq("fix_id", "D3"), "ledgerForWeek.data_fix") as Row[];
  const reconciling = fixes.filter((x) => x.status !== "applied" && x.amount !== null).map((x) => ({ label: String(x.fix_id), amount: String(x.amount) }));
  const r = ledgerControlsAt(src, led, date, bsYesterday, reconciling);
  return { controls: r.controls, balance: r.balance, date };
}

/**
 * PRD v4 §3.6: the reconciliation split in five, kg and Rp apart, on the balance date of a week (update date − 1).
 * (a) uses the latest stock card on or before that date against the ledger on the card's own date. (c) carries the D3
 * rows not yet booked as reasoned items (as C27 does); (e) the opening gap stays a difference until D3 is booked or
 * decided by Finance: no plug.
 */
export async function rekonSplitForWeek(sb: Supa, week: WeekRow, bsYesterday: string | null): Promise<{ date: string; cardDate: string | null; parts: ReconPart[] } | null> {
  const src = await loadLedgerSources(sb);
  if (!src) return null;
  const led = computeLedger(src.inputs);
  const date = addDays(week.update_date, -1);
  const balance = balanceAt(led, date, src.inputs.keys, src.inputs.params);
  const cardDate = [...src.cards.keys()].filter((d) => d <= date).sort().pop() ?? null;
  const hppByRef = new Map(src.inputs.sales.filter((x) => x.hpp_actual !== null && x.hpp_actual !== undefined && x.hpp_actual !== "").map((x) => [x.ref, x.hpp_actual!]));
  const fixes = await fetchAll<Row>((a, b) => sb.from("data_fix").select("week_id, amount, status").eq("fix_id", "D3").eq("scope", "opening_vs_bs").range(a, b));
  const firstWeek = src.weeks.find((w) => w.week_start === src.inputs.startDate);
  const d3First = fixes.find((x) => x.week_id === firstWeek?.id && x.amount !== null);
  const openingValue = src.inputs.opening.reduce((acc, o) => acc.plus(D(o.value ?? 0)), D(0));
  const openGap = d3First ? D(String(d3First.amount)) : null;
  const reasoned = [
    ...fixes.filter((x) => x.week_id === week.id && x.amount !== null && x.status !== "applied").map((x) => ({ label: "D3 belum dibukukan", amount: String(x.amount), part: "c" as const })),
    ...(d3First && (d3First.status === "applied" || d3First.status === "decided") ? [{ label: `D3 ${d3First.status === "applied" ? "dibukukan" : "diputuskan Finance"}`, amount: String(d3First.amount), part: "e" as const }] : []),
  ];
  const parts = reconcileSplit({
    ledger: led, balance, hppByRef, stockCard: null, bsInventory: bsYesterday,
    openingBs: openGap === null ? null : openingValue.minus(openGap).toFixed(2), openingValue: openGap === null ? null : openingValue.toFixed(2), reasoned,
  });
  if (cardDate) {
    const a = reconcileSplit({ ledger: led, balance: balanceAt(led, cardDate, src.inputs.keys, src.inputs.params), hppByRef, stockCard: src.cards.get(cardDate)!, bsInventory: null, openingBs: null, openingValue: null, reasoned: [] }).find((x) => x.part === "a")!;
    parts[0] = a;
  }
  return { date, cardDate, parts };
}

/** Reads for /sku and /sku/[key]: the latest built day ≤ the requested date. */
export async function skuBalances(sb: Supa, date: string): Promise<{ date: string | null; rows: Row[] }> {
  const { data } = await sb.from("sku_balance_daily").select("date").lte("date", date).order("date", { ascending: false }).limit(1).maybeSingle();
  const d = data ? String((data as Row).date) : null;
  if (!d) return { date: null, rows: [] };
  const rows = await fetchAll<Row>((a, b) => sb.from("sku_balance_daily").select("*").eq("date", d).order("key").range(a, b));
  return { date: d, rows };
}

registerV3Kind({
  kind: "stock_card", module: "m2_ledger", label: "Accurate — saldo stok per item (kartu stok, rekon ledger)", source: "Accurate",
  target: "stock_card_snapshot", roles: ["admin", "inventory_accounting"],
  description: "Saldo kg dan nilai per kode item pada satu tanggal (Inventory Valuation / kartu stok). Dipakai kontrol C26 (ledger vs kartu stok). Upload ulang tanggal yang sama menimpa.",
  async stage({ sheets }) {
    const res = parseV3Table("stock_card", sheets);
    const ok = res.rows.filter((r) => !r.issues.length);
    const dates = [...new Set(ok.map((r) => r.values.date).filter((x): x is string => !!x))].sort();
    const p = plan0("stock_card_snapshot", "Kartu stok", [`tanggal ${dates.join(", ") || "—"}`]);
    p.inserts = ok.length;
    return { rows: ok.map((r) => ({ target: "card", data: r.values as Row })), plan: [p], issues: res.issues, note: `${ok.length} item`, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null, sample: ok.slice(0, 25).map((r) => r.values as Row), unmappedItems: [] };
  },
  async commit({ sb, uploadId, rows }) {
    const data = rows.map((r) => ({ date: s(r.data.date), item_code: s(r.data.item_code), item_name: s(r.data.item_name), kg: D(s(r.data.kg)).toFixed(2), value: r.data.value === null ? null : D(s(r.data.value)).toFixed(2), source: "Accurate", upload_id: uploadId, deleted_at: null }));
    for (let i = 0; i < data.length; i += 500) {
      const e = await sb.from("stock_card_snapshot").upsert(data.slice(i, i + 500), { onConflict: "date,item_code" });
      if (e.error) throw new WriteError(`stock_card_snapshot: ${e.error.message}`);
    }
    return { inserted: data.length, updated: 0, deleted: 0, dates: [...new Set(data.map((d) => d.date).filter((x): x is string => !!x))], message: "Kartu stok disimpan (C26)" };
  },
});
