/** PPIC v5 screen (PRD v5 §6.3, mockup PPIC.dc.html) on fixtures/plan-2026-08-24 v5. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ppicV5Fixture } from "../../test-support/ppic-v5-fixture";
import { ppicV5Model } from "./ppic";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "../v4/minggu-ini";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));
const m = ppicV5Model(ppicV5Fixture());
const tile = (id: string) => m.tiles.find((t) => t.id === id);

describe("PPIC v5 layout = mockup grid", () => {
  it("tiles at the mockup coordinates; no overlap", () => {
    const spec: Record<string, [number, number, number, number]> = {
      stepper: [0, 0, 12, 1], headline: [0, 1, 12, 1], "c-po": [0, 2, 3, 2], "c-karkas": [3, 2, 2, 2], "c-rencana": [5, 2, 2, 2], "c-batch": [7, 2, 2, 2], "c-biaya": [9, 2, 3, 2],
      "t-demand": [0, 4, 7, 4], "dari-commercial": [7, 4, 5, 4], "t-mingguan": [0, 8, 7, 5], "ke-commercial": [7, 8, 5, 5], "t-harian": [0, 13, 12, 3], "t-hari-ini": [0, 16, 7, 3], "t-batch": [7, 16, 5, 3],
    };
    for (const [id, p] of Object.entries(spec)) expect(tile(id)?.pos, id).toEqual({ x: p[0], y: p[1], w: p[2], h: p[3] });
    const cells = new Map<string, string>();
    for (const t of m.tiles) for (let x = t.pos.x; x < t.pos.x + t.pos.w; x++) for (let y = t.pos.y; y < t.pos.y + t.pos.h; y++) {
      expect(cells.has(`${x},${y}`), `${t.id} overlaps ${cells.get(`${x},${y}`)}`).toBe(false);
      cells.set(`${x},${y}`, t.id);
    }
  });
});

describe("numbers of Lampiran B.3 / B.4 on the screen", () => {
  it("headline: 18.358 kg LB in three classes, ± 9.871 heads; batch 27.219 kg LB, 8.861 above the need", () => {
    expect(text(tile("headline"))).toContain("Order 27–29 Agu butuh 18.358 kg LB dalam 3 kelas berat (± 9.871 ekor); batch rencana di input 27.219 kg LB, 8.861 kg di atas kebutuhan.");
  });
  it("step 1: sizes → class → kg LB; 811 kg without a size marked; total 13.118 / 18.358 / 9.871", () => {
    const v = text(tile("t-demand"));
    for (const s of ["Uk 1.3 fresh 4.622 0 4.622 S 1,89 6.468 3.424", "Uk 0.9 fresh 58 0 58 K 1,33 81 61", "Tanpa ukuran 811 0 811 belum ada 2,00 1.135 568", "Total 13.118 0 13.118 1,86 18.358 9.871"]) expect(v).toContain(s);
    expect(v).toContain("811 kg karkas di PO tanpa ukuran memakai STD");
  });
  it("cards: need 18.358 kg LB per class K 2.548 · S 8.212 · B 6.463 · STD 1.135; karkas fresh plan cost ±37.592 at LB 24.600", () => {
    expect(text(tile("c-rencana"))).toContain("K 2.548 · S 8.212 · B 6.463 · STD 1.135");
    const c = text(tile("c-biaya"));
    expect(c).toMatch(/37\.59\d Rp\/kg/);
    expect(c).toContain("breakeven LB rencana kebutuhan 23.961");
  });
  it("step 2: need version GP −11,7 jt, no frozen; saved version surplus ± 6.332 kg, downgrade −32,0 above 25,0", () => {
    const need = text(tile("t-mingguan"));
    expect(need).toContain("GP rencana Rp −11,7 jt");
    expect(need).toContain("Frozen terencana 0 kg");
    const b = ppicV5Model(ppicV5Fixture("batch")).tiles.find((t) => t.id === "t-mingguan")!;
    const bt = text(b);
    expect(bt).toContain("Karkas surplus 6.332 0 6.332");
    expect(bt).toContain("Downgrade Rp −32,0 jt · di atas batas approval 25,0 jt");
    expect(bt).toContain("Margin potong rencana Rp −105,5 jt (blok 2)");
    expect(b.views![0].options.map((o) => o.href)).toEqual(["/w/2026-08-24/rencana", "/w/2026-08-24/rencana?versi=batch"]);
  });
  it("to Commercial: by-product shortfall HJA 1.022, Usus 897, Kepala 842, Ceker 548; 811 kg without size", () => {
    const v = text(tile("ke-commercial"));
    // engine 842,6 / 547,4 kg: Lampiran B.3 rounds 842 / 548 (golden v4 tolerance 1 kg)
    expect(v).toContain("HJA kurang dari order −1.022 kg · beli trading atau kurangi order Usus kurang dari order −897 kg · beli trading atau kurangi order Kepala kurang dari order −843 kg · beli trading atau kurangi order Ceker kurang dari order −547 kg");
    expect(v).toContain("811 kg · minta Commercial isi ukuran");
  });
  it("step 3: Rab 26 → Kam 27 7.461 kg LB 3.870 ekor 0 / 2.081 / 1.221 · 568 tanpa ukuran; Kam 27 today; supply and capacity belum diisi", () => {
    const v = text(tile("t-harian"));
    expect(v).toContain("Rab 26 Kam 27 7.461 3.870 0 / 2.081 / 1.221 · 568 tanpa ukuran 5.332 belum diisi belum diisi lewat");
    expect(v).toContain("Kam 27 Jum 28 4.664 2.536 646 / 1.040 / 851 3.333");
    expect(v).toContain("Jum 28 Sab 29 6.233 3.465 1.094 / 1.300 / 1.071 4.454");
    expect(v).toContain("Belum bisa salin ke batch rencana: C42 PERIKSA, C58 BELUM DIISI");
  });
  it("K25: no buy / delay label anywhere", () => {
    const all = plain(renderToStaticMarkup(<TilePage tiles={m.tiles} label="x" />));
    expect(all).not.toMatch(/TUNDA|NEGOSIASI|BELI LB|Beli live bird/i);
  });
});
