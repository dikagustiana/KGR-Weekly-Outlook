/**
 * PRD v5.2-A R68 (T15, K62, O24–O27): fsRecon, the minimum mapping, the app side (PL, BS, memo mode) and the golden
 * fixtures fs-recon-2026-08 / -09 (built by scripts/build_fs_recon.py; table in docs/v5.2/fs-recon-fixture.md).
 *
 * The golden holds EXPECTED differences with their cause where the fixture data is incomplete (the journal of the
 * fixtures stops on 26 Aug 2026; there is none for September): nothing here is adjusted to make a row pass.
 */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadFixtureWeek, loadV3Fixture } from "../src/fixtures";
import { actualRowsV4 } from "../src/month-v4";
import { computeWeek } from "../src/week";
import {
  APP_LINE_LABEL, FS_MIN_MAP, appBsLines, appPlLines, fsKey, fsMapEntries, fsRecon, isCostingRowsMode, plLineAmounts, reconHints,
  type AppLine, type FsLine, type FsMapEntry, type PlAmount, type ReconInput, type ReconLine,
} from "../src";

// ------------------------------------------------------------------------------------------------ fsRecon, synthetic
const entry = (statement: "PL" | "BS", row_no: number, app_line: string, sign: 1 | -1 = 1): FsMapEntry => ({ statement, row_no, app_line, sign, note: null });
const fsl = (statement: "PL" | "BS", row_no: number, line: string, amount: string | null): FsLine => ({ statement, row_no, line, amount });

describe("fsRecon (R68): per line, sign, tolerance, C59", () => {
  const base: ReconInput = {
    app: [{ app_line: "revenue", amount: "5039854" }, { app_line: "nibt", amount: "-953903" }, { app_line: "kas", amount: "103000" }],
    fs: [fsl("PL", 12, "Revenue", "5039854"), fsl("PL", 51, "INCOME (LOSS) BEFORE TAX", "-910100"), fsl("BS", 14, "Cash and cash equivalents", "103000")],
    map: [entry("PL", 12, "revenue"), entry("PL", 51, "nibt"), entry("BS", 14, "kas")],
  };
  const by = (r: { lines: ReconLine[] }) => Object.fromEntries(r.lines.map((l) => [l.key, l]));

  it("selisih = app − FS; sama / beda; C59 GAGAL on a difference beyond the tolerance", () => {
    const r = fsRecon(base);
    const l = by(r);
    expect(l["PL b.12"].status).toBe("sama");
    expect(l["PL b.12"].cause).toBeNull();
    expect(l["PL b.51"].status).toBe("beda");
    expect(l["PL b.51"].selisih!.toFixed(0)).toBe("-43803");
    expect(l["PL b.51"].cause).toBe("selisih");
    expect(l["BS b.14"].status).toBe("sama");
    expect(r.summary).toEqual({ mapped: 3, sama: 2, beda: 1, missing: 0, unmapped: 0 });
    expect(r.c59.code).toBe("C59");
    expect(r.c59.status).toBe("GAGAL");
    expect(r.c59.value.toFixed(0)).toBe("1");
    expect(r.c59.detail).toHaveLength(1);
    expect(r.c59.detail[0]).toContain("PL b.51");
  });

  it("tolerance Rp 1 (O26): exactly Rp 1 is sama, beyond it is beda; a given tolerance replaces the default", () => {
    const at = (appAmt: string, tolerance?: string) =>
      fsRecon({ app: [{ app_line: "revenue", amount: appAmt }], fs: [fsl("PL", 12, "Revenue", "1000")], map: [entry("PL", 12, "revenue")], tolerance }).lines[0];
    expect(at("1001").status).toBe("sama");
    expect(at("999").status).toBe("sama");
    expect(at("1001.01").status).toBe("beda");
    expect(at("998.99").status).toBe("beda");
    expect(at("1001.01", "1000").status).toBe("sama");
    expect(at("1001.01", "0").status).toBe("beda");
  });

  it("the sign of the map multiplies the app amount", () => {
    const r = fsRecon({ app: [{ app_line: "utang", amount: "-500" }], fs: [fsl("BS", 47, "Trade Payables", "500")], map: [entry("BS", 47, "utang", -1)] });
    expect(r.lines[0].app!.toFixed(0)).toBe("500");
    expect(r.lines[0].status).toBe("sama");
  });

  it("a mapped pair with a missing side is never read as 0: tidak ada di app / tidak ada di FS, C59 BELUM DIISI", () => {
    const noApp = fsRecon({ ...base, app: [{ app_line: "revenue", amount: "5039854" }, { app_line: "nibt", amount: null }], map: base.map });
    const l = by(noApp);
    expect(l["PL b.51"].status).toBe("tidak ada di app");
    expect(l["PL b.51"].selisih).toBeNull();
    expect(l["PL b.51"].cause).toBe("data belum ada");
    expect(l["BS b.14"].status).toBe("tidak ada di app");
    expect(noApp.c59.status).toBe("BELUM DIISI");
    expect(noApp.c59.detail.join("|")).toContain("PL b.51");
    const noFs = fsRecon({ ...base, fs: base.fs.slice(0, 2) });
    expect(by(noFs)["BS b.14"].status).toBe("tidak ada di FS");
    expect(by(noFs)["BS b.14"].cause).toBe("data belum ada");
    expect(noFs.c59.status).toBe("GAGAL"); // the beda of PL b.51 outranks the missing line
    const clean = fsRecon({ ...base, fs: [fsl("PL", 12, "Revenue", "5039854"), fsl("PL", 51, "x", "-953903"), fsl("BS", 14, "Kas", "103000")] });
    expect(clean.c59.status).toBe("LULUS");
    expect(clean.c59.detail).toEqual([]);
    expect(clean.lines.every((x) => x.status === "sama")).toBe(true);
    expect(fsRecon({ app: [], fs: [], map: [] }).c59.status).toBe("BELUM DIISI");
  });

  it("FS rows outside the map are 'tidak ada di app' with cause 'definisi' and never count for C59; app lines outside the map are 'tidak ada di FS'", () => {
    const r = fsRecon({
      app: [...base.app, { app_line: "extra", amount: "7" }],
      fs: [...base.fs, fsl("BS", 77, "TOTAL EQUITY", "702600")],
      map: [entry("PL", 12, "revenue")],
    });
    const l = by(r);
    expect(l["BS b.77"]).toMatchObject({ status: "tidak ada di app", cause: "definisi", mapped: false });
    expect(D(l["BS b.77"].fs!).toFixed(0)).toBe("702600");
    expect(l["extra"]).toMatchObject({ status: "tidak ada di FS", mapped: false });
    expect(r.lines.filter((x) => x.mapped)).toHaveLength(1);
    expect(r.summary.unmapped).toBe(r.lines.length - 1);
    expect(r.c59.status).toBe("LULUS");
  });

  it("a hint gives the cause of a beda line; without one the cause is selisih", () => {
    const hinted = fsRecon({ ...base, hints: { nibt: { cause: "data belum ada", note: "jurnal baru sampai 26 Agu" } } });
    expect(by(hinted)["PL b.51"]).toMatchObject({ cause: "data belum ada", note: "jurnal baru sampai 26 Agu" });
    expect(hinted.c59.detail[0]).toContain("data belum ada: jurnal baru sampai 26 Agu");
    expect(by(fsRecon(base))["PL b.51"].cause).toBe("selisih");
  });

  it("ordering: mapped PL then BS by row, then FS rows outside the map, then app lines outside the map", () => {
    const r = fsRecon({
      app: [{ app_line: "kas", amount: "1" }, { app_line: "revenue", amount: "1" }, { app_line: "zz", amount: "1" }],
      fs: [fsl("BS", 99, "Z", "1"), fsl("BS", 14, "Kas", "1"), fsl("PL", 12, "Revenue", "1"), fsl("PL", 80, "Y", "1")],
      map: [entry("BS", 14, "kas"), entry("PL", 12, "revenue")],
    });
    expect(r.lines.map((l) => l.key)).toEqual(["PL b.12", "BS b.14", "PL b.80", "BS b.99", "zz"]);
  });

  it("ambiguous input fails closed: duplicate app line, FS row or map row throws", () => {
    expect(() => fsRecon({ ...base, app: [...base.app, { app_line: "kas", amount: "1" }] })).toThrow(/baris app ganda: kas/);
    expect(() => fsRecon({ ...base, fs: [...base.fs, fsl("PL", 12, "Revenue", "1")] })).toThrow(/baris FS ganda: PL b\.12/);
    expect(() => fsRecon({ ...base, map: [...base.map, entry("PL", 12, "kas")] })).toThrow(/pemetaan ganda: PL b\.12/);
  });
});

// ------------------------------------------------------------------------------------------------ minimum mapping
type FsFixture = { pl: { row: number; line: string; values: Record<string, string> }[]; bs: { row: number; line: string; values: Record<string, string> }[] };
const fsSource = loadV3Fixture<FsFixture>("fs-2026-09", "inputs.json");

describe("minimum mapping (R68, O27 a): rows checked against fixtures/fs-2026-09/inputs.json", () => {
  it("is exactly the rows of the spec", () => {
    expect(FS_MIN_MAP.filter((m) => m.statement === "PL").map((m) => m.row_no)).toEqual([12, 13, 15, 37, 49, 51]);
    expect(FS_MIN_MAP.filter((m) => m.statement === "BS").map((m) => m.row_no)).toEqual([14, 17, 18, 23, 24, 47, 48, 51, 77]);
    expect(new Set(FS_MIN_MAP.map((m) => fsKey(m.statement, m.row_no))).size).toBe(15);
    expect(new Set(FS_MIN_MAP.map((m) => m.app_line)).size).toBe(15);
  });
  it("every row number and label exists in the FS fixture, with a value in July, August and September", () => {
    for (const m of FS_MIN_MAP) {
      const row = (m.statement === "PL" ? fsSource.pl : fsSource.bs).find((r) => r.row === m.row_no);
      expect(row, `${fsKey(m.statement, m.row_no)}`).toBeDefined();
      expect(row!.line.trim(), `${fsKey(m.statement, m.row_no)} label`).toBe(m.fs_line);
      for (const month of ["2026-07-31", "2026-08-31", "2026-09-30"]) expect(row!.values[month], `${fsKey(m.statement, m.row_no)} ${month}`).toBeDefined();
    }
  });
  it("every app line has a label and the sign is ±1", () => {
    for (const m of FS_MIN_MAP) { expect(APP_LINE_LABEL[m.app_line], m.app_line).toBeTruthy(); expect([1, -1]).toContain(m.sign); }
  });
  it("the database shape of a seed row has exactly the columns of fs_line_map", () => {
    expect(Object.keys(fsMapEntries()[0]).sort()).toEqual(["app_line", "note", "row_no", "sign", "statement"]);
  });
});

// ------------------------------------------------------------------------------------------------ app side
describe("appPlLines (R68, O24 b): FS structure and memo mode", () => {
  const journal: PlAmount[] = [
    { pl_line: "Revenue - LB Main Product", amount: "1000" }, { pl_line: "Revenue - Trading", amount: "500" },
    { pl_line: "COGS - Live Bird", amount: "-700" }, { pl_line: "Other COGS - Expedition", amount: "-100" },
    { pl_line: "Salaries and allowance", amount: "-60" }, { pl_line: "Depreciation & amortisation", amount: "-10" }, { pl_line: "Tax expenses", amount: "-5" },
    { pl_line: "Interest Expense", amount: "-20" }, { pl_line: "Other Income", amount: "8" }, { pl_line: "Other Expense", amount: "-2" },
  ];
  const v5: PlAmount[] = [{ pl_line: "Selisih costing", amount: "-30" }, { pl_line: "Biaya kapasitas idle", amount: "-12" }];
  const get = (r: { lines: AppLine[] }) => Object.fromEntries(r.lines.map((l) => [l.app_line, D(l.amount!).toFixed(0)]));

  it("folds revenue, COGS, GP, operating expenses (with depreciation and tax), other income/expense and NIBT", () => {
    const r = appPlLines({ lines: journal });
    expect(get(r)).toEqual({ revenue: "1500", cogs: "-800", gp: "700", opex: "-75", other: "-14", nibt: "611" });
    expect(r.v5.toFixed(0)).toBe("0");
    expect(r.memo).toEqual([]);
  });
  it("mode 'cogs' (default): the v5 rows are cost of sales", () => {
    const r = appPlLines({ lines: [...journal, ...v5] });
    expect(get(r)).toEqual({ revenue: "1500", cogs: "-842", gp: "658", opex: "-75", other: "-14", nibt: "569" });
    expect(r.v5.toFixed(0)).toBe("-42");
    expect(get(appPlLines({ lines: [...journal, ...v5], costingRowsMode: "cogs" }))).toEqual(get(r));
  });
  it("mode 'memo': COGS, GP and NIBT of the comparison are without the v5 rows, and the rows are not opex either", () => {
    const r = appPlLines({ lines: [...journal, ...v5], costingRowsMode: "memo" });
    expect(get(r)).toEqual(get(appPlLines({ lines: journal })));
    expect(r.v5.toFixed(0)).toBe("-42");
    expect(r.memo.map((m) => [m.pl_line, D(m.amount).toFixed(0)])).toEqual([["Selisih costing", "-30"], ["Biaya kapasitas idle", "-12"]]);
  });
  it("memo mode vs cogs mode against an FS built from the journal: C59 LULUS vs GAGAL with cause 'definisi'", () => {
    const fs: FsLine[] = [fsl("PL", 12, "Revenue", "1500"), fsl("PL", 13, "Cost of Sales", "-800"), fsl("PL", 15, "GROSS PROFIT", "700"), fsl("PL", 37, "TOTAL OPERATING EXPENSES", "-75"),
      fsl("PL", 49, "TOTAL OTHER INCOME (EXPENSE)", "-14"), fsl("PL", 51, "INCOME (LOSS) BEFORE TAX", "611")];
    const map = fsMapEntries().filter((m) => m.statement === "PL");
    const run = (costingRowsMode: "cogs" | "memo") => {
      const a = appPlLines({ lines: [...journal, ...v5], costingRowsMode });
      return fsRecon({ app: a.lines, fs, map, hints: reconHints({ journalThrough: "2026-08-31", monthEnd: "2026-08-31", costingRowsMode, v5: a.v5, appLines: a.lines.map((l) => l.app_line) }) });
    };
    const memo = run("memo");
    expect(memo.c59.status).toBe("LULUS");
    const cogs = run("cogs");
    expect(cogs.c59.status).toBe("GAGAL");
    expect(cogs.lines.filter((l) => l.status === "beda").map((l) => [l.key, l.selisih!.toFixed(0), l.cause])).toEqual([
      ["PL b.13", "-42", "definisi"], ["PL b.15", "-42", "definisi"], ["PL b.51", "-42", "definisi"],
    ]);
  });
  it("without any P&L line the month has no number: null, never 0", () => {
    const r = appPlLines({ lines: [] });
    expect(r.lines.map((l) => l.amount)).toEqual([null, null, null, null, null, null]);
    expect(fsRecon({ app: r.lines, fs: [fsl("PL", 12, "Revenue", "100")], map: fsMapEntries().filter((m) => m.statement === "PL") }).lines[0].status).toBe("tidak ada di app");
  });
  it("plLineAmounts: actual rows of every basis but fixed_estimate, plus the posted adjustments", () => {
    const rows = [
      { pl_line: "Revenue - Trading", basis: "journal", actual: "100" }, { pl_line: "Revenue - Trading", basis: "do_unbilled", actual: "50" },
      { pl_line: "Storage Expenses", basis: "fixed_estimate", actual: "-999" }, { pl_line: "Storage Expenses", basis: "journal", actual: null },
      { pl_line: "Storage Expenses", basis: "journal", actual: "-10" },
    ];
    const r = plLineAmounts(rows, [{ pl_line: "Storage Expenses", amount: "-62.5" }]);
    expect(r.map((x) => [x.pl_line, D(x.amount).toFixed(1)])).toEqual([["Revenue - Trading", "150.0"], ["Storage Expenses", "-72.5"]]);
  });
  it("isCostingRowsMode accepts only 'cogs' and 'memo'", () => {
    expect(["cogs", "memo", "", null, undefined, "COGS"].map(isCostingRowsMode)).toEqual([true, true, false, false, false, false]);
  });
});

describe("appBsLines (R68): trial balance + journal per bs_line", () => {
  const coa = [
    { account: "1", type: "Neraca", bs_line: "Cash and cash equivalents" }, { account: "2", type: "Neraca", bs_line: "Trade Payables - Third Parties" },
    { account: "3", type: "Neraca", bs_line: "Shareholder Equity" }, { account: "4", type: "Neraca", bs_line: "Retained earnings" },
    { account: "5", type: "LabaRugi", bs_line: null }, { account: "6", type: "LabaRugi", bs_line: null }, { account: "9", type: "Header", bs_line: null },
    { account: "7", type: "Neraca", bs_line: null },
  ];
  // balanced: 1140 − 400 − 1000 + 300 − 100 + 60 = 0; year profit at the opening = 100 − 60 = 40
  const tb = [{ account: "1", balance: "1140" }, { account: "2", balance: "-400" }, { account: "3", balance: "-1000" }, { account: "4", balance: "300" }, { account: "5", balance: "-100" }, { account: "6", balance: "60" }];
  const gl = [
    { date: "2026-08-01", account: "1", debit: "50", credit: null }, { date: "2026-08-01", account: "5", debit: null, credit: "50" },
    { date: "2026-08-10", account: "1", debit: null, credit: "20" }, { date: "2026-08-10", account: "6", debit: "20", credit: null },
    { date: "2026-08-20", account: "2", debit: "100", credit: null }, { date: "2026-08-20", account: "1", debit: null, credit: "100" },
  ];
  const at = (date: string, extra: Partial<Parameters<typeof appBsLines>[0]> = {}) =>
    Object.fromEntries(appBsLines({ tb, gl, coa, date, ...extra }).lines.map((l) => [l.app_line, l.amount === null ? null : D(l.amount).toFixed(0)]));

  it("assets are debit-positive, liabilities and equity credit-positive; equity includes the profit of the year", () => {
    expect(at("2026-07-31")).toMatchObject({ kas: "1140", utang_dagang_pihak_ketiga: "400", piutang_pihak_ketiga: "0", ekuitas: "740" }); // 1000 − 300 + 40
    expect(at("2026-08-31")).toMatchObject({ kas: "1070", utang_dagang_pihak_ketiga: "300", ekuitas: "770" }); // + 50 − 20; assets 1070 = 300 + 770
  });
  it("journal is counted up to the balance date (inclusive) and, with tbDate, only after the trial balance date", () => {
    expect(at("2026-08-09")).toMatchObject({ kas: "1190", ekuitas: "790" });
    expect(at("2026-08-10")).toMatchObject({ kas: "1170", ekuitas: "770" });
    expect(at("2026-08-31", { tbDate: "2026-08-10" })).toMatchObject({ kas: "1040", utang_dagang_pihak_ketiga: "300", ekuitas: "740" });
  });
  it("without a trial balance every line is null (never 0)", () => {
    expect(Object.values(at("2026-08-31", { tb: [] })).every((v) => v === null)).toBe(true);
  });
  it("accounts the chart cannot place are reported, not dropped silently", () => {
    const r = appBsLines({ tb: [...tb, { account: "7", balance: "11" }, { account: "8", balance: "-3" }, { account: "9", balance: "0" }], gl, coa, date: "2026-08-31" });
    expect(r.unplaced.map((u) => [u.account, u.net.toFixed(0)])).toEqual([["7", "11"], ["8", "-3"]]);
    expect(appBsLines({ tb, gl, coa, date: "2026-08-31" }).unplaced).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ golden fixtures
interface GoldenRow { key: string; fs_line: string; app_line: string; app: string | null; fs: string | null; selisih: string | null; status: string; cause: string | null; explain: string }
interface Recon {
  id: string; fs_column: string; statements: ("PL" | "BS")[];
  app_data: { week_fixture: string; tb_opening_date: string; from: string | null; journal_through: string; month_end: string } | null;
  pl_lines: { pl_line: string; amount: string }[]; app: { app_line: string; amount: string }[]; fs: (FsLine & { sheet: string })[];
}
interface Inputs { month: string; tolerance: string; costing_rows_mode: string; map: (FsMapEntry & { fs_line: string })[]; recons: Recon[] }
interface Golden { unit: string; tolerance: string; recons: { id: string; rows: GoldenRow[]; summary: Record<string, number>; c59: string }[] }
interface SourceJson { fixture: string; sources: { file: string; sha256: string }[] }

const week = loadFixtureWeek("2026-08-24");
const f2 = (v: unknown) => D(v as string).toFixed(2);

/** The app side the engine builds from the repo's fixture data for one reconciliation of the fixture. */
function engineApp(r: Recon, mode: "cogs" | "memo") {
  const d = r.app_data;
  if (!d) return { app: [] as AppLine[], hints: {}, v5: D(0), unplaced: [] as { account: string; net: unknown }[] };
  const bs = appBsLines({ tb: week.tb_opening, gl: week.gl_lines, coa: week.coa_map, date: d.month_end, tbDate: d.tb_opening_date });
  const pl = d.from
    ? appPlLines({ lines: plLineAmounts(actualRowsV4({ gl: week.gl_lines, coa: week.coa_map, from: d.from, to: d.month_end })), costingRowsMode: mode })
    : null;
  const app = [...(pl?.lines ?? []), ...bs.lines].filter((l) => r.statements.includes(FS_MIN_MAP.find((m) => m.app_line === l.app_line)!.statement));
  return { app, hints: reconHints({ journalThrough: d.journal_through, monthEnd: d.month_end, costingRowsMode: mode, v5: pl?.v5 ?? 0, appLines: app.map((l) => l.app_line) }), v5: pl?.v5 ?? D(0), unplaced: bs.unplaced };
}

for (const name of ["fs-recon-2026-08", "fs-recon-2026-09"]) {
  const inputs = loadV3Fixture<Inputs>(name, "inputs.json");
  const golden = loadV3Fixture<Golden>(name, "golden.json");
  const month = inputs.month.slice(0, 7);

  describe(`golden ${name} (T15)`, () => {
    it("the fixture is the minimum mapping, the FS rows of fixtures/fs-2026-09 (numeric(20,2)) and the production mode (memo)", () => {
      expect(inputs.map).toEqual(FS_MIN_MAP.map((m) => ({ ...m, note: m.note ?? null })));
      expect(isCostingRowsMode(inputs.costing_rows_mode) && inputs.costing_rows_mode).toBe("memo");
      expect(inputs.tolerance).toBe("1");
      for (const r of inputs.recons) {
        const rows = [...fsSource.pl.map((x) => ({ st: "PL" as const, ...x })), ...fsSource.bs.map((x) => ({ st: "BS" as const, ...x }))]
          .filter((x) => r.statements.includes(x.st) && x.values[r.fs_column] !== undefined);
        expect(r.fs.map((x) => [x.statement, x.row_no, x.line, x.amount])).toEqual(rows.map((x) => [x.st, x.row, x.line, f2(x.values[r.fs_column])]));
        // the stored numbers are the DB shape: numeric(20,2)
        for (const x of r.fs) expect(String(x.amount)).toBe(f2(x.amount));
      }
    });

    it("source.json lists the sha256 of every source, and the workbook is the repo copy", () => {
      const src = loadV3Fixture<SourceJson>(name, "source.json");
      expect(src.fixture).toBe(name);
      expect(src.sources.find((s) => s.file.startsWith("reference/09."))?.sha256).toBe("7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5");
      for (const s of src.sources) expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    for (const r of inputs.recons) {
      const g = golden.recons.find((x) => x.id === r.id)!;
      describe(`${month} ${r.id}`, () => {
        it("the engine builds the app numbers of the fixture from the repo's journal and trial balance", () => {
          const e = engineApp(r, inputs.costing_rows_mode as "memo");
          expect(e.app.map((l) => [l.app_line, f2(l.amount)])).toEqual(r.app.map((l) => [l.app_line, l.amount]));
          if (r.app_data) {
            if (r.app_data.from) {
              const rows = plLineAmounts(actualRowsV4({ gl: week.gl_lines, coa: week.coa_map, from: r.app_data.from, to: r.app_data.month_end }));
              expect(rows.map((x) => [x.pl_line, f2(x.amount)])).toEqual(r.pl_lines.map((x) => [x.pl_line, x.amount]));
            }
            expect(e.unplaced).toEqual([]);
          } else expect(r.app).toEqual([]);
        });

        it("fsRecon reproduces the golden row by row (selisih, status, cause) and C59", () => {
          const e = engineApp(r, inputs.costing_rows_mode as "memo");
          const out = fsRecon({ app: e.app, fs: r.fs, map: fsMapEntries().filter((m) => r.statements.includes(m.statement)), tolerance: inputs.tolerance, hints: e.hints });
          const mapped = out.lines.filter((l) => l.mapped);
          expect(mapped.map((l) => ({
            key: l.key, fs_line: l.fs_line, app_line: l.app_line, app: l.app === null ? null : f2(l.app), fs: l.fs === null ? null : f2(l.fs),
            selisih: l.selisih === null ? null : f2(l.selisih), status: l.status, cause: l.cause,
          }))).toEqual(g.rows.map(({ explain: _explain, ...x }) => x));
          expect(out.summary).toEqual(g.summary);
          expect(out.c59.status).toBe(g.c59);
          expect(out.tolerance.toFixed(0)).toBe(golden.tolerance);
          // every FS row outside the mapping is listed with a cause and does not count
          for (const l of out.lines.filter((x) => !x.mapped)) expect(l).toMatchObject({ status: "tidak ada di app", cause: "definisi", app: null });
        });

        it("the golden states each expected difference with its cause (nothing unexplained)", () => {
          for (const row of g.rows) {
            if (row.status === "sama") { expect(row.cause).toBeNull(); expect(D(row.selisih!).abs().lte(1)).toBe(true); continue; }
            expect(["data belum ada", "definisi", "selisih"]).toContain(row.cause);
            expect(row.explain.length, `${row.key} has no explanation`).toBeGreaterThan(20);
            if (row.status === "beda") expect(D(row.selisih!).abs().gt(1)).toBe(true);
          }
        });
      });
    }
  });
}

describe("golden: 0 differences beyond Rp 1 where the data is complete, explicit ones otherwise (T15)", () => {
  const aug = loadV3Fixture<Golden>("fs-recon-2026-08", "golden.json");
  const augIn = loadV3Fixture<Inputs>("fs-recon-2026-08", "inputs.json");
  const sep = loadV3Fixture<Golden>("fs-recon-2026-09", "golden.json");

  it("August, opening 31 Jul (TB Accurate vs FS July, complete): 8 of 9 rows equal; the only difference is b.77 by Rp −2,71, cause 'selisih'", () => {
    const g = aug.recons.find((r) => r.id === "saldo-awal")!;
    expect(augIn.recons.find((r) => r.id === "saldo-awal")!.app_data!.journal_through).toBe("2026-07-31");
    expect(g.rows.filter((r) => r.status === "sama").map((r) => r.key)).toEqual(["BS b.14", "BS b.17", "BS b.18", "BS b.23", "BS b.24", "BS b.47", "BS b.48", "BS b.51"]);
    const beda = g.rows.filter((r) => r.status === "beda");
    expect(beda.map((r) => [r.key, r.selisih, r.cause])).toEqual([["BS b.77", "-2.71", "selisih"]]);
    expect(beda[0].explain).toContain("b.71");
    expect(g.c59).toBe("GAGAL");
  });

  it("August, month end: every difference is 'data belum ada' (journal of the fixture stops 26 Aug); only b.18 and b.48 (0 = 0) are equal", () => {
    const g = aug.recons.find((r) => r.id === "akhir-bulan")!;
    expect(g.rows.filter((r) => r.status === "beda").every((r) => r.cause === "data belum ada")).toBe(true);
    expect(g.rows.filter((r) => r.status === "sama").map((r) => r.key)).toEqual(["BS b.18", "BS b.48"]);
    expect(g.summary).toMatchObject({ mapped: 15, sama: 2, beda: 13, missing: 0 });
    const by = Object.fromEntries(g.rows.map((r) => [r.key, r]));
    // the FS side is the Management Report of August: revenue 8.361,8 jt, GP 306,7 jt, NIBT −26,5 jt, kas 495,4 jt, ekuitas 1.612,6 jt
    expect(by["PL b.12"].fs).toBe("8361760903.00");
    expect(by["PL b.15"].fs).toBe("306709757.03");
    expect(by["PL b.51"].fs).toBe("-26517860.51");
    expect(by["BS b.14"].fs).toBe("495363150.28");
    expect(by["BS b.77"].fs).toBe("1612612014.63");
    // the app side to 26 Aug equals the independent month golden (jt Rp, fixtures/month-2026-08/golden-v4.json)
    const m = loadV3Fixture<{ actual: Record<string, string> }>("month-2026-08", "golden-v4.json").actual;
    const jt = (v: string | null) => D(v!).div(1_000_000).toFixed(1);
    expect([jt(by["PL b.12"].app), jt(by["PL b.13"].app), jt(by["PL b.15"].app), jt(by["PL b.51"].app)]).toEqual([m.revenue, m.cogs, m.gp, m.nibt]);
    expect(g.c59).toBe("GAGAL");
  });

  it("September: no journal in the fixtures, so no app number: 15 'tidak ada di app' with cause 'data belum ada', C59 BELUM DIISI (not LULUS)", () => {
    const g = sep.recons[0];
    expect(g.rows).toHaveLength(15);
    expect(g.rows.every((r) => r.status === "tidak ada di app" && r.cause === "data belum ada" && r.app === null && r.selisih === null)).toBe(true);
    expect(g.c59).toBe("BELUM DIISI");
    const by = Object.fromEntries(g.rows.map((r) => [r.key, r]));
    // the repo copy of the workbook: NIBT −910.058.539,73 and equity 702.553.474,90 (not the copy with NIBT −953,9 jt)
    expect(by["PL b.51"].fs).toBe("-910058539.73");
    expect(by["BS b.77"].fs).toBe("702553474.90");
    expect(by["PL b.12"].fs).toBe("5039854191.00");
    expect(by["PL b.15"].fs).toBe("-475432415.26");
    expect(by["BS b.14"].fs).toBe("102996959.86");
  });
});

// ------------------------------------------------------------------------------------------------ app BS against the v1 engine
describe("appBsLines agrees with the v1 balance sheet (computeWeek, statements.ts)", () => {
  it("the week's yesterday (26 Aug) and the trial balance column (31 Jul) are the same numbers, to the cent", { timeout: 60000 }, () => {
    const w = computeWeek(week);
    const bs = w.statements.bs;
    const v1 = (col: "tb" | "yesterday") => {
      const v = (line: string) => bs.get(line).values[col];
      return {
        kas: v("Cash and cash equivalents"), piutang_pihak_ketiga: v("Trade Receivables - Third Parties"), piutang_pihak_berelasi: v("Trade Receivables - Related Parties"),
        persediaan_produk: v("Inventory - Product"), persediaan_trading: v("Inventory - Trading"), utang_dagang_pihak_ketiga: v("Trade Payables - Third Parties"),
        utang_dagang_afiliasi: v("Trade Payables - Affiliates"), utang_lain_afiliasi: v("Other Payable - Related Parties"), ekuitas: bs.totals.equity.values[col],
      };
    };
    expect(w.week.today).toBe("2026-08-27");
    for (const [col, date] of [["yesterday", "2026-08-26"], ["tb", w.week.tbOpeningDate]] as const) {
      const mine = Object.fromEntries(appBsLines({ tb: week.tb_opening, gl: week.gl_lines, coa: week.coa_map, date }).lines.map((l) => [l.app_line, D(l.amount!)]));
      for (const [k, x] of Object.entries(v1(col))) expect(mine[k].toFixed(2), `${k} ${col}`).toBe(x.toFixed(2));
    }
  });
});
