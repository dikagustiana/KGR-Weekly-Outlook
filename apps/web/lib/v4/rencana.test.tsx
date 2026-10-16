/** Page "Rencana" (PRD v4 §6.4) on fixtures/plan-2026-08-24. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { rencanaFixture } from "../../test-support/rencana-fixture";
import { rencanaModel, sentenceCase } from "./rencana";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "./minggu-ini";

const text = (t: TileModel | undefined) => renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Rencana §6.4 on the example week (yield placeholder, STD 2,0 kg)", () => {
  const m = rencanaModel(rencanaFixture());
  const tile = (id: string) => m.tiles.find((t) => t.id === id);
  it("tiles of the mockup at their coordinates, plus actual vs plan and the link to step 4", () => {
    const spec: Record<string, [number, number, number, number]> = { stepper: [0, 0, 12, 1], "t-demand": [0, 1, 8, 5], "ch-ekor": [8, 1, 4, 5], "t-rencana": [0, 6, 8, 4], ekonomi: [8, 6, 4, 4], "t-harian": [0, 10, 12, 4], "t-varian": [0, 14, 12, 4], "link-alokasi": [0, 18, 12, 1] };
    for (const [id, p] of Object.entries(spec)) expect(tile(id)?.pos, id).toEqual({ x: p[0], y: p[1], w: p[2], h: p[3] });
  });
  it("step 1: Karkas binding 9.179 heads; by-products do not decide heads and show the shortfall", () => {
    const v = text(tile("t-demand"));
    expect(v).toContain("Karkas (binding)");
    expect(v).toContain("9.179");
    expect(v).toContain("1,4292");
    expect(v).toContain("tidak menentukan ekor");
    expect(v).toContain("kurangi order");
    expect(tile("t-demand")!.note).toContain("tulis alasan");
  });
  it("by-products drawn in grey with their would-be heads, the main product in blue", () => {
    const pts = (tile("ch-ekor")!.content as { points: { key: string; barTone?: string; bar: number | null }[] }).points;
    expect(pts.find((p) => p.key === "Karkas")!.barTone).toBe("s1");
    expect(pts.find((p) => p.key === "Usus")!.barTone).toBe("s3");
    expect(pts.find((p) => p.key === "Karkas")!.bar).toBe(9179);
  });
  it("C41 without a reason locks steps 2–4; save says why; copy also needs C42 and C47", () => {
    const st = (tile("stepper")!.content as { steps: { n: number; locked?: string | null; status: string }[] }).steps;
    expect(st.map((s) => s.locked ?? null)).toEqual([null, "selesaikan langkah 1 dulu", "selesaikan langkah 2 dulu", "selesaikan langkah 3 dulu"]);
    expect(st[0].status).toContain("by-product kurang");
    expect(m.actions.find((a) => a.action === "save")!.disabledReason).toContain("C41");
    expect(m.actions.find((a) => a.action === "copy")!.disabledReason).toBe("simpan rencana dulu");
    expect(m.actions.some((a) => a.action === "reason")).toBe(true);
  });
  it("with the C41 reason step 2 opens and save is enabled; step 3 still waits for C42 (placeholder yields)", () => {
    const r = rencanaModel(rencanaFixture({ reasons: ["C41"] }));
    expect(r.actions.find((a) => a.action === "save")!.disabledReason).toBeNull();
    const st = (r.tiles.find((t) => t.id === "stepper")!.content as { steps: { locked?: string | null }[] }).steps;
    expect(st[1].locked ?? null).toBeNull();
    expect(st[2].locked).toBe("selesaikan langkah 2 dulu");
    expect(r.tiles.find((t) => t.id === "t-demand")!.note).toContain("Alasan C41");
  });
  it("plan and economics: 9.179 heads, 18.358 kg LB, yield sementara; action in sentence case", () => {
    const v = text(tile("t-rencana"));
    expect(v).toContain("9.179");
    expect(v).toContain("18.358");
    expect(v).toContain("sementara (placeholder)");
    const e = text(tile("ekonomi"));
    expect(e).toContain("24.600");
    expect(e).toMatch(/Negosiasi ≤ Rp \d/);
    expect(e).toContain("\u22123.874");
    expect(sentenceCase("POTONG 2.000 kg: x")).toBe("Potong 2.000 kg");
  });
  it("daily plan rows without capacity read 'belum diisi'; no actual yet", () => {
    expect(text(tile("t-harian"))).toContain("belum diisi");
    expect(text(tile("t-varian"))).toContain("tidak ada data untuk periode ini");
  });
});
