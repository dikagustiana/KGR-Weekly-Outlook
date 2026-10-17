/**
 * Manajemen v5 (PRD v5 §6.1, flag v5_management): the LB simulation tile = Lampiran B.1 through @kgr/engine, the
 * decisions waiting and the loop status, K25 (no recommendation), K36 source labels, K37 "Lihat sebagai", and G13
 * (journey L: the loop status and the tasks move as the week's inputs arrive).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, instancesDue, needBasisOutputs, simulateLivebird, taskOf, type PlanOutput, type TaskRule } from "@kgr/engine";
import { augustV5 } from "../../test-support/pl-v5-fixture";
import { fixtureInput } from "../../test-support/minggu-ini-fixture";
import { mingguIniModel, type TileModel } from "../v4/minggu-ini";
import { TilePage } from "@/components/v4/TilePage";
import { decisionLines, loopLines, managementV5, simPrices, sourceLabel, type LoopFacts, type ManagementV5Input, type SimBasis } from "./management";
import { viewAsActive, viewAsItems } from "./view-as";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));

// Lampiran B.1 inputs (fixtures/costing-sim-2026-08-24, placeholder yields)
const inp = JSON.parse(readFileSync(join(__dirname, "../../../../fixtures/costing-sim-2026-08-24/inputs.json"), "utf8")) as {
  tariff_per_kg_lb: string; need: { kg_lb: string; demand: PlanOutput[]; by_products: { key: string; yield: string; priceRef: string | null }[] }; batch: { kg_lb: string; outputs: PlanOutput[]; extra_value: string };
};
const today = D(24600);
const prices = simPrices(today);
const sims = {
  need: simulateLivebird({ basis: "need", kgLb: inp.need.kg_lb, outputs: needBasisOutputs({ kgLb: inp.need.kg_lb, demand: inp.need.demand, byProducts: inp.need.by_products }), tariffPerKgLb: inp.tariff_per_kg_lb, prices }),
  batch: simulateLivebird({ basis: "batch", kgLb: inp.batch.kg_lb, outputs: inp.batch.outputs, extraValue: inp.batch.extra_value, tariffPerKgLb: inp.tariff_per_kg_lb, prices }),
};
const loop0: LoopFacts = {
  commitment: { locked: false, drafts: 2, deadline: "Jum 28/08 17.00", late: false }, planNext: { version: null },
  costing: { sementara: 2, final: 0, wpLate: [] }, lb: { cutDate: "2026-08-28", price: null }, freeStock: { kg: D("126434"), value: D("3233300000") },
};
const mgmt = (basis: SimBasis = "need", price = today, over: Partial<ManagementV5Input> = {}): ManagementV5Input => ({
  sim: {
    basis, available: ["need", "batch"], labels: { need: "Kebutuhan PO: 18.358 kg LB (3 kelas)", batch: "Batch rencana di input: 27.219 kg LB" }, price, todayPrice: today, prices,
    result: sims[basis], decided: null, cutDate: "2026-08-28", dataDate: "2026-08-27", href: (b, p) => `/minggu-ini/2026-08-24?${b === "batch" ? "sim=batch&" : ""}lb=${p.toFixed(0)}`,
  },
  decisions: decisionLines({
    lb: { cutDate: "2026-08-28", decided: false, today, breakevenNeed: sims.need.breakeven },
    batch: { kgLb: D(inp.batch.kg_lb), needKgLb: D(inp.need.kg_lb), surplusKg: D("6331.9"), downgrade: D("31957000"), threshold: D("25000000") },
    belowFloor: { count: 1, top: { key: "Trading|BLP|Frozen", kg: D("3229.2"), price: D("43086"), floor: D("47199"), totalBelow: D("13281700") } },
    cash: { min: D("-910300000"), date: "2026-08-28" },
  }),
  loop: loopLines(loop0),
  sources: {
    "c-outlook": sourceLabel({ what: "jurnal s.d. 26/08 + PO", role: "inventory_accounting", at: "2026-08-27 08.15".replace(".", ":"), late: false }),
    "sim-lb": sourceLabel({ what: "WP sementara", role: "cost_accounting", at: "2026-08-26 09:12", late: true }),
  },
  ...over,
});

describe("Manajemen v5 layout (mockup Main.dc.html from row 9)", () => {
  const { base: mb } = fixtureInput();
  const v5 = augustV5();
  const model = mingguIniModel({ ...mb, on: { ...mb.on, m4: true }, v5Pl: { first: "2026-08-01", cutOff: "2026-08-26", rows: v5.rows, fixed: v5.fixed, pl: "wk", href: () => "/minggu-ini/2026-08-24" }, v5Mgmt: mgmt() });
  const at = (id: string) => model.tiles.find((t) => t.id === id)!.pos;
  it("P&L in rows 5–8, simulation (7 columns) and decisions (5) from row 9 (5 rows, Q-v5-50), the v4 tiles below moved down; no overlap", () => {
    expect(at("t-laba-rugi")).toEqual({ x: 0, y: 4, w: 12, h: 4 });
    expect(at("sim-lb")).toEqual({ x: 0, y: 8, w: 7, h: 5 });
    expect(at("keputusan")).toEqual({ x: 7, y: 8, w: 5, h: 5 });
    expect(at("ch-harian")).toEqual({ x: 0, y: 13, w: 7, h: 4 });
    expect(at("ch-bridge")).toEqual({ x: 7, y: 13, w: 5, h: 4 });
    const cells = model.tiles.flatMap((t) => Array.from({ length: t.pos.w * t.pos.h }, (_, i) => `${t.pos.x + (i % t.pos.w)},${t.pos.y + Math.floor(i / t.pos.w)}`));
    expect(new Set(cells).size).toBe(cells.length);
  });
  it("flag off: no v5 tile and the v5_pl layout as before", () => {
    const off = mingguIniModel({ ...mb, on: { ...mb.on, m4: true }, v5Pl: { first: "2026-08-01", cutOff: "2026-08-26", rows: v5.rows, fixed: v5.fixed, pl: "wk", href: () => "/minggu-ini/2026-08-24" } });
    expect(off.tiles.some((t) => t.id === "sim-lb" || t.id === "keputusan")).toBe(false);
    expect(off.tiles.find((t) => t.id === "ch-harian")!.pos.y).toBe(8);
  });
});

describe("simulasi harga live bird (K25, Lampiran B.1)", () => {
  const tile = (b: SimBasis, p = today) => managementV5([], mgmt(b, p), { at: 8 }).find((t) => t.id === "sim-lb");
  it("need basis at 24.600: COGS 498,5; GP −11,7 (PRD −11,8, Q-v5-9); breakeven 23.961 (PRD 23.960); margin per kg LB −639", () => {
    const t = text(tile("need"));
    expect(t).toMatch(/COGS rencana 498,5 Rp jt · 18\.358 kg LB/);
    expect(t).toMatch(/GP rencana −11,7 Rp jt · −2,4% dari nilai jual/);
    expect(t).toMatch(/Breakeven live bird 23\.961 Rp\/kg LB/);
    expect(t).toMatch(/Margin per kg LB −639/);
    // COGS/kg karkas fresh: engine k 1,0241 → 37.590 (PRD 1,0242 → 37.592, Q-v5-9)
    expect(t).toMatch(/Karkas Fresh 12\.307 36\.705 37\.590 −885/);
    expect(t).toMatch(/Di harga 24\.600 setiap SKU menanggung COGS 102% dari harga list, jadi semua output rugi pada harga list\./);
  });
  it("another price changes the simulation (journey M): 22.000 → COGS 450,7, GP 36,0", () => {
    const t = text(tile("need", D(22000)));
    expect(t).toMatch(/COGS rencana 450,7/);
    expect(t).toMatch(/GP rencana 36,0/);
  });
  it("batch basis: 27.219 kg LB, at 24.600 COGS 739,0, GP −105,5 (engine −105,45; PRD 739,1 / −105,4, block 2 v1 −105,5); breakeven 20.726", () => {
    const t = text(tile("batch"));
    expect(t).toMatch(/COGS rencana 739,0 Rp jt · 27\.219 kg LB/);
    expect(t).toMatch(/GP rencana −105,5/);
    expect(t).toMatch(/Breakeven live bird 20\.726/);
  });
  it("price buttons 20.000–26.000 with today's price; basis buttons; links keep the choice", () => {
    expect(prices.map((p) => p.toFixed(0))).toEqual(["20000", "21000", "22000", "23000", "24000", "24600", "25000", "26000"]);
    const html = renderToStaticMarkup(<TilePage tiles={[tile("need")!]} label="x" />);
    expect(plain(html)).toMatch(/24\.600 · hari ini/);
    expect(html).toContain('href="/minggu-ini/2026-08-24?sim=batch&amp;lb=24600"');
    expect(html).toContain('href="/minggu-ini/2026-08-24?lb=22000"');
  });
  it("K25: the decider is named; no buy / wait / negotiate label anywhere on the v5 tiles", () => {
    const all = managementV5([], mgmt(), { at: 8 }).map(text).join(" ");
    expect(all).toMatch(/Harga dan volume live bird diputuskan Direktur Operasional\. Simulasi, bukan rekomendasi\./);
    expect(all).not.toMatch(/\b(beli|tunda|negosiasi)\b/i);
  });
});

describe("perlu keputusan dan status putaran", () => {
  const t = text(managementV5([], mgmt(), { at: 8 }).find((x) => x.id === "keputusan"));
  it("each decision with its owner (§6.1)", () => {
    expect(t).toMatch(/Harga live bird untuk potong Jum 28\/08\. Harga hari ini 24\.600; breakeven rencana kebutuhan 23\.961 Rp\/kg LB\. Direktur Operasional · hari ini/);
    expect(t).toMatch(/Batch rencana 27\.219 kg LB, 8\.861 kg di atas kebutuhan\. ± 6\.332 kg karkas jadi frozen, downgrade Rp 32,0 jt \(di atas batas 25,0 jt\)\. Direktur Operasional \+ PPIC · sebelum potong/);
    expect(t).toMatch(/BLP Frozen dijual di bawah biaya\. 3\.229 kg order di 43\.086 vs lantai 47\.199; selisih Rp −13,3 jt\. Kepala Sales · minggu ini/);
    expect(t).toMatch(/Pendanaan kas minggu ini\. Kas terendah Jum 28\/08 Rp −910,3 jt tanpa pendanaan baru\. Direksi/);
  });
  it("loop status as the data says", () => {
    expect(t).toMatch(/Komitmen Commercial minggu depan: belum dikunci · tenggat Jum 28\/08 17\.00/);
    expect(t).toMatch(/Rencana PPIC minggu depan: menunggu komitmen/);
    expect(t).toMatch(/Costing batch minggu ini: 2 sementara, 0 final/);
    expect(t).toMatch(/Stok bebas belum ke PO: 126\.434 kg · Rp 3\.233,3 jt/);
  });
  it("a decided price leaves the list", () => {
    expect(decisionLines({ lb: { cutDate: "2026-08-28", decided: true, today, breakevenNeed: null }, batch: null, belowFloor: { count: 0, top: null }, cash: null })).toEqual([]);
  });
});

describe("G13 — journey L: the loop moves as the inputs arrive", () => {
  const rules: TaskRule[] = [
    { kind: "commitment_lock", title: "Kunci komitmen", owner_role: "commercial_lead", due_rule: "week_start - 3 days 17:00", impact_text: "" },
    { kind: "plan_week", title: "Rencana mingguan", owner_role: "ppic", due_rule: "week_start + 0 days 10:00", impact_text: "" },
    { kind: "lb_price_decision", title: "Harga LB", owner_role: "operations_director", due_rule: "cut_date - 1 day 12:00", impact_text: "" },
    { kind: "costing_wp", title: "WP", owner_role: "cost_accounting", due_rule: "batch.date + 1 day 12:00", impact_text: "" },
  ];
  const x = { cutDates: ["2026-09-01"], batches: [{ ref: "B260901", date: "2026-09-01" }] };
  const due = ["2026-08-28", "2026-08-31", "2026-09-02"].flatMap((d) => instancesDue(rules, d, x));
  const status = (now: string, done: Record<string, boolean>) => due.map((i) => `${i.kind}:${taskOf(i, { done: done[i.kind] ? "passed" : null }, now).status}`);
  it("Friday 17.00 lock → Monday plan → LB decision → WP H+1: tasks pass and the status lines change", () => {
    // Friday 16.00, nothing yet
    expect(status("2026-08-28T16:00:00+07:00", {})).toEqual(["commitment_lock:open", "plan_week:open", "lb_price_decision:open", "costing_wp:open"]);
    // Friday 17.30: the lock is late; Monday 13.00 after the lock and the plan (the LB price for the 1st was due at 12.00)
    expect(status("2026-08-28T17:30:00+07:00", {})[0]).toBe("commitment_lock:late");
    expect(status("2026-08-31T13:00:00+07:00", { commitment_lock: true, plan_week: true })).toEqual(["commitment_lock:passed", "plan_week:passed", "lb_price_decision:late", "costing_wp:open"]);
    // Wednesday 13.00: price decided, WP of the 1st in
    expect(status("2026-09-02T13:00:00+07:00", { commitment_lock: true, plan_week: true, lb_price_decision: true, costing_wp: true }).every((s) => s.endsWith(":passed"))).toBe(true);
    const before = loopLines(loop0), after = loopLines({ ...loop0, commitment: { ...loop0.commitment, locked: true, drafts: 0 }, planNext: { version: 1 }, lb: { cutDate: "2026-09-01", price: D(24000) }, costing: { sementara: 3, final: 0, wpLate: [] } });
    expect(before.map((l) => l.value)).toEqual(["belum dikunci · tenggat Jum 28/08 17.00", "menunggu komitmen", "belum diputuskan", "2 sementara, 0 final", "126.434 kg · Rp 3.233,3 jt"]);
    expect(after.map((l) => l.value)).toEqual(["dikunci", "versi 1 tersimpan", "Rp 24.000 · Direktur Operasional", "3 sementara, 0 final", "126.434 kg · Rp 3.233,3 jt"]);
  });
});

describe("K36 source labels", () => {
  it("'WP sementara · Cost Accounting · 26 Agu 09.12'; late → named and in the negative colour", () => {
    expect(sourceLabel({ what: "WP sementara", role: "cost_accounting", at: "2026-08-26 09:12", late: false }).text).toBe("WP sementara · Cost Accounting · 26 Agu 09.12");
    const sim = managementV5([], mgmt(), { at: 8 }).find((t) => t.id === "sim-lb")!;
    expect(sim.source).toEqual({ text: "WP sementara · Cost Accounting · 26 Agu 09.12 · lewat tenggat", late: true });
    const html = renderToStaticMarkup(<TilePage tiles={[sim]} label="x" />);
    expect(html).toContain('<span class="src bad" data-tile-source="">Sumber: WP sementara · Cost Accounting · 26 Agu 09.12 · lewat tenggat</span>');
    // only the label is red, not the K25 sentence before it
    expect(html).toMatch(/Simulasi, bukan rekomendasi\. <span class="src bad"/);
  });
});

describe("K37 Lihat sebagai", () => {
  const on = { v4_design: { enabled: true }, m7_commercial: { enabled: true }, m3_planning: { enabled: true }, v5_input: { enabled: true }, v5_management: { enabled: true } };
  const ids = (r: Parameters<typeof viewAsItems>[0], s = on) => viewAsItems(r, s, { week: "2026-08-24" }).map((i) => i.id);
  it("management and the operations director: all four; Sales: Commercial and Input; PPIC: PPIC and Input; others none", () => {
    expect(ids("management")).toEqual(["manajemen", "commercial", "ppic", "input"]);
    expect(ids("operations_director")).toEqual(["manajemen", "commercial", "ppic", "input"]);
    expect(ids("sales")).toEqual(["commercial", "input"]);
    expect(ids("ppic")).toEqual(["ppic", "input"]);
    expect(ids("cost_accounting")).toEqual([]);
    expect(viewAsItems("management", on, { week: "2026-08-24" })[2].href).toBe("/w/2026-08-24/rencana");
  });
  it("flag off = nothing; a screen whose module is off is left out", () => {
    expect(ids("management", { ...on, v5_management: { enabled: false } })).toEqual([]);
    expect(ids("management", { ...on, v5_input: { enabled: false } })).toEqual(["manajemen", "commercial", "ppic"]);
    expect([viewAsActive("minggu-ini"), viewAsActive("/komersial"), viewAsActive("rencana"), viewAsActive("/input")]).toEqual(["manajemen", "commercial", "ppic", "input"]);
  });
});
