/**
 * Model of the PPIC screen v5 (PRD v5 §4.2–4.4, §6.3; mockup reference/design/v5/PPIC.dc.html), pure: the class demand
 * of @kgr/engine (toClassLB, dailyClassPlan, classByProducts, weekClassPlan, planCost) in, one tile list out. Numbers
 * are decided by the engine; this file places and labels them (kg and Rp/kg without decimals, Rp jt one decimal,
 * U+2212, status in words). No buy / delay recommendation for live birds (K25).
 */
import {
  D, dayName, type BatchKpi, type ClassDemand, type ControlV3, type DailyClassRow, type Decimal, type PlanCostResult, type PlanOutput,
} from "@kgr/engine";
import { jtV4, minus, num, pctV4, tglShort } from "../fmt";
import type { Col, TRow } from "@/components/v4/Table";
import type { TilePos } from "@/components/v4/Tile";
import type { TileModel } from "../v4/minggu-ini";
import { withFailures, type Failed } from "../v4/tile-errors";

export interface PpicClassInfo { code: string; min_kg: string | null; max_kg: string | null; avg_kg: string | null }

export interface PpicV5Input {
  /** PRD v6 R161 (flag v6_pages): per-class rows, a surplus in the warn tone, long notes in the drawer. */
  v6?: boolean;
  /** PRD v5.1 K41: tile id → message of the read that failed. */
  failed?: Failed;
  week: { start: string; end: string; update: string };
  base: string;
  versi: "need" | "batch";
  demand: ClassDemand;
  daily: DailyClassRow[];
  classes: PpicClassInfo[];
  /** v4 netting of the karkas keys (fresh with sizes, n/a without, frozen covered by stock). */
  karkas: { freshKg: Decimal; naKg: Decimal; frozenOrderKg: Decimal; frozenCovered: boolean; stockFreshKg: Decimal | null; stockFreshAgeDays: number | null };
  /** K25 simulation inputs of both bases (the Manajemen tile reads them; the PPIC screen does not). */
  sim?: { tariff: Decimal; need: { kgLb: Decimal; outputs: PlanOutput[] } | null; batch: { kgLb: Decimal; outputs: PlanOutput[]; extraValue: Decimal } | null };
  po: { from: string; to: string; kg: Decimal; rpaKg: Decimal; tradingKg: Decimal; tentativeKg: Decimal };
  byProducts: { unit: string; net_kg: Decimal; output_kg: Decimal; shortfall_kg: Decimal }[];
  /** Need version at the LB price decided last (§4.1 mode rencana); null without a price. */
  needCost: PlanCostResult | null;
  lbPrice: { price: Decimal | null; source: "keputusan Direktur Operasional" | "harga hari ini (parameter)" };
  /** Saved / input version: batch rencana in the horizon (block 2 v1) and its surplus. */
  batch: { kgLb: Decimal; batches: number; margin: Decimal; surplusKg: Decimal; downgrade: Decimal | null; threshold: Decimal; priceFresh: Decimal | null; priceFrozen: Decimal | null } | null;
  fromCommercial: { commitment: "dikunci" | "belum dikunci"; deadline: string; priceList: "dikunci" | "belum"; surplus: "dijawab" | "menunggu" | "tidak ada surplus"; spotFreshKg: Decimal | null };
  capacity: Map<string, number | null>;
  /** Supply LB per cut date per class (kg LB), confirmed or received. */
  supply: { date: string; weight_class: string | null; kg_lb: Decimal }[];
  controls: ControlV3[];
  today: { poKg: Decimal; poValue: Decimal | null; cutOffTime: string; allocHref: string };
  block6: BatchKpi | null;
  canPlan: boolean;
  /** Why save / copy are not possible now (control codes with their status); empty = possible. */
  saveBlockers: string[];
  copyBlockers: string[];
  /** PRD v5.1 R29: the written reason that lets C58 (supply short of the class need) open the copy; null = none. */
  c58Reason?: string | null;
  /** R53: the downgrade approval of the saved plan version (null = no plan saved yet). */
  approval?: { planId: string; version: number; needs: boolean; approvedBy: string | null } | null;
  /** R39 (K20): cost status of this week's actual batches (estimasi / sementara / final / campur); null = v5_costing off or none. */
  batchStatus?: string | null;
}

/** PRD v5.1 R30: "dalam n kelas berat", or STD alone (no weight class filled by PPIC yet) — STD is not a class. */
export const classWords = (n: number) => (n === 0 ? "dalam kelas STD (kelas berat belum diisi PPIC)" : `dalam ${n} kelas berat`);
const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const kg = (v: Decimal | null | undefined) => (v === null || v === undefined ? "belum diisi" : minus(num(v, 0)));
const rp = kg;
const d2 = (v: Decimal | null) => (v === null ? "—" : num(v, 2));
const short = (d: string) => `${dayName(d).slice(0, 3)} ${Number(d.slice(8, 10))}`;
const range = (a: string, b: string) => `${Number(a.slice(8, 10))}–${tglShort(b)}`;
const statusOf = (cs: ControlV3[], code: string) => cs.find((c) => c.code === code)?.status ?? null;
const CLASS_WORD: Record<string, string> = { K: "K · kecil", S: "S · sedang", B: "B · besar" };

export function ppicV5Model(x: PpicV5Input): { title: string; tiles: TileModel[] } {
  const d = x.demand;
  const tiles: TileModel[] = [];
  const shipRange = range(x.po.from, x.po.to);
  const classes = d.byClass.filter((c) => c.weight_class !== "STD");
  const std = d.byClass.find((c) => c.weight_class === "STD") ?? null;
  const unsizedKg = d.unsized.reduce((a, u) => a.plus(u.kg), D(0));
  const c42 = statusOf(x.controls, "C42"), c58 = statusOf(x.controls, "C58");

  // ---------------------------------------------------------------- row 0: stepper
  tiles.push({
    id: "stepper", pos: P(0, 0, 12, 1), kind: "bare",
    content: {
      type: "stepper", current: 1, steps: [
        { n: 1, label: "Demand", status: d.total.po_kg.gt(0) ? "PO masuk" : "belum ada PO", href: "#langkah-1" },
        { n: 2, label: "Rencana mingguan", status: c42 && c42 !== "LULUS" ? "yield sementara" : "siap", href: "#langkah-2" },
        { n: 3, label: "Rencana harian", status: c58 === "BELUM DIISI" ? "supply belum diisi" : c58 === "PERIKSA" ? "supply kurang" : [...x.capacity.values()].some((v) => v !== null) ? "siap" : "kapasitas belum diisi", href: "#langkah-3" },
        { n: 4, label: "Alokasi hari ini", status: "lihat alokasi", href: x.today.allocHref },
      ],
    },
  });

  // ---------------------------------------------------------------- row 1: headline (a finding)
  const over = x.batch ? x.batch.kgLb.minus(d.total.kg_lb) : null;
  tiles.push({
    id: "headline", pos: P(0, 1, 12, 1), kind: "bare",
    content: {
      type: "headline",
      text: `Order ${shipRange} butuh ${kg(d.total.kg_lb)} kg LB ${classWords(classes.length)} (± ${kg(d.total.heads)} ekor)${x.batch ? `; batch rencana di input ${kg(x.batch.kgLb)} kg LB, ${over && over.gt(0) ? `${kg(over)} kg di atas kebutuhan` : over && over.lt(0) ? `${kg(over.neg())} kg di bawah kebutuhan` : "sama dengan kebutuhan"}` : ""}.`,
    },
  });

  // ---------------------------------------------------------------- rows 2–3: cards
  const fc = x.needCost?.lines.find((l) => l.key === "RPA|Karkas|Fresh") ?? null;
  tiles.push({ id: "c-po", pos: P(0, 2, 3, 2), kind: "card", title: `PO kirim ${shipRange}`, content: { type: "card", value: kg(x.po.kg), unit: "kg", compare: [{ label: "kg RPA", value: kg(x.po.rpaKg) }, { label: "kg Trading", value: kg(x.po.tradingKg) }, { label: "tentatif", value: kg(x.po.tentativeKg) }] } });
  tiles.push({ id: "c-karkas", pos: P(3, 2, 2, 2), kind: "card", title: "Kebutuhan karkas", content: { type: "card", value: kg(d.total.net_kg), unit: "kg", compare: [{ label: `fresh di ${d.bySize.filter((s) => s.mapped).length} ukuran`, value: kg(d.total.net_kg.minus(unsizedKg)) }, { label: "tanpa ukuran", value: kg(unsizedKg), tone: unsizedKg.gt(0) ? "worse" : undefined }] } });
  tiles.push({ id: "c-rencana", pos: P(5, 2, 2, 2), kind: "card", title: "Rencana kebutuhan", content: { type: "card", value: kg(d.total.kg_lb), unit: "kg LB", compare: x.v6
    // R161: one row per class (K 83 · S 4.208 · B 13.108), not one string that wraps
    ? d.byClass.slice(0, 3).map((c) => ({ label: `kelas ${c.weight_class}`, value: `${kg(c.kg_lb)} kg` }))
    : [{ label: "per kelas", value: d.byClass.map((c) => `${c.weight_class} ${kg(c.kg_lb)}`).join(" · ") }, { label: "ekor", value: `± ${kg(d.total.heads)}` }] },
    ...(x.v6 ? { note: `± ${kg(d.total.heads)} ekor${d.byClass.length > 3 ? `; ${d.byClass.length - 3} kelas lain di tabel` : ""}` } : {}) });
  tiles.push({ id: "c-batch", pos: P(7, 2, 2, 2), kind: "card", title: "Batch rencana di input", content: x.batch ? { type: "card", value: kg(x.batch.kgLb), unit: "kg LB", compare: over ? [{ label: over.gte(0) ? "di atas kebutuhan" : "di bawah kebutuhan", value: `${over.gte(0) ? "+" : "−"}${num(over.abs(), 0)} kg LB`, tone: over.gt(0) && !x.v6 ? "worse" : undefined }] : [] } : { type: "card", value: null, missing: "belum ada batch rencana", compare: [] },
    // R161: a batch above the need is a warning (the + stays), not red
    ...(x.v6 && x.batch && over && over.gt(0) ? { note: "di atas kebutuhan: periksa surplus karkas" } : {}) });
  tiles.push({
    id: "c-biaya", pos: P(9, 2, 3, 2), kind: "card", title: "Biaya rencana karkas fresh",
    content: fc?.costPerKg ? { type: "card", value: rp(fc.costPerKg), unit: "Rp/kg", compare: [{ label: `harga list · LB ${rp(x.lbPrice.price)}`, value: rp(fc.priceRef) }, { label: "breakeven LB rencana kebutuhan", value: rp(x.needCost?.breakeven ?? null) }] } : { type: "card", value: null, missing: x.lbPrice.price ? "harga acuan belum diisi" : "harga LB belum diputuskan", compare: [] },
  });

  // ---------------------------------------------------------------- rows 4–7: step 1 demand per size, from Commercial
  const dCols: Col[] = [{ key: "u", label: "Ukuran karkas", kind: "key" }, { key: "po", label: "PO kg", num: true }, { key: "s", label: "Stok layak", num: true, kind: "sup" }, { key: "net", label: "Net kg", num: true },
    { key: "c", label: "Kelas LB", kind: "key" }, { key: "lbe", label: "kg LB/ekor", num: true }, { key: "lb", label: "kg LB", num: true }, { key: "h", label: "Ekor", num: true }];
  const dRows: TRow[] = d.bySize.map((r) => ({
    id: r.size_code, redNeg: !r.mapped,
    cells: { u: r.size_code === "tanpa" ? "Tanpa ukuran" : `${r.size_code} fresh`, po: kg(r.po_kg), s: kg(r.po_kg.minus(r.net_kg)), net: kg(r.net_kg), c: r.mapped ? r.weight_class : "belum ada", lbe: d2(r.lb_per_head), lb: kg(r.kg_lb), h: kg(r.heads) },
  }));
  dRows.push({ id: "total", kind: "total", cells: { u: "Total", po: kg(d.total.po_kg), s: kg(d.total.po_kg.minus(d.total.net_kg)), net: kg(d.total.net_kg), c: "", lbe: d2(d.total.lb_per_head), lb: kg(d.total.kg_lb), h: kg(d.total.heads) } });
  tiles.push({
    id: "t-demand", pos: P(0, 4, 7, 4), kind: "tall", title: `1 · Demand karkas per ukuran → kelas berat → kg LB, kirim ${shipRange}`,
    note: x.v6 ? (unsizedKg.gt(0) ? `${kg(unsizedKg)} kg karkas di PO tanpa ukuran memakai ukuran standar sampai Commercial melengkapinya.` : undefined) : [
      "Ukuran dibaca dari kode item PO (Uk 1.3 = karkas 1,30–1,39 kg/ekor, dihitung di titik tengah). kg LB = net karkas ÷ yield karkas kelas.",
      unsizedKg.gt(0) ? `${kg(unsizedKg)} kg karkas di PO tanpa ukuran memakai STD ${num(std?.lb_per_head ?? null, 1)} kg sampai Commercial melengkapinya.` : null,
      "By-product tidak menambah kg LB; kekurangannya tampil di kanan.",
      x.karkas.frozenOrderKg.gt(0) ? `Karkas frozen ${kg(x.karkas.frozenOrderKg)} kg ${x.karkas.frozenCovered ? "tertutup stok frozen" : "belum tertutup stok"}.` : null,
    ].filter(Boolean).join(" "),
    cara: { title: "Demand per kelas", fn: "toClassLB (K28)", rule: (x.v6 ? "Ukuran dibaca dari kode item PO (Uk 1.3 = karkas 1,30–1,39 kg/ekor, titik tengah). By-product tidak menambah kg LB. " : "") + "net kg = PO × porsi net key (netting stok per key, kelayakan pada tanggal kirim); kelas = peta ukuran → kelas; kg LB = net ÷ yield karkas kelas; ekor = net ÷ (ukuran + 0,05); tanpa ukuran = kelas STD (C50).", period: shipRange, basis: "PO, stok ledger, size_class_map, yield_matrix", status: "draft", sources: [{ label: "Tabel", value: "sales_line, item_map, size_class_map, yield_matrix, lot_balance_daily" }] },
    content: { type: "table", cols: dCols, rows: dRows },
  });
  const fRows: TRow[] = [
    { id: "kom", cells: { t: "Komitmen minggu depan", st: x.fromCommercial.commitment, s: `Tenggat ${x.fromCommercial.deadline}.` } },
    { id: "pl", cells: { t: "Price list minggu depan", st: x.fromCommercial.priceList, s: "Dipakai costing minggu depan." } },
    { id: "sur", cells: { t: "Jawaban surplus", st: x.fromCommercial.surplus, s: "Sanggup serap atau kurangi potong." } },
    { id: "spot", cells: { t: "Spot fresh hari ini", st: x.fromCommercial.spotFreshKg ? `${kg(x.fromCommercial.spotFreshKg)} kg` : "belum ada", s: `Sisa diblast ${x.today.cutOffTime}.` } },
  ];
  tiles.push({ id: "dari-commercial", pos: P(7, 4, 5, 4), kind: "tall", title: "Dari Commercial", content: { type: "table", cols: [{ key: "t", label: "", kind: "key" }, { key: "st", label: "Status" }, { key: "s", label: "", kind: "sup", wrap: true }], rows: fRows } });

  // ---------------------------------------------------------------- rows 8–12: step 2 weekly plan, to Commercial
  const need = x.versi === "need";
  const href = (v: "need" | "batch") => `${x.base}${v === "batch" ? "?versi=batch" : ""}`;
  const cCols: Col[] = [{ key: "c", label: "Kelas berat LB", kind: "key" }, { key: "r", label: "Rentang" }, { key: "lb", label: "kg LB", num: true }, { key: "e", label: "Ekor", num: true }, { key: "a", label: "Rata-rata", num: true }, { key: "p", label: "Pola potong", kind: "sup", wrap: true }];
  const info = new Map(x.classes.map((c) => [c.code, c]));
  const cRows: TRow[] = d.byClass.map((c) => {
    const i = info.get(c.weight_class);
    const rng = c.weight_class === "STD" ? `STD ${num(i?.avg_kg ?? null, 1)} kg` : i?.min_kg && i?.max_kg ? `${num(i.min_kg, 1)}–${num(i.max_kg, 1)} kg` : "belum diisi";
    return { id: c.weight_class, cells: { c: c.weight_class === "STD" ? "Belum ada kelas" : CLASS_WORD[c.weight_class] ?? c.weight_class, r: rng, lb: kg(c.kg_lb), e: kg(c.heads), a: d2(c.lb_per_head), p: c.weight_class === "STD" ? "menunggu ukuran dari Commercial" : `karkas utuh ${c.sizes.join(", ")}` } };
  });
  const oCols: Col[] = [{ key: "s", label: "SKU", kind: "key" }, { key: "o", label: "Output kg", num: true }, { key: "f", label: "Ke PO fresh", num: true }, { key: "z", label: "Frozen terencana", num: true }, { key: "p", label: "Harga list", num: true }, { key: "c", label: "Biaya/kg", num: true }, { key: "dg", label: "Downgrade Rp jt", num: true }];
  let oRows: TRow[] = [];
  let planCards: string[] = [];
  let planNote = "";
  if (need) {
    const c = x.needCost;
    oRows = (c?.lines ?? []).map((l) => ({ id: l.key, cells: { s: l.key.replace(/^RPA\|/, "").replace("|", " "), o: kg(l.kg), f: kg(l.kg), z: "0", p: l.priceRef === null ? "belum diisi" : rp(l.priceRef), c: l.costPerKg === null ? "—" : rp(l.costPerKg), dg: "0,0" } }));
    planCards = [
      `kg LB · ${classes.length ? `${classes.length} kelas` : "STD"}: ${kg(d.total.kg_lb)} (± ${kg(d.total.heads)} ekor)`,
      c ? `Biaya rencana Rp ${jtV4(c.costPool)} jt di LB ${rp(x.lbPrice.price)}` : "Biaya rencana: harga LB belum diputuskan",
      c ? `GP rencana Rp ${jtV4(c.gp)} jt${c.value.isZero() ? "" : ` (${pctV4(c.gp.div(c.value))})`}` : "",
      "Frozen terencana 0 kg: semua output ke PO",
    ].filter(Boolean);
    planNote = c?.k ? `Biaya rencana memakai joint costing: setiap SKU menanggung ${num(c.k.times(100), 0)}% dari harga list; breakeven LB ${rp(c.breakeven)}. By-product tidak menambah potong; kekurangannya ditutup trading atau order dikurangi.${c42 && c42 !== "LULUS" ? " Yield masih placeholder per kelas, jadi kg LB per kelas bergeser saat yield per kelas diisi." : ""}` : "Biaya rencana menunggu harga LB dan harga acuan.";
  } else if (x.batch) {
    const b = x.batch;
    oRows = [
      { id: "fresh", cells: { s: "Karkas fresh ke PO", o: kg(d.total.net_kg), f: kg(d.total.net_kg), z: "0", p: b.priceFresh ? rp(b.priceFresh) : "belum diisi", c: "—", dg: "0,0" } },
      { id: "surplus", redNeg: true, cells: { s: "Karkas surplus", o: kg(b.surplusKg), f: "0", z: kg(b.surplusKg), p: b.priceFrozen ? rp(b.priceFrozen) : "belum diisi", c: "—", dg: b.downgrade === null ? "belum diisi" : jtV4(b.downgrade.neg()) } },
    ];
    planCards = [
      `kg LB ${kg(b.kgLb)} (${b.batches} batch)`,
      `Margin potong rencana Rp ${jtV4(b.margin)} jt (blok 2)`,
      `Frozen terencana ${kg(b.surplusKg)} kg`,
      b.downgrade === null ? "Downgrade: harga fresh/frozen belum diisi" : `Downgrade Rp ${jtV4(b.downgrade.neg())} jt${b.downgrade.gt(b.threshold) ? ` · di atas batas approval ${jtV4(b.threshold)} jt` : ""}`,
    ];
    planNote = b.surplusKg.gt(0) ? `Batch rencana menghasilkan ± ${kg(b.surplusKg)} kg karkas di atas kebutuhan PO; butuh jawaban Commercial${b.downgrade && b.downgrade.gt(b.threshold) ? " dan persetujuan downgrade" : ""}.` : "Batch rencana tidak menghasilkan surplus karkas.";
  }
  tiles.push({
    id: "t-mingguan", pos: P(0, 8, 7, 5), kind: "tall", title: "2 · Rencana mingguan: output per SKU dan biaya rencana",
    views: [{ label: "Versi", current: x.versi, options: [{ value: "need", label: `Usulan: kebutuhan PO (${kg(d.total.kg_lb)} kg LB)`, href: href("need") }, { value: "batch", label: `Tersimpan: batch rencana${x.batch ? ` ${kg(x.batch.kgLb)} kg LB` : ""}`, href: href("batch") }] }],
    note: [planCards.join(" · "), planNote, x.saveBlockers.length ? `Belum bisa disimpan: ${x.saveBlockers.join(", ")}.` : x.canPlan ? "" : "Disimpan oleh PPIC."].filter(Boolean).join(" "),
    cara: { title: "Rencana mingguan", fn: need ? "planCost (rencana) + toClassLB" : "weekClassPlan + blok 2 v1", rule: "Usulan = kebutuhan PO per kelas pada harga LB keputusan terakhir; biaya per SKU = k × harga acuan. Tersimpan = batch rencana yang diinput; surplus = output karkas − kebutuhan; downgrade = surplus × (harga fresh − harga frozen).", period: range(x.week.start, x.week.end), basis: x.lbPrice.source, status: "draft", sources: [{ label: "Tabel", value: "plan_week, plan_week_class, batch, lb_price_decision, sku_price" }] },
    content: { type: "table", cols: cCols, rows: cRows, sections: [{ title: "Output per SKU", cols: oCols, rows: oRows }] },
  });
  const toRows: TRow[] = [
    { id: "sur", cells: { a: "Surplus karkas belum punya pembeli", v: need ? "0 kg" : x.batch ? `± ${kg(x.batch.surplusKg)} kg` : "—" } },
    ...x.byProducts.filter((b) => b.shortfall_kg.gt(0)).sort((p, q) => q.shortfall_kg.cmp(p.shortfall_kg)).map((b) => ({ id: b.unit, redNeg: true, cells: { a: `${b.unit.split(" ")[0]} kurang dari order`, v: `${minus(num(b.shortfall_kg.neg(), 0))} kg · beli trading atau kurangi order` } })),
    ...(unsizedKg.gt(0) ? [{ id: "unsized", cells: { a: "Karkas di PO tanpa ukuran", v: `${kg(unsizedKg)} kg · minta Commercial isi ukuran` } }] : []),
  ];
  tiles.push({
    id: "ke-commercial", pos: P(7, 8, 5, 5), kind: "tall", title: "Ke Commercial dan Direktur Operasional",
    note: "Harga live bird diputuskan Direktur Operasional; biaya rencana mengikuti harga keputusan terakhir.",
    content: { type: "table", cols: [{ key: "a", label: "", kind: "key", wrap: true }, { key: "v", label: "", wrap: true }], rows: toRows },
  });

  // ---------------------------------------------------------------- rows 13–15: step 3 daily
  const supplyOf = (date: string, cls: string) => x.supply.filter((s) => s.date === date && s.weight_class === cls).reduce<Decimal | null>((a, s) => (a ?? D(0)).plus(s.kg_lb), null);
  const hCols: Col[] = [{ key: "cut", label: "Potong", kind: "key" }, { key: "send", label: "Kirim" }, { key: "lb", label: "kg LB", num: true }, { key: "h", label: "Ekor", num: true }, { key: "mix", label: "Ekor per kelas K / S / B" }, { key: "k", label: "Target karkas", num: true }, { key: "cap", label: "Kapasitas", num: true }, { key: "sup", label: "Supply LB", num: true }, { key: "st", label: "Status" }];
  const hRows: TRow[] = x.daily.map((r) => {
    const by = (c: string) => r.byClass.find((b) => b.weight_class === c)?.heads ?? D(0);
    const sup = r.byClass.map((b) => supplyOf(r.cut_date, b.weight_class));
    const cap = x.capacity.get(r.cut_date) ?? null;
    return {
      id: r.cut_date, on: r.cut_date === x.week.update,
      cells: {
        cut: short(r.cut_date), send: short(r.ship_date), lb: kg(r.kg_lb), h: kg(r.heads), mix: `${kg(by("K"))} / ${kg(by("S"))} / ${kg(by("B"))}${r.unsizedHeads.gt(0) ? ` · ${kg(r.unsizedHeads)} tanpa ukuran` : ""}`,
        k: kg(r.karkas_kg), cap: cap === null ? "belum diisi" : num(cap, 0), sup: sup.every((v) => v === null) ? "belum diisi" : kg(sup.reduce<Decimal>((a, v) => (v === null ? a : a.plus(v)), D(0))), // class without supply row adds nothing; all blank = "belum diisi"
        st: r.cut_date < x.week.update ? "lewat: dibandingkan WP" : r.cut_date === x.week.update ? "hari ini" : "rencana",
      },
    };
  });
  tiles.push({
    id: "t-harian", pos: P(0, 13, 12, 3), title: "3 · Rencana harian: potong H−1 dari tanggal kirim",
    note: x.copyBlockers.length ? `Belum bisa salin ke batch rencana: ${x.copyBlockers.join(", ")}. Kebutuhan per hari dihitung dari ukuran karkas di PO per tanggal kirim.` : "Kebutuhan per hari dihitung dari ukuran karkas di PO per tanggal kirim.",
    content: { type: "table", cols: hCols, rows: hRows },
  });

  // ---------------------------------------------------------------- rows 16–18: step 4 today, batch actual vs plan
  tiles.push({
    id: "t-hari-ini", pos: P(0, 16, 7, 3), title: `4 · Hari ini, ${short(x.week.update)} ${tglShort(x.week.update).split(" ")[1]}: alokasi ke PO dan cut-off`,
    note: "Lot dari potong hari ini berstatus estimasi (kg dari yield standar); diganti actual saat WP potong masuk besok.",
    content: { type: "table", cols: [{ key: "a", label: "", kind: "key" }, { key: "v", label: "", num: true }, { key: "s", label: "", kind: "sup" }], rows: [
      { id: "po", cells: { a: "PO kirim hari ini", v: `${kg(x.today.poKg)} kg`, s: x.today.poValue === null ? "harga PO belum ada" : `Rp ${jtV4(x.today.poValue)} jt` } },
      { id: "alloc", cells: { a: "Alokasi FEFO", v: "", s: "buka Alokasi hari ini" }, href: x.today.allocHref },
      { id: "cut", cells: { a: `Cut-off ${x.today.cutOffTime}`, v: "blast sisa", s: "downgrade dicatat per SKU" } },
    ] },
  });
  const b6 = x.block6;
  const row6 = (st: "Aktual" | "Rencana") => b6?.rows.find((r) => r.status === st) ?? null;
  const a = row6("Aktual"), r = row6("Rencana");
  tiles.push({
    id: "t-batch", pos: P(7, 16, 5, 3), title: "Batch aktual vs rencana · WP H+1",
    content: { type: "table", cols: [{ key: "k", label: "", kind: "key" }, { key: "lb", label: "kg LB", num: true }, { key: "sh", label: "Shrink", num: true }, { key: "y", label: "Yield", num: true }, { key: "c", label: "Biaya" }], rows: [
      { id: "a", cells: { k: "Aktual", lb: a && !a.lbKg.isZero() ? kg(a.lbKg) : "belum ada", sh: a?.shrink ? pctV4(a.shrink) : "", y: a?.karkasYield ? pctV4(a.karkasYield) : "", c: x.batchStatus ?? "" } },
      { id: "r", cells: { k: "Rencana", lb: r && !r.lbKg.isZero() ? kg(r.lbKg) : "belum ada", sh: r?.shrink ? pctV4(r.shrink) : "", y: r?.karkasYield ? pctV4(r.karkasYield) : "", c: "rencana" } },
      { id: "t", cells: { k: "Target", lb: "", sh: b6 ? pctV4(b6.target.shrink) : "", y: b6 ? pctV4(b6.target.karkasYield) : "", c: "" } },
    ] },
  });
  // ---------------------------------------------------------------- rows 19–20: the approval of a plan with a downgrade above the limit (R53)
  if (x.approval?.needs) {
    const a = x.approval;
    tiles.push({
      id: "t-approval", pos: P(0, 19, 12, 2), title: "Persetujuan downgrade rencana",
      note: "Downgrade di atas batas approval disetujui Finance; rencana yang belum disetujui tidak bisa disalin ke batch.",
      content: { type: "list", items: [a.approvedBy ? `Rencana v${a.version} disetujui oleh ${a.approvedBy}.` : `Rencana v${a.version} menunggu persetujuan Finance: downgrade di atas batas approval.`] },
    });
  }
  return { title: "PPIC · Rencana", tiles: withFailures(tiles, x.failed) };
}
