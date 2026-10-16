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
import { fixtureInput } from "../test-support/minggu-ini-fixture";
import { mingguIniModel, type MingguIniInput } from "../lib/v4/minggu-ini";
import { v4Nav } from "../lib/v4/nav";
import { TilePage } from "../components/v4/TilePage";
import { V4Frame } from "../components/v4/Frame";
import { kasFixtureFs, kasFixtureProjection, outlookBulanFixture } from "../test-support/month-fixture";
import { outlookBulanModel } from "../lib/v4/outlook-bulan";
import { kasModel } from "../lib/v4/kas";
import { rencanaFixture } from "../test-support/rencana-fixture";
import { rencanaModel } from "../lib/v4/rencana";
import { ActionForm } from "../components/ActionForm";

const out = resolve(process.argv[2] ?? "../../docs/v4/bukti/html");
mkdirSync(out, { recursive: true });
const css = readFileSync(resolve(__dirname, "../app/v4.css"), "utf8");

function page(title: string, nav: string, body: React.ReactElement, role: "management" | "ppic" = "management"): string {
  const settings = { v4_design: { enabled: true }, m2_ledger: { enabled: true }, m3_planning: { enabled: true }, m4_monthly: { enabled: true }, m6_cash: { enabled: true } };
  const items = v4Nav(role, settings, { week: "2026-08-24", month: "2026-08", today: "2026-08-27" });
  const html = renderToStaticMarkup(
    <V4Frame nav={items} active={nav} view={role === "management" ? "management" : "preparer"} period={<span className="note">24–30 Agu 2026</span>} account={<span>{role === "management" ? "Direksi · Management" : "PPIC"}</span>}>
      {body}
    </V4Frame>,
  );
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>html,body{margin:0;padding:0}${css}</style></head><body>${html}</body></html>`;
}

const { base, ledgerOverAgeJt } = fixtureInput();
const r = base.r;

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
  if (v.file === "minggu-ini.html") writeFileSync(join(out, "minggu-ini.model.full.json"), JSON.stringify(model.tiles, (_, x) => (typeof x === "object" && x !== null && "toFixed" in x && "s" in x ? x.toString() : x), 1));
}
// PRD v4 irisan 2: Outlook bulan (§6.2) and Kas & solvabilitas (§6.3)
const months: { file: string; title: string; nav: string; model: { tiles: Parameters<typeof TilePage>[0]["tiles"]; hidden: string[] } }[] = [
  { file: "outlook-bulan.html", title: "Outlook bulan", nav: "outlook-bulan", model: outlookBulanModel(outlookBulanFixture()) },
  { file: "kas-solvabilitas.html", title: "Kas & solvabilitas", nav: "kas", model: kasModel(kasFixtureFs()) },
  { file: "kas-solvabilitas-proyeksi.html", title: "Kas & solvabilitas", nav: "kas", model: kasModel(kasFixtureProjection()) },
];
for (const v of months) {
  writeFileSync(join(out, v.file), page(v.title, v.nav, <><h1 className="sr-only">{v.title}</h1><TilePage tiles={v.model.tiles} label={v.title} /></>));
  report[v.file] = { tiles: v.model.tiles.map((t) => t.id), hidden: v.model.hidden };
}
// PRD v4 irisan 3: PPIC Rencana (§6.4), with the action bars the page puts under t-rencana and t-harian (PPIC role)
const noop = async () => ({});
for (const v of [{ file: "ppic-rencana.html", reasons: [] as string[] }, { file: "ppic-rencana-alasan.html", reasons: ["C41"] }]) {
  const m = rencanaModel(rencanaFixture({ reasons: v.reasons }));
  const why = (tile: string, action: string) => m.actions.find((a) => a.tile === tile && a.action === action)?.disabledReason ?? null;
  const bar = (label: string, primary: boolean, reason: string | null) => <div className="actionbar"><ActionForm v4={primary ? "primary" : true} action={noop} submit={label} disabled={reason !== null} />{reason ? <span className="reason">{reason}</span> : null}</div>;
  const extras = {
    "t-demand": m.actions.some((a) => a.action === "reason") ? bar("Simpan alasan C41", false, null) : null,
    "t-rencana": bar("Simpan rencana versi 1", true, why("t-rencana", "save") ?? "yield sementara: boleh disimpan, tidak boleh disalin ke batch"),
    "t-harian": bar("Salin ke batch rencana", false, why("t-harian", "copy")),
  };
  writeFileSync(join(out, v.file), page("PPIC Rencana", "rencana", <><h1 className="sr-only">{m.title}</h1><TilePage tiles={m.tiles} label={m.title} extras={extras} /></>, "ppic"));
  report[v.file] = { tiles: m.tiles.map((t) => t.id), actions: m.actions };
}
writeFileSync(join(out, "minggu-ini.model.json"), JSON.stringify(report, null, 1));
console.log(`v4-fixture: ${variants.length + months.length + 2} halaman → ${out}`);
console.log(JSON.stringify(report["minggu-ini.html"]));
console.log(`stok di atas batas umur (ledger M2): ${ledgerOverAgeJt} jt; blok 4: ${r.block4.find((b) => b.status === "PERHATIAN")!.value.div(1e6).toFixed(1)} jt`);
