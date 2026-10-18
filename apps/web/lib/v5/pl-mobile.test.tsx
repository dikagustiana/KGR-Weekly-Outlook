/**
 * PRD v5.2 O17 (decided 17 Okt 2026): the Manajemen P&L tile (Minggu ini) is collapsed by default at <= 768 px, opened by a button; above
 * 768 px the layout is as before. O19: the note of the P&L tile explains why "Beban tetap belum dijurnal" can be positive in a payroll-posting
 * week, and only then. vitest (markup of the tile and the rules of the stylesheet); the behaviour in Chromium is in the e2e journey A6.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, plTable, type PlTable } from "@kgr/engine";
import { augustV5 } from "../../test-support/pl-v5-fixture";
import { fixtureInput } from "../../test-support/minggu-ini-fixture";
import { outlookBulanFixture } from "../../test-support/month-fixture";
import { outlookBulanModel } from "../v4/outlook-bulan";
import { mingguIniModel, type TileModel } from "../v4/minggu-ini";
import { TilePage } from "@/components/v4/TilePage";
import { FIXED_POSITIVE_NOTE, fixedPositiveNote, plTableTile } from "./pl-tiles";

const v5 = augustV5();
const html = (tiles: TileModel[]) => renderToStaticMarkup(<TilePage tiles={tiles} label="x" />).replace(/<!-- -->/g, "");
const plain = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const { base: mb } = fixtureInput();
const minggu = mingguIniModel({ ...mb, on: { ...mb.on, m4: true }, v5Pl: { first: "2026-08-01", cutOff: "2026-08-26", rows: v5.rows, fixed: v5.fixed, pl: "wk", href: () => "/minggu-ini/2026-08-24" } });
const bulan = outlookBulanModel({ ...outlookBulanFixture(), v5: { rows: v5.rows, fixed: v5.fixed, pl: "wk", cm: "revenue", href: () => "/m/2026-08" } });

describe("O17: P&L collapsed by default at <= 768 px (Minggu ini)", () => {
  const pl = minggu.tiles.find((t) => t.id === "t-laba-rugi")!;
  it("the Manajemen P&L tile of Minggu ini is the collapsible one; the month page and every other tile are not", () => {
    expect(pl.collapse).toEqual({ label: "tabel laba rugi" });
    expect(bulan.tiles.find((t) => t.id === "t-laba-rugi")!.collapse).toBeUndefined();
    expect(minggu.tiles.filter((t) => t.collapse).map((t) => t.id)).toEqual(["t-laba-rugi"]);
  });
  it("markup: an unchecked checkbox (closed) and its button before the body; header, body and note stay in the tile; 'Perlu keputusan' has none", () => {
    const h = html([pl]);
    expect(h).toMatch(/<input type="checkbox" id="t-laba-rugi-buka" class="tile-collapse-toggle" data-tile-collapse=""[^>]*\/>/);
    expect(h).not.toMatch(/tile-collapse-toggle"[^>]*checked/);
    expect(h).toContain('<label for="t-laba-rugi-buka" class="v4b tile-collapse-btn">');
    expect(plain(h)).toContain("Tampilkan tabel laba rugi Sembunyikan tabel laba rugi");
    // the order the stylesheet relies on: header, checkbox, button, body, note (sibling selectors)
    const order = ["tile-h", "tile-collapse-toggle", "tile-collapse-btn", "tile-b", 'class="note"'].map((s) => h.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain("Revenue");
    expect(html([{ id: "keputusan", pos: { x: 7, y: 8, w: 5, h: 5 }, kind: "tall", title: "Perlu keputusan minggu ini", content: { type: "list", items: ["a"] } }])).not.toContain("tile-collapse");
  });
  it("an error tile is not collapsible (the message must be seen)", () => {
    expect(html([{ ...pl, error: "boom" }])).not.toContain("tile-collapse");
  });
  const css = readFileSync(join(__dirname, "../../app/v4.css"), "utf8");
  const mq = css.indexOf("@media (max-width: 768px)");
  const block = css.slice(mq, css.indexOf("@media print", mq));
  it("stylesheet: the button and the checkbox do not exist above 768 px; the body is hidden only inside the 768 px media query", () => {
    expect(css).toMatch(/\.tile-collapse-toggle, \.tile-collapse-btn \{ display: none; \}/);
    expect(mq).toBeGreaterThan(css.indexOf(".tile-collapse-toggle, .tile-collapse-btn { display: none; }"));
    expect(block).toContain(".tile-collapse-toggle:not(:checked) ~ .tile-b, .tile-collapse-toggle:not(:checked) ~ .note { display: none; }");
    expect(block).toContain(".tile-collapse-btn { display: inline-flex;");
    // no rule outside that media query hides a collapsible body
    const outside = css.slice(0, mq) + css.slice(mq + block.length);
    expect(outside).not.toMatch(/tile-collapse-toggle:not\(:checked\)/);
    // outside it, `display: none` is only on the button and the checkbox themselves (and the button on paper), never on a body
    expect(outside.match(/\.tile-collapse[^{]*\{[^}]*display:\s*none/g)).toEqual([".tile-collapse-toggle, .tile-collapse-btn { display: none", ".tile-collapse-btn { display: none"]);
  });
  it("stylesheet: opening shows the 'Sembunyikan' label, closing the 'Tampilkan' one; the collapsed tile does not keep the 300 px of a tall tile", () => {
    expect(block).toContain(".tile-collapse-toggle:checked + .tile-collapse-btn .when-closed { display: none; }");
    expect(block).toContain(".tile-collapse-toggle:checked + .tile-collapse-btn .when-open { display: inline; }");
    expect(block).toMatch(/\.tile\.has-collapse \{ min-height: 0 !important;/);
  });
});

describe("O19: the note explains a positive 'Beban tetap belum dijurnal'", () => {
  const table = (positive: boolean): PlTable => {
    const t = plTable("wk", "2026-08-01", { rows: v5.rows, cutOff: "2026-08-26", highlight: "2026-08-24", nominals: v5.fixed });
    return positive ? { ...t, rows: t.rows.map((r) => (r.key === "fixed" ? { ...r, values: r.values.map((v, i) => (i === 4 ? D(6_000_000) : v)) } : r)) } : t;
  };
  const note = (t: PlTable) => plTableTile(t, { id: "t-laba-rugi", pos: { x: 0, y: 4, w: 12, h: 4 }, hrefs: { rr: "/a", wk: "/b" }, fixed: v5.fixed, status: "draft" }).note!;
  it("positive in a column (the week the salary is posted): the note says why — cumulative per month, the month is right", () => {
    expect(table(true).rows.find((r) => r.key === "fixed")!.values.some((v) => v !== null && v.gt(0))).toBe(true);
    const n = note(table(true));
    expect(n).toContain(FIXED_POSITIVE_NOTE.trim());
    expect(n).toContain("bisa positif di minggu posting gaji");
    expect(n).toContain("kumulatif per bulan");
    expect(n).toContain("total bulan tetap benar");
    expect(plain(html([plTableTile(table(true), { id: "t-laba-rugi", pos: { x: 0, y: 4, w: 12, h: 4 }, hrefs: { rr: "/a", wk: "/b" }, fixed: v5.fixed, status: "draft" })]))).toContain("kumulatif per bulan");
  });
  it("all values negative (or none known): no such sentence", () => {
    const t = table(false);
    expect(t.rows.find((r) => r.key === "fixed")!.values.every((v) => v === null || v.lte(0))).toBe(true);
    expect(note(t)).not.toContain("posting gaji");
    expect(fixedPositiveNote({ ...table(true), fixedMissing: true })).toBe("");
  });
  it("only the amount columns count: a positive share or budget column does not trigger it", () => {
    const t = table(false);
    const cols = t.columns.map((c) => ({ ...c, kind: "share" as const }));
    expect(fixedPositiveNote({ ...table(true), columns: cols })).toBe("");
  });
});
