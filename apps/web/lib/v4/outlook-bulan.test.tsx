/** Pages "Outlook bulan" (PRD v4 §6.2) and "Kas & solvabilitas" (§6.3) on the golden fixtures. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { kasFixtureFs, kasFixtureProjection, outlookBulanFixture } from "../../test-support/month-fixture";
import { outlookBulanModel } from "./outlook-bulan";
import { kasModel } from "./kas";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "./minggu-ini";

const tile = (tiles: TileModel[], id: string) => tiles.find((t) => t.id === id);
const values = (t: TileModel | undefined) => renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
function noOverlap(tiles: TileModel[]) {
  const cells = new Map<string, string>();
  for (const t of tiles) for (let x = t.pos.x; x < t.pos.x + t.pos.w; x++) for (let y = t.pos.y; y < t.pos.y + t.pos.h; y++) {
    const k = `${x},${y}`;
    expect(cells.has(k), `${t.id} overlaps ${cells.get(k)} at ${k}`).toBe(false);
    cells.set(k, t.id);
  }
}

describe("Outlook bulan §6.2 on August 2026, cut-off 26 Aug", () => {
  const input = outlookBulanFixture();
  const m = outlookBulanModel(input);
  it("tiles at the coordinates of the PRD table, none overlapping", () => {
    const spec: Record<string, [number, number, number, number]> = {
      "slicer-bulan": [0, 0, 6, 1], rilis: [9, 0, 3, 1], headline: [0, 1, 12, 1], "c-actual": [0, 2, 2, 2], "c-forecast": [2, 2, 2, 2], "c-outlook": [4, 2, 3, 2],
      "c-po": [7, 2, 2, 2], "c-budget": [9, 2, 3, 2], "ch-harian": [0, 4, 7, 4], "t-sisa": [7, 4, 5, 4], "ch-kumulatif": [0, 8, 8, 4], register: [8, 8, 4, 4],
      "ch-bridge": [0, 12, 7, 4], "t-versi": [7, 12, 5, 4], akurasi: [0, 16, 6, 3], solvabilitas: [6, 16, 6, 3],
    };
    for (const [id, p] of Object.entries(spec)) expect(tile(m.tiles, id)?.pos, id).toEqual({ x: p[0], y: p[1], w: p[2], h: p[3] });
    noOverlap(m.tiles);
  });
  it("headline and cards: K3 outlook 7.764,1 jt, GP P&L 296,4 jt (3,8%), 77% of the rest of the month on PO", () => {
    expect(values(tile(m.tiles, "headline"))).toContain("Revenue Agustus diproyeksikan Rp 7.764,1 jt, GP P&L Rp 296,4 jt (3,8%); sisa bulan 77% ber-PO.");
    expect(values(tile(m.tiles, "c-actual"))).toContain("6.385,9");
    expect(values(tile(m.tiles, "c-actual"))).toContain("347,4 jt");
    expect(values(tile(m.tiles, "c-forecast"))).toContain("1.378,2");
    expect(values(tile(m.tiles, "c-forecast"))).toContain("−51,0 jt");
    expect(values(tile(m.tiles, "c-outlook"))).toContain("7.626,3–7.901,9");
    expect(values(tile(m.tiles, "c-po"))).toContain("40.437");
  });
  it("no budget: the card says so in words, never 0", () => {
    expect(values(tile(m.tiles, "c-budget"))).toContain("budget belum diisi");
  });
  it("budget filled: difference, need per day", () => {
    const b = outlookBulanModel({ ...input, budget: [{ segment: "Total", metric: "revenue", value: "8000000000" }, { segment: "Total", metric: "gp", value: "300000000" }] });
    const v = values(tile(b.tiles, "c-budget"));
    expect(v).toContain("−235,9");
    expect(v).toContain("selisih GP");
    expect(v).toContain("butuh per hari");
  });
  it("daily chart: the run-rate window and the rest of the month; 25 Aug labelled in words, the cut-off marked", () => {
    const t = tile(m.tiles, "ch-harian")!;
    expect(t.note).toContain("25 Agu");
    const pts = (t.content as { points: { key: string; marker?: string; barTone?: string; title?: string }[] }).points;
    expect(pts.map((p) => p.key)[0]).toBe("2026-08-20");
    expect(pts.find((p) => p.key === "2026-08-26")!.marker).toBe("cut-off");
    expect(pts.find((p) => p.key === "2026-08-31")!.barTone).toBe("s3");
    expect(pts.find((p) => p.key === "2026-08-25")!.title).toContain("anomali");
  });
  it("remaining days: PO 27–29, no delivery on Sunday 30, run-rate on 31 Aug; total = forecast", () => {
    const v = values(tile(m.tiles, "t-sisa"));
    expect(v).toContain("PO");
    expect(v).toContain("tidak ada pengiriman");
    expect(v).toContain("run-rate 7 hari");
    expect(v).toContain("310,4");
    expect(v).toContain("1.378,2");
  });
  it("register: the engine's assumptions, open ones first and marked in words", () => {
    const v = values(tile(m.tiles, "register"));
    expect(tile(m.tiles, "register")!.note).toContain("belum disepakati");
    expect(v).toContain("belum");
    expect(v).toContain("310,4 jt");
  });
  it("no V2: the bridge says so; versions empty; accuracy V1 vs FINAL 649,4 (8,4%)", () => {
    expect(values(tile(m.tiles, "ch-bridge"))).toContain("V2 belum ada");
    expect(values(tile(m.tiles, "t-versi"))).toContain("belum ada versi terkunci");
    const a = values(tile(m.tiles, "akurasi"));
    expect(a).toContain("7.712,4");
    expect(a).toContain("8.361,8");
    expect(a).toContain("649,4 (8,4%)");
    expect(a).not.toContain("NIBT");
  });
  it("not built yet: one sentence, nothing shown as 0", () => {
    const e = outlookBulanModel({ ...input, rows: null });
    expect(values(tile(e.tiles, "headline"))).toContain("belum dibangun");
    expect(e.tiles.map((t) => t.id)).toEqual(["slicer-bulan", "rilis", "headline"]);
  });
  it("M6 off: the solvency tile is left out", () => {
    expect(outlookBulanModel({ ...input, on: { m6: false } }).hidden).toContain("solvabilitas");
  });
  it("no technical sheet names, e-mail or arrows in the page", () => {
    const html = renderToStaticMarkup(<TilePage tiles={m.tiles} label="Outlook" />).replace(/<[^>]+>/g, " ");
    expect(html).not.toMatch(/\b[IOT]_[A-Za-z_]+/);
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(html).not.toContain("→");
  });
});

describe("Kas & solvabilitas §6.3", () => {
  it("30 Sep from the FS only: headline, cards; no projection reads 'tidak tersedia', never 0", () => {
    const m = kasModel(kasFixtureFs());
    noOverlap(m.tiles);
    expect(values(tile(m.tiles, "headline"))).toContain("Kas Rp 103,0 jt per 30 Sep 2026");
    expect(values(tile(m.tiles, "headline"))).toContain("ekuitas Rp 702,6 jt habis dalam 0,8 bulan bila rugi September berulang");
    expect(values(tile(m.tiles, "c-terendah"))).toContain("tidak tersedia");
    expect(values(tile(m.tiles, "c-afiliasi"))).toContain("9.845,9");
    expect(values(tile(m.tiles, "c-afiliasi"))).toContain("4.218,8 jt");
    expect(values(tile(m.tiles, "c-afiliasi"))).toContain("54,0 jt");
    expect(values(tile(m.tiles, "c-ekuitas"))).toContain("14%");
    expect(values(tile(m.tiles, "ch-12bulan"))).toContain("tidak tersedia: outlook bulanan belum menjadi basis");
    expect(values(tile(m.tiles, "ccc"))).toContain("36,2");
  });
  it("26 Aug with plans: lowest 289,7 jt on 28 Aug, without the affiliate facility −910,3 jt; operations and affiliate funding apart", () => {
    const m = kasModel(kasFixtureProjection());
    noOverlap(m.tiles);
    const c = values(tile(m.tiles, "c-terendah"));
    expect(c).toContain("289,7");
    expect(c).toContain("−910,3 jt");
    expect(values(tile(m.tiles, "headline"))).toContain("tanpa fasilitas afiliasi Rp −910,3 jt");
    const t = values(tile(m.tiles, "t-arus"));
    expect(t).toContain("1.200,0");
    expect(tile(m.tiles, "t-arus")!.note).toContain("Terendah tanpa fasilitas 28 Agu");
    expect(tile(m.tiles, "ch-13minggu")!.note).toContain("Rp 1.200,0 jt yang sudah masuk minggu ini");
    expect(tile(m.tiles, "t-arus")!.note).not.toContain("PB Dari BCA");
    expect(values(tile(m.tiles, "ch-12bulan"))).not.toContain("tidak tersedia");
  });
});
