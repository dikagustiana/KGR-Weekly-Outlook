/**
 * PRD v5.1 T11 / R28 (K53, K54): the 8 flag combinations of §5.4 × the roles admin, sales, management. K25 comes from
 * one helper (k25On) for the Outlook, the print view, the Rencana v4 economics and the PDF; the Commercial mart gives
 * the v5 cost only to the roles v5_costing lists; the loop status says "modul belum aktif" for a module that is off.
 * The pages themselves are opened per combination on PostgREST (docs/v5.1/journey-K-M-N-O.md, flag matrix).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, computeWeek } from "@kgr/engine";
import { loadFixtureWeek } from "@kgr/engine/fixtures";
import { OutlookBody } from "@/components/OutlookBody";
import { Headline } from "@/components/outlook/Headline";
import { TilePage } from "@/components/v4/TilePage";
import { rencanaFixture } from "../../test-support/rencana-fixture";
import { rencanaModel } from "../v4/rencana";
import { isModuleOn, k25On, type ModuleKey, type ModuleSettings } from "../modules-core";
import type { Role } from "../roles";
import { fakeSb } from "../fake-sb";
import { loopLines } from "./management";

vi.mock("server-only", () => ({}));
const { commercialMart } = await import("../v3/commercial");

const V4: ModuleKey[] = ["m1_costing", "m2_ledger", "m3_planning", "m4_monthly", "m5_drivers", "m6_cash", "m7_commercial", "m7_approval", "v4_design", "v4_release"];
const on = (keys: ModuleKey[], roles: Role[] | null = null): ModuleSettings => Object.fromEntries([...V4, ...keys].map((k) => [k, { enabled: true, roles: V4.includes(k) ? null : roles }]));
const ALL_V5: ModuleKey[] = ["v5_costing", "v5_pl", "v5_ppic_class", "v5_commercial", "v5_input", "v5_management"];
const COMBOS: { n: number; name: string; s: ModuleSettings }[] = [
  { n: 1, name: "v5 semua mati", s: on([]) },
  { n: 2, name: "v5_costing", s: on(["v5_costing"]) },
  { n: 3, name: "v5_costing + v5_pl", s: on(["v5_costing", "v5_pl"]) },
  { n: 4, name: "+ v5_ppic_class", s: on(["v5_costing", "v5_pl", "v5_ppic_class"]) },
  { n: 5, name: "+ v5_commercial", s: on(["v5_costing", "v5_pl", "v5_ppic_class", "v5_commercial"]) },
  { n: 6, name: "+ v5_input", s: on(["v5_costing", "v5_pl", "v5_ppic_class", "v5_commercial", "v5_input"]) },
  { n: 7, name: "semua hidup", s: on(ALL_V5) },
  { n: 8, name: "semua hidup, roles [admin]", s: on(ALL_V5, ["admin"]) },
];
const ROLES: Role[] = ["admin", "sales", "management"];
const r = computeWeek(loadFixtureWeek("2026-08-24"));
// the v1 recommendation words (block 2) that K25 removes
const LABELS = /NEGOSIASI|TUNDA|REKOMENDASI RPA|Negosiasi|Tunda|\bBELI\b/;
const blockTwo = (k25: boolean) => [
  renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="preparer" k25={k25} />).replace(/<section[^>]*id="keputusan-trading"[\s\S]*?<\/section>/g, ""),
  renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="management" k25={k25} />).replace(/<section[^>]*id="keputusan-trading"[\s\S]*?<\/section>/g, ""),
  renderToStaticMarkup(<Headline r={r} week="2026-08-24" k25={k25} />),
  renderToStaticMarkup(<TilePage tiles={rencanaModel({ ...rencanaFixture(), k25 }).tiles.filter((t) => t.id === "ekonomi")} label="x" />),
];

describe("K54: one K25 for every screen of the live-bird decision", () => {
  for (const c of COMBOS) for (const role of ROLES) {
    const k25 = k25On(c.s, role);
    it(`(${c.n}) ${c.name} · ${role}: K25 ${k25 ? "on — simulation only" : "off — the v1 recommendation"}`, () => {
      expect(k25).toBe(isModuleOn(c.s.v5_costing, role) || isModuleOn(c.s.v5_management, role));
      const html = blockTwo(k25);
      if (k25) for (const h of html) expect(h).not.toMatch(LABELS);
      else expect(html[2]).toMatch(/NEGOSIASI/);
    });
  }
  it("K25 per combination: on from (2); in (8) only for admin", () => {
    expect(COMBOS.map((c) => ROLES.map((role) => (k25On(c.s, role) ? 1 : 0)).join(""))).toEqual(["000", "111", "111", "111", "111", "111", "111", "100"]);
  });
});

describe("K53: the Commercial mart gives the v5 cost to the roles of v5_costing only", () => {
  const row = { date: "2026-08-26", key: "RPA|Karkas|Fresh", rank: 1, cost_per_kg: "34196.0000", cost_status: "estimasi", cost_check: false, cost_per_kg_ma: "33000.0000" };
  for (const c of COMBOS) for (const role of ROLES) {
    const v5 = isModuleOn(c.s.v5_costing, role);
    it(`(${c.n}) ${c.name} · ${role}: ${v5 ? "v5 cost" : "no v5 cost"}`, async () => {
      const sales = role === "sales";
      const sb = fakeSb({ rows: { commercial_daily: [row], commercial_daily_sales: [{ ...row, cost_per_kg: null, cost_status: null, cost_check: null }], commercial_daily_sales_v5: [row] } });
      const m = await commercialMart(sb as never, "2026-08-27", sales, v5);
      const table = sales ? (v5 ? "commercial_daily_sales_v5" : "commercial_daily_sales") : "commercial_daily";
      expect(sb.calls.filter((x) => x.endsWith(":select")).every((x) => x.startsWith(`${table}:`))).toBe(true);
      expect(m.rows[0].cost_per_kg).toBe(v5 ? "34196.0000" : null);
      expect(m.rows[0].cost_status).toBe(v5 ? "estimasi" : null);
    });
  }
  it("(8) sales: the plain Sales view, no cost column of v5", async () => {
    const c8 = COMBOS[7].s;
    expect(isModuleOn(c8.v5_costing, "sales")).toBe(false);
    const sb = fakeSb({ rows: { commercial_daily_sales: [{ date: "2026-08-26", key: "RPA|Karkas|Fresh", rank: 1 }] } });
    const m = await commercialMart(sb as never, "2026-08-27", true, isModuleOn(c8.v5_costing, "sales"));
    expect(sb.calls).not.toContain("commercial_daily_sales_v5:select");
    expect([m.rows[0].cost_per_kg, m.rows[0].cost_status, m.rows[0].cost_check]).toEqual([null, null, null]);
  });
});

describe("Status putaran: a module that is off says so (R28)", () => {
  const facts = {
    commitment: { locked: false, drafts: 0, deadline: "Jum 28/08 17.00", late: true }, planNext: { version: null }, costing: { sementara: 2, final: 0, wpLate: ["B260826"] },
    lb: { cutDate: "2026-08-28", price: null }, freeStock: { kg: D(1000), value: D(30000000) },
  };
  for (const c of COMBOS) {
    it(`(${c.n}) ${c.name}`, () => {
      const off = { commitment: !c.s.v5_commercial?.enabled, planNext: !c.s.v5_ppic_class?.enabled, costing: !c.s.v5_costing?.enabled, freeStock: !c.s.m7_commercial?.enabled };
      const lines = loopLines({ ...facts, off });
      const commit = lines.find((l) => l.label.startsWith("Komitmen"))!;
      expect(commit).toEqual(off.commitment ? { label: commit.label, value: "modul belum aktif", late: false } : { label: commit.label, value: "belum dikunci · tenggat Jum 28/08 17.00", late: true });
      expect(lines.find((l) => l.label.startsWith("Costing"))!.value).toBe(off.costing ? "modul belum aktif" : "2 sementara, 0 final · WP B260826 terlambat");
    });
  }
});
