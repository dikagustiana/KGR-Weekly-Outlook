/**
 * PRD v5.2-A R68 (T15, K62, O24–O27): fsRecon, the minimum mapping, the app side (PL, BS, memo mode) and the golden
 * fixtures fs-recon-2026-08 / -09 (built by scripts/build_fs_recon.py; table in docs/v5.2/fs-recon-fixture.md).
 *
 * The golden holds EXPECTED differences with their cause where the fixture data is incomplete (the journal of the
 * fixtures stops on 26 Aug 2026; there is none for September): nothing here is adjusted to make a row pass.
 */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
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

