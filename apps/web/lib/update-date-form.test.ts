/**
 * PRD v5.2 K69 (B2 A-REL-1, Q-v5.2-12): the update date is set by hand only by Admin and Finance and only while the week
 * is open (the database refuses everything else since v52_security). The form follows the database: the other roles do
 * not get the area, an unchanged date is not sent, a released or closed week answers with the K69 message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSb, type FakeSb } from "./fake-sb";
import { can } from "./roles";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect ${decodeURIComponent(url)}`); } }));
let sb: FakeSb = fakeSb();
let role = "finance";
vi.mock("./supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("./session", () => ({ requireViewer: async () => ({ email: "x@kgr.test", role }) }));

const { saveParameters } = await import("@/app/w/[week]/input/parameter/actions");

const form = (update: string) => {
  const f = new FormData();
  f.set("week", "2026-08-24");
  f.set("update_date", update);
  return f;
};
const weekRow = (status: string) => ({ id: "w35", week_start: "2026-08-24", status, update_date: "2026-08-27" });
const weekUpdates = () => sb.args.filter((a) => a.call === "week:update").map((a) => a.args[0]);

afterEach(() => { sb = fakeSb(); role = "finance"; });

describe("K69: who may set the update date by hand", () => {
  it("only Admin and Finance have the area", () => {
    for (const r of ["admin", "finance"]) expect(can(r as never, "update_date")).toBe(true);
    for (const r of ["inventory_accounting", "cost_accounting", "ppic", "sales", "purchasing", "commercial_lead", "operations_director", "management"]) {
      expect(can(r as never, "update_date")).toBe(false);
    }
  });
});

describe("K69: saveParameters and the update date", () => {
  it("open week, Finance moves the date: one week update with the new date", async () => {
    sb = fakeSb({ rows: { week: [weekRow("open")] } });
    await expect(saveParameters(form("2026-08-28"))).rejects.toThrow("redirect /w/2026-08-24/input/parameter?ok=Parameter disimpan");
    expect(weekUpdates()).toEqual([{ update_date: "2026-08-28" }]);
  });
  it("released week: refused with the K69 message, nothing written", async () => {
    sb = fakeSb({ rows: { week: [weekRow("released")] } });
    await expect(saveParameters(form("2026-08-28"))).rejects.toThrow("minggu berstatus released (K69)");
    expect(weekUpdates()).toEqual([]);
  });
  it("unchanged date on a released week (the form re-posts it): not sent, no error", async () => {
    sb = fakeSb({ rows: { week: [weekRow("released")] } });
    await expect(saveParameters(form("2026-08-27"))).rejects.toThrow("?ok=Parameter disimpan");
    expect(weekUpdates()).toEqual([]);
  });
  it("PPIC posting a date: ignored (no area), nothing written", async () => {
    role = "ppic";
    sb = fakeSb({ rows: { week: [weekRow("open")] } });
    await expect(saveParameters(form("2026-08-28"))).rejects.toThrow("?ok=Parameter disimpan");
    expect(weekUpdates()).toEqual([]);
  });
  it("a blank date is refused", async () => {
    sb = fakeSb({ rows: { week: [weekRow("open")] } });
    await expect(saveParameters(form(""))).rejects.toThrow("Tanggal update wajib diisi");
    expect(weekUpdates()).toEqual([]);
  });
});
