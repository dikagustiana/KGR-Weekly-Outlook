/**
 * Render the v4 pages from the golden fixtures, without Supabase (PRD v4 §9.4 screenshot comparison).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/v4-fixture.tsx <out-dir>
 *
 * Writes <out-dir>/minggu-ini.html (modules M2 and M6 on, as the mockup) and minggu-ini-modul-mati.html (only the
 * v4 flag on, as production would be with the modules off). The page model is the same function the server page
 * calls (lib/v4/minggu-ini.ts); the marts are what the rebuild job would write, computed here from the fixtures
 * with the same engine functions (weekPlDaily, computeLedger + balanceAt, solvency).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { D, balanceAt, computeLedger, computeWeek, ledgerInputsFromWeek, solvency, weekPlDaily } from "@kgr/engine";
// fixture loaders are node-only (not part of the engine's public entry)
import { loadFixtureWeek, loadV3Fixture } from "../../../packages/engine/src/fixtures";
import { mingguIniModel, type MingguIniInput } from "../lib/v4/minggu-ini";
import { v4Nav } from "../lib/v4/nav";
import { TilePage } from "../components/v4/TilePage";
import { V4Frame } from "../components/v4/Frame";

const out = resolve(process.argv[2] ?? "../../docs/v4/bukti/html");
mkdirSync(out, { recursive: true });
const css = readFileSync(resolve(__dirname, "../app/v4.css"), "utf8");

function page(title: string, nav: string, body: React.ReactElement): string {
  const settings = { v4_design: { enabled: true }, m2_ledger: { enabled: true }, m6_cash: { enabled: true } };
  const items = v4Nav("management", settings, { week: "2026-08-24", month: "2026-08", today: "2026-08-27" });
  const html = renderToStaticMarkup(
    <V4Frame nav={items} active={nav} view="management" period={<span className="note">24–30 Agu 2026</span>} account={<span>Direksi · Management</span>}>
      {body}
    </V4Frame>,
  );
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>html,body{margin:0;padding:0}${css}</style></head><body>${html}</body></html>`;
}

// ---------------------------------------------------------------- the example week 24–30 Aug 2026, update 27 Aug
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

const variants: { file: string; input: MingguIniInput }[] = [
  { file: "minggu-ini.html", input: base },
  { file: "minggu-ini-modul-mati.html", input: { ...base, on: { m1: false, m2: false, m3: false, m4: false, m6: false }, stock: null, solvency: null } },
  { file: "minggu-ini-aktual.html", input: { ...base, mode: "aktual" } },
  { file: "minggu-ini-hari-26.html", input: { ...base, hari: "2026-08-26" } },
];
const report: Record<string, unknown> = {};
for (const v of variants) {
  const model = mingguIniModel(v.input);
  writeFileSync(join(out, v.file), page("Minggu ini", "minggu-ini", <><h1 className="sr-only">Minggu ini</h1><TilePage tiles={model.tiles} label="Minggu ini" /></>));
  report[v.file] = { tiles: model.tiles.map((t) => t.id), hidden: model.hidden };
}
writeFileSync(join(out, "minggu-ini.model.json"), JSON.stringify(report, null, 1));
console.log(`v4-fixture: ${variants.length} halaman → ${out}`);
console.log(JSON.stringify(report["minggu-ini.html"]));
console.log(`stok di atas batas umur (ledger M2): ${bal.perKey.reduce((a, k) => a.plus(k.over_age_kg.times(k.cost_per_kg_ma ?? 0)), D(0)).div(1e6).toFixed(1)} jt; blok 4: ${r.block4.find((b) => b.status === "PERHATIAN")!.value.div(1e6).toFixed(1)} jt`);
