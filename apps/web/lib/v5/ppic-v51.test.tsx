/**
 * PRD v5.1 R29 (C57 holds "Salin ke batch rencana" without exception, C58 opens with a written reason) and R30 (STD is
 * not a weight class in the PPIC headline) on fixtures/plan-2026-08-24 v5.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, c57, type ControlV3 } from "@kgr/engine";
import { ppicV5Fixture } from "../../test-support/ppic-v5-fixture";
import { classWords, ppicV5Model } from "./ppic";
import { TilePage } from "@/components/v4/TilePage";

vi.mock("server-only", () => ({}));
const { copyBlockersOf } = await import("./ppic-data");

const ctl = (code: string, status: ControlV3["status"]) => ({ code, status, action: "" });
const noDecision = c57({ cutDates: ["2026-08-28"], decisions: [] });
const decided = c57({ cutDates: ["2026-08-28"], decisions: [{ date: "2026-08-28" }] });

describe("copy to the planned batches (R29)", () => {
  it("no LB price decision for 28/08: C57 holds, and a written reason does not open it", () => {
    expect(noDecision.status).toBe("BELUM DIISI");
    expect(copyBlockersOf([ctl("C58", "LULUS")], noDecision, [])).toEqual(["C57 BELUM DIISI"]);
    expect(copyBlockersOf([ctl("C58", "LULUS")], noDecision, [{ code: "C57" }])).toEqual(["C57 BELUM DIISI"]);
  });
  it("supply short of the class need (C58 PERIKSA): held until PPIC writes a reason, then open", () => {
    expect(copyBlockersOf([ctl("C58", "PERIKSA")], decided, [])).toEqual(["C58 PERIKSA"]);
    expect(copyBlockersOf([ctl("C58", "PERIKSA")], decided, [{ code: "C58" }])).toEqual([]);
  });
  it("the v4 rules stay (C42, C45, C46, C47); v5_costing off = no C57", () => {
    expect(copyBlockersOf([ctl("C42", "PERIKSA"), ctl("C58", "LULUS")], null, [{ code: "C42" }])).toEqual(["C42 PERIKSA"]);
    expect(copyBlockersOf([ctl("C58", "LULUS")], null, [])).toEqual([]);
  });
  it("the daily plan tile names what holds the copy", () => {
    const m = ppicV5Model({ ...ppicV5Fixture(), copyBlockers: ["C57 BELUM DIISI"] });
    const html = renderToStaticMarkup(<TilePage tiles={m.tiles.filter((t) => t.id === "t-harian")} label="x" />);
    expect(html).toContain("Belum bisa salin ke batch rencana: C57 BELUM DIISI");
  });
});

describe("STD is not a weight class (R30)", () => {
  it("headline: three classes as before; none filled → 'dalam kelas STD (kelas berat belum diisi PPIC)'", () => {
    expect(classWords(3)).toBe("dalam 3 kelas berat");
    expect(classWords(0)).toBe("dalam kelas STD (kelas berat belum diisi PPIC)");
    const f = ppicV5Fixture();
    const std = { ...f, demand: { ...f.demand, byClass: [{ weight_class: "STD", kg_lb: D("18358"), heads: D("9871"), net_kg: D("13118") }] as typeof f.demand.byClass } };
    const html = renderToStaticMarkup(<TilePage tiles={ppicV5Model(std).tiles.filter((t) => t.id === "headline")} label="x" />);
    expect(html).toContain("butuh 18.358 kg LB dalam kelas STD (kelas berat belum diisi PPIC)");
  });
});
