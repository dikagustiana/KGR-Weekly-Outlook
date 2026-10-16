/** PRD v5 v5/1 on the screens: K25 (no live-bird recommendation while v5_costing is on) and the cost status in Commercial. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeWeek } from "@kgr/engine";
import { loadFixtureWeek } from "@kgr/engine/fixtures";
import { OutlookBody } from "@/components/OutlookBody";
import { Headline } from "@/components/outlook/Headline";
import { TilePage } from "@/components/v4/TilePage";
import { rencanaFixture } from "../../test-support/rencana-fixture";
import { rencanaModel } from "../v4/rencana";
import { commercialView } from "../v3/commercial-view";
import { komersialModel } from "../v4/komersial";
import { lbSimulationText } from "./k25";

const r = computeWeek(loadFixtureWeek("2026-08-24"));
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const LABELS = /NEGOSIASI|TUNDA|REKOMENDASI RPA|Negosiasi|Tunda/;

describe("K25: simulation only, no recommendation (flag v5_costing)", () => {
  it("flag off: the ebe4ad8 outlook keeps its block 2 action (rule 6)", () => {
    expect(renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="preparer" />)).toMatch(/REKOMENDASI RPA/);
    expect(renderToStaticMarkup(<Headline r={r} week="2026-08-24" />)).toMatch(/NEGOSIASI/);
  });
  it("flag on: preparer, management and headline show the figures without a label", () => {
    for (const html of [
      renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="preparer" k25 />),
      renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" view="management" k25 />),
      renderToStaticMarkup(<OutlookBody r={r} week="2026-08-24" print k25 />),
      renderToStaticMarkup(<Headline r={r} week="2026-08-24" k25 />),
    ]) {
      expect(html).not.toMatch(LABELS);
      expect(html).not.toContain("data-reco");
      expect(plain(html)).toContain("Direktur Operasional");
    }
    expect(lbSimulationText(r.block2)).toBe("Harga LB hari ini Rp 24.600 · breakeven rencana Rp 20.726 · margin −3.874 Rp/kg LB");
  });
  it("Rencana: no 'Aksi' row in Ekonomi rencana", () => {
    const tile = (k25: boolean) => rencanaModel({ ...rencanaFixture(), k25 }).tiles.find((t) => t.id === "ekonomi");
    const text = (k25: boolean) => plain(renderToStaticMarkup(<TilePage tiles={[tile(k25)!]} label="x" />));
    expect(text(false)).toContain("Aksi");
    expect(text(true)).not.toContain("Aksi");
    expect(text(true)).not.toMatch(LABELS);
  });
});

describe("Commercial reads the costing cost and status from the mart (§4.1, §4.6)", () => {
  const base = { date: "2026-08-26", group_code: "By-product", form: "fresh", free_fresh_kg: "325", free_frozen_kg: "0", oldest_age_days: 1, hours_to_cutoff: 10,
    cost_per_kg_ma: "15299.0000", cost_per_kg_si: "3465.0000", price_floor: "3465", price_list: "3101", margin_per_kg_list: "-364", realized_price_7d: null, margin_per_kg_realized: null,
    holding_loss_per_day: "0", downgrade_risk_rp: "0", urgency: "jual_hari_ini", priority_score: "1", ordered_today_kg: "0" };
  const raw = [
    { ...base, key: "RPA|Ceker|Fresh", rank: 1, cost_per_kg: "3465.0000", cost_status: "sementara", cost_check: false },
    { ...base, key: "RPA|Kepala|Fresh", rank: 2, cost_per_kg: "13024.0000", cost_status: "final", cost_check: true },
  ];
  it("the view model carries cost, status and C54; sales_sees_cost = false hides the cost, not the status", () => {
    const lead = commercialView(raw, { role: "commercial_lead", salesSeesCost: false, assignedKeys: "all" });
    expect(lead.map((x) => [x.cost_per_kg, x.cost_status, x.cost_check])).toEqual([["3465.0000", "sementara", false], ["13024.0000", "final", true]]);
    const sales = commercialView(raw, { role: "sales", salesSeesCost: false, assignedKeys: "all" });
    expect(sales.map((x) => [x.cost_per_kg, x.cost_status])).toEqual([[null, "sementara"], [null, "final"]]);
    // v4 rows (flag off) have no status
    expect(commercialView([{ ...base, key: "X", rank: 1 }], { role: "commercial_lead", salesSeesCost: true, assignedKeys: "all" })[0].cost_status).toBeNull();
  });
  it("the ranking table shows 'Biaya Rp/kg' and 'Status biaya' as text, and names the C54 SKU", () => {
    const rows = commercialView(raw, { role: "commercial_lead", salesSeesCost: true, assignedKeys: "all" });
    const m = komersialModel({ today: "2026-08-27", date: "2026-08-26", role: "commercial_lead", rows, unassigned: false, spot: { enabled: false, cutOffTime: "14:00", now: "2026-08-27T09:00:00+07:00", canRecord: false }, approvals: [], controls: null });
    const t = m.tiles.find((x) => x.id === "t-ranking")!;
    const html = plain(renderToStaticMarkup(<TilePage tiles={[t]} label="x" />));
    expect(html).toContain("Status biaya");
    expect(html).toContain("Biaya Rp/kg");
    expect(html).not.toContain("MA Rp/kg");
    expect(html).toContain("final · periksa biaya");
    expect(t.note).toContain("Periksa biaya (C54): RPA|Kepala|Fresh");
  });
});
