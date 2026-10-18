/**
 * Finance close of PRD v4 (§3.5, §3.6, §7.1, §7.2): the release verdict (the same rule the database applies inside
 * release_week / release_month, so a page can say why before anyone presses the button), the mandatory controls per
 * monthly version, C48 (Aktual batch without SKU output), and the M2 reconciliation split into its five parts with kg
 * and Rp kept apart. Pure functions, decimal.js.
 */
import { D, Decimal, ZERO, sum, type Num } from "./decimal";
import type { ControlV3, ControlV3Status } from "./controls-v3";
import type { BalanceResult, LedgerResult, StockCardRow } from "./ledger";
import { isCogsLine, isOpexLine, isRevenueLine, type CostingRowsMode } from "./monthly";
import { totalsV4, type MonthPlanV4, type PlTotalsV4, type RegisterRow } from "./month-v4";
import type { PlRowV4 } from "./week-outlook";

const n = (v: number) => D(v);

// ------------------------------------------------------------------------------------------------ §7.2 release verdict

export type MonthVersion = "V1" | "V2" | "FINAL";

/** §7.1 "Wajib untuk": V1 needs C33, C34, C49; V2 needs C32; FINAL (monthly release) C21–C24, C35–C37, C48, C49. */
export function monthMandatory(v: MonthVersion): string[] {
  return v === "V1" ? ["C33", "C34", "C49"] : v === "V2" ? ["C32"] : ["C21", "C22", "C23", "C24", "C35", "C36", "C37", "C48", "C49"];
}

export interface ReleaseVerdict {
  ok: boolean;
  /** One line per rejecting control: "C8 BELUM DIISI". */
  rejections: { code: string; status: ControlV3Status | "STALE"; overridable: boolean }[];
}

/**
 * Same rule as public.release_rejections: a mandatory control (all when `mandatory` is null) rejects when GAGAL, or
 * also BELUM DIISI / STALE when `strict`. Under the strict rule an override for the control lifts it; the v1 rule
 * (strict off) has no overrides, as before. Pending rebuild dates reject as STALE when strict. `overridable` = strict
 * and the policy lets some role override the code.
 */
export function releaseVerdict(x: {
  controls: { code: string; status: ControlV3Status | string }[];
  mandatory: string[] | null;
  overrides: string[];
  strict: boolean;
  staleDates?: string[];
  policy?: Record<string, string[]>;
}): ReleaseVerdict {
  const rejections: ReleaseVerdict["rejections"] = [];
  for (const c of x.controls) {
    if (x.mandatory && !x.mandatory.includes(c.code)) continue;
    const bad = c.status === "GAGAL" || (x.strict && (c.status === "BELUM DIISI" || c.status === "STALE"));
    if (!bad || (x.strict && x.overrides.includes(c.code))) continue;
    rejections.push({ code: c.code, status: c.status as ControlV3Status, overridable: x.strict && (x.policy?.[c.code] ?? []).length > 0 });
  }
  if (x.strict && (x.staleDates ?? []).length) rejections.push({ code: "STALE", status: "STALE", overridable: false });
  return { ok: rejections.length === 0, rejections };
}

/** v1 weekly controls (numbered) as codes C1–C20. */
export const v1Codes = (controls: { no: number; status: string }[]) => controls.map((c) => ({ code: `C${c.no}`, status: c.status }));

// ------------------------------------------------------------------------------------------------ C48

/** C48 (§3.5, §7.1): an Aktual batch without any SKU output is GAGAL and blocks posting its costing and the monthly release. */
export function c48(x: { batches: { ref: string; status: string; date: string | null }[]; outputs: { batch_ref: string; kg: Num }[] }): ControlV3 {
  const have = new Set(x.outputs.filter((o) => D(o.kg).gt(0)).map((o) => o.batch_ref));
  const missing = x.batches.filter((b) => b.status === "Aktual" && !have.has(b.ref));
  return {
    code: "C48", module: "M1", name: "Batch Aktual punya output SKU",
    value: n(missing.length), comparator: n(0), difference: n(missing.length),
    status: missing.length ? "GAGAL" : "LULUS",
    action: missing.length ? "Unggah output WP (costing_wp) untuk batch berikut; biayanya tidak bisa diposting dan rilis bulanan ditolak" : "",
    detail: missing.map((b) => `${b.ref}${b.date ? ` (${b.date})` : ""}`),
  };
}

// ------------------------------------------------------------------------------------------------ §3.6 M2 reconciliation split

export interface ReconPart {
  part: "a" | "b" | "c" | "d" | "e";
  label: string;
  /** kg difference (null when the part has no kg side). */
  kg: Decimal | null;
  /** Rp difference (null when the part has no value side). */
  rp: Decimal | null;
  /** Input missing: the part is not computed (never 0). */
  missing: string | null;
  detail: string[];
}

/**
 * The five reconciliations of §3.6, each with kg and Rp apart: (a) ledger kg per key vs stock card, (b) MA cost of the
 * DOs vs the HPP Accurate booked for them, (c) inventory value at MA vs the balance sheet after the reasoned items,
 * (d) value at SI per lot vs value at MA, (e) opening value vs the balance sheet at the opening date after reasoned
 * adjustments. A gap is never closed by a plug: the reasoned items are listed and the rest stays a difference.
 */
export function reconcileSplit(x: {
  ledger: LedgerResult;
  balance: BalanceResult;
  /** HPP Accurate booked per sales line (ref → Rp), for the DOs up to the balance date. */
  hppByRef: Map<string, Num>;
  stockCard: StockCardRow[] | null;
  bsInventory: Num | null;
  /** Balance-sheet inventory on the opening date, and the ledger's opening value. */
  openingBs: Num | null;
  openingValue: Num | null;
  reasoned: { label: string; amount: Num; part: "c" | "e" }[];
}): ReconPart[] {
  const out: ReconPart[] = [];
  if (x.stockCard) {
    const card = new Map<string, { kg: Decimal; value: Decimal | null }>();
    for (const c of x.stockCard) {
      const k = c.key ?? "(tanpa key)";
      const o = card.get(k) ?? { kg: ZERO, value: ZERO as Decimal | null };
      card.set(k, { kg: o.kg.plus(D(c.kg)), value: c.value === null || c.value === undefined || o.value === null ? null : o.value.plus(D(c.value)) });
    }
    const keys = new Set([...card.keys(), ...x.balance.perKey.map((k) => k.key)]);
    let kg = ZERO, rp: Decimal | null = ZERO;
    const detail: string[] = [];
    for (const key of [...keys].sort()) {
      const l = x.balance.perKey.find((p) => p.key === key);
      const c = card.get(key);
      const dk = (l?.kg ?? ZERO).minus(c?.kg ?? ZERO);
      const dr = c?.value === null || c?.value === undefined ? null : (l?.cost_ma ?? ZERO).minus(c.value);
      kg = kg.plus(dk.abs());
      rp = rp === null || dr === null ? null : rp.plus(dr.abs());
      if (!dk.isZero()) detail.push(`${key}: ${dk.toFixed(2)} kg`);
    }
    out.push({ part: "a", label: "kg ledger lawan kartu stok", kg, rp, missing: null, detail });
  } else out.push({ part: "a", label: "kg ledger lawan kartu stok", kg: null, rp: null, missing: "kartu stok belum diunggah", detail: [] });

  // (b) per sales line: MA cost the ledger took vs HPP booked
  const outs = x.ledger.movements.filter((m) => m.type === "out_sale" && !m.planned && m.date <= x.balance.date && m.ref_id);
  const maByRef = new Map<string, { kg: Decimal; ma: Decimal }>();
  for (const m of outs) { const o = maByRef.get(m.ref_id!) ?? { kg: ZERO, ma: ZERO }; maByRef.set(m.ref_id!, { kg: o.kg.plus(m.kg.abs()), ma: o.ma.plus(m.cost_ma.abs()) }); }
  const withHpp = [...maByRef.entries()].filter(([ref]) => x.hppByRef.has(ref));
  out.push({
    part: "b", label: "HPP MA lawan HPP aktual Accurate", kg: null,
    rp: withHpp.length ? sum(withHpp.map(([ref, v]) => v.ma.minus(D(x.hppByRef.get(ref)!)))) : null,
    missing: withHpp.length ? null : "belum ada DO dengan HPP aktual", detail: [`${withHpp.length} dari ${maByRef.size} DO ber-HPP aktual`],
  });

  const rc = sum(x.reasoned.filter((r) => r.part === "c").map((r) => D(r.amount)));
  out.push({
    part: "c", label: "nilai persediaan MA lawan neraca", kg: null,
    rp: x.bsInventory === null || x.bsInventory === undefined || x.bsInventory === "" ? null : x.balance.totalCostMa.minus(D(x.bsInventory)).minus(rc),
    missing: x.bsInventory === null || x.bsInventory === undefined || x.bsInventory === "" ? "neraca belum ada" : null,
    detail: x.reasoned.filter((r) => r.part === "c").map((r) => `${r.label}: ${D(r.amount).toFixed(0)}`),
  });
  out.push({ part: "d", label: "nilai SI per lot lawan MA", kg: null, rp: x.balance.totalCostSi.minus(x.balance.totalCostMa), missing: null, detail: [] });

  const re = sum(x.reasoned.filter((r) => r.part === "e").map((r) => D(r.amount)));
  const hasOpen = x.openingBs !== null && x.openingBs !== undefined && x.openingBs !== "" && x.openingValue !== null && x.openingValue !== undefined && x.openingValue !== "";
  out.push({
    part: "e", label: "saldo awal lawan neraca, setelah penyesuaian beralasan", kg: null,
    rp: hasOpen ? D(x.openingValue!).minus(D(x.openingBs!)).minus(re) : null, missing: hasOpen ? null : "neraca saldo awal belum ada",
    detail: x.reasoned.filter((r) => r.part === "e").map((r) => `${r.label}: ${D(r.amount).toFixed(0)}`),
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ §6.6 tutup buku (FINAL)

/** FINAL (P13): actual of the full month, before and after the posted closing adjustments (P&L sign: + adds profit). */
export function finalTotalsV4(x: { rows: PlRowV4[]; adjustments: { pl_line: string; amount: Num }[]; mode?: CostingRowsMode }): { before: PlTotalsV4; adjustments: PlTotalsV4; after: PlTotalsV4 } {
  const mode = x.mode ?? "cogs";
  const before = totalsV4(x.rows, "actual", undefined, mode);
  const f = (p: (l: string) => boolean) => sum(x.adjustments.filter((a) => p(a.pl_line)).map((a) => D(a.amount)));
  const revenue = f(isRevenueLine), cogs = f((l) => isCogsLine(l, mode)), opex = f((l) => isOpexLine(l, mode));
  const adjustments: PlTotalsV4 = { revenue, cogs, gp: revenue.plus(cogs), opex, nibt: revenue.plus(cogs).plus(opex) };
  const add = (k: keyof PlTotalsV4) => before[k].plus(adjustments[k]);
  return { before, adjustments, after: { revenue: add("revenue"), cogs: add("cogs"), gp: add("gp"), opex: add("opex"), nibt: add("nibt") } };
}

const RANK: Record<string, number> = { GAGAL: 4, STALE: 3, "BELUM DIISI": 2, PERIKSA: 1, LULUS: 0, "N/A": -1 };

/** Controls of several weeks folded into one per code, keeping the worst status (a month is as good as its worst week). */
export function worstByCode(controls: ControlV3[]): ControlV3[] {
  const out = new Map<string, ControlV3>();
  for (const c of controls) {
    const o = out.get(c.code);
    if (!o) { out.set(c.code, { ...c, detail: [...c.detail] }); continue; }
    const keep = (RANK[c.status] ?? 0) > (RANK[o.status] ?? 0) ? { ...c, detail: [...c.detail] } : o;
    keep.detail = [...new Set([...o.detail, ...c.detail])];
    out.set(c.code, keep);
  }
  return [...out.values()].sort((a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)));
}

/**
 * Calibration (§6.6 "kalibrasi ditulis ke register"): what the FINAL month says about the next one, as register rows
 * with source kalibrasi, status proposed, owner Group Project Finance. The run-rate and margin at the month end (K3, K5)
 * and the bias of V1 against FINAL. They stay proposals until Finance agrees them for the next month (P10).
 */
export function calibrationV4(x: { month: string; plan: MonthPlanV4; v1Bias?: { revenue: Num; gp: Num | null } | null }): RegisterRow[] {
  const m = x.month.slice(0, 7);
  const mk = (code: string, name: string, basis: string, num: Num): RegisterRow => ({
    code, name, value_num: D(num).toFixed(6), value_text: null, basis, owner: "Group Project Finance", agreed_at: null, deviation_note: null, status: "proposed",
  });
  const rr = x.plan.runrate;
  const out = [
    mk("kal_runrate_revenue", "Run-rate revenue per hari kerja (kalibrasi)", `FINAL ${m}: ${rr.days.length} hari kerja dalam ${rr.windowDays} hari kalender terakhir, ${rr.anomalies.length} anomali`, rr.revenue),
    mk("kal_margin_ref", "Margin acuan GP P&L ÷ revenue (kalibrasi)", `FINAL ${m}`, x.plan.margin),
    mk("kal_runrate_offday", "Faktor Minggu / libur (kalibrasi)", `FINAL ${m}`, rr.offDayFactor),
  ];
  if (x.v1Bias) {
    out.push(mk("kal_bias_v1_revenue", "Bias V1 terhadap FINAL, revenue (kalibrasi)", `V1 − FINAL ${m}`, x.v1Bias.revenue));
    // V1 without a GP has no GP bias: the proposal is left out, never written as a bias of 0 (R64)
    if (x.v1Bias.gp !== null) out.push(mk("kal_bias_v1_gp", "Bias V1 terhadap FINAL, GP (kalibrasi)", `V1 − FINAL ${m}`, x.v1Bias.gp));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ §3.5 DI-01 cost date vs invoice date

export interface UnbilledPair {
  /** DO / SJ number shared by the Ops delivery line and the Accurate invoice line that replaced it. */
  document_ref: string;
  key: string | null;
  kg: Num;
  /** K11 revenue date (DO delivered) and the invoice date (when the stock left in the books). */
  revenue_date: string;
  invoice_date: string;
  /** COGS at MA on the revenue date, and on the invoice date (positive). */
  cogs_revenue: Num;
  cogs_invoice: Num;
}

/**
 * DI-01: the COGS of a DO delivered in one month and invoiced in the next is valued at MA on the revenue date; the
 * invoice books it at MA on the invoice date. The difference is the revaluation; the ledger keeps both values. For a
 * month: the pairs delivered in it and invoiced after its end, with the P&L effect per side (P&L sign, + adds profit):
 * the revenue month carries −(invoice − revenue) only if its books used the invoice value, so the closing adjustment
 * of the invoice month is +(invoice − revenue) to bring its COGS back to the revenue-date value.
 */
export function unbilledRevaluation(x: { month: string; pairs: UnbilledPair[] }): {
  rows: (UnbilledPair & { diff: Decimal })[];
  kg: Decimal;
  cogsRevenue: Decimal;
  cogsInvoice: Decimal;
  /** Σ (invoice − revenue) of the crossing pairs: what the invoice month's COGS carries in excess (Rp, + = higher). */
  revaluation: Decimal;
} {
  const first = x.month.slice(0, 8) + "01";
  const end = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const rows = x.pairs
    .filter((p) => p.revenue_date >= first && p.revenue_date <= end && p.invoice_date > end)
    .map((p) => ({ ...p, diff: D(p.cogs_invoice).minus(D(p.cogs_revenue)) }))
    .sort((a, b) => a.revenue_date.localeCompare(b.revenue_date) || a.document_ref.localeCompare(b.document_ref));
  return {
    rows,
    kg: sum(rows.map((r) => D(r.kg))),
    cogsRevenue: sum(rows.map((r) => D(r.cogs_revenue))),
    cogsInvoice: sum(rows.map((r) => D(r.cogs_invoice))),
    revaluation: sum(rows.map((r) => r.diff)),
  };
}
