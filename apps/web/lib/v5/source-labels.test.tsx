/**
 * PRD v5.2 R76 (A-UI-14, F26): the source labels (K36) are read for the period of the screen — the week opened — and per
 * source actually behind the number. A week of August opened in October, with uploads of October in the database, is
 * labelled with August. The simulation is PO + yield + harga LB (never WP); cost is WP / faktur; "late" comes from the
 * input_task rows of that source inside the period. Fake database that applies the filters (lib/mem-sb.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { memSb } from "../mem-sb";

vi.mock("server-only", () => ({}));
vi.mock("../v3/planning", () => ({ loadPlanning: async () => ({}) }));
vi.mock("../v3/stale", () => ({ stockMartControl: async () => ({ code: "C45", status: "LULUS" }) }));
vi.mock("../v3/commercial", () => ({ commercialMart: async () => ({ date: null, rows: [] }) }));
vi.mock("./ppic-data", () => ({ loadPpicV5: async () => ({ sim: null, demand: { byClass: [] }, batch: null }) }));

const { loadManagementV5, loadSources, periodOf, sourcesFor, sourcesOf } = await import("./management-data");
const { managementV5 } = await import("./management");
const { TilePage } = await import("@/components/v4/TilePage");
const { clock } = await import("../clock");

const AUG = periodOf("2026-08-24", "2026-08-30", "2026-08-27");
const OCT = periodOf("2026-10-12", "2026-10-18", "2026-10-15");
const WEEK_AUG = { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", tb_opening_date: "2026-08-23", status: "open" } as never;
const r = { block2: { lbPriceToday: "24600" } } as never;

/** Uploads of August (the week opened) and of October (made on 15 Oct 23.20 WIB = 16:20Z), in every table behind a label. */
const rows = {
  week: [{ update_date: "2026-08-27" }],
  gl_line: [{ date: "2026-08-26", created_at: "2026-08-27T01:15:00Z", deleted_at: null }, { date: "2026-10-14", created_at: "2026-10-15T16:20:00Z", deleted_at: null }],
  stock_card_snapshot: [{ date: "2026-08-26", created_at: "2026-08-27T01:30:00Z", deleted_at: null }, { date: "2026-10-14", created_at: "2026-10-15T16:21:00Z", deleted_at: null }],
  cash_daily: [{ date: "2026-08-27", updated_at: "2026-08-27T02:00:00Z" }, { date: "2026-10-15", updated_at: "2026-10-15T16:22:00Z" }],
  fixed_cost_schedule: [
    { start_date: "2026-01-01", end_date: "2026-08-31", updated_at: "2026-08-03T03:00:00Z", deleted_at: null },
    { start_date: "2026-10-01", end_date: null, updated_at: "2026-10-15T16:23:00Z", deleted_at: null },
  ],
  batch: [
    { date: "2026-08-26", status: "Aktual", deleted_at: null, superseded_at: null, wp_received_at: "2026-08-27T02:12:00Z", invoice_status: null, updated_at: "2026-08-27T02:12:00Z" },
    { date: "2026-10-14", status: "Aktual", deleted_at: null, superseded_at: null, wp_received_at: "2026-10-15T16:24:00Z", invoice_status: "tied", updated_at: "2026-10-15T16:24:00Z" },
  ],
  sales_line: [
    { date: "2026-08-29", status: "Order", deleted_at: null, created_at: "2026-08-26T07:10:00Z" },
    { date: "2026-10-16", status: "Order", deleted_at: null, created_at: "2026-10-15T16:20:00Z" },
  ],
  lb_price_decision: [{ date: "2026-08-28", decided_at: "2026-08-27T04:00:00Z" }, { date: "2026-10-16", decided_at: "2026-10-15T16:25:00Z" }],
  yield_matrix: [
    { effective_from: "2026-01-01", effective_to: null, deleted_at: null, created_at: "2026-08-20T03:00:00Z" },
    { effective_from: "2026-10-01", effective_to: null, deleted_at: null, created_at: "2026-10-15T16:26:00Z" },
  ],
  lb_supply: [{ date: "2026-08-27", created_at: "2026-08-26T05:00:00Z", deleted_at: null }, { date: "2026-10-16", created_at: "2026-10-15T16:27:00Z", deleted_at: null }],
  input_task: [
    // August: everything passed except the WP of batch 126 (due Thu 27 Aug 12.00, never received)
    { due_date: "2026-08-26", rule_kind: "po_lines", ref: "2026-08-27", status: "passed", due_at: "2026-08-26T12:00:00+07:00" },
    { due_date: "2026-08-26", rule_kind: "gl_daily", ref: "2026-08-26", status: "passed", due_at: "2026-08-26T16:00:00+07:00" },
    { due_date: "2026-08-27", rule_kind: "costing_wp", ref: "126/PO/KGR/08/2026", status: "open", due_at: "2026-08-27T12:00:00+07:00" },
    // October: PO and LB decision late
    { due_date: "2026-10-14", rule_kind: "po_lines", ref: "2026-10-15", status: "late", due_at: "2026-10-14T12:00:00+07:00" },
    { due_date: "2026-10-15", rule_kind: "lb_price_decision", ref: "2026-10-16", status: "late", due_at: "2026-10-15T12:00:00+07:00" },
  ],
};

beforeEach(() => { vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("KGR_TEST_NOW", "2026-10-17T09:00:00+07:00"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const labels = async (period: typeof AUG) => {
  const sb = memSb(rows) as never;
  return loadSources(sb, await clock(sb), period);
};

describe("R76: label sumber per periode angka", () => {
  it("minggu Agustus dengan upload Oktober: setiap label memakai Agustus", async () => {
    const l = await labels(AUG);
    expect(l.jurnal.text).toBe("jurnal s.d. 26/08 + PO · Inventory Accounting · 27 Agu 08.15");
    expect(l.stok.text).toBe("kartu stok 26/08 · Inventory Accounting · 27 Agu 08.30");
    expect(l.kas.text).toBe("saldo dan rencana kas 27/08 · Finance · 27 Agu 09.00");
    expect(l.beban_tetap.text).toBe("jadwal beban tetap · Finance · 3 Agu 10.00");
    expect(l.po.text).toBe("PO · Sales · 26 Agu 14.10");
    expect(l.lb.text).toBe("harga LB 28/08 · Direktur Operasional · 27 Agu 11.00");
    expect(l.supply.text).toBe("supply LB per kelas · Purchasing / Ops · 26 Agu 12.00");
    expect(l.yield.text).toBe("yield per kelas · PPIC · 20 Agu 10.00");
    for (const x of Object.values(l)) expect(x.text).not.toMatch(/Okt|\/10/);
  });
  it("minggu Oktober membaca Oktober (penyaringnya periode, bukan tanggal tetap)", async () => {
    const l = await labels(OCT);
    expect(l.po.text).toBe("PO · Sales · 15 Okt 23.20 · lewat tenggat");
    expect(l.jurnal.text).toBe("jurnal s.d. 14/10 + PO · Inventory Accounting · 15 Okt 23.20 · lewat tenggat"); // its PO task is late
    expect(l.beban_tetap.text).toBe("jadwal beban tetap · Finance · 15 Okt 23.23");
    expect(l.wp.text).toBe("WP + faktur · Cost Accounting · 15 Okt 23.24");
  });
  it("simulasi = PO + yield + harga LB (bukan WP); waktu = yang terbaru di antaranya", async () => {
    const aug = (await labels(AUG)).simulasi;
    expect(aug.text).toBe("PO + yield + harga LB 28/08 · 27 Agu 11.00");
    expect(aug.text).not.toMatch(/WP/);
    expect((await labels(OCT)).simulasi.text).toBe("PO + yield + harga LB 16/10 · 15 Okt 23.26 · lewat tenggat");
  });
  it("komponen yang tidak punya isi di periode disebut, bukan diganti isi periode lain", async () => {
    const sb = memSb({ ...rows, yield_matrix: [], sales_line: [] }) as never;
    const l = await loadSources(sb, await clock(sb), AUG);
    expect(l.simulasi.text).toBe("PO belum ada + yield belum ada + harga LB 28/08 · 27 Agu 11.00");
    expect(l.rencana.text).toBe("yield belum ada + harga LB 28/08 · 27 Agu 11.00");
  });
  it("biaya = WP / faktur dari batch minggu itu", async () => {
    expect((await labels(AUG)).wp.text).toBe("WP sementara · Cost Accounting · 27 Agu 09.12 · lewat tenggat");
  });
  it("late dari tugas sumber itu di periodenya: PO lewat tenggat di Oktober tidak mewarnai PO Agustus; WP Agustus yang tak pernah masuk terlambat", async () => {
    const aug = await labels(AUG);
    expect(aug.po.late).toBe(false);
    expect(aug.jurnal.late).toBe(false);
    expect(aug.lb.late).toBe(false);
    expect(aug.simulasi.late).toBe(false);
    expect(aug.wp.late).toBe(true);
    expect(aug.wp.text).toMatch(/ · lewat tenggat$/);
    const oct = await labels(OCT);
    expect(oct.po.late).toBe(true);
    expect(oct.lb.late).toBe(true);
    // the simulation is late through its own tasks (PO, LB decision), the cost through WP / faktur only
    expect(oct.simulasi.late).toBe(true);
    expect(oct.wp.late).toBe(false);
  });
  it("tile per layar: Manajemen simulasi, Komersial biaya (WP), PPIC rencana", async () => {
    const l = await labels(AUG);
    expect(sourcesFor("manajemen", l)["sim-lb"].text).toMatch(/^PO \+ yield \+ harga LB/);
    expect(sourcesFor("commercial", l)["c-stok"].text).toMatch(/^WP /);
    expect(sourcesFor("ppic", l)["c-biaya"].text).toMatch(/^yield \+ harga LB/);
    expect(sourcesFor("ppic", l)["c-po"].text).toMatch(/^PO · /);
  });
  it("sourcesOf tanpa periode memakai minggu tanggal data", async () => {
    const m = await sourcesOf("commercial", memSb(rows) as never);
    expect(m["t-komitmen"].text).toBe("PO · Sales · 26 Agu 14.10");
  });
});

describe("layar Minggu ini minggu Agustus dibuka 17 Okt", () => {
  it("catatan di bawah kartu dan simulasi berlabel Agustus, tanpa Oktober", async () => {
    const m = await loadManagementV5(memSb(rows) as never, WEEK_AUG, r, {}, null, "operations_director");
    const tiles = managementV5([
      { id: "c-outlook", pos: { x: 0, y: 2, w: 3, h: 2 }, kind: "card", title: "Outlook minggu", content: { type: "card", value: "1,0", compare: [] } },
      { id: "c-bulan", pos: { x: 7, y: 2, w: 2, h: 2 }, kind: "card", title: "Outlook Agustus", content: { type: "card", value: "1,0", compare: [] } },
    ], m, { at: 8 });
    const html = renderToStaticMarkup(<TilePage tiles={tiles} label="Minggu ini" />).replace(/<!-- -->/g, "");
    const srcs = [...html.matchAll(/data-tile-source="">([^<]*)</g)].map((x) => x[1]);
    expect(srcs.length).toBe(3);
    expect(srcs.join(" | ")).toContain("Sumber: jurnal s.d. 26/08 + PO · Inventory Accounting · 27 Agu 08.15");
    expect(srcs.join(" | ")).toContain("Sumber: jadwal beban tetap · Finance · 3 Agu 10.00");
    expect(srcs.join(" | ")).toContain("Sumber: PO + yield + harga LB 28/08 · 27 Agu 11.00");
    expect(srcs.join(" | ")).not.toMatch(/Okt/);
  });
});
