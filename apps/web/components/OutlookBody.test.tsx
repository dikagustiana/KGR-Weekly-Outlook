/** PRD v3 §6: the management view orders the sections headline → segmen → RPA + batch → Input → COGS → trading → stok → kas → demand → akurasi → peringatan. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeWeek } from "@kgr/engine";
import { loadFixtureWeek } from "@kgr/engine/fixtures";
import { OutlookBody } from "./OutlookBody";

const r = computeWeek(loadFixtureWeek("2026-08-24"));

describe("OutlookBody section order", () => {
  it("preparer view keeps the Excel order (blocks 1–8)", () => {
    const html = renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="preparer" />);
    for (const [a, b] of [["ringkasan", "keputusan-rpa"], ["keputusan-rpa", "stok"], ["stok", "keputusan-trading"], ["keputusan-trading", "kas-keluar"], ["kas-keluar", "batch-rpa"], ["batch-rpa", "laporan-keuangan"]]) {
      expect(html.indexOf(`id="${a}"`)).toBeLessThan(html.indexOf(`id="${b}"`));
    }
  });
  it("management view with the v3 sections follows PRD v3 §6", () => {
    const html = renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="management" v3={{
      input: <div id="X-input" />, cogs: <div id="X-cogs" />, cash: <div id="X-cash" />, demand: <div id="X-demand" />, accuracy: <div id="X-accuracy" />,
    }} />);
    const order = ["ringkasan", "keputusan-rpa", "batch-rpa", "X-input", "X-cogs", "keputusan-trading", "stok", "kas-keluar", "X-cash", "X-demand", "X-accuracy", "peringatan-v3", "laporan-keuangan"];
    const pos = order.map((id) => html.indexOf(`id="${id}"`));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});
