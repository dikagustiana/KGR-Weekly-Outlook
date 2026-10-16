/** PRD v5 v5/2 on the screens (K29–K31, G11): Outlook bulan and Minggu ini on fixtures/month-2026-08. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { outlookBulanFixture } from "../../test-support/month-fixture";
import { augustV5 } from "../../test-support/pl-v5-fixture";
import { fixtureInput } from "../../test-support/minggu-ini-fixture";
import { outlookBulanModel } from "../v4/outlook-bulan";
import { mingguIniModel } from "../v4/minggu-ini";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "../v4/minggu-ini";

const v5 = augustV5();
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));
const href = (q: { pl?: string; cm?: string }) => `/m/2026-08?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString()}`;
const base = outlookBulanFixture();
const model = (pl: "rr" | "wk" = "rr", cm: "revenue" | "cogs" | "gp" | "nibt" | "nibt_after" = "revenue") =>
  outlookBulanModel({ ...base, v5: { rows: v5.rows, fixed: v5.fixed, pl, cm, href } });

describe("Outlook bulan with v5_pl (§6.2, K29–K31)", () => {
  it("flag off: the v4 page has no P&L tile and keeps its coordinates", () => {
    const m = outlookBulanModel(base);
    expect(m.tiles.some((t) => t.id === "t-laba-rugi")).toBe(false);
    expect(m.tiles.find((t) => t.id === "ch-harian")!.pos.y).toBe(4);
  });
  it("P&L tile rows 5–8 across; the tiles below move four rows; no overlap", () => {
    const m = model();
    expect(m.tiles.find((t) => t.id === "t-laba-rugi")!.pos).toEqual({ x: 0, y: 4, w: 12, h: 4 });
    expect(m.tiles.find((t) => t.id === "ch-harian")!.pos).toEqual({ x: 0, y: 8, w: 7, h: 4 });
    expect(m.tiles.find((t) => t.id === "ch-kumulatif")!.pos).toEqual({ x: 0, y: 12, w: 8, h: 4 });
    const cells = new Map<string, string>();
    for (const t of m.tiles) for (let x = t.pos.x; x < t.pos.x + t.pos.w; x++) for (let y = t.pos.y; y < t.pos.y + t.pos.h; y++) {
      expect(cells.has(`${x},${y}`), `${t.id} overlaps ${cells.get(`${x},${y}`)}`).toBe(false);
      cells.set(`${x},${y}`, t.id);
    }
  });
  it("Actual vs run-rate = Lampiran B.2: NIBT jurnal 79,2, fixed −87,0, NIBT after −7,8; budget belum diisi", () => {
    const v = text(model().tiles.find((t) => t.id === "t-laba-rugi"));
    for (const s of ["Laba rugi Agustus 2026 (Rp jt)", "Actual vs run-rate", "Per minggu", "Actual · 1–26 Agu · jurnal", "PO + run-rate · 27–31 Agu", "Outlook · Agustus", "Budget · belum diisi",
      "Revenue 6.385,9 1.378,2 7.764,1", "Gross profit 347,4 −51,0 296,4", "NIBT menurut jurnal 165,2 −86,1 79,2",
      "Beban tetap belum dijurnal (estimasi) −73,0 −14,0 −87,0", "NIBT setelah beban tetap 92,3 −100,1 −7,8"]) expect(v).toContain(s);
    expect(v).toContain("Agustus diproyeksikan rugi −7,8 jt");
    // % revenue of the outlook: COGS −96,2%
    expect(v).toContain("COGS −6.038,5 −1.429,3 −7.467,7 −96,2%");
    expect(v).toContain("gaji, penyusutan dan bunga");
  });
  it("Per minggu: 1–2 · 3–9 · 10–16 · 17–23 · 24–30 (act + PO) · 31 (run-rate) · Agustus", () => {
    const v = text(model("wk").tiles.find((t) => t.id === "t-laba-rugi"));
    for (const s of ["1–2 Agu · jurnal", "24–30 Agu · act + PO", "31 Agu · run-rate", "Agustus · outlook",
      "Revenue 809,0 1.278,9 2.136,7 1.572,3 1.656,8 310,4 7.764,1",
      // engine: 87,02 jt ÷ 31 × 7 = 19,65 per full week (PRD rounds 87,0 first: 19,6); 24–30 −125,6 (PRD −125,7): within ±0,1 (Q-v5-19)
      "Beban tetap belum dijurnal (estimasi) \u22125,6 \u221219,7 \u221219,7 \u221219,7 \u221219,7 \u22122,8 \u221287,0",
      "NIBT setelah beban tetap 152,3 \u221244,6 133,7 \u2212130,6 \u2212125,6 7,1 \u22127,8"]) expect(v).toContain(s);
  });
  it("cards and headline carry NIBT according to the journal and after fixed costs (K29)", () => {
    const m = model();
    expect(text(m.tiles.find((t) => t.id === "headline"))).toContain("NIBT Rp 79,2 jt menurut jurnal atau Rp −7,8 jt setelah gaji, penyusutan dan bunga");
    const out = text(m.tiles.find((t) => t.id === "c-outlook"));
    expect(out).toContain("NIBT jurnal 79,2 jt");
    expect(out).toContain("NIBT setelah beban tetap −7,8 jt");
    expect(text(m.tiles.find((t) => t.id === "c-actual"))).toContain("NIBT jurnal 165,2 jt");
  });
  it("cumulative chart: five measures as links, the chosen one drawn; band on the forecast part only", () => {
    const t = model("rr", "nibt_after").tiles.find((x) => x.id === "ch-kumulatif")!;
    expect(t.title).toBe("NIBT kumulatif setelah beban tetap (Rp jt)");
    expect(t.views![0].options.map((o) => o.label)).toEqual(["Revenue", "COGS", "Gross profit", "NIBT jurnal", "NIBT + beban tetap"]);
    expect(t.views![0].current).toBe("nibt_after");
    expect(text(t)).toContain("Outlook −7,8");
    const r = model("rr", "revenue").tiles.find((x) => x.id === "ch-kumulatif")!;
    expect(r.note).toContain("7.626,3 s.d. 7.901,9");
    const cogs = model("rr", "cogs").tiles.find((x) => x.id === "ch-kumulatif")!;
    expect(cogs.title).toContain("ditampilkan positif");
  });
});

describe("Minggu ini with v5_pl (§6.1 tile Laba rugi, K30 default Per minggu)", () => {
  const { base: mb } = fixtureInput();
  const withV5 = (mode: "aktual" | "proyeksi") => mingguIniModel({ ...mb, mode, on: { ...mb.on, m4: true }, v5Pl: { first: "2026-08-01", cutOff: "2026-08-26", rows: v5.rows, fixed: v5.fixed, pl: "wk", href: (p) => `/minggu-ini/2026-08-24${p === "rr" ? "?pl=rr" : ""}` } });
  it("tile at rows 5–8, the week of the page highlighted; Aktual s.d. kemarin splits the running week 24–26 / 27–30", () => {
    const m = withV5("proyeksi");
    const t = m.tiles.find((x) => x.id === "t-laba-rugi")!;
    expect(t.pos).toEqual({ x: 0, y: 4, w: 12, h: 4 });
    expect(renderToStaticMarkup(<TilePage tiles={[t]} label="x" />)).toContain('<th class="n hi" scope="col">24–30 Agu · act + PO</th>');
    expect(m.tiles.find((x) => x.id === "ch-harian")!.pos.y).toBe(8);
    const split = text(withV5("aktual").tiles.find((x) => x.id === "t-laba-rugi"));
    expect(split).toContain("24–26 Agu · jurnal");
    expect(split).toContain("27–30 Agu · PO");
  });
});
