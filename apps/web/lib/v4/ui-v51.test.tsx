/**
 * PRD v5.1 irisan 4 UI on the fixtures: R37 (cash card without affiliate loans from the cash mart), R38 (§6.5 NIBT after
 * fixed costs on the three cards, accuracy rows), R39 (K20 cost status per segment and SKU), R40 (chart fits its tile;
 * v5 costing start date).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, accuracyV4 } from "@kgr/engine";
import { fixtureInput } from "../../test-support/minggu-ini-fixture";
import { outlookBulanFixture } from "../../test-support/month-fixture";
import { augustV5 } from "../../test-support/pl-v5-fixture";
import { mingguIniModel, type TileModel } from "./minggu-ini";
import { outlookBulanModel } from "./outlook-bulan";
import { TilePage } from "@/components/v4/TilePage";
import { statusMode } from "../v5/cost-status";

vi.mock("server-only", () => ({}));
const { sinceOf } = await import("../v5/costing");

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));
const { base } = fixtureInput();

describe("R37: Kas terendah minggu ini always names the balance without affiliate loans", () => {
  const days = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
  it("from the cash mart: the lowest closing_without_affiliate of the week", () => {
    const cashMart = days.map((d, i) => ({ date: d, closing: String(1_000_000_000 - i * 50_000_000), planned: d >= "2026-08-27", without: String(-200_000_000 - i * 10_000_000) }));
    const m = mingguIniModel({ ...base, cashMart });
    const v = text(m.tiles.find((t) => t.id === "c-kas"));
    expect(v).toContain("tanpa pinjaman afiliasi");
    expect(v).toContain("−260,0 jt");
  });
  it("cash mart without the column built: 'belum ada', never 0", () => {
    const cashMart = days.map((d) => ({ date: d, closing: "1000000000", planned: false, without: null }));
    expect(text(mingguIniModel({ ...base, cashMart }).tiles.find((t) => t.id === "c-kas"))).toContain("tanpa pinjaman afiliasi belum ada");
  });
  it("weekly cash flow (no mart): the line as before", () => {
    expect(text(mingguIniModel(base).tiles.find((t) => t.id === "c-kas"))).toMatch(/tanpa pinjaman afiliasi −?[\d.,]+ jt/);
  });
});

describe("R38 (§6.5): NIBT after fixed costs on Actual, Forecast and Outlook; accuracy with and without fixed costs", () => {
  const v5 = augustV5();
  const href = () => "/m/2026-08";
  const m = outlookBulanModel({ ...outlookBulanFixture(), v5: { rows: v5.rows, fixed: v5.fixed, pl: "rr", cm: "revenue", href } });
  it("the three cards: GP, NIBT jurnal, NIBT setelah beban tetap (92,3 / −100,1 / −7,8, Lampiran B.2)", () => {
    expect(text(m.tiles.find((t) => t.id === "c-actual"))).toContain("NIBT setelah beban tetap 92,3 jt");
    expect(text(m.tiles.find((t) => t.id === "c-forecast"))).toContain("NIBT setelah beban tetap −100,1 jt");
    expect(text(m.tiles.find((t) => t.id === "c-outlook"))).toContain("NIBT setelah beban tetap −7,8 jt");
    for (const id of ["c-actual", "c-forecast", "c-outlook"]) {
      const c = m.tiles.find((t) => t.id === id)!.content;
      expect(c.type === "card" && c.maxCompare, id).toBe(4);
    }
  });
  it("accuracy: 'NIBT jurnal' and 'NIBT + beban tetap' (the version's fixed estimate) against the FINAL", () => {
    // the fixture's V1 carries no NIBT: add one (79,2 jt by the journal, FINAL −5,0 jt) through the engine
    const f0 = outlookBulanFixture();
    const nibt = accuracyV4({ final: { revenue: 0, gp: 0, nibt: "-5000000" }, adjustments: { revenue: 0, gp: 0, nibt: 0 }, versions: [{ version: "V1", revenue: 0, gp: 0, nibt: "79200000" }] }).find((l) => l.metric === "nibt")!;
    const base0 = { ...f0, accuracy: { ...f0.accuracy!, lines: [...f0.accuracy!.lines, nibt] } };
    const withFixed = outlookBulanModel({ ...base0, accuracy: { ...base0.accuracy!, fixedOfVersion: "-87020000" }, v5: { rows: v5.rows, fixed: v5.fixed, pl: "rr", cm: "revenue", href } });
    const v = text(withFixed.tiles.find((t) => t.id === "akurasi"));
    expect(v).toContain("NIBT jurnal");
    const after = nibt.value.plus(D("-87020000"));
    // 79,2 − 87,0 = −7,8 jt against the FINAL −5,0: off by 2,8 jt (the journal alone: 84,2)
    expect(after.div(1e6).toFixed(2)).toBe("-7.82");
    expect(v).toContain("NIBT jurnal 79,2 −5,0 84,2");
    expect(v).toContain("NIBT + beban tetap −7,8 −5,0 2,8");
    // a version without a fixed estimate: unknown, not 0
    const none = outlookBulanModel({ ...base0, accuracy: { ...base0.accuracy!, fixedOfVersion: null }, v5: { rows: v5.rows, fixed: v5.fixed, pl: "rr", cm: "revenue", href } });
    expect(text(none.tiles.find((t) => t.id === "akurasi"))).toContain("NIBT + beban tetap belum ada");
    // flag off: the v4 rows as before
    const v4 = text(outlookBulanModel({ ...base0, v5: undefined }).tiles.find((t) => t.id === "akurasi"));
    expect(v4).not.toContain("NIBT + beban tetap");
    expect(v4).not.toContain("NIBT jurnal");
  });
});

describe("R39 (K20): the cost status of the stock, per SKU and per segment", () => {
  it("one status, 'campur' when they differ, nothing when none", () => {
    expect(statusMode(["estimasi", "estimasi"])).toBe("estimasi");
    expect(statusMode(["estimasi", "final", null])).toBe("campur");
    expect(statusMode([null, undefined])).toBeNull();
  });
  it("Minggu ini: segment column 'Status biaya' and the SKU cost with its status", () => {
    const keys = base.stock!.keys.map((k, i) => ({ ...k, cost_status: k.key.startsWith("RPA|") ? (i % 2 ? "estimasi" : "sementara") : "final" }));
    const m = mingguIniModel({ ...base, stock: { ...base.stock!, keys } });
    const seg = text(m.tiles.find((t) => t.id === "t-segmen"));
    expect(seg).toContain("Status biaya");
    expect(seg).toMatch(/RPA .* campur/);
    expect(seg).toMatch(/Trading .* final/);
    const stock = text(m.tiles.find((t) => t.id === "ch-stok-umur"));
    expect(stock).toMatch(/\d (estimasi|sementara|final)/);
  });
  it("no status in the mart (v5_costing off for the role): the tables as before", () => {
    const m = mingguIniModel(base);
    expect(text(m.tiles.find((t) => t.id === "t-segmen"))).not.toContain("Status biaya");
  });
});

describe("R40", () => {
  it("a full-tile chart fills the tile body, at least the 76 px rows of tileBox", () => {
    const m = mingguIniModel(base);
    const html = renderToStaticMarkup(<TilePage tiles={m.tiles.filter((t) => t.content.type === "combo" || t.content.type === "line" || t.content.type === "waterfall")} label="x" />);
    expect(html).toMatch(/<div class="chart-fit" style="min-height:\d+px"><svg class="chart"/);
  });
  it("v5 costing start date only from value.since (YYYY-MM-DD); never the date the flag changed", () => {
    expect(sinceOf({ enabled: true, since: "2026-08-24" })).toBe("2026-08-24");
    expect(sinceOf({ enabled: true, since: "2026-08-24T10:00:00+07:00" })).toBe("2026-08-24");
    expect(sinceOf({ enabled: true })).toBeNull();
    expect(sinceOf({ enabled: true, since: "kemarin" })).toBeNull();
    expect(sinceOf(null)).toBeNull();
  });
});
