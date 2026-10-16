/**
 * Model of the PPIC page "Rencana" (PRD v4 §6.4): steps 1–4 on one page. Pure: the week's demand and plan proposal
 * (@kgr/engine weekDemand / proposeWeekPlan with K1 and K2), the saved plan, the controls and the step gates, block 2
 * of the weekly engine (economics) and the plan_variance_daily mart in; one tile list out. The actions (save, approve,
 * copy, reasons, capacity) are rendered by the page beside the tiles it names in `actions`.
 */
import { D, Decimal, addDays, dayName, type ControlV3, type ControlV3Status, type DailyPlanRow, type RpaDecision, type WeekDemandResult, type WeekPlanProposal } from "@kgr/engine";
import { minus, num, tgl, tglShort } from "../fmt";
import type { ChartPoint } from "@/components/v4/Chart";
import type { Col, TRow } from "@/components/v4/Table";
import type { StepDef } from "@/components/v4/Controls";
import type { TileModel } from "./minggu-ini";
import type { TilePos } from "@/components/v4/Tile";

export interface RencanaInput {
  week: { start: string; update: string };
  demand: WeekDemandResult;
  proposal: WeekPlanProposal;
  days: { rows: DailyPlanRow[]; unplaced: number };
  cls: { code: string; avg_kg: string; note?: string | null } | null;
  supplyHeads: number;
  saved: { id: string; version: number; head_count: number; yield_provisional: boolean; needs_approval: boolean; approved: boolean; copied: boolean; output: Record<string, string>; surplus: Record<string, string>; rp_downgrade: string } | null;
  savedDays: { date: string; head_count: number; weight_class: string | null; cut_pattern: string | null; supplier: string | null; target_kg_by_key: Record<string, string>; limited_by: string | null }[];
  capacity: (date: string) => number | null;
  lbSupply: (date: string) => number | null;
  controls: ControlV3[];
  gates: { step: number; open: boolean; blockedBy: string[] }[];
  reasons: { code: string; reason: string }[];
  block2: RpaDecision | null;
  /** PRD v5 K25 (flag v5_costing): no action label in "Ekonomi rencana" — simulation figures only. */
  k25?: boolean;
  variance: { date: string; key: string; planned_kg: string | null; actual_kg: string | null; variance_kg: string | null; planned_heads: number | null; actual_heads: number | null }[];
  blockers: { save: string[]; approve: string[]; copy: string[] };
  alokasiHref: string;
  /** Replacement buy price of a unit: the C41 suggestion is "beli trading" when there is one. */
  buyPrice: (unit: string) => string | null;
}

export interface RencanaModel {
  title: string;
  tiles: TileModel[];
  /** Tiles that carry an action bar, with the reason it is disabled (null = enabled). */
  actions: { tile: string; action: "save" | "approve" | "copy" | "reason"; disabledReason: string | null }[];
}

const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const kg0 = (v: Decimal | string | null | undefined) => (v === null || v === undefined ? "" : minus(num(v, 0)));
const n0 = (v: Decimal | string | number) => minus(num(v, 0));
const SARAN: Record<string, string> = { buy_trading: "beli trading", reduce_order: "kurangi order" };
/** "NEGOSIASI ≤ Rp 20.726: …" → "Negosiasi ≤ Rp 20.726" (sentence case, §6.4). */
export function sentenceCase(text: string): string {
  const head = text.split(":")[0].trim();
  const [w, ...rest] = head.split(" ");
  return [w.charAt(0) + w.slice(1).toLowerCase(), ...rest].join(" ");
}

function statusText(cs: ControlV3[], codes: string[]): string {
  const bad = cs.filter((c) => codes.includes(c.code) && c.status !== "LULUS" && c.status !== "N/A");
  if (!bad.length) return "lulus";
  const label: Record<string, string> = { C41: "by-product kurang", C42: "yield sementara", C44: "forecast kosong", C45: "stok basi", C46: "harga kosong", C47: "kapasitas belum diisi", C30: "melebihi kapasitas" };
  const st = (s: ControlV3Status) => (s === "BELUM DIISI" ? "" : `${s}: `);
  return bad.map((c) => `${st(c.status)}${label[c.code] ?? c.code}`).join(", ");
}

export function rencanaModel(x: RencanaInput): RencanaModel {
  const tiles: TileModel[] = [];
  const actions: RencanaModel["actions"] = [];
  const d = x.demand, p = x.proposal.plan;
  const gate = (n: number) => x.gates.find((g) => g.step === n) ?? { step: n, open: true, blockedBy: [] };
  const weekLabel = `${Number(x.week.start.slice(8, 10))}–${tglShort(addDays(x.week.start, 6))}`;

  // ---------------------------------------------------------------- stepper
  const steps: StepDef[] = [
    { n: 1, label: "Demand", status: statusText(x.controls, ["C41", "C44", "C45"]) },
    { n: 2, label: "Rencana mingguan", status: x.saved ? `versi ${x.saved.version}${x.saved.yield_provisional ? ", yield sementara" : ""}` : statusText(x.controls, ["C42", "C46"]), locked: gate(2).open ? null : "selesaikan langkah 1 dulu" },
    { n: 3, label: "Rencana harian", status: statusText(x.controls, ["C30", "C47"]), locked: gate(3).open ? null : "selesaikan langkah 2 dulu" },
    { n: 4, label: "Alokasi", status: "buka alokasi hari ini", href: x.alokasiHref, locked: gate(4).open ? null : "selesaikan langkah 3 dulu" },
  ];
  const current = !gate(2).open ? 1 : !gate(3).open ? 2 : !gate(4).open ? 3 : 4;
  tiles.push({ id: "stepper", pos: P(0, 0, 12, 1), kind: "bare", content: { type: "stepper", steps, current } });

  // ---------------------------------------------------------------- step 1: demand per production unit
  const units = new Map<string, { weighted: Decimal; stock: Decimal; cls: "main" | "by_product" }>();
  for (const r of d.rows) {
    if (!r.unit) continue;
    const u = units.get(r.unit) ?? { weighted: D(0), stock: D(0), cls: r.product_class === "by_product" ? "by_product" as const : "main" as const };
    u.weighted = u.weighted.plus(r.weighted_kg); u.stock = u.stock.plus(r.stock_free_kg).plus(r.substituted_kg);
    units.set(r.unit, u);
  }
  const headsRow = (u: string) => d.heads.patterns.flatMap((q) => q.rows).find((r) => r.key === u) ?? null;
  const short = (u: string) => d.shortfalls.find((s) => s.key === u) ?? null;
  const binding = new Set(d.binding);
  const order = [...units.keys()].sort((a, b) => Number(units.get(a)!.cls === "by_product") - Number(units.get(b)!.cls === "by_product") || Number(binding.has(b)) - Number(binding.has(a)) || a.localeCompare(b));
  const dCols: Col[] = [
    { key: "u", label: "Unit", kind: "key" }, { key: "w", label: "Berbobot kg", num: true, kind: "sup" }, { key: "s", label: "Stok layak", num: true, kind: "sup" },
    { key: "n", label: "Net kg", num: true }, { key: "k", label: "kg/ekor", num: true }, { key: "h", label: "Ekor", num: true, kind: "key" }, { key: "x", label: "Kurang kg", num: true }, { key: "a", label: "Saran", kind: "sup" },
  ];
  const dRows: TRow[] = order.map((u) => {
    const info = units.get(u)!;
    const net = d.unitNet.find((q) => q.key === u)?.kg ?? D(0);
    const hr = headsRow(u), sh = short(u);
    const main = info.cls === "main";
    const kph = main ? hr?.kg_per_head ?? null : sh?.kg_per_head ?? null;
    return {
      id: u,
      cells: {
        u: `${u}${binding.has(u) ? " (binding)" : ""}`, w: kg0(info.weighted), s: kg0(info.stock), n: kg0(net), k: kph ? num(kph, 4) : "tanpa yield",
        h: main ? (binding.has(u) ? num(x.demand.heads.patterns.find((q) => q.binding === u)?.heads ?? 0, 0) : hr ? num(hr.heads.ceil(), 0) : "") : "tidak menentukan ekor",
        x: sh && sh.shortfall_kg.gt(0) ? kg0(sh.shortfall_kg) : "", a: sh && sh.shortfall_kg.gt(0) ? SARAN[x.buyPrice(u) !== null ? "buy_trading" : "reduce_order"] : "",
      },
    };
  });
  const bought = d.rows.filter((r) => !r.unit && r.net_kg.gt(0));
  const c41 = x.controls.find((c) => c.code === "C41");
  tiles.push({
    id: "t-demand", pos: P(0, 1, 8, 5), kind: "tall", title: `Langkah 1: demand per SKU, minggu ${weekLabel}`,
    note: [bought.length ? `${bought.length} SKU trading dibeli, tidak dipotong.` : "", c41 && c41.status === "PERIKSA" ? (x.reasons.find((r) => r.code === "C41") ? `Alasan C41: ${x.reasons.find((r) => r.code === "C41")!.reason}` : "By-product kurang: tulis alasan untuk membuka langkah 2.") : ""].filter(Boolean).join(" ") || undefined,
    cara: { title: "Demand per unit potong", fn: "weekDemand (K1, K2)", rule: "PO pasti 100%, tentatif 70%, forecast 50% (forecast Sales menggantikan forecast statistik); dikurangi stok layak pada tanggal kirim; ekor = net ÷ kg/ekor produk utama (K1); by-product hanya ikut, kekurangannya disarankan beli trading atau kurangi order.", period: weekLabel, basis: "PO, forecast, stok ledger", status: "draft", sources: [{ label: "Tabel", value: "sales_line, forecast_line, lot_balance_daily, yield_matrix" }] },
    content: { type: "table", cols: dCols, rows: dRows, limit: 12 },
  });
  if (c41 && c41.status === "PERIKSA" && !x.reasons.find((r) => r.code === "C41")) actions.push({ tile: "t-demand", action: "reason", disabledReason: null });

  const pts: ChartPoint[] = order.map((u) => {
    const main = units.get(u)!.cls === "main";
    const net = d.unitNet.find((q) => q.key === u)?.kg ?? D(0);
    const kph = main ? headsRow(u)?.kg_per_head ?? null : short(u)?.kg_per_head ?? null;
    const h = kph && !kph.isZero() ? net.div(kph).ceil() : null;
    return {
      key: u, label: u.split(" ")[0], bar: h ? h.toNumber() : null, barText: h ? num(h, 0) : undefined, barTone: (main ? "s1" : "s3") as "s1" | "s3",
      title: main ? `${u}: ${num(h ?? 0, 0)} ekor${binding.has(u) ? " (binding)" : ""}` : `${u}: ${num(h ?? 0, 0)} ekor bila dipakai, tidak menentukan ekor (K1)`,
    };
  }).filter((q) => q.bar !== null);
  tiles.push({
    id: "ch-ekor", pos: P(8, 1, 4, 5), kind: "tall", title: "Ekor per produk utama",
    note: d.shortfalls.length ? "By-product ditampilkan abu-abu: tidak menentukan ekor." : undefined,
    content: { type: "combo", points: pts, legend: [{ tone: "s1", label: "produk utama" }, { tone: "s3", label: "by-product" }] },
  });

  // ---------------------------------------------------------------- step 2: weekly plan and economics
  const avg = x.cls?.avg_kg ?? "2";
  const c42 = x.controls.find((c) => c.code === "C42");
  const provisional = c42 ? c42.status !== "LULUS" : true;
  const rCols: Col[] = [{ key: "k", label: "", kind: "key" }, { key: "v", label: "Nilai", num: true }];
  const surplusKg = Object.values(p.surplus_kg_by_key).reduce((a, v) => a.plus(v), D(0));
  const rRows: TRow[] = [
    { id: "heads", cells: { k: "Ekor", v: num(p.head_count, 0) } },
    { id: "lb", cells: { k: `kg live bird (${x.cls?.code ?? "kelas"} ${num(avg, 1)} kg)`, v: num(D(p.head_count).times(D(avg)), 0) } },
    { id: "mix", cells: { k: "Pola potong", v: Object.entries(x.proposal.patternMix).map(([k, h]) => `${k} ${num(h, 0)}`).join(", ") || "belum ada" } },
    { id: "frozen", cells: { k: "Surplus direncanakan frozen", v: `${kg0(surplusKg)} kg` } },
    { id: "down", cells: { k: "Rp downgrade", v: x.controls.find((c) => c.code === "C46")?.status === "LULUS" ? n0(p.rp_downgrade) : "harga belum diisi" } },
    { id: "yield", cells: { k: "Yield", v: provisional ? "sementara (placeholder)" : "final" } },
    { id: "appr", cells: { k: "Perlu approval", v: p.needsApproval ? "ya" : "tidak" } },
    { id: "ver", cells: { k: "Versi tersimpan", v: x.saved ? `v${x.saved.version}${x.saved.approved ? ", disetujui" : x.saved.needs_approval ? ", menunggu approval" : ""}${x.saved.copied ? ", sudah disalin ke batch" : ""}` : "belum ada" } },
  ];
  tiles.push({
    id: "t-rencana", pos: P(0, 6, 8, 4), kind: "tall", title: `Langkah 2: rencana mingguan ${x.saved ? `versi ${x.saved.version + 1}` : "versi 1"}`,
    content: { type: "table", cols: rCols, rows: rRows },
  });
  const saveReason = !gate(2).open ? `langkah 1: ${gate(2).blockedBy.join(", ")} belum lulus` : x.blockers.save.length ? x.blockers.save.join(", ") : provisional ? null : null;
  actions.push({ tile: "t-rencana", action: "save", disabledReason: saveReason });
  if (x.saved?.needs_approval && !x.saved.approved) actions.push({ tile: "t-rencana", action: "approve", disabledReason: x.blockers.approve.length ? x.blockers.approve.join(", ") : null });

  if (x.block2) {
    const b = x.block2;
    const eCols: Col[] = [{ key: "k", label: "", kind: "key" }, { key: "v", label: "Rp/kg", num: true }];
    tiles.push({
      id: "ekonomi", pos: P(8, 6, 4, 4), kind: "tall", title: "Ekonomi rencana",
      cara: { title: "Ekonomi rencana", fn: "rpaDecision (blok 2 v1)", rule: "Breakeven = nilai output per kg LB pada porsi fresh rencana; margin per kg LB = breakeven − harga LB hari ini.", period: `${tgl(b.horizonFrom)} s.d. ${tgl(b.horizonTo)}`, basis: "parameter minggu, harga acuan", status: "draft", sources: [{ label: "Tabel", value: "engine mingguan blok 2" }] },
      content: {
        type: "table", cols: eCols,
        rows: [
          { id: "lb", cells: { k: "Harga LB hari ini", v: n0(b.lbPriceToday) } },
          { id: "be", cells: { k: "Breakeven porsi fresh rencana", v: n0(b.breakevenAtPlanShare) } },
          { id: "m", cells: { k: "Margin per kg LB", v: n0(b.marginPerKgLb) } },
          ...(x.k25 ? [] : [{ id: "a", cells: { k: "Aksi", v: sentenceCase(b.action.text) } }]),
        ],
      },
    });
  }

  // ---------------------------------------------------------------- step 3: daily plan and actual vs plan
  const days = x.savedDays.length
    ? x.savedDays.map((s) => ({ date: s.date, heads: s.head_count, cls: s.weight_class, pattern: s.cut_pattern, supplier: s.supplier, karkas: s.target_kg_by_key.Karkas ?? null, limited: s.limited_by }))
    : x.days.rows.map((r) => ({ date: r.date, heads: r.head_count, cls: x.cls?.code ?? null, pattern: Object.keys(x.proposal.patternMix)[0] ?? null, supplier: null, karkas: null, limited: r.limited_by }));
  const hCols: Col[] = [
    { key: "d", label: "Tanggal", kind: "key" }, { key: "h", label: "Ekor", num: true }, { key: "c", label: "Kapasitas", num: true }, { key: "l", label: "LB supply", num: true },
    { key: "w", label: "Kelas", kind: "sup" }, { key: "p", label: "Pola", kind: "sup" }, { key: "sp", label: "Supplier", kind: "sup" }, { key: "t", label: "Target karkas kg", num: true }, { key: "s", label: "Status", kind: "sup" },
  ];
  const hRows: TRow[] = days.filter((r) => r.heads > 0).map((r) => {
    const cap = x.capacity(r.date), lb = x.lbSupply(r.date);
    return {
      id: r.date,
      cells: {
        d: `${dayName(r.date).slice(0, 3)} ${tglShort(r.date)}`, h: num(r.heads, 0), c: cap === null ? "belum diisi" : num(cap, 0), l: lb === null ? "" : num(lb, 0),
        w: r.cls ?? "", p: r.pattern ?? "", sp: r.supplier ?? "", t: r.karkas ? kg0(r.karkas) : "",
        s: cap === null ? "belum diisi" : r.limited === "capacity" ? "dibatasi kapasitas" : r.limited === "supply" ? "dibatasi supply" : "",
      },
    };
  });
  tiles.push({
    id: "t-harian", pos: P(0, 10, 12, 4), kind: "tall", title: `Langkah 3: rencana harian${x.saved ? ` versi ${x.saved.version}` : " (usulan)"}`,
    note: x.days.unplaced ? `${num(x.days.unplaced, 0)} ekor tidak muat di hari mana pun (kapasitas atau supply).` : undefined,
    content: { type: "table", cols: hCols, rows: hRows, limit: 8 },
  });
  const copyReason = !x.saved ? "simpan rencana dulu" : !gate(3).open ? `langkah 2: ${gate(3).blockedBy.join(", ")} belum lulus` : x.blockers.copy.length ? x.blockers.copy.join(", ") : null;
  actions.push({ tile: "t-harian", action: "copy", disabledReason: copyReason });

  const vCols: Col[] = [
    { key: "d", label: "Tanggal", kind: "key" }, { key: "u", label: "Unit" }, { key: "p", label: "Rencana kg", num: true }, { key: "a", label: "Aktual kg", num: true },
    { key: "v", label: "Varian kg", num: true, kind: "key" }, { key: "hp", label: "Ekor rencana", num: true, kind: "sup" }, { key: "ha", label: "Ekor aktual", num: true, kind: "sup" },
  ];
  const vRows: TRow[] = x.variance.filter((v) => v.actual_kg !== null || v.planned_kg !== null).map((v) => ({
    id: `${v.date}|${v.key}`,
    cells: { d: `${dayName(v.date).slice(0, 3)} ${tglShort(v.date)}`, u: v.key, p: v.planned_kg === null ? "tidak direncanakan" : kg0(v.planned_kg), a: v.actual_kg === null ? "belum ada" : kg0(v.actual_kg), v: v.variance_kg === null ? "" : kg0(v.variance_kg), hp: v.planned_heads === null ? "" : num(v.planned_heads, 0), ha: v.actual_heads === null ? "" : num(v.actual_heads, 0) },
  }));
  tiles.push({ id: "t-varian", pos: P(0, 14, 12, 4), kind: "tall", title: "Aktual lawan rencana per unit per hari", content: { type: "table", cols: vCols, rows: vRows, limit: 10 } });

  tiles.push({ id: "link-alokasi", pos: P(0, 18, 12, 1), kind: "bare", content: { type: "list", items: [`Langkah 4: alokasi stok ke PO dikerjakan di halaman Alokasi hari ini (${tgl(x.week.update)}).`] } });
  return { title: `Rencana minggu ${weekLabel}`, tiles, actions };
}
