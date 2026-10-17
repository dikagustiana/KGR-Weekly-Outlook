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
  APP_LINE_LABEL, FS_MIN_MAP, fsKey, fsMapEntries, fsRecon,
  type FsLine, type FsMapEntry, type ReconInput, type ReconLine,
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

