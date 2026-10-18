/**
 * A8 (Q-v5.2-111): the accuracy tile of Outlook bulan said "Belum ada bulan yang FINAL." although a FINAL existed, when that month had no
 * locked V1 or V2 to compare it with. Text only: with a version the tile and its numbers are as before. vitest, in-memory database.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { outlookBulanFixture } from "../../test-support/month-fixture";
import { memSb, type MemRow } from "../../test-support/mem-sb";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "./minggu-ini";
import { outlookBulanModel } from "./outlook-bulan";

vi.mock("server-only", () => ({}));
const { loadOutlookBulan } = await import("./outlook-bulan-data");

const text = (t: TileModel | undefined) => renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const settings = { m6_cash: { enabled: false, roles: null } };
const final = (over: MemRow = {}): MemRow => ({ id: "v-final", month_outlook_id: "m1", version: "FINAL", revenue: "8361800000", gp: null, nibt: null, locked_at: "2026-09-02T03:00:00Z", snapshot: null, month_outlook: { month: "2026-08-01" }, ...over });
const v1: MemRow = { id: "v-1", month_outlook_id: "m1", version: "V1", revenue: "7712400000", gp: null, nibt: null, locked_at: "2026-08-20T03:00:00Z", snapshot: null };

/** The page's loader on this in-memory database, and the tile of the fixture month with the loader's accuracy and its reason. */
async function tileOf(versions: MemRow[]) {
  const sb = memSb({ month_outlook: [{ id: "m1", month: "2026-08-01" }], month_outlook_version: versions });
  const { input } = await loadOutlookBulan(sb as never, { first: "2026-08-01", today: "2026-09-03", role: "finance", settings, selected: null });
  const m = outlookBulanModel({ ...outlookBulanFixture(), accuracy: input.accuracy, accuracyGap: input.accuracyGap });
  return { input, tile: m.tiles.find((t) => t.id === "akurasi"), text: text(m.tiles.find((t) => t.id === "akurasi")) };
}

describe("accuracy tile: a FINAL that cannot be compared is not 'no FINAL'", () => {
  it("no FINAL at all: 'Belum ada bulan yang FINAL.' (unchanged)", async () => {
    const r = await tileOf([v1]);
    expect(r.input.accuracy).toBeNull();
    expect(r.input.accuracyGap).toBeNull();
    expect(r.text).toContain("Belum ada bulan yang FINAL.");
  });
  it("FINAL without any V1 or V2: says the FINAL exists and what is missing, and no longer says there is no FINAL", async () => {
    const r = await tileOf([final()]);
    expect(r.input.accuracy).toBeNull();
    expect(r.input.accuracyGap).toEqual({ month: "2026-08-01", reason: "no_versions" });
    expect(r.text).toContain("FINAL Agustus 2026 sudah ada, tetapi belum ada versi V1 atau V2 yang terkunci untuk dibandingkan.");
    expect(r.text).not.toContain("Belum ada bulan yang FINAL");
  });
  it("a FINAL without revenue has nothing to compare either, and says that instead", async () => {
    const r = await tileOf([final({ revenue: null }), v1]);
    expect(r.input.accuracy).toBeNull();
    expect(r.input.accuracyGap).toEqual({ month: "2026-08-01", reason: "no_revenue" });
    expect(r.text).toContain("FINAL Agustus 2026 sudah ada, tetapi belum punya angka revenue untuk dibandingkan.");
  });
  it("FINAL with a V1: the tile and its numbers are as before (V1 against FINAL), no 'belum ada versi' sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // the C59 row of this stand-in month has no snapshot rows: its own error line, not this tile's
    const r = await tileOf([final(), v1]);
    vi.restoreAllMocks();
    expect(r.input.accuracyGap).toBeNull();
    expect(r.input.accuracy).toMatchObject({ month: "2026-08-01", version: "V1" });
    expect(r.text).toContain("Agustus 2026, V1 terhadap FINAL");
    expect(r.text).toContain("7.712,4");
    expect(r.text).toContain("8.361,8");
    expect(r.text).toContain("649,4 (8,4%)");
    expect(r.text).not.toContain("belum ada versi V1 atau V2");
  });
});
