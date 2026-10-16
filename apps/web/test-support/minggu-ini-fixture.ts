/**
 * Input of the page "Minggu ini" built from the golden fixtures (week 2026-08-24, update date 27 Aug; FS Aug 2026 for
 * the solvency). Node only: used by the fixture harness (scripts/v4-fixture.tsx) and the page-model tests.
 */
import { D, balanceAt, computeLedger, computeWeek, ledgerInputsFromWeek, solvency, weekPlDaily } from "@kgr/engine";
import { loadFixtureWeek, loadV3Fixture } from "../../../packages/engine/src/fixtures";
import type { MingguIniInput } from "../lib/v4/minggu-ini";

export function fixtureInput(): { base: MingguIniInput; ledgerOverAgeJt: string } {
const inputs = loadFixtureWeek("2026-08-24", "2026-08-27");
const r = computeWeek(inputs);
const plRows = weekPlDaily(r);

// M2 marts on the day before the update date (what the ledger rebuild writes into sku_balance_daily / lot_balance_daily)
const li = ledgerInputsFromWeek(inputs);
const led = computeLedger(li);
const bal = balanceAt(led, "2026-08-26", li.keys, li.params);
const stock = {
  date: "2026-08-26",
  keys: bal.perKey.map((k) => ({ key: k.key, over_age_kg: k.over_age_kg.toFixed(2), cost_per_kg_ma: k.cost_per_kg_ma === null ? null : k.cost_per_kg_ma.toFixed(4) })),
  lots: bal.perLot.map((l) => ({ key: l.key, kg: l.kg.toFixed(2), age_days: l.age_days, cost_per_kg_ma: l.cost_per_kg_ma === null ? null : l.cost_per_kg_ma.toFixed(4) })),
  info: Object.fromEntries(r.stock.rows.map((k) => [k.key, { ordersRest: k.ordersRestOfWeek.toFixed(2), refPrice: k.refPrice === null ? null : k.refPrice.toFixed(2) }])),
};

// M6 solvency of August 2026 (the month of the example week) from the FS fixture (BS / PL - Management Report col. K)
type Line = { row: number; line: string; values: Record<string, string> };
const fs = loadV3Fixture<{ pl: Line[]; bs: Line[] }>("fs-2026-09", "inputs.json");
const AUG = "2026-08-31";
const bs = (l: string) => D(fs.bs.find((x) => x.line === l)!.values[AUG] ?? "0");
const pl = (l: string) => D(fs.pl.find((x) => x.line === l)!.values[AUG] ?? "0");
const sv = solvency({
  equity: bs("TOTAL EQUITY"), paidInCapital: bs("Shareholder Equity"),
  affiliatePayable: bs("Other Payable - Related Parties").plus(bs("Trade Payables - Affiliates")).plus(bs("Accrued Expenses - Related Parties")),
  affiliateReceivable: bs("Trade Receivables - Related Parties").plus(bs("Other Receivable - Affiliated Party")),
  nibtMonth: pl("INCOME (LOSS) BEFORE TAX"),
});

const base: MingguIniInput = {
  r, week: { start: "2026-08-24", end: "2026-08-30", update: "2026-08-27", status: "open" },
  weeks: [{ start: "2026-08-24", end: "2026-08-30", status: "open" }, { start: "2026-08-17", end: "2026-08-23", status: "released" }],
  base: "/minggu-ini/2026-08-24", release: null, mode: "proyeksi", hari: null, segmen: null, sku: null,
  on: { m1: false, m2: true, m3: false, m4: false, m6: true },
  plRows,
  lastWeek: { revenue: r.statements.pnl.get("TOTAL REVENUE").values.lastWeek, gp: r.statements.pnl.get("GROSS PROFIT").values.lastWeek, nibt: r.statements.pnl.get("NET INCOME").values.lastWeek, basis: "jurnal" },
  stock, cashMart: null, month: null,
  solvency: { label: "2026-08", equity: sv.equity.toFixed(2), paidIn: sv.paid_in_capital.toFixed(2), affiliate: sv.affiliate_payable.toFixed(2), months: sv.months_to_negative_equity === null ? null : sv.months_to_negative_equity.toFixed(2), interest: null },
  demand: null, groups: null, roll: null,
  controlsV3: r.controls.controls.filter((k) => k.status === "BELUM DIISI").map((k) => ({ code: `Kontrol ${k.no}`, module: "M1", name: k.name, value: k.value, comparator: k.comparator, difference: k.difference, status: k.status, action: k.action, detail: [] })),
  pdfHref: "/api/w/2026-08-24/pdf",
};

  return { base, ledgerOverAgeJt: bal.perKey.reduce((a, k) => a.plus(k.over_age_kg.times(k.cost_per_kg_ma ?? 0)), D(0)).div(1e6).toFixed(1) };
}
