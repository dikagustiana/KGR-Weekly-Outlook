/**
 * PRD v5 §4.9 (K34): one validation for an upload, run in the browser for the preview and again on the server, which
 * is the authority. Pure: the file is already a grid of cells (SheetJS in the browser, a pasted TSV, or the raw grid the
 * browser sends); everything the checks need from the database comes in the context.
 *
 *   header      first row; lower case, spaces → "_"; empty rows skipped
 *   numbers     1.234,5 · 36.705 · Rp 43.086 · 71,5% · Excel numbers
 *   dates       YYYY-MM-DD · DD/MM/YYYY · Excel serial days
 *   result      checks (ok / warn / fail / info) and rows; rows without `fail` may be saved (ok_count); the fingerprint
 *               binds the preview to the grid and the result, so the server refuses a payload changed after preview
 *
 * Checks follow `validate()` of the mockup Input.dc.html, with the differences of PRD Lampiran D: the tolerance of
 * Σ SKU vs the cut output is C22 (2 %), the shrink target and the karkas yield bounds come from the parameters (O6).
 */
import { D, Decimal, ZERO, sum, type Num } from "./decimal";
import { addDays, isISODate, type ISODate } from "./dates";
import { fixed } from "./format";
import { sizeKgOf } from "./ppic-class";
import { inAssignmentScope, type SalesAssignment } from "./commercial-v5";

export type UploadKindV5 = "po_lines" | "costing_wp" | "yield_matrix" | "lb_supply" | "fixed_cost" | "supplier_invoice";
export const UPLOAD_KINDS_V5: UploadKindV5[] = ["po_lines", "costing_wp", "yield_matrix", "lb_supply", "fixed_cost", "supplier_invoice"];

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];
export type CheckLevel = "ok" | "warn" | "fail" | "info";
export type RowLevel = "ok" | "warn" | "fail";

export interface UploadCheck { level: CheckLevel; title: string; detail: string; result: string; code?: string }
/** A row of the preview table (per file row; per class for the yield matrix, as in the mockup). */
export interface UploadRow { ref: string; name: string; kg: string; level: RowLevel; action: string }
/** A file row as the server saves it: its level and the normalised values (strings, decimal text). */
export interface UploadRecord { line: number; level: RowLevel; data: Record<string, string | null> }

export interface UploadResult {
  kind: UploadKindV5;
  total: number;
  ok_count: number;
  checks: UploadCheck[];
  rows: UploadRow[];
  records: UploadRecord[];
  summary: string;
  /** Batches (or other scopes) whose rows may be saved only with a written reason (e.g. Σ SKU outside C22). */
  needsReason: string[];
  /** Dates the saved rows touch (rebuild queue). */
  dates: ISODate[];
  fingerprint: string;
}

export interface UploadTemplate { kind: UploadKindV5; fileName: string; cols: { name: string; required: boolean }[]; hint: string; owner: string }

const col = (name: string, required = true) => ({ name, required });
export const UPLOAD_TEMPLATES: Record<UploadKindV5, UploadTemplate> = {
  po_lines: {
    kind: "po_lines", fileName: "template_PO.xlsx", owner: "Sales",
    cols: [col("no_po"), col("tanggal_kirim"), col("kode_item"), col("kg"), col("harga"), col("pelanggan", false), col("ukuran", false)],
    hint: "Kolom: no_po, tanggal_kirim (YYYY-MM-DD), kode_item (kode Accurate), kg, harga (Rp/kg), pelanggan; ukuran (Uk 1.3) bila kode karkas belum punya ukuran. Baris 1 = judul kolom.",
  },
  costing_wp: {
    kind: "costing_wp", fileName: "template_WP_potong.xlsx", owner: "Cost Accounting",
    cols: [col("batch"), col("kg_lb"), col("ekor"), col("kode_item"), col("kg")],
    hint: "Kolom: batch, kg_lb dan ekor (cukup di baris pertama tiap batch), kode_item, kg hasil per SKU. Baris 1 = judul kolom.",
  },
  yield_matrix: {
    kind: "yield_matrix", fileName: "template_yield_kelas.xlsx", owner: "PPIC",
    cols: [col("kelas"), col("kunci"), col("yield_pct"), col("pola", false), col("berlaku_mulai", false)],
    hint: "Kolom: kelas (K/S/B), kunci (Karkas, Kepala, Ceker, Usus, HJA, Lemak), yield_pct (0,715 atau 71,5); pola (karkas) dan berlaku_mulai boleh kosong. Baris 1 = judul kolom.",
  },
  lb_supply: {
    kind: "lb_supply", fileName: "template_supply_LB.xlsx", owner: "Purchasing",
    cols: [col("tanggal"), col("kelas"), col("pemasok"), col("kg_lb"), col("harga", false), col("ekor", false)],
    hint: "Kolom: tanggal (potong), kelas (terdaftar), pemasok, kg_lb, harga (Rp/kg LB), ekor. Baris 1 = judul kolom.",
  },
  fixed_cost: {
    kind: "fixed_cost", fileName: "template_beban_tetap.xlsx", owner: "Finance",
    cols: [col("coa"), col("bulan"), col("nominal"), col("basis", false), col("dasar", false)],
    hint: "Kolom: coa (akun beban tetap), bulan (YYYY-MM), nominal (Rp per bulan), basis (payroll / jadwal aset / jadwal pinjaman), dasar. Baris 1 = judul kolom.",
  },
  supplier_invoice: {
    kind: "supplier_invoice", fileName: "template_faktur_LB.xlsx", owner: "Cost Accounting",
    cols: [col("no_faktur"), col("tanggal"), col("pemasok"), col("batch"), col("kg", false), col("nilai")],
    hint: "Kolom: no_faktur, tanggal, pemasok, batch, kg LB, nilai (Rp). Baris 1 = judul kolom.",
  },
};

// ------------------------------------------------------------------------------------------------ context

export interface UploadItem { code: string; name: string | null; key: string; size_kg?: Num | null }
export interface UploadClass { code: string; min_kg: Num | null; max_kg: Num | null; avg_kg: Num | null }
export interface UploadBatch {
  ref: string; date: ISODate; lb_kg: Num | null; heads: Num | null;
  /**
   * PRD v5.2 R58: the WP output rows the batch already has (active, source WP). A line of the file that is held keeps its
   * old row (the commit does not retire it), so C22 counts that old output with the rows that pass.
   */
  output?: { key: string | null; item_code: string | null; kg: Num }[];
}

export interface UploadContext {
  today: ISODate;
  items: UploadItem[];
  /** Price floor per SKU key = cost per kg (v5/1); null when this user may not see costs (sales_sees_cost false). */
  floors: Record<string, Num> | null;
  classes: UploadClass[];
  batches?: UploadBatch[];
  /** O6 defaults: karkas yield 68–76 %, shrink target 3 %, C22 tolerance 2 %. */
  yieldKarkas?: { min: Num; max: Num };
  shrinkTarget?: Num;
  tolerance?: Num;
  /** K32: customers the uploader writes POs for; "all" for the commercial lead and admin. */
  customers?: string[] | "all";
  /**
   * PRD v5.2 R58 (O21(b)): the assignment rows (customer × key) of a Sales uploader. When given, a PO line must lie inside one
   * of them (customer and key together, the database guard's rule); without it only `customers` is checked.
   */
  assignments?: SalesAssignment[];
  /** fixed_cost: accounts whose driver is fixed, and the schedule rows already in force. */
  fixedAccounts?: string[];
  fixedSchedule?: { code: string | null; account: string | null; start: ISODate; end: ISODate | null }[];
  /**
   * PRD v5.1 O15 (parameter.po_unsized_mode): a karkas RPA PO line without size is "warn" — saved with size_kg null,
   * PPIC plans it as STD — or "fail" (held). Default "warn".
   */
  poUnsizedMode?: "warn" | "fail";
  /** supplier_invoice: GL amount per document number (C23 tie). */
  glByDoc?: Record<string, Num>;
  /** lb_supply: need of kg LB per cut date and class (C58). */
  classNeed?: { date: ISODate; weight_class: string; kg_lb: Num }[];
}

/** C51: a class is registered once PPIC has given it numbers (an average or a range); v5/0 seeds K/S/B without (O5). */
export function registeredClasses(classes: UploadClass[]): string[] {
  const has = (v: Num | null | undefined) => v !== null && v !== undefined && v !== "";
  return classes.filter((c) => has(c.avg_kg) || (has(c.min_kg) && has(c.max_kg))).map((c) => c.code);
}

/** The registered class whose range [min, max) holds an average kg per head; null when none. */
export function classOfAvg(classes: UploadClass[], avg: Decimal): string | null {
  const reg = new Set(registeredClasses(classes));
  const hit = classes.filter((c) => reg.has(c.code) && c.min_kg !== null && c.max_kg !== null && c.min_kg !== "" && c.max_kg !== "")
    .find((c) => avg.gte(D(c.min_kg)) && avg.lt(D(c.max_kg)));
  return hit?.code ?? null;
}

// ------------------------------------------------------------------------------------------------ parsing

export const normHeader = (h: Cell) => String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_");
const txt = (c: Cell | undefined) => (c === null || c === undefined ? "" : String(c).trim());

/** Delimited text (one row per line); "quoted" cells may hold the separator, newlines and "" (Excel's quoting). */
function parseDelimited(text: string, sep: string): Grid {
  const rows: Grid = [];
  let row: Cell[] = [], cell = "", q = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** A range pasted from Excel: tab-separated (no library, PRD §4.9). */
export const parseTsv = (text: string): Grid => parseDelimited(text, "\t");

/** A CSV file: comma or semicolon (Excel id-ID writes ";"), whichever the header line holds more of. */
export function parseCsv(text: string): Grid {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  return parseDelimited(text, (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",");
}

/** 1.234,5 · 36.705 · Rp 43.086 · 71,5% · 811.3 · 0.715 · Excel numbers; null when empty or not a number. */
export function upNum(v: Cell | undefined): Decimal | null {
  if (typeof v === "number") return Number.isFinite(v) ? D(String(v)) : null;
  if (typeof v === "boolean" || v === null || v === undefined) return null;
  let s = String(v).trim().replace(/\s|rp|%/gi, "").replace(/^−/, "-");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) {
    // R79: "1,234" (English thousands, comma + 3 digits) is ambiguous — refuse it, never read it as a decimal
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return null;
    s = s.replace(",", ".");
  }
  // PRD v5.1 R32: 0.715 is a decimal (a share, a yield), never 715; 1.234 stays a thousands group
  else if (/^-?0\.\d+$/.test(s)) { /* decimal as written */ }
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? D(s) : null;
}

/** YYYY-MM-DD (time ignored) · DD/MM/YYYY · DD-MM-YYYY · Excel serial days (1900 system); null otherwise. */
export function upDate(v: Cell | undefined): ISODate | null {
  if (typeof v === "number") return v > 0 && v < 2_958_466 ? addDays("1899-12-30", Math.floor(v)) : null;
  const s = txt(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let d = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  if (!d) {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
    d = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  }
  if (!d && /^\d{5}(\.\d+)?$/.test(s)) return upDate(Number(s));
  return d && isISODate(d) ? d : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
/** A month: YYYY-MM · MM/YYYY · "Agu 2026" · any date of it → its first day. */
export function upMonth(v: Cell | undefined): ISODate | null {
  const s = txt(v);
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) { const d = `${m[1]}-${m[2].padStart(2, "0")}-01`; return isISODate(d) ? d : null; }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) { const d = `${m[2]}-${m[1].padStart(2, "0")}-01`; return isISODate(d) ? d : null; }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-01`;
  const d = upDate(v);
  return d ? d.slice(0, 8) + "01" : null;
}

/** "Uk 1.3", "1.3", "1,3" → 1.30; null otherwise. */
export function upSize(v: Cell | undefined): Decimal | null {
  const s = txt(v);
  if (!s) return null;
  const m = /^(?:uk\.?\s*)?(\d+)[.,](\d+)$/i.exec(s) ?? /^(?:uk\.?\s*)?(\d+)$/i.exec(s);
  if (!m) return sizeKgOf(s);
  return D(m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1]);
}

// ------------------------------------------------------------------------------------------------ format (id-ID)

const f1 = (x: Decimal) => fixed(x, 1).replace(/^-/, "−");
const f0 = (x: Decimal) => fixed(x, 0).replace(/^-/, "−");
const f2 = (x: Decimal) => fixed(x, 2).replace(/^-/, "−");
const pc1 = (x: Decimal) => `${f1(x.times(100))}%`;
const pc0 = (x: Decimal) => `${f0(x.times(100))}%`;
const range = (lo: Decimal, hi: Decimal) => `${f0(lo.times(100))}–${pc0(hi)}`;
const dm = (d: ISODate) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const str = (x: Decimal | null) => (x === null ? null : x.toString());

// ------------------------------------------------------------------------------------------------ fingerprint

/** cyrb53: a 53-bit string hash (pure; not a security boundary — the server re-validates everything). */
function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** The grid as text cells, trailing empty cells and empty rows dropped: what both sides hash. */
export function normalizeGrid(grid: Grid): string[][] {
  return grid.map((r) => {
    const cells = r.map((c) => (typeof c === "number" ? String(c) : txt(c)));
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
  }).filter((r) => r.length > 0);
}

export function uploadFingerprint(kind: UploadKindV5, grid: Grid, r: Omit<UploadResult, "fingerprint">): string {
  const body = JSON.stringify([
    kind, normalizeGrid(grid), r.total, r.ok_count, r.checks.map((c) => [c.level, c.title, c.detail, c.result]),
    r.rows.map((x) => [x.ref, x.level, x.action]), r.records.map((x) => [x.line, x.level, x.data]), r.needsReason,
  ]);
  return `v1:${cyrb53(body, 1)}${cyrb53(body, 2)}`;
}

// ------------------------------------------------------------------------------------------------ validation

interface Table { idx: Record<string, number>; missing: string[]; body: { line: number; cells: Cell[] }[] }

function table(kind: UploadKindV5, grid: Grid): Table {
  const head = (grid[0] ?? []).map(normHeader);
  const idx: Record<string, number> = {};
  const missing: string[] = [];
  for (const c of UPLOAD_TEMPLATES[kind].cols) {
    idx[c.name] = head.indexOf(c.name);
    if (idx[c.name] < 0 && c.required) missing.push(c.name);
  }
  const body = grid.slice(1).map((cells, i) => ({ line: i + 2, cells })).filter((r) => r.cells.some((c) => txt(c) !== ""));
  return { idx, missing, body };
}

const chk = (level: CheckLevel, title: string, detail: string, result: string, code?: string): UploadCheck => (code ? { level, title, detail, result, code } : { level, title, detail, result });
const countCheck = (title: string, good: number, n: number, failLevel: CheckLevel, unit = "", code?: string, failResult?: string) =>
  chk(good === n ? "ok" : failLevel, title, `${good} dari ${n}${unit}`, good === n ? "lolos" : failResult ?? `${n - good} baris`, code);

function finish(kind: UploadKindV5, grid: Grid, r: Omit<UploadResult, "fingerprint" | "kind">): UploadResult {
  const base = { kind, ...r };
  return { ...base, fingerprint: uploadFingerprint(kind, grid, base) };
}

function itemIndex(ctx: UploadContext) {
  const m = new Map<string, UploadItem>();
  for (const i of ctx.items) m.set(i.code.trim().toUpperCase(), i);
  return (code: string) => m.get(code.trim().toUpperCase()) ?? null;
}

const isKarkasToSize = (key: string) => /^RPA\|Karkas\|(Fresh|n\/a)$/i.test(key);

/** PRD v5 §4.9: validate an upload of `kind`; the same function runs in the browser (preview) and on the server (save). */
export function validateUpload(kind: UploadKindV5, grid: Grid, ctx: UploadContext): UploadResult {
  const t = table(kind, grid);
  if (!grid.length || !(grid[0] ?? []).some((c) => txt(c) !== "")) {
    return finish(kind, grid, { total: 0, ok_count: 0, checks: [chk("fail", "File", "kosong", "isi baris judul dan data")], rows: [], records: [], summary: "File kosong.", needsReason: [], dates: [] });
  }
  if (t.missing.length) {
    return finish(kind, grid, {
      total: t.body.length, ok_count: 0, checks: [chk("fail", "Kolom wajib", `tidak ditemukan: ${t.missing.join(", ")}`, "perbaiki judul kolom")], rows: [], records: [],
      summary: "File tidak bisa dicek: judul kolom tidak sesuai template.", needsReason: [], dates: [],
    });
  }
  const g = (r: { cells: Cell[] }, c: string): Cell => (t.idx[c] >= 0 ? r.cells[t.idx[c]] ?? null : null);
  switch (kind) {
    case "po_lines": return poLines(grid, t, g, ctx);
    case "costing_wp": return costingWp(grid, t, g, ctx);
    case "yield_matrix": return yieldMatrix(grid, t, g, ctx);
    case "lb_supply": return lbSupply(grid, t, g, ctx);
    case "fixed_cost": return fixedCost(grid, t, g, ctx);
    case "supplier_invoice": return supplierInvoice(grid, t, g, ctx);
  }
}

type Get = (r: { cells: Cell[] }, c: string) => Cell;
const head = chk("ok", "Kolom wajib", "lengkap", "lolos");

function poLines(grid: Grid, t: Table, g: Get, ctx: UploadContext): UploadResult {
  const item = itemIndex(ctx);
  const customers = ctx.customers ?? "all";
  const allowed = customers === "all" ? null : new Set(customers.map((c) => c.trim().toLowerCase()));
  // R58 (O21(b)): a Sales line must lie inside one assignment row — customer and key together (the database guard's rule)
  const scope = ctx.assignments ?? null;
  const unsizedFails = ctx.poUnsizedMode === "fail";
  let mapped = 0, needSize = 0, sized = 0, dateOk = 0, numOk = 0, floorOk = 0, custOk = 0;
  let kgOk = ZERO, kgAll = ZERO;
  const rows: UploadRow[] = [], records: UploadRecord[] = [];
  for (const r of t.body) {
    const code = txt(g(r, "kode_item")), it = item(code), kg = upNum(g(r, "kg")), price = upNum(g(r, "harga")), date = upDate(g(r, "tanggal_kirim"));
    const customer = txt(g(r, "pelanggan")) || null;
    const issues: string[] = [];
    let level = "ok" as RowLevel;
    const fail = (m: string) => { issues.push(m); level = "fail"; };
    if (it) mapped++; else fail("kode tidak dikenal: petakan di master item");
    let size: Decimal | null = null;
    if (it && isKarkasToSize(it.key)) {
      needSize++;
      size = upSize(g(r, "ukuran")) ?? (it.size_kg !== null && it.size_kg !== undefined && it.size_kg !== "" ? D(it.size_kg) : null) ?? sizeKgOf(it.name);
      if (size) sized++;
      else if (unsizedFails) fail("ukuran karkas kosong: isi kolom ukuran (Uk 0.8–1.5)");
      else { issues.push("ukuran karkas kosong: isi kolom ukuran atau biarkan STD"); if (level === "ok") level = "warn"; }
    }
    if (date && date >= ctx.today) dateOk++; else fail(date ? `tanggal kirim ${dm(date)} sudah lewat` : "tanggal kirim tidak terbaca");
    if (kg?.gt(0) && price?.gt(0)) numOk++; else fail(!kg?.gt(0) ? "kg kosong" : "harga kosong");
    const fl = it && ctx.floors && ctx.floors[it.key] !== undefined && ctx.floors[it.key] !== null ? D(ctx.floors[it.key]) : null;
    if (fl && price?.gt(0) && price.lt(fl)) { issues.push(`harga ${f0(price)} < lantai ${f0(fl)}: approval Kepala Sales`); if (level === "ok") level = "warn"; }
    else floorOk++;
    if (scope) {
      if (inAssignmentScope(scope, { customer, key: it?.key ?? null })) custOk++;
      else fail(`${customer ?? "(spot)"} · ${it?.key ?? code ?? "—"} tidak ditugaskan kepada Anda`);
    } else if (!allowed || (customer && allowed.has(customer.toLowerCase()))) custOk++;
    else fail(customer ? `pelanggan ${customer} tidak ditugaskan kepada Anda` : "pelanggan kosong");
    if (kg?.gt(0)) kgAll = kgAll.plus(kg);
    if (level !== "fail" && kg?.gt(0)) kgOk = kgOk.plus(kg);
    rows.push({ ref: txt(g(r, "no_po")), name: it ? `${it.name ?? it.key} · kirim ${date ? dm(date) : "?"}` : `${code || "—"} (tidak dikenal)`, kg: kg?.gt(0) ? f1(kg) : "—", level, action: issues.join("; ") });
    records.push({
      line: r.line, level,
      data: { po_ref: txt(g(r, "no_po")) || null, delivery_date: date, item_code: code || null, key: it?.key ?? null, kg: str(kg), price: str(price), customer, size_kg: size ? size.toFixed(2) : null, below_floor: fl && price?.lt(fl) ? "true" : null },
    });
  }
  const n = t.body.length, ok = records.filter((x) => x.level !== "fail").length;
  const checks = [
    head,
    countCheck("Kode item terpetakan", mapped, n, "fail", "", "C56"),
    countCheck("Ukuran karkas RPA terisi", sized, needSize, unsizedFails ? "fail" : "warn", " baris karkas", "C50", unsizedFails ? undefined : `${needSize - sized} baris → STD`),
    countCheck("Tanggal kirim ≥ hari ini", dateOk, n, "fail"),
    countCheck("kg dan harga terisi", numOk, n, "fail"),
    ctx.floors ? countCheck("Harga ≥ lantai (biaya)", floorOk, n, "warn", "", "C38", `${n - floorOk} baris → approval`) : chk("info", "Harga ≥ lantai (biaya)", "dicek saat simpan", "di bawah lantai → approval", "C38"),
    allowed || scope ? countCheck(scope ? "Pelanggan dan SKU sesuai assignment" : "Pelanggan sesuai assignment", custOk, n, "fail", "", "K32") : chk("ok", "Pelanggan sesuai assignment", "semua pelanggan", "lolos", "K32"),
  ];
  const dates = [...new Set(records.filter((x) => x.level !== "fail" && x.data.delivery_date).map((x) => x.data.delivery_date!))].sort();
  return finish("po_lines", grid, {
    total: n, ok_count: ok, checks, rows, records, needsReason: [], dates,
    summary: `${ok} dari ${n} baris bisa disimpan (${f1(kgOk)} kg dari ${f1(kgAll)} kg). Baris gagal ditahan sampai diperbaiki.`,
  });
}

function costingWp(grid: Grid, t: Table, g: Get, ctx: UploadContext): UploadResult {
  const item = itemIndex(ctx);
  const tol = D(ctx.tolerance ?? "0.02"), shrink = D(ctx.shrinkTarget ?? "0.03");
  const ymin = D(ctx.yieldKarkas?.min ?? "0.68"), ymax = D(ctx.yieldKarkas?.max ?? "0.76");
  const known = ctx.batches ? new Map(ctx.batches.map((b) => [b.ref.trim().toUpperCase(), b])) : null;
  interface B {
    ref: string; kgLb: Decimal | null; heads: Decimal | null; lbs: Set<string>; lines: number[]; out: Decimal; karkas: Decimal; found: UploadBatch | null | undefined;
    /** R58: item codes of the lines held in the file, and the key|code of the lines that pass (what the commit writes). */
    held: Set<string>; passing: Set<string>;
  }
  const batches = new Map<string, B>();
  let mapped = 0;
  const rows: UploadRow[] = [], records: UploadRecord[] = [];
  for (const r of t.body) {
    const ref = txt(g(r, "batch")) || "?", code = txt(g(r, "kode_item")), it = item(code), kg = upNum(g(r, "kg"));
    const b = batches.get(ref) ?? { ref, kgLb: null, heads: null, lbs: new Set<string>(), lines: [], out: ZERO, karkas: ZERO, found: known ? known.get(ref.toUpperCase()) ?? null : undefined, held: new Set<string>(), passing: new Set<string>() };
    batches.set(ref, b);
    b.lines.push(rows.length);
    const lb = upNum(g(r, "kg_lb")), hd = upNum(g(r, "ekor"));
    if (lb?.gt(0)) { b.kgLb = lb; b.lbs.add(lb.toString()); }
    if (hd?.gt(0)) b.heads = hd;
    const issues: string[] = [];
    let level = "ok" as RowLevel;
    const fail = (m: string) => { issues.push(m); level = "fail"; };
    if (it) mapped++; else fail("kode tidak dikenal: petakan di master item");
    if (!kg?.gt(0)) fail("kg kosong");
    if (b.found === null) fail(`batch ${ref} tidak ada di data batch`);
    // R58: C22 is judged on the output that will be saved — the rows that pass (and the old output a held line keeps),
    // not the rejected ones
    if (kg?.gt(0) && level !== "fail") { b.out = b.out.plus(kg); if (it && /\|Karkas\|/.test(it.key)) b.karkas = b.karkas.plus(kg); if (it) b.passing.add(`${it.key}|${code}`); }
    else if (code) b.held.add(code.toUpperCase());
    rows.push({ ref: code || "—", name: it ? it.name ?? it.key : "(tidak dikenal)", kg: kg?.gt(0) ? f1(kg) : "—", level, action: issues.join("; ") });
    records.push({ line: r.line, level, data: { batch_ref: ref, item_code: code || null, key: it?.key ?? null, item_name: it?.name ?? null, kg: str(kg), kg_lb: str(lb?.gt(0) ? lb : null), heads: str(hd?.gt(0) ? hd : null), batch_date: b.found?.date ?? null } });
  }
  const n = t.body.length;
  const checks: UploadCheck[] = [head, countCheck("Kode SKU terpetakan", mapped, n, "fail", " baris", "C56")];
  const needsReason: string[] = [];
  // PRD v5.1 R34: a batch without kg LB or heads, or with different kg LB on its rows, holds every row of that batch
  const holdBatch = (b: B, why: string) => {
    for (const i of b.lines) {
      if (records[i].level !== "fail") { records[i].level = "fail"; rows[i].level = "fail"; }
      rows[i].action = rows[i].action ? `${rows[i].action}; ${why}` : why;
    }
  };
  for (const b of batches.values()) {
    if (b.found === null) { checks.push(chk("fail", `Batch ${b.ref}`, "tidak ada di data batch", "buat batch dulu")); continue; }
    if (!b.kgLb || !b.heads) { checks.push(chk("fail", `Batch ${b.ref}`, "kg_lb atau ekor kosong", "isi di baris pertama")); holdBatch(b, `batch ${b.ref}: kg_lb atau ekor kosong`); continue; }
    if (b.lbs.size > 1) {
      const v = [...b.lbs].map((x) => f1(D(x))).join(" / ");
      checks.push(chk("fail", `Batch ${b.ref}`, `kg LB tidak konsisten (${v})`, "satu angka kg LB per batch"));
      holdBatch(b, `batch ${b.ref}: kg LB tidak konsisten`);
      continue;
    }
    if (b.found && b.found.lb_kg !== null && b.found.lb_kg !== "" && D(b.found.lb_kg).gt(0)) {
      const plan = D(b.found.lb_kg), d = b.kgLb.minus(plan).div(plan);
      checks.push(chk(d.abs().lte(tol) ? "ok" : "warn", "kg LB sesuai batch", `${f0(b.kgLb)} di WP vs ${f0(plan)} di batch (${d.gte(0) ? "+" : ""}${pc1(d)})`, d.abs().lte(tol) ? "lolos" : "cek timbangan"));
    }
    const avg = b.kgLb.div(b.heads), cls = classOfAvg(ctx.classes, avg);
    checks.push(chk("info", `Batch ${b.ref} · rata-rata LB`, `${f1(b.kgLb)} kg / ${f0(b.heads)} ekor = ${f2(avg)} kg/ekor`, cls ? `kelas ${cls}` : "di luar kelas terdaftar"));
    // R58: the old rows of the lines held in this file are kept by the commit, so they are part of what will be saved
    const kept = (b.found?.output ?? []).filter((o) => o.item_code && b.held.has(o.item_code.toUpperCase()) && !b.passing.has(`${o.key ?? ""}|${o.item_code}`));
    const keptKg = sum(kept.map((o) => D(o.kg))), keptKarkas = sum(kept.filter((o) => o.key && /\|Karkas\|/.test(o.key)).map((o) => D(o.kg)));
    const out = b.out.plus(keptKg), karkas = b.karkas.plus(keptKarkas);
    const expect = b.kgLb.times(D(1).minus(shrink)), gap = D(1).minus(out.div(expect)), okGap = gap.abs().lte(tol);
    checks.push(chk(okGap ? "ok" : "fail", "Σ SKU vs hasil potong", `${f1(out)} vs ${f1(expect)} kg (LB − susut ${pc0(shrink)}), selisih ${pc1(gap)} (batas ${pc0(tol)})${keptKg.gt(0) ? `; termasuk ${f1(keptKg)} kg output lama yang dipertahankan` : ""}`, okGap ? "lolos" : "perlu penjelasan", "C22"));
    if (!okGap) needsReason.push(b.ref);
    const ky = karkas.div(b.kgLb), okY = ky.gte(ymin) && ky.lte(ymax);
    checks.push(chk(okY ? "ok" : "warn", "Yield karkas", `${pc1(ky)} (batas ${range(ymin, ymax)})`, okY ? "lolos" : "cek timbangan"));
  }
  const ok = records.filter((x) => x.level !== "fail").length;
  const dates = [...new Set(records.filter((x) => x.level !== "fail" && x.data.batch_date).map((x) => x.data.batch_date!))].sort();
  return finish("costing_wp", grid, {
    total: n, ok_count: ok, checks, rows, records, needsReason, dates,
    summary: `${ok} dari ${n} baris bisa disimpan. Batch dengan selisih di atas ${pc0(tol)} tetap berstatus sementara sampai diberi alasan.`,
  });
}

/** Canonical yield keys (yield_matrix.key, v3 seed) by the short names of the template. */
const YIELD_KEYS: Record<string, string> = {
  karkas: "Karkas", kepala: "Kepala", ceker: "Ceker", usus: "Usus", lemak: "Lemak",
  hja: "HJA (Hati/Jantung/Ampela)", "hja (hati/jantung/ampela)": "HJA (Hati/Jantung/Ampela)",
};

function yieldMatrix(grid: Grid, t: Table, g: Get, ctx: UploadContext): UploadResult {
  const reg = new Set(registeredClasses(ctx.classes));
  const ymin = D(ctx.yieldKarkas?.min ?? "0.68"), ymax = D(ctx.yieldKarkas?.max ?? "0.76");
  interface P { lines: number[]; sum: Decimal; karkas: Decimal | null; bad: number; badKeys: string[] }
  const per = new Map<string, P>();
  const parsed = t.body.map((r) => {
    const k = txt(g(r, "kelas")).toUpperCase();
    let y = upNum(g(r, "yield_pct"));
    if (y && y.gt(1)) y = y.div(100);
    const raw = txt(g(r, "kunci")), key = YIELD_KEYS[raw.toLowerCase()] ?? null;
    const p = per.get(k) ?? { lines: [], sum: ZERO, karkas: null, bad: 0, badKeys: [] };
    per.set(k, p);
    p.lines.push(r.line);
    if (y && y.gte(0)) p.sum = p.sum.plus(y); else p.bad++;
    if (!key) p.badKeys.push(raw || "—");
    if (key === "Karkas") p.karkas = y;
    return { r, k, y, key };
  });
  const level = new Map<string, RowLevel>();
  const rows: UploadRow[] = [];
  for (const [k, p] of per) {
    const sumOk = p.sum.lte("1.0001") && !p.bad && !p.badKeys.length, isReg = reg.has(k);
    const kOk = p.karkas !== null && p.karkas.gte(ymin) && p.karkas.lte(ymax);
    const lv: RowLevel = !sumOk || !isReg ? "fail" : kOk ? "ok" : "warn";
    level.set(k, lv);
    const acts: string[] = [];
    if (!isReg) acts.push(`daftarkan kelas ${k || "—"}`);
    if (p.badKeys.length) acts.push(`kunci tidak dikenal: ${p.badKeys.join(", ")}`);
    if (!p.sum.lte("1.0001") || p.bad) acts.push("Σ yield > 100% atau ada angka kosong");
    if (!kOk) acts.push(`yield karkas di luar ${range(ymin, ymax)}`);
    rows.push({ ref: k || "—", name: `${p.lines.length} kunci`, kg: p.karkas === null ? "—" : pc1(p.karkas), level: lv, action: acts.join("; ") || `Σ ${pc1(p.sum)}` });
  }
  const records: UploadRecord[] = parsed.map(({ r, k, y, key }) => ({
    line: r.line, level: level.get(k)!,
    data: { weight_class: k || null, cut_pattern: txt(g(r, "pola")).toLowerCase() || "karkas", key, yield_pct: y ? y.toFixed(6) : null, effective_from: upDate(g(r, "berlaku_mulai")) ?? ctx.today },
  }));
  const unreg = [...per.keys()].filter((k) => !reg.has(k));
  const regList = [...reg].join(", ") || "belum ada";
  const n = t.body.length, ok = records.filter((x) => x.level !== "fail").length;
  const checks: UploadCheck[] = [
    head,
    chk(unreg.length ? "fail" : "ok", "Kelas terdaftar", unreg.length ? `${unreg.join(", ")} belum ada di tabel kelas berat (baru ${regList})` : "semua terdaftar", unreg.length ? "daftarkan dulu" : "lolos", "C51"),
    chk([...per.values()].every((p) => p.sum.lte("1.0001") && !p.bad) ? "ok" : "fail", "Σ yield per kelas ≤ 100%", [...per].map(([k, p]) => `${k} ${pc1(p.sum)}`).join(" · "), "per kelas"),
    chk([...per.values()].every((p) => p.karkas !== null && p.karkas.gte(ymin) && p.karkas.lte(ymax)) ? "ok" : "warn", `Yield karkas di ${range(ymin, ymax)}`,
      [...per].map(([k, p]) => `${k} ${p.karkas === null ? "—" : pc1(p.karkas)}`).join(" · "), "per kelas"),
  ];
  return finish("yield_matrix", grid, {
    total: n, ok_count: ok, checks, rows, records, needsReason: [], dates: [],
    summary: `${ok} dari ${n} baris bisa disimpan. Yield menggantikan placeholder C42 setelah kelas terdaftar.`,
  });
}

function lbSupply(grid: Grid, t: Table, g: Get, ctx: UploadContext): UploadResult {
  const reg = new Set(registeredClasses(ctx.classes));
  let regOk = 0, dateOk = 0, kgOk = 0;
  const rows: UploadRow[] = [], records: UploadRecord[] = [];
  const got = new Map<string, Decimal>();
  for (const r of t.body) {
    const date = upDate(g(r, "tanggal")), cls = txt(g(r, "kelas")).toUpperCase(), sup = txt(g(r, "pemasok")), kg = upNum(g(r, "kg_lb")), price = upNum(g(r, "harga")), heads = upNum(g(r, "ekor"));
    const issues: string[] = [];
    let level = "ok" as RowLevel;
    const fail = (m: string) => { issues.push(m); level = "fail"; };
    if (date) dateOk++; else fail("tanggal tidak terbaca");
    if (reg.has(cls)) regOk++; else fail(`kelas ${cls || "—"} belum terdaftar (C51)`);
    if (kg?.gt(0)) kgOk++; else fail("kg LB kosong");
    if (!sup) fail("pemasok kosong");
    if (price && price.lt(0)) fail("harga negatif");
    if (level !== "fail" && date) got.set(`${date}|${cls}`, (got.get(`${date}|${cls}`) ?? ZERO).plus(kg!));
    rows.push({ ref: date ? dm(date) : "—", name: `${cls || "—"} · ${sup || "—"}`, kg: kg?.gt(0) ? f1(kg) : "—", level, action: issues.join("; ") });
    records.push({ line: r.line, level, data: { date, weight_class: cls || null, supplier: sup || null, kg: str(kg), price_per_kg: str(price), head_count: str(heads) } });
  }
  const n = t.body.length;
  const checks: UploadCheck[] = [head, countCheck("Kelas terdaftar", regOk, n, "fail", "", "C51"), countCheck("Tanggal terbaca", dateOk, n, "fail"), countCheck("kg LB terisi", kgOk, n, "fail")];
  if (ctx.classNeed?.length) {
    const short: string[] = [];
    for (const [k, kg] of got) {
      const [date, cls] = k.split("|");
      const need = sum(ctx.classNeed.filter((x) => x.date === date && x.weight_class === cls).map((x) => D(x.kg_lb)));
      if (need.gt(kg)) short.push(`${cls} ${dm(date)} kurang ${f0(need.minus(kg))} kg`);
    }
    checks.push(chk(short.length ? "warn" : "ok", "Supply vs kebutuhan kelas", short.length ? short.join(" · ") : "cukup untuk semua kelas di file", short.length ? "PERIKSA" : "lolos", "C58"));
  } else checks.push(chk("info", "Supply vs kebutuhan kelas", "kebutuhan per kelas belum dihitung", "dicek di layar PPIC", "C58"));
  const ok = records.filter((x) => x.level !== "fail").length;
  const dates = [...new Set(records.filter((x) => x.level !== "fail" && x.data.date).map((x) => x.data.date!))].sort();
  return finish("lb_supply", grid, { total: n, ok_count: ok, checks, rows, records, needsReason: [], dates, summary: `${ok} dari ${n} baris bisa disimpan.` });
}

function fixedCost(grid: Grid, t: Table, g: Get, ctx: UploadContext): UploadResult {
  const fixedAcc = new Set((ctx.fixedAccounts ?? []).map((a) => a.trim()));
  const sched = ctx.fixedSchedule ?? [];
  let accOk = 0, monOk = 0, amtOk = 0, overlapOk = 0;
  const seen = new Set<string>();
  const rows: UploadRow[] = [], records: UploadRecord[] = [];
  for (const r of t.body) {
    const acc = txt(g(r, "coa")), month = upMonth(g(r, "bulan")), amt = upNum(g(r, "nominal"));
    const issues: string[] = [];
    let level = "ok" as RowLevel;
    const fail = (m: string) => { issues.push(m); level = "fail"; };
    if (fixedAcc.has(acc)) accOk++; else fail(`COA ${acc || "—"} bukan beban berdriver tetap`);
    if (month) monOk++; else fail("bulan tidak terbaca");
    if (amt && amt.gte(0)) amtOk++; else fail("nominal kosong atau negatif");
    const code = month ? `v5:${acc}:${month.slice(0, 7)}` : null;
    let clash: string | null = null;
    if (month) {
      const end = addDays(addDays(month, 31).slice(0, 8) + "01", -1);
      const hit = sched.find((s) => s.account === acc && s.code !== code && s.start <= end && (s.end === null || s.end >= month));
      if (hit) clash = `tumpang tindih dengan jadwal ${hit.code ?? "tanpa kode"} (${hit.start} s.d. ${hit.end ?? "terbuka"})`;
      if (code && seen.has(code)) clash = "COA × bulan ganda di file";
      if (code) seen.add(code);
    }
    if (clash) fail(clash); else overlapOk++;
    rows.push({ ref: acc || "—", name: month ? month.slice(0, 7) : "—", kg: amt ? f1(amt.div(1_000_000)) + " jt" : "—", level, action: issues.join("; ") });
    records.push({ line: r.line, level, data: { code, account: acc || null, month, amount: str(amt), basis: txt(g(r, "basis")) || null, note: txt(g(r, "dasar")) || null } });
  }
  const n = t.body.length;
  const checks = [head, countCheck("COA berdriver tetap", accOk, n, "fail"), countCheck("Bulan terbaca", monOk, n, "fail"), countCheck("Nominal terisi", amtOk, n, "fail"), countCheck("Periode tidak tumpang tindih", overlapOk, n, "fail")];
  const ok = records.filter((x) => x.level !== "fail").length;
  const dates = [...new Set(records.filter((x) => x.level !== "fail" && x.data.month).map((x) => x.data.month!))].sort();
  return finish("fixed_cost", grid, { total: n, ok_count: ok, checks, rows, records, needsReason: [], dates, summary: `${ok} dari ${n} baris bisa disimpan. Jadwal menggantikan estimasi bulan lalu (C55).` });
}

function supplierInvoice(grid: Grid, t: Table, g: Get, ctx: UploadContext): UploadResult {
  const known = new Map((ctx.batches ?? []).map((b) => [b.ref.trim().toUpperCase(), b]));
  const gl = ctx.glByDoc ?? {};
  let batchOk = 0, valOk = 0, tied = 0;
  const rows: UploadRow[] = [], records: UploadRecord[] = [];
  for (const r of t.body) {
    const doc = txt(g(r, "no_faktur")), date = upDate(g(r, "tanggal")), ref = txt(g(r, "batch")), amt = upNum(g(r, "nilai")), kg = upNum(g(r, "kg"));
    const b = known.get(ref.toUpperCase()) ?? null;
    const issues: string[] = [];
    let level = "ok" as RowLevel;
    const fail = (m: string) => { issues.push(m); level = "fail"; };
    if (!doc) fail("no faktur kosong");
    if (!date) fail("tanggal tidak terbaca");
    if (b) batchOk++; else fail(`batch ${ref || "—"} tidak ada`);
    if (amt?.gt(0)) valOk++; else fail("nilai kosong");
    const glAmt = doc && gl[doc] !== undefined ? D(gl[doc]) : null;
    const tie = glAmt !== null && amt !== null && glAmt.minus(amt).abs().lte(1);
    if (tie) tied++;
    else if (level !== "fail") { issues.push(glAmt === null ? "belum ada di jurnal: costing tetap sementara" : `selisih jurnal ${f0(amt!.minus(glAmt))}`); level = "warn"; }
    rows.push({ ref: doc || "—", name: `${ref || "—"} · ${txt(g(r, "pemasok")) || "—"}`, kg: amt ? f1(amt.div(1_000_000)) + " jt" : "—", level, action: issues.join("; ") });
    records.push({ line: r.line, level, data: { document_ref: doc || null, date, supplier: txt(g(r, "pemasok")) || null, batch_ref: ref || null, batch_date: b?.date ?? null, kg: str(kg), amount: str(amt), tied: tie ? "true" : null } });
  }
  const n = t.body.length;
  const checks = [head, countCheck("Batch ada", batchOk, n, "fail"), countCheck("Nilai terisi", valOk, n, "fail"), countCheck("Tie ke GL", tied, n, "warn", "", "C23", `${n - tied} faktur sementara`)];
  const ok = records.filter((x) => x.level !== "fail").length;
  const dates = [...new Set(records.filter((x) => x.level !== "fail" && x.data.batch_date).map((x) => x.data.batch_date!))].sort();
  return finish("supplier_invoice", grid, { total: n, ok_count: ok, checks, rows, records, needsReason: [], dates, summary: `${ok} dari ${n} faktur bisa disimpan; yang tie ke GL membuat biaya batch final.` });
}

/** A template: the header row only (the browser writes it as .xlsx, or CSV without SheetJS). */
export function templateGrid(kind: UploadKindV5): Grid {
  return [UPLOAD_TEMPLATES[kind].cols.map((c) => c.name)];
}
