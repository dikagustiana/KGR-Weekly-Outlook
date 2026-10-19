/**
 * Backtest COGS live bird (v5.3, pilot 19 Okt): the app's costing path against the WP COGS LB workbooks of Aug and Sep 2026.
 *
 * For every `Pot_*` sheet of both files:
 *   sheet  — the sheet's own numbers, read from its cells (cached values; label-located, the cell is recorded);
 *   P      — the costing_wp upload parser (`readWorkbook` + `parseCostingWorkbook`, packages/parsers/src/costing-wp.ts);
 *   A      — the engine on the parser's helper input (`allocateBatch(wpToAllocateInput(b))`, packages/engine/src/costing.ts);
 *   W      — the web builder end to end (apps/web/lib/v3/costing.ts: kind costing_wp stage → commit → allocateWeek) on an
 *            in-memory PostgREST stand-in (fake-sb.ts, SETUP); the stored allocation_run / allocation_line are compared;
 *   S      — `planCost` (the K71 simulator formula, k = biaya ÷ nilai jual) on the parsed inputs;
 *   O      — `parseUpload("ops_batch", …)` on the sheet (the tabular batch upload), to record whether it can read a Pot_ sheet.
 * Tolerance: Rp 1 for totals, 0,01 for per-kg numbers, 1e-6 for ratios.
 *
 * The workbooks are never copied into the repo: they are read from BACKTEST_DIR (default /home/user/backtest-data).
 * Output: a Markdown table on stdout (aggregates and RPA codes only); `--json <file>` writes the full comparison;
 * `--write-fixture` writes fixtures/backtest-cogs-2026-08-09/expected.json (inputs + expected cells, no supplier / invoice /
 * item names).
 *
 * Run: pnpm backtest:cogs   (= pnpm tsx --conditions=react-server tests/backtest/cogs-lb/run.ts)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { D, allocateBatch, planCost, costComponentOf, type Decimal } from "../../../packages/engine/src/index";
import { readWorkbook, parseCostingWorkbook, parseUpload, parseWpSheet, wpToAllocateInput, type Sheet, type WpBatch } from "../../../packages/parsers/src/index";
import { FakeDb } from "./fake-sb";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

// apps/web/lib/v3/costing.ts starts with `import "server-only"`: it loads only under the react-server condition
if (!process.execArgv.some((a) => a.includes("react-server")) && !process.env.BT_COGS_CHILD) {
  const r = spawnSync(process.execPath, ["--conditions=react-server", ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, BT_COGS_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

const DIR = process.env.BACKTEST_DIR ?? "/home/user/backtest-data";
const FILES = [
  { month: "2026-08", file: "202608_Data_COGS_LB.xlsx" },
  { month: "2026-09", file: "202609_Data_COGS_LB.xlsx" },
];
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const writeFixture = args.includes("--write-fixture");

// ------------------------------------------------------------------------------------------------ sheet cells

type Cell = string | number | boolean | null;
const colL = (c: number) => { let s = ""; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const at = (s: Sheet, r: number, c: number): Cell => (s.rows[r - 1]?.[c - 1] ?? null) as Cell;
const addr = (r: number, c: number) => `${colL(c)}${r}`;
const nrm = (v: Cell) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "");
const num = (v: Cell): number | null => (typeof v === "number" ? v : null);

interface Ref { cell: string; value: number | null }
const ref = (s: Sheet, r: number, c: number): Ref => ({ cell: addr(r, c), value: num(at(s, r, c)) });
const none: Ref = { cell: "—", value: null };

function findLabel(s: Sheet, label: string, maxRow: number): { r: number; c: number } | null {
  for (let r = 1; r <= maxRow; r++) for (let c = 1; c <= 20; c++) if (nrm(at(s, r, c)) === label) return { r, c };
  return null;
}

interface SheetRef {
  hdr: number | null; tot: number | null; date: string | null;
  lbKg: Ref; processed: Ref; shrinkKg: Ref; shrinkPct: Ref;
  lb: Ref; freight: Ref; maklon: Ref; total: Ref; bl: Ref; totalInclBl: Ref;
  totF: Ref; qty: Ref; value: Ref; cogs: Ref; gp: Ref; gpMargin: Ref;
  rows: { row: number; code: string | null; kg: number; price: number | null; L: Ref }[];
}

/** The sheet's own numbers (the template of the WP COGS LB: labels in A3:A6, I3:I5, K4, E6, K8/K9; header "Produk"). */
function sheetRef(s: Sheet): SheetRef {
  let hdr: number | null = null;
  for (let r = 1; r <= 25; r++) if (nrm(at(s, r, 1)) === "produk") { hdr = r; break; }
  const tot = hdr === null ? null : hdr + 1;
  const lim = (hdr ?? 9) - 1;
  const right = (label: string) => { const p = findLabel(s, label, lim); return p ? ref(s, p.r, p.c + 1) : none; };
  const costRow = (label: string) => { for (let r = 3; r <= lim; r++) if (nrm(at(s, r, 1)) === label) return ref(s, r, 2); return none; };
  const hp = findLabel(s, "hasil potong", lim);
  const susut = hp && nrm(at(s, hp.r, hp.c + 2)) === "susut";
  const d = (() => { const p = findLabel(s, "tgl. potong", lim); const v = p ? at(s, p.r, p.c + 1) : null; return typeof v === "number" ? new Date(Math.round((v - 25569) * 86400) * 1000).toISOString().slice(0, 10) : null; })();
  const b7 = (() => { const t = findLabel(s, "total", lim); return t && t.c === 1 && num(at(s, t.r + 1, 2)) !== null ? ref(s, t.r + 1, 2) : none; })();
  const rows: SheetRef["rows"] = [];
  if (tot !== null) {
    for (let r = tot + 1; r <= s.rows.length; r++) {
      const a = at(s, r, 1);
      if (typeof a === "string" && /^(dibuat|diperiksa|disetujui)/i.test(a.trim())) break;
      const kg = (num(at(s, r, 6)) ?? 0) + (num(at(s, r, 9)) ?? 0); // missing-ok: the WP sums F (non blasting) + I (qty); a blank side is no kg
      if (kg === 0) continue;
      const code = at(s, r, 7);
      rows.push({ row: r, code: typeof code === "string" && code.trim() ? code.trim() : null, kg, price: num(at(s, r, 2)), L: ref(s, r, 12) });
    }
  }
  const gpm = findLabel(s, "est. gp margin", lim + 1);
  return {
    hdr, tot, date: d,
    lbKg: right("total kg lb"), processed: hp ? ref(s, hp.r + 1, hp.c) : none,
    shrinkKg: susut ? ref(s, hp!.r + 1, hp!.c + 1) : none, shrinkPct: susut ? ref(s, hp!.r + 1, hp!.c + 2) : none,
    lb: costRow("live bird"), freight: costRow("biaya ekspedisi"), maklon: costRow("biaya potong"), total: costRow("total"),
    bl: right("biaya bl"), totalInclBl: b7,
    totF: tot ? ref(s, tot, 6) : none, qty: tot ? ref(s, tot, 9) : none, value: tot ? ref(s, tot, 11) : none,
    cogs: tot ? ref(s, tot, 13) : none, gp: tot ? ref(s, tot, 15) : none, gpMargin: gpm ? ref(s, gpm.r, gpm.c + 1) : none,
    rows,
  };
}

// ------------------------------------------------------------------------------------------------ comparison

type Kind = "total" | "perkg" | "ratio" | "kg";
const TOL: Record<Kind, number> = { total: 1, perkg: 0.01, ratio: 1e-6, kg: 0.01 };
interface Check { name: string; cell: string; sheet: number | null; app: number | null; path: string; kind: Kind; ok: boolean | null; diff: number | null }
const toN = (v: Decimal | string | number | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(String(v)));
function check(name: string, r: Ref | { cell: string; value: number | null }, app: Decimal | string | number | null | undefined, path: string, kind: Kind): Check {
  const a = toN(app), s = r.value;
  if (a === null && s === null) return { name, cell: r.cell, sheet: s, app: a, path, kind, ok: null, diff: null };
  if (a === null || s === null) return { name, cell: r.cell, sheet: s, app: a, path, kind, ok: false, diff: null };
  const diff = a - s;
  return { name, cell: r.cell, sheet: s, app: a, path, kind, ok: Math.abs(diff) <= TOL[kind] + 1e-9, diff };
}

// ------------------------------------------------------------------------------------------------ web path (SETUP)

type Row = Record<string, unknown>;
const web = await import("../../../apps/web/lib/v3/costing.ts");
const { v3Kind } = await import("../../../apps/web/lib/v3/uploads.ts");
void web;
const db = new FakeDb();
const sb = db.client() as never;
const viewer = { email: "backtest@example.invalid", role: "admin", fullName: "backtest" } as never;
// Monday-start weeks covering Aug and Sep 2026 (the weeks B-R90 creates); a cut date outside them is skipped by the app
for (let t = Date.UTC(2026, 6, 27); t <= Date.UTC(2026, 8, 28); t += 7 * 86400000) {
  const ws = new Date(t).toISOString().slice(0, 10), we = new Date(t + 6 * 86400000).toISOString().slice(0, 10);
  const w = db.complete("week", { week_start: ws, week_end: we, update_date: we, tb_opening_date: ws, status: "open" });
  db.rows("week").push(w);
  db.rows("parameter").push(db.complete("parameter", { week_id: w.id, by_product_method: "joint", yield_gap_tolerance: "0.02", avg_lb_kg_default: "2.0", selling_cost_per_kg: "0" }));
}
const kind = v3Kind("costing_wp")!;
const commitNotes: Record<string, string> = {};
const allocNotes: string[] = [];
const crossEffects: { file: string; batch: string; before: unknown; after: unknown }[] = [];
const snapshot = new Map<string, unknown>();
/** W state of one batch (week start | batch_ref): stored header costs, latest run, Σ sales value of its lines. */
function wState(k: string) {
  const [ws, ref] = k.split("|");
  const w = db.rows("week").find((x) => x.week_start === ws);
  const b = db.rows("batch").find((x) => x.week_id === w?.id && x.batch_ref === ref && (x.deleted_at === null || x.deleted_at === undefined));
  if (!b) return null;
  const run = db.rows("allocation_run").filter((x) => x.batch_id === b.id && x.status !== "superseded").pop();
  const lines = run ? db.rows("allocation_line").filter((x) => x.allocation_run_id === run.id) : [];
  return { total_cost: run?.total_cost ?? null, total_allocated: run?.total_allocated ?? null, sales_value: lines.reduce((a, l) => a + Number(l.sales_value), 0).toFixed(2), lines: lines.length };
}
const stageNotes: Record<string, { issues: string[]; note: string; skipped: string[] }> = {};

// ------------------------------------------------------------------------------------------------ run

interface BatchOut {
  month: string; file: string; sheet: string; hidden: boolean; rpa: string; date: string | null;
  parsed: boolean; opsBatch: string; issues: string[]; checks: Check[];
  rowsTotal: number; rowsOk: Record<string, number>;
  inputs: Row | null; expected: Row | null;
}
const out: BatchOut[] = [];
const sources: { file: string; sha256: string; sheets: number; pot: string[] }[] = [];
const xlsxReq = createRequire(join(root, "packages/parsers/package.json"));
const XLSX = xlsxReq("xlsx") as { read: (b: Uint8Array, o: object) => { SheetNames: string[]; Workbook?: { Sheets?: { name: string; Hidden?: number }[] } }; version: string };

for (const f of FILES) {
  const path = join(DIR, f.file);
  if (!existsSync(path)) throw new Error(`${path} tidak ada (BACKTEST_DIR=${DIR})`);
  const buf = readFileSync(path);
  const sha = createHash("sha256").update(buf).digest("hex");
  const sheets = readWorkbook(buf, f.file);
  const meta = XLSX.read(new Uint8Array(buf), { type: "array", sheetRows: 1 });
  const hidden = new Set((meta.Workbook?.Sheets ?? []).filter((x) => x.Hidden).map((x) => x.name));
  const pot = sheets.filter((s) => /^pot_/i.test(s.name));
  sources.push({ file: f.file, sha256: sha, sheets: sheets.length, pot: pot.map((s) => s.name) });
  const res = parseCostingWorkbook(sheets);

  // W: the upload as the app does it (one file = one upload), then the allocation of every week touched
  const st = await kind.stage({ sb, viewer, week: db.rows("week")[0] as never, sheets, fileName: f.file });
  stageNotes[f.file] = { issues: st.issues, note: st.note, skipped: [...res.skipped, ...res.hidden.map((h) => `${h} (tersembunyi)`)] };
  const uploadId = db.nextId();
  const cm = await kind.commit({ sb, viewer, week: db.rows("week")[0] as never, uploadId, rows: JSON.parse(JSON.stringify(st.rows)) });
  commitNotes[f.file] = cm.message;
  // as the user does next (Input → Costing: Alokasikan): every week the upload touched is allocated again
  const touched = db.rows("week").filter((w) => cm.dates.some((d) => d >= String(w.week_start) && d <= String(w.week_end)));
  for (const w of touched) allocNotes.push(`${f.file} ${w.week_start}: ${await web.allocateWeek(sb, viewer, w as never)}`);
  // what this upload did to batches an earlier upload (another file) created
  for (const [k, before] of snapshot) {
    const now = wState(k);
    if (JSON.stringify(now) !== JSON.stringify(before)) crossEffects.push({ file: f.file, batch: k, before, after: now });
  }

  for (const s of pot) {
    const R = sheetRef(s);
    // a hidden sheet is not part of the upload (BT-COGS-1); its numbers are still checked on paths P, A and S
    const b = res.batches.find((x) => x.sheet === s.name) ?? (res.hidden.includes(s.name) ? parseWpSheet(s) : null);
    const uploaded = res.batches.some((x) => x.sheet === s.name);
    const ops = (() => {
      try {
        const p = parseUpload("ops_batch", [s]);
        if (!p.detected) return "header tidak terdeteksi";
        const n = p.sets.reduce((a, x) => a + x.rows.length, 0);
        return `header baris ${p.detected.headerRow}, ${n} baris batch`;
      } catch (e) { return `error: ${(e as Error).message}`; }
    })();
    const rpa = /AGRO/i.test(s.name) ? "AGRO" : /ISA/i.test(s.name) ? "ISA" : "?";
    const bo: BatchOut = { month: f.month, file: f.file, sheet: s.name, hidden: hidden.has(s.name), rpa, date: b?.date ?? R.date, parsed: !!b, opsBatch: ops, issues: b?.issues ?? [], checks: [], rowsTotal: R.rows.length, rowsOk: {}, inputs: null, expected: null };
    out.push(bo);
    if (!b) continue;
    const C = bo.checks;
    const comp = (c: WpBatch["costs"], k: string) => c.filter((x) => costComponentOf(x.label) === k).reduce((a, x) => a.plus(D(x.amount)), D(0));
    const lbAmt = comp(b.costs, "LB"), fr = comp(b.costs, "freight"), mk = comp(b.costs, "maklon");
    const bl = D(b.cost_bl);
    // P: parser vs cells
    C.push(check("kg LB beli", R.lbKg, b.lb_kg, "P", "kg"));
    C.push(check("kg diproses", R.processed, b.processed_kg, "P", "kg"));
    const shrinkKg = b.lb_kg && b.processed_kg ? D(b.lb_kg).minus(D(b.processed_kg)) : null;
    C.push(check("susut kg", R.shrinkKg, shrinkKg, "P", "kg"));
    C.push(check("susut %", R.shrinkPct, shrinkKg && !D(b.lb_kg).isZero() ? shrinkKg.div(D(b.lb_kg)) : null, "P", "ratio"));
    C.push(check("LB Rp", R.lb, lbAmt, "P", "total"));
    C.push(check("angkut Rp", R.freight, fr, "P", "total"));
    C.push(check("potong Rp", R.maklon, mk, "P", "total"));
    C.push(check("biaya BL Rp", R.bl, b.cost_bl, "P", "total"));
    C.push(check("biaya (tanpa BL)", R.totF, b.total_cost, "P", "total"));
    // A: engine on the parser's helper input
    const A = allocateBatch(wpToAllocateInput(b));
    const aValue = A.lines.reduce((a, l) => a.plus(l.salesValue), D(0));
    const totIncl: Ref = R.totalInclBl.value !== null ? R.totalInclBl : { cell: `${R.totF.cell}+${R.bl.cell}`, value: (R.totF.value ?? 0) + (R.bl.value ?? 0) }; // missing-ok: BL absent = no BL pool
    C.push(check("biaya total", totIncl, A.totalCost, "A", "total"));
    C.push(check("nilai jual", R.value, aValue, "A", "total"));
    C.push(check("COGS teralokasi", R.cogs, A.totalAllocated, "A", "total"));
    C.push(check("GP", R.gp, aValue.minus(A.totalAllocated), "A", "total"));
    C.push(check("GP ÷ biaya (Est. GP Margin)", R.gpMargin, A.totalAllocated.isZero() ? null : aValue.div(A.totalAllocated).minus(1), "A", "ratio"));
    // S: planCost (needs kg LB; R62: freight + fee as actual amounts)
    const lbKg = b.lb_kg && !D(b.lb_kg).isZero() ? D(b.lb_kg) : null;
    const S = lbKg ? planCost({ status: "final", kgLb: lbKg, lbPrice: lbAmt.div(lbKg), directCost: fr.plus(mk).plus(bl), outputs: b.rows.map((r) => ({ key: `${r.row}`, kg: D(r.kg_non_blasting).plus(D(r.kg)), priceRef: r.price })) }) : null;
    const kSheet = R.totF.value !== null && R.value.value ? { cell: `${R.totF.cell}÷${R.value.cell}`, value: (R.totF.value + (R.bl.value ?? 0)) / R.value.value } : { cell: `${R.totF.cell}÷${R.value.cell}`, value: null }; // missing-ok: BL absent = 0
    const beSheet = R.lbKg.value && R.value.value !== null ? { cell: `(${R.value.cell}−${R.freight.cell}−${R.maklon.cell})÷${R.lbKg.cell}`, value: (R.value.value - (R.freight.value ?? 0) - (R.maklon.value ?? 0)) / R.lbKg.value } : { cell: "—", value: null }; // missing-ok: a missing cost row is a missing cost, shown by its own check
    const lbPriceSheet = R.lbKg.value && R.lb.value !== null ? { cell: `${R.lb.cell}÷${R.lbKg.cell}`, value: R.lb.value / R.lbKg.value } : { cell: "—", value: null };
    if (S) {
      C.push(check("harga LB Rp/kg", lbPriceSheet, S.lbPrice, "S", "perkg"));
      C.push(check("biaya total", totIncl, S.costPool, "S", "total"));
      C.push(check("nilai jual", R.value, S.value, "S", "total"));
      C.push(check("k", kSheet, S.k, "S", "ratio"));
      C.push(check("GP", R.gp, S.gp, "S", "total"));
      C.push(check("breakeven Rp/kg LB", beSheet, S.value.isZero() ? null : S.value.minus(fr).minus(mk).div(lbKg!), "S", "perkg"));
      if (!bl.isZero()) C.push(check("breakeven planCost (BL ikut dikurangi)", beSheet, S.breakeven, "S", "perkg"));
    } else {
      // planCost needs kg LB beli (the sheet has no "Total KG LB"): not run, recorded as n/a
      C.push({ name: "planCost (kg LB kosong)", cell: R.lbKg.cell, sheet: null, app: null, path: "S", kind: "total", ok: null, diff: null });
    }
    // W: the stored allocation of the web builder
    const w = db.rows("week").find((x) => b.date && b.date >= String(x.week_start) && b.date <= String(x.week_end));
    const wb = w ? db.rows("batch").find((x) => x.week_id === w.id && x.batch_ref === s.name.trim() && isNullish(x.deleted_at)) : undefined;
    let wLines: Row[] = [];
    if (wb) {
      snapshot.set(`${w!.week_start}|${s.name.trim()}`, wState(`${w!.week_start}|${s.name.trim()}`));
      const run = db.rows("allocation_run").filter((x) => x.batch_id === wb.id && x.status !== "superseded").pop();
      wLines = run ? db.rows("allocation_line").filter((x) => x.allocation_run_id === run.id) : [];
      C.push(check("harga LB Rp/kg", lbPriceSheet, wb.lb_price as string | null, "W", "perkg"));
      C.push(check("angkut Rp", R.freight, wb.freight as string | null, "W", "total"));
      C.push(check("potong Rp", R.maklon, wb.maklon as string | null, "W", "total"));
      C.push(check("biaya total", totIncl, run ? (run.total_cost as string) : null, "W", "total"));
      C.push(check("nilai jual", R.value, run ? wLines.reduce((a, l) => a.plus(D(String(l.sales_value))), D(0)) : null, "W", "total"));
      C.push(check("COGS teralokasi", R.cogs, run ? (run.total_allocated as string) : null, "W", "total"));
    } else {
      // not uploaded (hidden, BT-COGS-1) is expected; an uploaded sheet without a stored batch (no week for its date) is not
      C.push({ name: uploaded ? "batch tersimpan" : "tidak diunggah (sheet tersembunyi)", cell: "—", sheet: null, app: null, path: "W", kind: "total", ok: uploaded ? false : null, diff: null });
    }
    // per output row: L (COGS/kg)
    const rowsOk = { A: 0, S: 0, W: 0 };
    for (const r of R.rows) {
      const al = A.lines.find((l) => l.ref === `${s.name}!${r.row}`);
      const sl = S?.lines.find((l) => l.key === `${r.row}`);
      const wl = wLines.find((l) => (l.item_code ?? null) === r.code);
      const ca = check(`L${r.row}`, r.L, al?.costPerKg ?? null, "A", "perkg");
      const cs = check(`L${r.row}`, r.L, sl?.costPerKg ?? null, "S", "perkg");
      const cw = check(`L${r.row}`, r.L, wl ? String(wl.cost_per_kg) : null, "W", "perkg");
      if (ca.ok) rowsOk.A++; else C.push({ ...ca, name: `COGS/kg ${ca.name}` });
      if (cs.ok) rowsOk.S++; else if (S) C.push({ ...cs, name: `COGS/kg ${cs.name}` });
      if (cw.ok) rowsOk.W++; else if (wb) C.push({ ...cw, name: `COGS/kg ${cw.name}` });
    }
    bo.rowsOk = rowsOk;
    bo.inputs = {
      date: b.date, lb_kg: b.lb_kg, processed_kg: b.processed_kg,
      cost: { LB: lbAmt.toString(), freight: fr.toString(), maklon: mk.toString(), bl: b.cost_bl },
      rows: b.rows.map((r) => ({ row: r.row, item_code: r.item_code, kg: D(r.kg_non_blasting).plus(D(r.kg)).toString(), price: r.price, boneless: /boneless/i.test(r.item_name ?? "") })),
    };
    bo.expected = {
      lb_kg: R.lbKg, processed_kg: R.processed, shrink_kg: R.shrinkKg, shrink_pct: R.shrinkPct, lb: R.lb, freight: R.freight, maklon: R.maklon, bl: R.bl,
      total_ex_bl: R.totF, total: totIncl, value: R.value, cogs: R.cogs, gp: R.gp, gp_margin: R.gpMargin, k: kSheet, breakeven: beSheet, lb_price: lbPriceSheet,
      L: Object.fromEntries(R.rows.map((r) => [String(r.row), r.L.value])),
    };
  }
}
function isNullish(v: unknown) { return v === null || v === undefined; }

// ------------------------------------------------------------------------------------------------ report

const fmt = (v: number | null, k: Kind) => v === null ? "—" : k === "ratio" ? v.toFixed(6) : k === "kg" ? v.toFixed(2) : k === "perkg" ? v.toFixed(2) : v.toFixed(0);
console.log(`# Backtest COGS LB — ${new Date().toISOString()}`);
console.log(`SheetJS ${XLSX.version}; BACKTEST_DIR=${DIR}`);
for (const s of sources) console.log(`- ${s.file} sha256 ${s.sha256} · ${s.sheets} sheet · Pot_*: ${s.pot.length}`);
for (const [f, n] of Object.entries(stageNotes)) {
  console.log(`\n## stage costing_wp ${f}: ${n.note}; dilewati: ${n.skipped.join(", ") || "—"}`);
  for (const i of n.issues) console.log(`  - ${i}`);
  console.log(`  commit: ${commitNotes[f]}`);
}
console.log(`\n## alokasi (allocateWeek)`);
for (const a of allocNotes) console.log(`- ${a}`);
console.log(`\n## efek upload berkas berikutnya pada batch yang sudah ada`);
for (const c of crossEffects) console.log(`- ${c.file} mengubah ${c.batch}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
if (!crossEffects.length) console.log("- tidak ada");
const perWeek = new Map<string, { n: number; refs: string[]; cost: number }>();
for (const b of db.rows("batch")) {
  const w = db.rows("week").find((x) => x.id === b.week_id);
  const run = db.rows("allocation_run").filter((x) => x.batch_id === b.id && x.status !== "superseded").pop();
  const k = String(w?.week_start);
  const e = perWeek.get(k) ?? { n: 0, refs: [], cost: 0 };
  e.n++; e.refs.push(String(b.batch_ref)); e.cost += Number(run?.total_cost ?? 0); // missing-ok: a batch without a run adds no allocated cost to the week total shown
  perWeek.set(k, e);
}
console.log(`\n## batch tersimpan per minggu (W)`);
for (const [k, e] of [...perWeek].sort()) console.log(`- ${k}: ${e.n} batch, Σ biaya run ${e.cost.toFixed(0)} — ${e.refs.join(", ")}`);
console.log(`\n| bulan | sheet | tersembunyi | tgl | kg LB | kg diproses | susut % | biaya total | nilai jual | GP | k | BE Rp/kg LB | baris L A/S/W | selisih (jalur: cek) | ops_batch |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const b of out) {
  const g = (n: string, p: string) => b.checks.find((c) => c.name === n && c.path === p);
  const bad = b.checks.filter((c) => c.ok === false).map((c) => `${c.path}:${c.name} ${c.cell} sheet ${fmt(c.sheet, c.kind)} app ${fmt(c.app, c.kind)}`);
  const v = (c: Check | undefined, side: "sheet" | "app" = "sheet") => (c ? fmt(c[side], c.kind) : "—");
  console.log(`| ${b.month} | ${b.sheet} | ${b.hidden ? "ya" : ""} | ${b.date ?? "—"} | ${v(g("kg LB beli", "P"))} | ${v(g("kg diproses", "P"))} | ${g("susut %", "P")?.sheet !== null && g("susut %", "P") ? (g("susut %", "P")!.sheet! * 100).toFixed(2) : "—"} | ${v(g("biaya total", "A"))} | ${v(g("nilai jual", "A"))} | ${v(g("GP", "A"))} | ${v(g("k", "S"))} | ${v(g("breakeven Rp/kg LB", "S"))} | ${b.rowsTotal ? `${b.rowsOk.A ?? 0}/${b.rowsOk.S ?? 0}/${b.rowsOk.W ?? 0} dari ${b.rowsTotal}` : "0"} | ${b.parsed ? (bad.length ? bad.slice(0, 6).join("; ") + (bad.length > 6 ? ` (+${bad.length - 6})` : "") : "sama") : "tidak terbaca parser"} | ${b.opsBatch} |`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ sources, stageNotes, commitNotes, allocNotes, crossEffects, batches: out }, null, 1));
if (writeFixture) {
  const dir = join(root, "fixtures/backtest-cogs-2026-08-09");
  mkdirSync(dir, { recursive: true });
  const fx = {
    fixture: "backtest-cogs-2026-08-09", generated_by: "tests/backtest/cogs-lb/run.ts --write-fixture",
    note: "Aggregates and output rows (item code, kg, price) of the Pot_* sheets; no supplier, invoice, customer or item names. Cells are the sheet's own cached values.",
    sources: sources.map((s) => ({ file: s.file, sha256: s.sha256 })),
    tolerance: TOL,
    batches: out.filter((b) => b.parsed).map((b) => ({
      month: b.month, sheet: b.sheet, hidden: b.hidden, rpa: b.rpa, inputs: b.inputs, expected: b.expected,
      result: Object.fromEntries(b.checks.filter((c) => !c.name.startsWith("COGS/kg")).map((c) => [`${c.path}:${c.name}`, c.ok])),
      rows_ok: b.rowsOk,
    })),
    not_parsed: out.filter((b) => !b.parsed).map((b) => ({ month: b.month, sheet: b.sheet, hidden: b.hidden })),
  };
  writeFileSync(join(dir, "expected.json"), JSON.stringify(fx, null, 1) + "\n");
  console.log(`\nfixture: ${join(dir, "expected.json")}`);
}
