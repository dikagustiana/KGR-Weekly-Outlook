/**
 * PRD v5.2-A R66 (K63) and R64 (K51) on the screens: the P&L tile of Outlook bulan and Minggu ini in both modes of
 * app_setting v5_pl.costing_rows_mode, golden B.2 unchanged in 'cogs'; the cumulative NIBT after fixed costs draws no
 * point while every fixed nominal is missing.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { costingPlRows, type PlRowV4 } from "@kgr/engine";
import { outlookBulanFixture } from "../../test-support/month-fixture";
import { augustV5 } from "../../test-support/pl-v5-fixture";
import { fixtureInput } from "../../test-support/minggu-ini-fixture";
import { outlookBulanModel } from "../v4/outlook-bulan";
import { mingguIniModel } from "../v4/minggu-ini";
import { costingModeOf } from "../modules-core";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "../v4/minggu-ini";

const v5 = augustV5();
// the two v5 costing rows of August: Selisih costing −5,0 jt (20 Aug, actual), idle −1,0 (20 Aug) and −3,0 jt (29 Aug, forecast)
const v5rows: PlRowV4[] = costingPlRows({ cutOff: "2026-08-26", from: "2026-08-01", to: "2026-08-31", selisih: [{ date: "2026-08-20", amount: "-5000000" }], idle: [{ date: "2026-08-20", amount: "-1000000" }, { date: "2026-08-29", amount: "-3000000" }] });
const rows = [...v5.rows, ...v5rows];
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));
const href = (q: { pl?: string; cm?: string }) => `/m/2026-08?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString()}`;
const base = outlookBulanFixture();
const model = (mode: "cogs" | "memo" | undefined, x: { rows?: PlRowV4[]; pl?: "rr" | "wk"; cm?: "revenue" | "nibt" | "nibt_after"; fixed?: typeof v5.fixed } = {}) =>
  outlookBulanModel({ ...base, v5: { rows: x.rows ?? rows, fixed: x.fixed ?? v5.fixed, pl: x.pl ?? "rr", cm: x.cm ?? "revenue", href, mode } });
const pl = (m: ReturnType<typeof model>) => text(m.tiles.find((t) => t.id === "t-laba-rugi"));

describe("R66 mode setting: 'memo' only when the stored value says so", () => {
  it("costingModeOf", () => {
    expect(costingModeOf({ enabled: true, costing_rows_mode: "memo" })).toBe("memo");
    for (const v of [{ enabled: true }, { costing_rows_mode: "cogs" }, { costing_rows_mode: "MEMO" }, { costing_rows_mode: 1 }, null, undefined, "memo"]) expect(costingModeOf(v)).toBe("cogs");
  });
});

describe("R66 Outlook bulan, mode cogs (default): the v5 behaviour, golden B.2 on the journal columns", () => {
  it("no mode, 'cogs' and the fixture without the v5 rows give the same B.2 table; no memo block", () => {
    const b2 = pl(model(undefined, { rows: v5.rows }));
    for (const s of ["NIBT menurut jurnal 165,2 −86,1 79,2", "Beban tetap belum dijurnal (estimasi) −73,0 −14,0 −87,0", "NIBT setelah beban tetap 92,3 −100,1 −7,8", "Gross profit 347,4 −51,0 296,4"]) expect(b2).toContain(s);
    expect(pl(model("cogs", { rows: v5.rows }))).toBe(b2);
    expect(b2).not.toContain("Memo");
    expect(b2).not.toContain("NIBT manajemen");
  });
  it("with the v5 rows the cost of sales and the journal NIBT carry them (as before v5.2)", () => {
    const v = pl(model("cogs"));
    expect(v).toContain("Gross profit 341,4 −54,0 287,4"); // 347,4 − 6,0 (actual); −51,0 − 3,0 (forecast); 296,4 − 9,0 (outlook)
    expect(v).not.toContain("Memo");
  });
});

describe("R66 Outlook bulan, mode memo: the journal columns hold journal lines only; the memo block below the journal NIBT", () => {
  it("the journal rows are B.2 again, the memo rows and NIBT manajemen follow the journal NIBT", () => {
    const v = pl(model("memo"));
    for (const s of ["Gross profit 347,4 −51,0 296,4", "NIBT menurut jurnal 165,2 −86,1 79,2", "NIBT setelah beban tetap 92,3 −100,1 −7,8"]) expect(v).toContain(s);
    expect(v).toContain("Memo · Selisih costing (belum di jurnal) −5,0 0,0 −5,0");
    expect(v).toContain("Memo · Biaya kapasitas idle (belum di jurnal) −1,0 −3,0 −4,0");
    // NIBT manajemen = journal NIBT + memo rows: 165,2 − 6,0 · −86,1 − 3,0 · 79,2 − 9,0
    expect(v).toContain("NIBT manajemen (jurnal + memo) 159,2 −89,1 70,2");
    // the order of the rows: NIBT jurnal, the memo block, then the fixed-cost rows
    const order = ["NIBT menurut jurnal", "Memo · Selisih costing", "Memo · Biaya kapasitas idle", "NIBT manajemen (jurnal + memo)", "Beban tetap belum dijurnal", "NIBT setelah beban tetap"].map((s) => v.indexOf(s));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true);
  });
  it("NIBT manajemen of memo = the journal NIBT of cogs, to the cell (the same management number)", () => {
    const memo = pl(model("memo")), cogs = pl(model("cogs"));
    expect(memo).toContain("NIBT manajemen (jurnal + memo) 159,2 −89,1 70,2");
    expect(cogs).toContain("NIBT menurut jurnal 159,2 −89,1 70,2");
  });
  it("per week: the memo rows are in the week columns and the month; the note says what the journal columns hold", () => {
    const t = model("memo", { pl: "wk" }).tiles.find((x) => x.id === "t-laba-rugi")!;
    const v = text(t);
    expect(v).toContain("Memo · Selisih costing (belum di jurnal)");
    expect(t.note).toContain("kolom jurnal memuat baris jurnal saja (sama dengan FS)");
    expect(t.cara?.sources?.some((s) => s.label === "Kolom jurnal")).toBe(true);
  });
  it("headline and cards follow the mode: GP and the journal NIBT without the v5 rows", () => {
    const m = model("memo");
    expect(text(m.tiles.find((t) => t.id === "headline"))).toContain("NIBT Rp 79,2 jt menurut jurnal");
    expect(text(m.tiles.find((t) => t.id === "c-outlook"))).toContain("NIBT jurnal 79,2 jt");
    const c = model("cogs");
    expect(text(c.tiles.find((t) => t.id === "headline"))).toContain("NIBT Rp 70,2 jt menurut jurnal");
  });
});

describe("R66 Minggu ini follows the same mode", () => {
  const { base: mb } = fixtureInput();
  const wk = (mode: "cogs" | "memo") => mingguIniModel({ ...mb, mode: "proyeksi", on: { ...mb.on, m4: true }, v5Pl: { first: "2026-08-01", cutOff: "2026-08-26", rows, fixed: v5.fixed, pl: "wk", mode, href: () => "/minggu-ini/2026-08-24" } });
  it("memo: the tile has the memo block; cogs: none", () => {
    expect(text(wk("memo").tiles.find((t) => t.id === "t-laba-rugi"))).toContain("NIBT manajemen (jurnal + memo)");
    expect(text(wk("cogs").tiles.find((t) => t.id === "t-laba-rugi"))).not.toContain("NIBT manajemen");
  });
});

describe("R64 (K51): NIBT after fixed costs draws no point while every fixed nominal is missing", () => {
  const missing = v5.fixed.map((f) => ({ ...f, nominal: null, source: "belum ada" as const }));
  it("the chart of 'NIBT + beban tetap' is empty and says why, instead of drawing the journal NIBT", () => {
    const t = model("cogs", { rows: v5.rows, cm: "nibt_after", fixed: missing }).tiles.find((x) => x.id === "ch-kumulatif")!;
    expect(t.title).toBe("NIBT kumulatif setelah beban tetap (Rp jt)");
    expect(t.note).toContain("belum bisa digambar");
    expect(t.note).toContain("tidak menampilkan NIBT jurnal sebagai penggantinya");
    if (t.content.type !== "line") throw new Error("line");
    expect(t.content.plot.series.every((s) => s.points.every((p) => p === null))).toBe(true);
    expect(t.content.plot.marks).toEqual([]);
    expect(text(t)).not.toContain("Outlook ");
  });
  it("with the nominals present the same chart draws the series; the journal chart is unaffected by the missing nominals", () => {
    const ok = model("cogs", { rows: v5.rows, cm: "nibt_after" }).tiles.find((x) => x.id === "ch-kumulatif")!;
    expect(text(ok)).toContain("Outlook −7,8");
    const j = model("cogs", { rows: v5.rows, cm: "nibt", fixed: missing }).tiles.find((x) => x.id === "ch-kumulatif")!;
    if (j.content.type !== "line") throw new Error("line");
    expect(j.content.plot.series[0].points.some((p) => p !== null)).toBe(true);
  });
});
