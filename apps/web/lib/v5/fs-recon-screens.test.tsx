/**
 * PRD v5.2-A R69 (T15, K62, O25–O27) — screen tests with mocks: the Rekonsiliasi page (app against FS, difference and
 * cause), who may open it, the loaders failing closed, C59 holding the FINAL lock unless Finance records an override,
 * and the C59 row of the accuracy tile of Outlook bulan. The database is a stand-in (fake-sb: rows per table, filters
 * recorded not applied); the numbers come from the repo's fixtures through @kgr/engine, as in fixtures/fs-recon-2026-08.
 *
 * The tables fs_statement_line and fs_line_map are B-R86 (PRD v5.2-B): these tests need no database, but the code under
 * test may only be merged after B-R86 is in main and applied in KGR-OS (PRD v5.2-A Bab 4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, actualRowsV4, type PlRowV4 } from "@kgr/engine";
import { fakeSb, type FakeSb } from "../fake-sb";
import { LoaderError } from "../loader";
import { outlookBulanFixture } from "../../test-support/month-fixture";
import { TilePage } from "@/components/v4/TilePage";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/components/Shell", () => ({ Shell: ({ children }: { children: unknown }) => <div data-shell>{children as never}</div> }));
vi.mock("@/lib/page", () => ({ plainContext: async () => ({ viewer, weeks: [], week: null }) }));
/**
 * fake-sb answers every page of a query with all the rows, so fetchAll would never stop on a table of 1000+ rows (the
 * journal, gl_line, has 1.840): this applies .range(from, to) to the answer, as PostgREST does.
 */
function mk(x: Parameters<typeof fakeSb>[0] = {}): FakeSb {
  const f = fakeSb(x);
  const from = f.from.bind(f);
  f.from = (table: string) => {
    const q = from(table) as Record<string, unknown> & PromiseLike<{ data: unknown[] | null }>;
    const range = q.range as (a: number, b: number) => unknown;
    q.range = (a: number, b: number) => {
      range(a, b);
      return { then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(q).then((r) => ({ ...r, data: r.data ? r.data.slice(a, b + 1) : r.data })).then(ok, ko) };
    };
    return q;
  };
  return f;
}
let sb: FakeSb = mk();
let viewer = { email: "fin@x.test", role: "finance", fullName: null } as { email: string; role: string; fullName: string | null };
let planRows: PlRowV4[] = [];
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/session", () => ({ requireViewer: async () => viewer }));
// lib/rebuild registers every builder at import and needs the real month builder, which this test replaces below
vi.mock("@/lib/rebuild", () => ({ moduleSettingsGlobal: (s: unknown) => s }));
vi.mock("@/lib/v4/month", () => ({
  RULE_VERSION: "v4-test",
  ensureOutlook: async () => ({ id: "mo1" }),
  computeMonthV4: async (_sb: unknown, first: string) => ({
    first, last: "2026-08-31", controls: [{ code: "C49", module: "M4", name: "Jurnal seimbang", value: D(0), comparator: D(0), difference: D(0), status: "LULUS", action: "", detail: [] }],
    plan: { rows: planRows, margin: D("0.05"), runrate: { revenue: D("310400000"), windowFrom: "2026-08-20", days: ["2026-08-20"], anomalies: [] } },
  }),
}));

const { default: RekonsiliasiPage } = await import("@/app/m/[month]/rekonsiliasi/page");
const { finalizeMonthV4, finalMandatory } = await import("@/lib/v4/close");
const { loadFsMap, loadFsRows, loadCostingRowsMode, loadFsReconTile } = await import("./fs-recon-data");
const { outlookBulanModel } = await import("../v4/outlook-bulan");
const { WriteError } = await import("../write");

const root = join(__dirname, "../../../../fixtures");
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(root, p), "utf8")) as T;
const FS_FILE = "reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx";
const SHA = "7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5";
type Recon = { fs: { statement: string; sheet: string; row_no: number; line: string; amount: string }[] };
const aug = json<{ map: ({ fs_line: string } & Record<string, unknown>)[]; recons: Recon[] }>("fs-recon-2026-08/inputs.json");
const sep = json<{ recons: Recon[] }>("fs-recon-2026-09/inputs.json");
const wkFile = <T,>(f: string) => json<T>(`week-2026-08-24/${f}`);
const gl = wkFile<{ date: string; account: string; debit: string | null; credit: string | null }[]>("gl_lines.json");
const coa = wkFile<{ account: string; type: string; pl_line: string | null; bs_line: string | null }[]>("coa_map.json");
const tb = wkFile<{ account: string; balance: string }[]>("tb_opening.json");

const fsRows = (r: Recon, month: string, version = 1) => r.fs.map((x) => ({ month, statement: x.statement, sheet: x.sheet, row_no: x.row_no, line: x.line, amount: x.amount, source_file: FS_FILE, source_sha256: SHA, version, locked_at: null }));
const mapRows = aug.map.map(({ fs_line: _l, ...m }) => ({ ...m, status: "agreed" }));
const dbRows = (over: Record<string, Record<string, unknown>[]> = {}): Record<string, Record<string, unknown>[]> => ({
  // the first app_setting row is what a single-row read of any key returns in the fake
  app_setting: [{ key: "v5_pl", value: { enabled: true, costing_rows_mode: "memo" } }, { key: "m4_monthly", value: { enabled: true } }],
  fs_statement_line: fsRows(aug.recons[0], "2026-08-01"), fs_line_map: mapRows,
  week: [{ id: "w1", tb_opening_date: "2026-07-31" }], tb_opening: tb, coa_map: coa.map((c) => ({ account: c.account, type: c.type, bs_line: c.bs_line })), gl_line: gl,
  month_outlook: [], month_outlook_version: [], closing_adjustment: [], release_override: [], release_override_policy: [{ code: "C59", allowed_roles: ["finance"] }], rebuild_queue: [], batch: [], batch_output_sku: [],
  ...over,
});
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const page = async (month: string) => plain(renderToStaticMarkup(await RekonsiliasiPage({ params: Promise.resolve({ month }) })));
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${iso}T05:00:00Z`)); };

beforeEach(() => {
  viewer = { email: "fin@x.test", role: "finance", fullName: null };
  planRows = actualRowsV4({ gl, coa, from: "2026-08-01", to: "2026-08-31" });
  sb = mk({ rows: dbRows() });
  at("2026-08-27");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Rekonsiliasi page: app against FS per line, with the difference and its cause (R69)", () => {
  it("August while the month is open: the journal stops 26 Aug, so every difference is 'data belum ada'; C59 GAGAL", async () => {
    const t = await page("2026-08");
    expect(t).toContain("Rekonsiliasi ke FS Agustus 2026");
    expect(t).toContain("C59 GAGAL");
    expect(t).toContain("2 sama, 13 beda, 0 belum ada angka dari 15 baris yang dipetakan");
    // Revenue: app (journal to 26 Aug) vs FS Management Report b.12, to the rupiah
    expect(t).toMatch(/PL b\.12 · Revenue Revenue \(jurnal\) Rp 6\.385\.876\.039,00 Rp 8\.361\.760\.903,00 Rp −1\.975\.884\.864,00 beda data belum ada: jurnal baru sampai 2026-08-26, akhir bulan 2026-08-31/);
    expect(t).toMatch(/PL b\.51 · INCOME \(LOSS\) BEFORE TAX NIBT \(jurnal\) Rp 165\.249\.780,70 Rp −26\.517\.860,51 Rp 191\.767\.641,21 beda/);
    expect(t).toMatch(/BS b\.18 · Trade Receivables - Related Parties Piutang usaha pihak berelasi Rp 0,00 Rp 0,00 Rp 0,00 sama/);
    expect(t).toContain("Angka app laba rugi: jurnal bulan berjalan sampai 26 Agu (belum FINAL, bulan belum penuh).");
    expect(t).toContain("Angka app neraca: TB 31 Jul + jurnal sampai 26 Agu.");
    expect(t).toContain("FS acuan: versi 1, berkas reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx, SHA-256 7e68aa89751c…");
    expect(t).toContain("Mode costing memo (O24 b)");
    expect(t).toContain("Baris di luar pemetaan (58)");
    // the detail of C59 writes minus as U+2212 like the table, never a hyphen before a number
    expect(t).toContain("selisih −1.975.884.864,00");
    expect(t).not.toMatch(/ -\d/);
    expect(t).not.toContain("-0,00");
    expect(t).not.toContain("NaN");
  });

  it("the month is over, FINAL not locked: the same numbers, now judged as complete data, so the differences are 'selisih'", async () => {
    at("2026-10-17");
    const t = await page("2026-08");
    expect(t).toContain("Angka app laba rugi: jurnal bulan penuh + penyesuaian yang diposting; FINAL belum dikunci.");
    expect(t).toMatch(/PL b\.12 · Revenue Revenue \(jurnal\) Rp 6\.385\.876\.039,00 Rp 8\.361\.760\.903,00 Rp −1\.975\.884\.864,00 beda selisih/);
    expect(t).not.toContain("jurnal baru sampai");
    expect(t).toContain("Angka app neraca: TB 31 Jul + jurnal sampai 31 Agu.");
  });

  it("a locked FINAL is the reference: the page reads its snapshot, not the live month", async () => {
    at("2026-10-17");
    planRows = []; // the live month must not be asked for
    const rows = actualRowsV4({ gl, coa, from: "2026-08-01", to: "2026-08-31" }).map((r) => ({ date: r.date, segment: r.segment, pl_line: r.pl_line, basis: r.basis, actual: r.actual!.toFixed(2), forecast: null }));
    sb = mk({ rows: dbRows({ month_outlook: [{ id: "mo1" }], month_outlook_version: [{ snapshot: { rows, adjustments: [{ code: "DI-X", pl_line: "Storage Expenses", amount: "-1000000.00" }] }, locked_at: "2026-09-05T03:00:00Z" }] }) });
    const t = await page("2026-08");
    expect(t).toContain("Angka app laba rugi: FINAL yang sudah dikunci");
    expect(t).toMatch(/PL b\.12 · Revenue Revenue \(jurnal\) Rp 6\.385\.876\.039,00/);
    // the posted closing adjustment of the snapshot is in the app's operating expenses: 183.890.155,67 + 1.000.000 (Storage Expenses −89.014.384 → −90.014.384 inside b.37)
    expect(t).toMatch(/PL b\.37 · TOTAL OPERATING EXPENSES Beban operasi \(jurnal\) Rp −184\.890\.155,67 Rp −302\.908\.802,02/);
    expect(sb.calls).not.toContain("closing_adjustment:select");
  });

  it("September without any journal: the app has no number (belum ada, never 0), the FS column is the Management Report; C59 BELUM DIISI", async () => {
    at("2026-10-17");
    planRows = [];
    sb = mk({ rows: dbRows({ fs_statement_line: fsRows(sep.recons[0], "2026-09-01"), week: [], tb_opening: [], gl_line: [] }) });
    const t = await page("2026-09");
    expect(t).toContain("C59 BELUM DIISI");
    expect(t).toContain("0 sama, 0 beda, 15 belum ada angka dari 15 baris yang dipetakan");
    expect(t).toMatch(/PL b\.51 · INCOME \(LOSS\) BEFORE TAX NIBT \(jurnal\) belum ada Rp −910\.058\.539,73 tidak ada di app data belum ada/);
    expect(t).toMatch(/BS b\.77 · TOTAL EQUITY Total ekuitas belum ada Rp 702\.553\.474,90 tidak ada di app/);
    expect(t).toContain("belum ada TB awal, jadi baris neraca app kosong (bukan 0)");
    expect(t).not.toContain("C59 LULUS");
  });

  it("no FS imported for the month: the FS column is empty (not 0), C59 is not judged and says it does not hold FINAL", async () => {
    sb = mk({ rows: dbRows({ fs_statement_line: [] }) });
    const t = await page("2026-08");
    expect(t).toContain("C59 BELUM DIISI");
    expect(t).toContain("FS bulan ini belum diimpor (B-R91)");
    expect(t).toContain("belum menahan FINAL");
    expect(t).toContain("FS acuan: belum ada.");
    expect(t).toMatch(/PL b\.12 Revenue \(jurnal\) Rp 6\.385\.876\.039,00 belum ada tidak ada di FS data belum ada/);
  });

  it("the map still in draft: nothing is compared with a map Finance has not agreed; C59 is not judged and does not hold FINAL", async () => {
    sb = mk({ rows: dbRows({ fs_line_map: mapRows.map((m) => ({ ...m, status: "draft" })) }) });
    const t = await page("2026-08");
    expect(t).toContain("C59 BELUM DIISI");
    expect(t).toContain("pemetaan belum disetujui Finance");
    expect(t).toContain("Pemetaan baris FS ke baris app belum disetujui Finance (15 baris masih draft)");
    expect(t).toContain("0 sama, 0 beda, 0 belum ada angka dari 0 baris yang dipetakan");
    expect(t).not.toContain("C59 GAGAL");
    expect(t).toContain("Baris di luar pemetaan (");
  });

  it("before August 2026 is out of scope (O27): one sentence, and the FS tables are never read", async () => {
    const t = await page("2026-07");
    expect(t).toContain("Bulan sebelum Agustus 2026 di luar cakupan rekonsiliasi ke FS (O27)");
    expect(sb.calls.filter((c) => c.startsWith("fs_statement_line") || c.startsWith("fs_line_map"))).toEqual([]);
  });

  it("a Finance override of C59 for FINAL is shown next to the verdict, never instead of it", async () => {
    sb = mk({ rows: dbRows({ release_override: [{ id: "o1", code: "C59", reason: "Rp 2,71 dari b.71 FS, dikoreksi di bulan depan", evidence: "WA Finance 20/10", created_by: "fin@x.test", created_role: "finance", created_at: "2026-10-20T01:00:00Z" }] }) });
    const t = await page("2026-08");
    expect(t).toContain("C59 GAGAL");
    expect(t).toContain("Override C59");
    expect(t).toContain("Rp 2,71 dari b.71 FS, dikoreksi di bulan depan (bukti: WA Finance 20/10, oleh finance)");
  });
});

describe("Rekonsiliasi page: who may open it", () => {
  const open = (role: string) => { viewer = { email: `${role}@x.test`, role, fullName: null }; return page("2026-08"); };
  it.each(["admin", "finance", "management", "operations_director"])("%s reads it", async (role) => {
    expect(await open(role)).toContain("Rekonsiliasi ke FS Agustus 2026");
  });
  it.each(["sales", "ppic", "purchasing", "inventory_accounting", "commercial_lead", "cost_accounting"])("%s gets 404", async (role) => {
    await expect(open(role)).rejects.toThrow("404");
  });
  it("module m4_monthly off: 404; an invalid month: 404", async () => {
    sb = mk({ rows: dbRows({ app_setting: [{ key: "m4_monthly", value: { enabled: false } }] }) });
    await expect(page("2026-08")).rejects.toThrow("404");
    sb = mk({ rows: dbRows() });
    await expect(page("2026-13")).rejects.toThrow("404");
    await expect(page("agustus")).rejects.toThrow("404");
  });
});

describe("loaders fail closed (K41) and read the newest version (K70)", () => {
  it("a failing read of fs_statement_line or fs_line_map is the error, never 'FS belum diimpor'", async () => {
    quiet();
    sb = mk({ rows: dbRows(), fail: { fs_statement_line: { message: 'relation "fs_statement_line" does not exist', code: "42P01" } } });
    await expect(page("2026-08")).rejects.toThrow(LoaderError);
    await expect(loadFsRows(sb as never, "2026-08-01")).rejects.toMatchObject({ schema: true, code: "42P01" });
    sb = mk({ rows: dbRows(), fail: { fs_line_map: "permission denied for table fs_line_map" } });
    await expect(loadFsMap(sb as never)).rejects.toThrow("permission denied for table fs_line_map");
    await expect(page("2026-08")).rejects.toThrow(LoaderError);
  });
  it("a map row that cannot be read stops the page: unknown statement, sign other than ±1", async () => {
    sb = mk({ rows: dbRows({ fs_line_map: [{ statement: "CF", row_no: 1, app_line: "kas", sign: 1, note: null, status: "agreed" }] }) });
    await expect(loadFsMap(sb as never)).rejects.toThrow(/statement tidak dikenal: CF/);
    sb = mk({ rows: dbRows({ fs_line_map: [{ statement: "BS", row_no: 14, app_line: "kas", sign: 2, note: null, status: "agreed" }] }) });
    await expect(loadFsMap(sb as never)).rejects.toThrow(/tanda 2 di BS b\.14 bukan 1 atau -1/);
  });
  it("the map: agreed rows are what C59 compares, draft rows are only counted, an unknown status stops the page", async () => {
    const row = (row_no: number, status: string) => ({ statement: "BS", row_no, app_line: "kas", sign: 1, note: null, status });
    sb = mk({ rows: dbRows({ fs_line_map: [row(14, "agreed"), row(17, "draft"), row(18, "draft")] }) });
    const m = await loadFsMap(sb as never);
    expect(m.agreed.map((e) => e.row_no)).toEqual([14]);
    expect(m.draft).toBe(2);
    expect(Object.keys(m.agreed[0]).sort()).toEqual(["app_line", "note", "row_no", "sign", "statement"]);
    sb = mk({ rows: dbRows({ fs_line_map: [row(14, "disetujui")] }) });
    await expect(loadFsMap(sb as never)).rejects.toThrow(/status disetujui di BS b\.14 bukan draft atau agreed/);
  });
  it("paging is ordered by the unique keys of both tables (K42)", async () => {
    sb = mk({ rows: dbRows() });
    await loadFsRows(sb as never, "2026-08-01");
    await loadFsMap(sb as never);
    const order = (t: string) => sb.args.filter((a) => a.call === `${t}:order`).map((a) => a.args[0]);
    expect(order("fs_statement_line")).toEqual(["statement", "row_no", "version"]);
    expect(order("fs_line_map")).toEqual(["statement", "row_no"]);
    expect(sb.args.some((a) => a.call === "fs_statement_line:eq" && a.args[0] === "month" && a.args[1] === "2026-08-01")).toBe(true);
  });
  it("a correction is a new version: the newest version of each row wins, and the source is that version's", async () => {
    const v1 = fsRows(aug.recons[0], "2026-08-01", 1);
    const v2 = [{ ...v1.find((r) => r.statement === "PL" && r.row_no === 12)!, amount: "8361760900.00", version: 2, source_file: "09._Laporan_koreksi.xlsx", source_sha256: "ab".repeat(32), locked_at: "2026-10-20T03:00:00Z" }];
    sb = mk({ rows: dbRows({ fs_statement_line: [...v1, ...v2] }) });
    const r = await loadFsRows(sb as never, "2026-08-01");
    expect(r.rows.find((x) => x.statement === "PL" && x.row_no === 12)!.amount).toBe("8361760900.00");
    expect(r.rows).toHaveLength(v1.length);
    expect(r.meta).toMatchObject({ version: 2, sourceFile: "09._Laporan_koreksi.xlsx", sha256: "ab".repeat(32), rows: v1.length });
  });
  it("the costing mode: no value = 'cogs', 'memo' as set, anything else is refused", async () => {
    sb = mk({ rows: { app_setting: [{ key: "v5_pl", value: { enabled: true } }] } });
    expect(await loadCostingRowsMode(sb as never)).toBe("cogs");
    sb = mk({ rows: { app_setting: [] } });
    expect(await loadCostingRowsMode(sb as never)).toBe("cogs");
    sb = mk({ rows: { app_setting: [{ key: "v5_pl", value: { enabled: true, costing_rows_mode: "memo" } }] } });
    expect(await loadCostingRowsMode(sb as never)).toBe("memo");
    sb = mk({ rows: { app_setting: [{ key: "v5_pl", value: { enabled: true, costing_rows_mode: "memos" } }] } });
    await expect(loadCostingRowsMode(sb as never)).rejects.toThrow(/nilai tidak dikenal: memos/);
  });
});

describe("C59 holds the FINAL lock unless Finance records an override (R69, PRD B-R86 policy)", () => {
  const lock = (over: Record<string, Record<string, unknown>[]> = {}, month = "2026-08-01") => {
    at("2026-10-17");
    sb = mk({ rows: dbRows(over), fail: { "rpc:release_month": "stop: sampai di sini kunci diizinkan" } });
    return finalizeMonthV4(sb as never, viewer as never, month, { m4_monthly: { enabled: true } } as never);
  };
  it("GAGAL: FINAL ditolak with C59 named, and release_month is not called", async () => {
    const e = await lock().catch((x: Error) => x);
    expect(e).toBeInstanceOf(WriteError);
    expect((e as Error).message).toBe("FINAL ditolak: C59 GAGAL");
    expect(sb.rpcCalls).toEqual([]);
  });
  it("with a Finance override of C59 for the month's FINAL the lock goes on to release_month", async () => {
    const e = await lock({ release_override: [{ code: "C59" }] }).catch((x: Error) => x);
    expect((e as Error).message).toBe("stop: sampai di sini kunci diizinkan");
    expect(sb.rpcCalls.map((c) => c.name)).toEqual(["release_month"]);
    // the snapshot records C59 with the controls at the lock
    expect(JSON.parse(String(sb.rpcCalls[0].args.p_json)).controls.map((c: { code: string }) => c.code)).toContain("C59");
  });
  it("an override of another control does not lift C59", async () => {
    const e = await lock({ release_override: [{ code: "C49" }] }).catch((x: Error) => x);
    expect((e as Error).message).toBe("FINAL ditolak: C59 GAGAL");
  });
  it("no FS imported yet: C59 is not judged and does not hold FINAL (the FS comes after the close, B-R91)", async () => {
    const e = await lock({ fs_statement_line: [] }).catch((x: Error) => x);
    expect((e as Error).message).toBe("stop: sampai di sini kunci diizinkan");
    expect(JSON.parse(String(sb.rpcCalls[0].args.p_json)).controls.map((c: { code: string }) => c.code)).not.toContain("C59");
  });
  it("an FS is imported but Finance has not agreed the map (all draft): C59 is not judged and does not hold FINAL", async () => {
    const e = await lock({ fs_line_map: mapRows.map((m) => ({ ...m, status: "draft" })) }).catch((x: Error) => x);
    expect((e as Error).message).toBe("stop: sampai di sini kunci diizinkan");
    expect(JSON.parse(String(sb.rpcCalls[0].args.p_json)).controls.map((c: { code: string }) => c.code)).not.toContain("C59");
  });
  it("before August 2026 FINAL never asks for the FS tables", async () => {
    planRows = actualRowsV4({ gl, coa, from: "2026-07-01", to: "2026-07-31" });
    const e = await lock({}, "2026-07-01").catch((x: Error) => x);
    expect((e as Error).message).toBe("stop: sampai di sini kunci diizinkan");
    expect(sb.calls.filter((c) => c.startsWith("fs_statement_line") || c.startsWith("fs_line_map"))).toEqual([]);
  });
  it("a failing read of the FS tables stops the lock with the error (never a lock without C59)", async () => {
    quiet();
    at("2026-10-17");
    sb = mk({ rows: dbRows(), fail: { fs_statement_line: "permission denied for table fs_statement_line" } });
    await expect(finalizeMonthV4(sb as never, viewer as never, "2026-08-01", {} as never)).rejects.toThrow("permission denied for table fs_statement_line");
    expect(sb.rpcCalls).toEqual([]);
  });
  it("the mandatory list of the lock and of the page is one list: the §7.1 controls, plus C59 when it was judged", () => {
    expect(finalMandatory([{ code: "C49" }])).not.toContain("C59");
    expect(finalMandatory([{ code: "C49" }, { code: "C59" }])).toEqual(expect.arrayContaining(["C21", "C48", "C49", "C59"]));
  });
});

describe("accuracy tile of Outlook bulan shows C59 (R69)", () => {
  const base = outlookBulanFixture();
  const tileText = (fsRecon: unknown) => {
    const m = outlookBulanModel({ ...base, accuracy: { ...base.accuracy!, fsRecon: fsRecon as never } });
    return plain(renderToStaticMarkup(<TilePage tiles={m.tiles.filter((t) => t.id === "akurasi")} label="x" />));
  };
  it("the row says GAGAL with the count, LULUS, or that the FS is not imported; a failed read is that tile's message only", () => {
    const href = "/m/2026-08/rekonsiliasi";
    expect(tileText({ status: "GAGAL", hasFs: true, hasMap: true, mapped: 15, beda: 13, missing: 0, href })).toContain("Rekonsiliasi ke FS (C59) GAGAL: 13 dari 15 baris beda");
    expect(tileText({ status: "LULUS", hasFs: true, hasMap: true, mapped: 15, beda: 0, missing: 0, href })).toContain("Rekonsiliasi ke FS (C59) LULUS");
    expect(tileText({ status: "BELUM DIISI", hasFs: true, hasMap: true, mapped: 15, beda: 0, missing: 15, href })).toContain("BELUM DIISI: 15 dari 15 baris belum ada angka");
    expect(tileText({ status: "BELUM DIISI", hasFs: false, hasMap: true, mapped: 15, beda: 0, missing: 15, href })).toContain("Rekonsiliasi ke FS (C59) FS belum diimpor");
    expect(tileText({ status: "BELUM DIISI", hasFs: true, hasMap: false, mapped: 0, beda: 0, missing: 0, href })).toContain("Rekonsiliasi ke FS (C59) pemetaan FS belum disetujui Finance");
    const err = tileText({ error: "outlook bulan.akurasi C59 — fs-recon.fs_statement_line: permission denied" });
    expect(err).toContain("tidak bisa dimuat: outlook bulan.akurasi C59");
    expect(err).toContain("649,4 (8,4%)"); // the rest of the tile stays
  });
  it("the first cell links to the Rekonsiliasi page; without C59 the tile is as before", () => {
    const html = renderToStaticMarkup(<TilePage tiles={outlookBulanModel({ ...base, accuracy: { ...base.accuracy!, fsRecon: { status: "GAGAL", hasFs: true, hasMap: true, mapped: 15, beda: 1, missing: 0, href: "/m/2026-08/rekonsiliasi" } } }).tiles.filter((t) => t.id === "akurasi")} label="x" />);
    expect(html).toContain('href="/m/2026-08/rekonsiliasi"');
    expect(tileText(null)).not.toContain("C59");
    expect(tileText(undefined)).not.toContain("C59");
  });
  it("the summary of a FINAL month is read from its snapshot and the imported FS (August: 13 of 15 differ)", async () => {
    const rows = actualRowsV4({ gl, coa, from: "2026-08-01", to: "2026-08-31" }).map((r) => ({ date: r.date, segment: r.segment, pl_line: r.pl_line, basis: r.basis, actual: r.actual!.toFixed(2), forecast: null }));
    sb = mk({ rows: dbRows({ month_outlook: [{ id: "mo1" }], month_outlook_version: [{ snapshot: { rows, adjustments: [] }, locked_at: "2026-09-05T03:00:00Z" }] }) });
    expect(await loadFsReconTile(sb as never, "2026-08-01", "2026-10-17")).toEqual({ status: "GAGAL", hasFs: true, hasMap: true, mapped: 15, beda: 13, missing: 0, href: "/m/2026-08/rekonsiliasi" });
    expect(await loadFsReconTile(sb as never, "2026-07-01", "2026-10-17")).toBeNull();
    sb = mk({ rows: dbRows({ month_outlook: [] }) });
    expect(await loadFsReconTile(sb as never, "2026-08-01", "2026-10-17")).toBeNull();
  });
});
