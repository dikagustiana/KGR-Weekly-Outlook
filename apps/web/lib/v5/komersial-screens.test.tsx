/** Commercial v5 screen (PRD v5 §6.2, mockup Commercial.dc.html). Rows of Lampiran C (ebe4ad8 data) through the engine. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, c52, commitmentDeadline, filterRows, spotRows, stockSellRows, stockSummary, type StockSellItem } from "@kgr/engine";
import { komersialV5Model, type KomersialV5Input } from "./komersial";
import { surplusOptionLabel } from "./surplus";
import { TilePage } from "@/components/v4/TilePage";
import type { TileModel } from "../v4/minggu-ini";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));
const items: StockSellItem[] = [
  { key: "Trading|Karkas|n/a", form: "frozen", free_kg: "39564.7", oldest_age_days: 13.4, over_age_kg: "829.2", urgency: "aman", cost_per_kg: "30065.5", cost_status: "final", price_ref: "31277", cost_check: false },
  { key: "RPA|Karkas|Fresh", form: "fresh", free_kg: "6461.1", oldest_age_days: 6.9, over_age_kg: "0", urgency: "jual_hari_ini", cost_per_kg: "37399.8", cost_status: "sementara", price_ref: "36705", cost_check: false },
  { key: "RPA|Ceker|Fresh", form: "fresh", free_kg: "887.2", oldest_age_days: 7.5, over_age_kg: "0", urgency: "jual_hari_ini", cost_per_kg: "15995.9", cost_status: "sementara", price_ref: "3101", cost_check: true },
  { key: "RPA|Kepala|Frozen", form: "frozen", free_kg: "1811.2", oldest_age_days: 53.9, over_age_kg: "1811.2", urgency: "di_atas_umur", cost_per_kg: "7797.3", cost_status: "sementara", price_ref: "5000", cost_check: false },
];
const rate = D("97510200").div(D("3532558577.57")).div(31);
const input = (filter: "all" | "hari" | "batas" | "below" = "all", over: Partial<KomersialV5Input> = {}): KomersialV5Input => {
  const all = stockSellRows(items, rate);
  const deadline = commitmentDeadline("2026-08-31", 5, "17:00");
  return {
    today: "2026-08-27", spotToday: true, roleLabel: "Kepala Sales", sales: false, base: "/komersial", filter, stockDate: "2026-08-26", rows: filterRows(all, filter), summary: stockSummary(all), holdingRate: rate,
    approvalsWaiting: 0, cutOffTime: "14.00",
    commitment: { weekStart: "2026-08-31", weekEnd: "2026-09-06", deadline: "Jum 28/08 17.00", canEdit: true, canLock: true, priceListLocked: false,
      rows: [{ key: "RPA|Karkas", thisWeekKg: D("17346"), fresh: null, frozen: null, price: "36705", status: "belum diisi", version: null }, { key: "RPA|Usus", thisWeekKg: D("2174"), fresh: "2000", frozen: null, price: "1500", status: "draft", version: 1 }] },
    ppic: { shipRange: "27–29/08", surplusKg: D("6331.9"), downgrade: D("31957000"), planCostKarkas: D("37592"), lbPrice: D("24600"), answered: null,
      byProducts: [{ unit: "HJA (Hati/Jantung/Ampela)", order: D("2019"), output: D("997"), short: D("1022") }, { unit: "Usus", order: D("1673"), output: D("776"), short: D("897") }] },
    spot: spotRows(all, (k) => (k === "RPA|Karkas|Fresh" ? "31658" : k === "RPA|Ceker|Fresh" ? "5000" : null)),
    controls: [c52({ now: "2026-08-27T10:00:00+07:00", deadline, commitments: [{ key: "RPA|Usus", status: "draft" }] })],
    ...over,
  };
};
const m = komersialV5Model(input());
const tile = (id: string) => m.tiles.find((t) => t.id === id);

describe("Commercial v5 layout = mockup grid", () => {
  it("tiles at the mockup coordinates; no overlap", () => {
    const spec: Record<string, [number, number, number, number]> = {
      filter: [0, 0, 7, 1], konteks: [7, 0, 5, 1], headline: [0, 1, 12, 1], "c-stok": [0, 2, 3, 2], "c-hari": [3, 2, 2, 2], "c-bawah": [5, 2, 3, 2], "c-simpan": [8, 2, 2, 2], "c-approval": [10, 2, 2, 2],
      "t-ranking": [0, 4, 12, 6], "t-komitmen": [0, 10, 7, 5], "t-ppic": [7, 10, 5, 5], "t-spot": [0, 15, 12, 3],
    };
    for (const [id, p] of Object.entries(spec)) expect(tile(id)?.pos, id).toEqual({ x: p[0], y: p[1], w: p[2], h: p[3] });
    const cells = new Map<string, string>();
    for (const t of m.tiles) for (let x = t.pos.x; x < t.pos.x + t.pos.w; x++) for (let y = t.pos.y; y < t.pos.y + t.pos.h; y++) {
      expect(cells.has(`${x},${y}`), `${t.id} overlaps ${cells.get(`${x},${y}`)}`).toBe(false);
      cells.set(`${x},${y}`, t.id);
    }
  });
});

describe("Commercial v5 content", () => {
  it("ranking: status biaya as text, floor = cost, reference, margin, loss at the reference; C54 named", () => {
    const v = text(tile("t-ranking"));
    expect(v).toContain("Ceker fresh · RPA jual hari ini 887 7,5 hr sementara 15.996 3.101 −12.895");
    expect(v).toContain("Karkas · Trading aman 39.565 13,4 hr 829 final 30.066 31.277 +1.212");
    expect(tile("t-ranking")!.note).toContain("Ceker fresh · RPA: biaya per kg di atas batas kali harga acuan (C54, periksa biaya)");
  });
  it("cards: stock, fresh today, below cost with its loss, holding per day, approvals", () => {
    expect(text(tile("c-bawah"))).toContain("3 SKU");
    expect(text(tile("c-hari"))).toContain("7.348 kg");
    expect(text(tile("c-simpan"))).toContain("0,089% per hari");
  });
  it("filter links and the filtered ranking", () => {
    const f = tile("filter")!.content;
    expect(f.type === "slicer" ? f.options.map((o) => o.href) : []).toEqual(["/komersial", "/komersial?filter=hari", "/komersial?filter=batas", "/komersial?filter=below"]);
    const below = komersialV5Model(input("below")).tiles.find((t) => t.id === "t-ranking")!;
    expect(text(below)).toContain("di bawah biaya");
    expect(text(below)).not.toContain("Karkas · Trading");
  });
  it("commitments: rows per SKU with this week's kg and status; deadline Friday 17.00", () => {
    const v = text(tile("t-komitmen"));
    expect(v).toContain("Untuk PPIC: komitmen minggu depan, 31–6 Sep");
    expect(v).toContain("Karkas 17.346 36.705 belum diisi");
    expect(v).toContain("Usus 2.174 2.000 1.500 draft v1");
    expect(v).toContain("Belum dikunci; tenggat Jum 28/08 17.00");
  });
  it("from PPIC: surplus ± 6.332 kg, downgrade −32,0 jt, plan cost 37.592 at LB 24.600; by-product shortfall", () => {
    const v = text(tile("t-ppic"));
    expect(v).toContain("Karkas surplus dari batch rencana saat ini ± 6.332 kg turun −32,0 jt");
    expect(v).toContain("HJA 2.019 997 −1.022");
    expect(v).toContain("biaya rencana 37.592/kg di LB 24.600");
    expect(v).toContain("Belum dijawab; PPIC menunggu jawaban sebelum potong.");
  });
  it("spot: fresh to sell before 14.00, the drop when blasted", () => {
    const v = text(tile("t-spot"));
    expect(v).toContain("Jual spot sebelum cut-off 14.00");
    expect(v).toContain("Karkas fresh · RPA 6.461 37.400 36.705 31.658 −32,6 jt acuan di bawah biaya: butuh approval");
  });
  it("sales: no all-SKU line in the context; K25 nowhere", () => {
    const s = komersialV5Model(input("all", { sales: true, roleLabel: "Sales" }));
    expect(text(s.tiles.find((t) => t.id === "konteks"))).toContain("Anda melihat SKU dan pelanggan yang ditugaskan");
    expect(plain(renderToStaticMarkup(<TilePage tiles={m.tiles} label="x" />))).not.toMatch(/TUNDA|NEGOSIASI/);
  });
  it("R64: Sales cannot read the age of the stock — the '> batas' column says 'tidak ditampilkan' (never 0) and the note says for whom", () => {
    const rows = stockSellRows(items.map((i) => ({ ...i, over_age_kg: null })), rate);
    const sales = komersialV5Model(input("all", { sales: true, roleLabel: "Sales", rows }));
    const rank = sales.tiles.find((t) => t.id === "t-ranking");
    expect(text(rank)).toContain("tidak ditampilkan");
    expect(rank!.note).toContain('Kolom "> batas" (kg di atas batas umur) tidak ditampilkan untuk Sales.');
    // a role that may read it shows the kg, and says nothing
    const lead = text(tile("t-ranking"));
    expect(lead).not.toContain("tidak ditampilkan");
    expect(lead).toContain("829");
    expect(tile("t-ranking")!.note ?? "").not.toContain("tidak ditampilkan");
  });
});

describe("Q-v5.2-112 (A8): the two surplus numbers say which is which", () => {
  const ppic = (over: object) => ({ ...input().ppic!, ...over });
  const note = (i: KomersialV5Input) => komersialV5Model(i).tiles.find((t) => t.id === "t-ppic")!.note ?? "";
  it("the tile row is 'rencana saat ini' (recomputed now) and its note says the answer list is the saved plan, which PPIC uses", () => {
    const i = input("all", { ppic: ppic({ surplus: [{ key: "RPA|Karkas", kg: "0.09" }] }) });
    expect(text(komersialV5Model(i).tiles.find((t) => t.id === "t-ppic"))).toContain("Karkas surplus dari batch rencana saat ini ± 6.332 kg");
    expect(note(i)).toContain("Surplus di tabel = rencana saat ini, dihitung ulang dengan data sekarang; daftar jawaban memuat surplus rencana tersimpan, yang dijawab dan dipakai PPIC (bisa berbeda).");
  });
  it("the sentence is only there when there is a surplus to answer (a plan without surplus has no second number)", () => {
    expect(note(input("all", { ppic: ppic({ surplusKg: D(0), surplus: [] }) }))).not.toContain("rencana tersimpan");
    expect(note(input("all", { ppic: ppic({ surplusKg: D(0), surplus: [{ key: "RPA|Lemak", kg: "350" }] }) }))).toContain("rencana tersimpan");
  });
  it("an option of the answer form carries the saved plan's kg and says so", () => {
    expect(surplusOptionLabel("RPA|Karkas", "0.09")).toBe("Karkas · 0 kg (surplus rencana tersimpan)");
    expect(surplusOptionLabel("RPA|Lemak", "350")).toBe("Lemak · 350 kg (surplus rencana tersimpan)");
    expect(surplusOptionLabel("RPA|Sayap|Fresh", "14054.4")).toBe("Sayap|Fresh · 14.054 kg (surplus rencana tersimpan)");
  });
  it("Sales: the surplus table is headed 'rencana tersimpan' and its note names the plan version", () => {
    const sales = komersialV5Model(input("all", { sales: true, roleLabel: "Sales", ppic: null, surplusForSales: { planWeekId: "p1", weekStart: "2026-08-24", version: 3, rows: [{ key: "RPA|Lemak", kg: D("350"), response: null, absorbKg: null }] } as never }));
    const t = sales.tiles.find((x) => x.id === "t-ppic")!;
    expect(text(t)).toContain("Surplus kg (rencana tersimpan)");
    expect(t.note).toContain("Kg = surplus rencana tersimpan v3, yang dijawab dan dipakai PPIC.");
  });
});
