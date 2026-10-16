/** Page "Minggu ini" (PRD v4 §6.1) on the golden fixture of week 24–30 Aug 2026. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fixtureInput } from "../../test-support/minggu-ini-fixture";
import { mingguIniModel, type MingguIniInput } from "./minggu-ini";
import { TilePage } from "@/components/v4/TilePage";
import { V4Table } from "@/components/v4/Table";

const { base } = fixtureInput();
const off: MingguIniInput = { ...base, on: { m1: false, m2: false, m3: false, m4: false, m6: false }, stock: null, solvency: null, cashMart: null, month: null, demand: null };
const pos = (m: ReturnType<typeof mingguIniModel>, id: string) => m.tiles.find((t) => t.id === id)?.pos;

describe("tile grid of §6.1 (x, y, w, h)", () => {
  const m = mingguIniModel(base);
  const spec: Record<string, [number, number, number, number]> = {
    "slicer-minggu": [0, 0, 6, 1], mode: [6, 0, 3, 1], rilis: [9, 0, 3, 1], headline: [0, 1, 12, 1],
    "c-outlook": [0, 2, 3, 2], "c-stok": [3, 2, 2, 2], "c-kas": [5, 2, 2, 2], "c-solvabilitas": [9, 2, 3, 2],
    "ch-harian": [0, 4, 7, 4], "ch-bridge": [7, 4, 5, 4], "t-segmen": [0, 8, 7, 4], "ch-cogs": [7, 8, 5, 4],
    "t-input": [0, 12, 6, 4], "t-cogs": [6, 12, 6, 4], "ch-stok-umur": [0, 16, 6, 4], kas: [6, 16, 6, 4],
    "t-trading": [0, 20, 6, 3], peringatan: [9, 20, 3, 3], catatan: [0, 23, 12, 1],
  };
  it("every tile sits at the coordinates of the PRD table", () => {
    for (const [id, p] of Object.entries(spec)) expect(pos(m, id), id).toEqual({ x: p[0], y: p[1], w: p[2], h: p[3] });
  });
  it("no two tiles overlap in the 12-column grid", () => {
    const cells = new Map<string, string>();
    for (const t of mingguIniModel({ ...base, on: { ...base.on, m3: true, m4: true } }).tiles) {
      for (let x = t.pos.x; x < t.pos.x + t.pos.w; x++) for (let y = t.pos.y; y < t.pos.y + t.pos.h; y++) {
        const k = `${x},${y}`;
        expect(cells.has(k), `${t.id} overlaps ${cells.get(k)} at ${k}`).toBe(false);
        cells.set(k, t.id);
      }
    }
  });
});

describe("module flags: a tile whose module is off is not rendered", () => {
  const m = mingguIniModel(off);
  it("c-bulan, c-solvabilitas, demand and the stock per age tile are left out; t-input and t-cogs always stay", () => {
    expect(m.hidden).toEqual(expect.arrayContaining(["c-bulan", "c-solvabilitas", "demand", "ch-stok-umur"]));
    const ids = m.tiles.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["t-input", "t-cogs", "c-outlook", "c-stok", "c-kas", "kas"]));
    expect(ids).not.toContain("c-solvabilitas");
  });
  it("headline = the §6.1 template: GP P&L, worst segment, stock over the age limit (block 4 while M2 is off)", () => {
    const h = m.tiles.find((t) => t.id === "headline")!.content as { text: string };
    expect(h.text).toBe("GP P&L minggu ini diproyeksikan Rp −67,5 jt (−4,1%); RPA menyumbang Rp −62,6 jt. Stok di atas batas umur Rp 2.782,2 jt.");
  });
  it("without the weekly P&L rows (mart not built) no headline and no outlook card, never a 0", () => {
    const m2 = mingguIniModel({ ...off, plRows: null });
    expect(m2.hidden).toEqual(expect.arrayContaining(["headline", "c-outlook", "ch-harian", "ch-bridge"]));
    // their places say the mart is not built, so the page has no holes (production before the first rebuild)
    const p = m2.tiles.filter((t) => t.id.endsWith("-pending"));
    expect(p.map((t) => t.id)).toEqual(expect.arrayContaining(["headline-pending", "c-outlook-pending", "ch-harian-pending", "ch-bridge-pending"]));
    const card = p.find((t) => t.id === "c-outlook-pending")!;
    expect(card.content).toMatchObject({ type: "card", value: null, missing: "belum dibangun" });
    expect(card.pos).toEqual({ x: 0, y: 2, w: 3, h: 2 });
  });
  it("a module that is on with its mart not built yet: a placeholder in the tile's place; a module that is off: nothing", () => {
    const on = { ...off, on: { m1: false, m2: true, m3: true, m4: true, m6: true }, stock: null, month: null, solvency: null, demand: null };
    const ids = mingguIniModel(on).tiles.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["c-bulan-pending", "c-solvabilitas-pending", "ch-stok-umur-pending", "demand-pending"]));
    expect(m.tiles.map((t) => t.id).filter((i) => i.endsWith("-pending"))).toEqual([]);
  });
});

describe("K16: Rp jt with one decimal, U+2212; never an arrow or M as unit", () => {
  const all = JSON.stringify(mingguIniModel(base).tiles, (_, v) => (typeof v === "object" && v !== null && "s" in v && "toFixed" in v ? v.toString() : v));
  it("no ASCII minus before a decimal amount, no →, no ' M ' unit", () => {
    expect(all).not.toMatch(/(?<![\w-])-\d+,\d/);
    expect(all).not.toContain("→");
    expect(all).not.toMatch(/\d\s?M\b(?!\w)/);
  });
  it("cards: GP P&L −67,5 jt (−4,1%); cash 289,7 on Fri 28 Aug; stock card from the ledger when M2 is on", () => {
    const m = mingguIniModel(base);
    const card = (id: string) => m.tiles.find((t) => t.id === id)!.content as { value: string | null; compare: { label: string; value: string }[] };
    expect(card("c-outlook").compare[0].value).toBe("−67,5 jt (−4,1%)");
    expect(card("c-kas").value).toBe("289,7");
    expect(card("c-kas").compare.map((c) => c.value)).toEqual(["Jumat 28 Agu", "−910,3 jt"]);
    expect(card("c-stok").value).toBe("685,4");
  });
});

describe("mode and filters", () => {
  it("Aktual s.d. kemarin hides the forecast bars of the daily chart (27–30 Aug)", () => {
    const m = mingguIniModel({ ...base, mode: "aktual" });
    const ch = m.tiles.find((t) => t.id === "ch-harian")!.content as { points: { key: string; bar: number | null }[] };
    expect(ch.points.map((p) => [p.key, p.bar === null])).toEqual([["2026-08-24", false], ["2026-08-25", false], ["2026-08-26", false], ["2026-08-27", true], ["2026-08-28", true], ["2026-08-29", true], ["2026-08-30", true]]);
  });
  it("a click on a day filters the segment table to that day; a click on a segment filters COGS/kg", () => {
    const day = mingguIniModel({ ...base, hari: "2026-08-26" }).tiles.find((t) => t.id === "t-segmen")!;
    expect(day.title).toContain("Rabu 26");
    const seg = mingguIniModel({ ...base, segmen: "Trading" }).tiles.find((t) => t.id === "ch-cogs")!.content as { groups: { key: string }[] };
    expect(seg.groups.map((g) => g.key)).toEqual(["Trading"]);
  });
  it("the 25 Aug without journal is written as missing data, not zero", () => {
    const n = mingguIniModel(base).tiles.find((t) => t.id === "ch-harian")!.note ?? "";
    expect(n).toContain("Selasa 25 Agu");
    expect(n).toContain("data hilang");
  });
});

describe("rendering", () => {
  it("TilePage writes data-tile and the grid position of every tile", () => {
    const m = mingguIniModel(base);
    const html = renderToStaticMarkup(<TilePage tiles={m.tiles} label="Minggu ini" />);
    for (const t of m.tiles) expect(html).toContain(`data-tile="${t.id}" data-x="${t.pos.x}" data-y="${t.pos.y}" data-w="${t.pos.w}" data-h="${t.pos.h}"`);
    expect(html).not.toContain("→");
  });
  it("no inline hex colour or font size anywhere in the page", () => {
    const html = renderToStaticMarkup(<TilePage tiles={mingguIniModel(base).tiles} label="Minggu ini" />);
    expect(html).not.toMatch(/style="[^"]*#[0-9a-fA-F]{3,8}/);
    expect(html).not.toMatch(/style="[^"]*font-size/);
  });
  it("Table: truncated state says how many of N and links to the detail", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: String(i), cells: { a: `r${i}` } }));
    const html = renderToStaticMarkup(<V4Table cols={[{ key: "a", label: "A" }]} rows={rows} detailHref="/x" />);
    expect(html).toContain("menampilkan 50 dari 60");
    expect(html).toContain("buka detail");
    expect(renderToStaticMarkup(<V4Table cols={[{ key: "a", label: "A" }]} rows={[]} />)).toContain("tidak ada data untuk periode ini");
  });
});
