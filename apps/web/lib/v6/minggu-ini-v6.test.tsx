/** PRD v6 K89 / K97 / R150 / R157 (flag v6_pages): the cards of Minggu ini carry the decided metric. */
import { describe, expect, it, vi } from "vitest";
import { D } from "@kgr/engine";

vi.mock("server-only", () => ({}));
const { fixtureInput } = await import("../../test-support/minggu-ini-fixture");
const { mingguIniModel, shownDelta } = await import("../v4/minggu-ini");
const { jtV4 } = await import("../fmt");

const card = (tiles: { id: string; content: { type: string } }[], id: string) => {
  const t = tiles.find((x) => x.id === id);
  if (!t || t.content.type !== "card") throw new Error(`no card ${id}`);
  return t as unknown as { title: string; note?: string; content: { value: string | null; unit?: string; compare: { label: string; value: string }[] } };
};

describe("Minggu ini v6 cards", () => {
  const { base } = fixtureInput();
  const v4 = mingguIniModel(base).tiles;
  const v6 = mingguIniModel({ ...base, v6: true }).tiles;

  it("GP minggu: GP is the value, revenue a comparison (v4 showed revenue)", () => {
    const o4 = card(v4, "c-outlook"), o6 = card(v6, "c-outlook");
    expect(o6.title).toBe("GP minggu");
    expect(o6.content.compare.find((c) => c.label === "Revenue")?.value).toBe(`${o4.content.value} jt`);
    expect(o4.content.compare[0].value.startsWith(`${o6.content.value} jt`)).toBe(true);
  });

  it("Solvabilitas: equity ÷ paid-in capital is the value", () => {
    const s = card(v6, "c-solvabilitas");
    expect(s.content.unit).toBe("% modal disetor");
    expect(s.content.compare[0].label).toBe("ekuitas");
    expect(/^\d+$/.test(String(s.content.value))).toBe(true);
  });

  it("Kas: the lowest balance without affiliate loans is the value, the balance with them a comparison", () => {
    const k4 = card(v4, "c-kas"), k6 = card(v6, "c-kas");
    expect(k6.content.value).toBe(k4.content.compare.find((c) => c.label === "tanpa pinjaman afiliasi")?.value.replace(/ jt$/, ""));
    expect(k6.content.compare.find((c) => c.label === "saldo dengan afiliasi")?.value).toBe(`${k4.content.value} jt`);
    if (k6.content.value?.startsWith("−")) expect(k6.note).toMatch(/^butuh afiliasi Rp [\d.,]+ jt sebelum /);
  });

  it("K97: a delta is taken from the rounded numbers shown", () => {
    // 10,06 − 5,04 is shown as 10,1 − 5,0 = 5,1 (the full decimals would print 5,0 next to two numbers that differ by 5,1)
    expect(jtV4(shownDelta(D("10060000"), D("5040000")))).toBe("5,1");
  });
});

// M7 on screen: with v6_pages the rendered text of Minggu ini names no specification code outside the drawer
import { renderToStaticMarkup } from "react-dom/server";
import { TilePage } from "@/components/v4/TilePage";
import { hasCode } from "./glossary";
describe("M7: no codes in the rendered v6 screen", () => {
  it("Minggu ini (fixture) — text outside 'cara hitung'", () => {
    const { base } = fixtureInput();
    const tiles = mingguIniModel({ ...base, v6: true }).tiles.map((t) => ({ ...t, cara: undefined }));
    const html = renderToStaticMarkup(<TilePage tiles={tiles} label="Minggu ini" v6 plainText />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const found = text.match(/\b(?:C\d{2}|K\d{2,3}|O\d{1,2}|R\d{2,3})\b/g) ?? [];
    expect(found).toEqual([]);
    expect(hasCode(text)).toBe(false);
  });
});
