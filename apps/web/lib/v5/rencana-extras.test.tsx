/**
 * PRD v5.2-A R53 (A-UI-12): the approval of a downgrade above the limit can be given on the v5 Rencana screen. Screen test per
 * role, rendering the tiles and the forms under them as the page does: ppic → the reason form (and the status as text),
 * finance / admin → the approve form, sales → nothing. The form belongs to the tile "t-approval", which exists only for a plan
 * that needs the approval (before the fix the form was placed on a tile id the model never had, so it never rendered).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ppicV5Fixture } from "../../test-support/ppic-v5-fixture";
import { ppicV5Model, type PpicV5Input } from "./ppic";
import { TilePage } from "@/components/v4/TilePage";
import type { Role } from "../roles";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/modules", () => ({ requireModuleAction: async () => ({}), moduleEnabled: async () => true }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => ({}) }));
const { rencanaV5Extras } = await import("@/app/w/[week]/rencana/extras");

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const page = (role: Role, over: Partial<PpicV5Input> = {}) => {
  const input: PpicV5Input = { ...ppicV5Fixture(), approval: { planId: "P2", version: 2, needs: true, approvedBy: null }, ...over };
  const extras = rencanaV5Extras({ role, week: "2026-08-24", latest: input.approval ? { id: input.approval.planId, version: input.approval.version } : null, input });
  return renderToStaticMarkup(<TilePage tiles={ppicV5Model(input).tiles} label="x" extras={extras} />);
};

describe("t-approval: the tile exists for a plan that needs approval", () => {
  it("a plan above the limit shows its status as text to every role that opens the page", () => {
    for (const role of ["ppic", "finance", "admin", "management"] as const) expect(plain(page(role))).toContain("Rencana v2 menunggu persetujuan Finance: downgrade di atas batas approval.");
  });
  it("no tile, no form for a plan that needs none (or no plan yet)", () => {
    for (const over of [{ approval: { planId: "P2", version: 2, needs: false, approvedBy: null } }, { approval: null }] as Partial<PpicV5Input>[]) {
      const h = page("finance", over);
      expect(plain(h)).not.toContain("Persetujuan downgrade rencana");
      expect(h).not.toContain("Setujui rencana");
    }
  });
  it("approved: the text says by whom and the form is gone", () => {
    const h = page("finance", { approval: { planId: "P2", version: 2, needs: true, approvedBy: "fin@x.test" } });
    expect(plain(h)).toContain("Rencana v2 disetujui oleh fin@x.test.");
    expect(h).not.toContain("Setujui rencana");
  });
});

describe("forms per role (R53)", () => {
  it("ppic: the C58 reason form and save / copy; no approve form", () => {
    const h = page("ppic");
    expect(h).toContain("Simpan alasan C58");
    expect(h).toContain("Salin ke batch rencana");
    expect(h).toContain("Simpan rencana versi");
    expect(h).not.toContain("Setujui rencana");
  });
  it("finance: the approve form with the plan id; no planning forms", () => {
    const h = page("finance");
    expect(h).toContain("Setujui rencana v2");
    expect(h).toContain('name="plan_id" value="P2"');
    expect(h).not.toContain("Simpan alasan C58");
    expect(h).not.toContain("Salin ke batch rencana");
  });
  it("admin: both", () => {
    const h = page("admin");
    expect(h).toContain("Setujui rencana v2");
    expect(h).toContain("Simpan alasan C58");
  });
  it("sales: no form at all", () => {
    expect(page("sales")).not.toContain("<form");
    expect(Object.keys(rencanaV5Extras({ role: "sales", week: "2026-08-24", latest: { id: "P2", version: 2 }, input: ppicV5Fixture() }))).toEqual([]);
  });
});
