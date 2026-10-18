/**
 * PRD v5.1 T11 / R28 (K53, K54) and PRD v5.2-A R72: the 10 flag combinations (v5.1 §5.4 (1)–(8), v5.2-A §5.4 (9)–(10)) × the 10 roles.
 * K25 comes from one helper (k25On) for the Outlook, the print view, the Rencana v4 economics and the PDF; the Commercial mart gives
 * the v5 cost only to the roles v5_costing lists; the loop status says "modul belum aktif" for a module that is off.
 * The expectations are the WRITTEN tables below (K25 on/off and v5 cost yes/no per combination and role), not a re-computation with
 * the helpers under test (R72: the earlier version compared isModuleOn with itself). The same combinations open the real pages on
 * PostgREST in tests/e2e/matrix.cjs against tests/e2e/matrix-expect.json (job CI `e2e`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
  { n: 9, name: "v4_release hidup + v5_input mati + v5_costing hidup", s: on(["v5_costing"]) },
  { n: 10, name: "v5_* roles [admin] + v4_release hidup", s: on(ALL_V5, ["admin"]) },
];
const ROLES: Role[] = ["admin", "finance", "commercial_lead", "sales", "ppic", "operations_director", "cost_accounting", "inventory_accounting", "purchasing", "management"];
// WRITTEN expectations, one digit per role in the order of ROLES (1 = yes). K54: K25 (the LB decision is a simulation) is on for a role
// when v5_costing or v5_management is on for it; K53: the v5 cost columns reach a role when v5_costing is on for it.
const ALL = "1111111111", NONE = "0000000000", ADMIN_ONLY = "1000000000";
const WRITTEN_K25: Record<number, string> = { 1: NONE, 2: ALL, 3: ALL, 4: ALL, 5: ALL, 6: ALL, 7: ALL, 8: ADMIN_ONLY, 9: ALL, 10: ADMIN_ONLY };
const WRITTEN_V5_COST: Record<number, string> = { 1: NONE, 2: ALL, 3: ALL, 4: ALL, 5: ALL, 6: ALL, 7: ALL, 8: ADMIN_ONLY, 9: ALL, 10: ADMIN_ONLY };
const written = (table: Record<number, string>, n: number, role: Role) => table[n][ROLES.indexOf(role)] === "1";
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
    const k25 = written(WRITTEN_K25, c.n, role);
    it(`(${c.n}) ${c.name} · ${role}: K25 ${k25 ? "on — simulation only" : "off — the v1 recommendation"}`, () => {
      expect(k25On(c.s, role)).toBe(k25); // the helper agrees with the written table
      const html = blockTwo(k25);
      if (k25) for (const h of html) expect(h).not.toMatch(LABELS);
      else expect(html[2]).toMatch(/NEGOSIASI/);
    });
  }
  it("K25 per combination (written table, digits = roles in the order admin, finance, commercial_lead, sales, ppic, operations_director, cost_accounting, inventory_accounting, purchasing, management)", () => {
    expect(COMBOS.map((c) => ROLES.map((role) => (k25On(c.s, role) ? 1 : 0)).join(""))).toEqual(COMBOS.map((c) => WRITTEN_K25[c.n]));
    expect(COMBOS.map((c) => WRITTEN_K25[c.n])).toEqual([NONE, ALL, ALL, ALL, ALL, ALL, ALL, ADMIN_ONLY, ALL, ADMIN_ONLY]);
  });
  it("tests/e2e/matrix-expect.json lists the same 10 combinations and 10 roles as this file", () => {
    const j = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../tests/e2e/matrix-expect.json"), "utf8")) as { roles: string[]; combos: { n: number }[]; expect: Record<string, Record<string, unknown>> };
    expect(j.roles).toEqual(ROLES);
    expect(j.combos.map((c) => c.n)).toEqual(COMBOS.map((c) => c.n));
    for (const c of COMBOS) expect(Object.keys(j.expect[String(c.n)]).sort()).toEqual([...ROLES].sort());
  });
});

describe("K53: the Commercial mart gives the v5 cost to the roles of v5_costing only", () => {
  const row = { date: "2026-08-26", key: "RPA|Karkas|Fresh", rank: 1, cost_per_kg: "34196.0000", cost_status: "estimasi", cost_check: false, cost_per_kg_ma: "33000.0000" };
  for (const c of COMBOS) for (const role of ROLES) {
    const v5 = written(WRITTEN_V5_COST, c.n, role);
    it(`(${c.n}) ${c.name} · ${role}: ${v5 ? "v5 cost" : "no v5 cost"}`, async () => {
      expect(isModuleOn(c.s.v5_costing, role)).toBe(v5); // the flag helper agrees with the written table
      const sales = role === "sales";
      const sb = fakeSb({ rows: { commercial_daily: [row], commercial_daily_sales: [{ ...row, cost_per_kg: null, cost_status: null, cost_check: null }], commercial_daily_sales_v5: [row] } });
      const m = await commercialMart(sb as never, "2026-08-27", sales, v5);
      const table = sales ? (v5 ? "commercial_daily_sales_v5" : "commercial_daily_sales") : "commercial_daily";
      expect(sb.calls.filter((x) => x.endsWith(":select")).every((x) => x.startsWith(`${table}:`))).toBe(true);
      expect(m.rows[0].cost_per_kg).toBe(v5 ? "34196.0000" : null);
      expect(m.rows[0].cost_status).toBe(v5 ? "estimasi" : null);
    });
  }
  it("(8) and (10) sales: the plain Sales view, no cost column of v5", async () => {
    for (const n of [8, 10]) {
      const s = COMBOS.find((c) => c.n === n)!.s;
      expect(isModuleOn(s.v5_costing, "sales")).toBe(false);
      const sb = fakeSb({ rows: { commercial_daily_sales: [{ date: "2026-08-26", key: "RPA|Karkas|Fresh", rank: 1 }] } });
      const m = await commercialMart(sb as never, "2026-08-27", true, false);
      expect(sb.calls).not.toContain("commercial_daily_sales_v5:select");
      expect([m.rows[0].cost_per_kg, m.rows[0].cost_status, m.rows[0].cost_check]).toEqual([null, null, null]);
    }
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
