/**
 * Manajemen · Minggu ini v5 (PRD v5 §6.1, flag v5_management; mockup reference/design/v5/Main.dc.html), pure: the
 * live-bird simulation for the operations director (K25: @kgr/engine simulateLivebird, never a recommendation), the
 * decisions waiting this week with their owner, the status of the weekly loop (§3.2), and the source label of the main
 * numbers (K36). Numbers come from the engine and the marts; this file places and words them.
 */
import { D, addDays, type Decimal, type LivebirdSimulation } from "@kgr/engine";
import { ROLE_LABEL, type Role } from "../roles";
import { jtV4, minus, num, pctV4 } from "../fmt";
import { K25_DECIDER } from "./k25";
import type { Col, TRow } from "@/components/v4/Table";
import type { TileModel } from "../v4/minggu-ini";
import { withFailures, type Failed } from "../v4/tile-errors";

export type SimBasis = "need" | "batch";

export interface SourceLabel { text: string; late: boolean }
export interface DecisionLine { title: string; sub: string; owner: string }
export interface LoopLine { label: string; value: string; late: boolean }

export interface ManagementV5Input {
  sim: {
    basis: SimBasis;
    available: SimBasis[];
    labels: Partial<Record<SimBasis, string>>;
    price: Decimal;
    todayPrice: Decimal | null;
    prices: Decimal[];
    result: LivebirdSimulation | null;
    /** Latest decision for the next cut date (K25), shown next to the simulation. */
    decided: { date: string; price: Decimal; by: string | null } | null;
    /** Tomorrow on the wall clock (K38): the date the decision form records. */
    cutDate: string;
    /** The date the data stands on; named next to the cut date when they differ (K38). */
    dataDate: string;
    href: (basis: SimBasis, price: Decimal) => string;
  };
  decisions: DecisionLine[];
  loop: LoopLine[];
  /** K36 per card id (c-outlook, c-stok, c-kas, c-bulan, c-solvabilitas) and the P&L tile. */
  sources: Record<string, SourceLabel>;
  /** K41: tile id → message of the read that failed (sim-lb, keputusan). */
  failed?: Failed;
}

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const dm = (d: string) => `${DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}/${d.slice(5, 7)}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const dmShort = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const rp = (v: Decimal | null | undefined) => (v === null || v === undefined ? "belum ada" : minus(num(v, 0)));
const kg = (v: Decimal) => num(v, 0);
const MONTH = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** K36: "WP sementara · Cost Accounting · 26 Agu 09.12"; red when the input behind it is past its deadline. */
export function sourceLabel(x: { what: string; role: Role | null; at: string | null; late: boolean }): SourceLabel {
  const when = x.at ? `${Number(x.at.slice(8, 10))} ${MONTH[Number(x.at.slice(5, 7)) - 1]}${x.at.length > 10 ? ` ${x.at.slice(11, 16).replace(":", ".")}` : ""}` : "belum ada";
  return { text: [x.what, x.role ? ROLE_LABEL[x.role] : null, when].filter(Boolean).join(" · ") + (x.late ? " · lewat tenggat" : ""), late: x.late };
}

/** The price buttons of the simulation (§6.1: 20.000–26.000) plus today's price. */
export function simPrices(today: Decimal | null): Decimal[] {
  const ps = [20000, 21000, 22000, 23000, 24000, 25000, 26000].map((p) => D(p));
  if (today && today.gt(0) && !ps.some((p) => p.eq(today))) ps.push(today);
  return ps.sort((a, b) => a.cmp(b));
}

export interface DecisionFacts {
  lb: { cutDate: string; decided: boolean; today: Decimal | null; breakevenNeed: Decimal | null } | null;
  batch: { kgLb: Decimal; needKgLb: Decimal; surplusKg: Decimal; downgrade: Decimal | null; threshold: Decimal } | null;
  belowFloor: { count: number; top: { key: string; kg: Decimal; price: Decimal; floor: Decimal; totalBelow: Decimal } | null };
  cash: { min: Decimal; date: string } | null;
}

/** "Perlu keputusan minggu ini" (§6.1): what waits, with its owner. Nothing here proposes a choice (K25). */
export function decisionLines(f: DecisionFacts): DecisionLine[] {
  const out: DecisionLine[] = [];
  if (f.lb && !f.lb.decided) out.push({
    title: `Harga live bird untuk potong ${dm(f.lb.cutDate)}`,
    sub: `Harga hari ini ${rp(f.lb.today)}; breakeven rencana kebutuhan ${rp(f.lb.breakevenNeed)} Rp/kg LB.`,
    owner: "Direktur Operasional · hari ini",
  });
  if (f.batch && f.batch.kgLb.gt(f.batch.needKgLb)) out.push({
    title: `Batch rencana ${kg(f.batch.kgLb)} kg LB, ${kg(f.batch.kgLb.minus(f.batch.needKgLb))} kg di atas kebutuhan`,
    sub: `± ${kg(f.batch.surplusKg)} kg karkas jadi frozen, ${f.batch.downgrade ? `downgrade Rp ${jtV4(f.batch.downgrade)} jt${f.batch.downgrade.gt(f.batch.threshold) ? ` (di atas batas ${jtV4(f.batch.threshold)} jt)` : ""}` : "downgrade belum dihitung (harga frozen belum ada)"}.`,
    owner: "Direktur Operasional + PPIC · sebelum potong",
  });
  if (f.belowFloor.top) {
    const t = f.belowFloor.top;
    out.push({
      title: `${t.key.split("|").slice(1).join(" ").replace(/ n\/a$/, "")} dijual di bawah biaya`,
      sub: `${kg(t.kg)} kg order di ${rp(t.price)} vs lantai ${rp(t.floor)}; selisih Rp ${jtV4(t.totalBelow.neg())} jt${f.belowFloor.count > 1 ? `; ${f.belowFloor.count - 1} permintaan lain` : ""}.`,
      owner: "Kepala Sales · minggu ini",
    });
  }
  if (f.cash && f.cash.min.lt(0)) out.push({ title: "Pendanaan kas minggu ini", sub: `Kas terendah ${dm(f.cash.date)} Rp ${jtV4(f.cash.min)} jt tanpa pendanaan baru.`, owner: `Direksi · sebelum ${dm(f.cash.date)}` });
  return out;
}

export interface LoopFacts {
  commitment: { locked: boolean; drafts: number; deadline: string; late: boolean };
  planNext: { version: number | null };
  costing: { sementara: number; final: number; wpLate: string[] };
  lb: { cutDate: string; price: Decimal | null };
  /** null = no Commercial mart yet; error = the mart could not be read (K41). */
  freeStock: { kg: Decimal; value: Decimal } | { error: string } | null;
  /** PRD v5.1 R28: rows whose module is off (flag not enabled): "modul belum aktif", never late. */
  off?: Partial<Record<LoopRow, boolean>>;
}

export type LoopRow = "commitment" | "planNext" | "costing" | "freeStock";
/** The module behind each loop row that can be off. */
export const LOOP_MODULE: Record<LoopRow, "v5_commercial" | "v5_ppic_class" | "v5_costing" | "m7_commercial"> = {
  commitment: "v5_commercial", planNext: "v5_ppic_class", costing: "v5_costing", freeStock: "m7_commercial",
};
const OFF = "modul belum aktif";

/** "Status putaran" (§3.2): the hand-overs of the week, each as the data says. */
export function loopLines(f: LoopFacts): LoopLine[] {
  const lines: (LoopLine & { row?: LoopRow })[] = [
    { row: "commitment", label: "Komitmen Commercial minggu depan", value: f.commitment.locked ? `dikunci${f.commitment.drafts ? ` · ${f.commitment.drafts} SKU masih draft` : ""}` : `belum dikunci · tenggat ${f.commitment.deadline}`, late: !f.commitment.locked && f.commitment.late },
    { row: "planNext", label: "Rencana PPIC minggu depan", value: f.planNext.version !== null ? `versi ${f.planNext.version} tersimpan` : f.commitment.locked ? "belum disusun" : "menunggu komitmen", late: false },
    { label: `Harga LB potong ${dm(f.lb.cutDate)}`, value: f.lb.price ? `Rp ${rp(f.lb.price)} · Direktur Operasional` : "belum diputuskan", late: false },
    { row: "costing", label: "Costing batch minggu ini", value: `${f.costing.sementara} sementara, ${f.costing.final} final${f.costing.wpLate.length ? ` · WP ${f.costing.wpLate.join(", ")} terlambat` : ""}`, late: f.costing.wpLate.length > 0 },
    { row: "freeStock", label: "Stok bebas belum ke PO", value: !f.freeStock ? "belum ada mart Commercial" : "error" in f.freeStock ? `gagal dimuat (${f.freeStock.error})` : `${kg(f.freeStock.kg)} kg · Rp ${jtV4(f.freeStock.value)} jt`, late: !!f.freeStock && "error" in f.freeStock },
  ];
  return lines.map(({ row, ...l }) => (row && f.off?.[row] ? { label: l.label, value: OFF, late: false } : l));
}

const LABEL: Record<SimBasis, string> = { need: "Kebutuhan PO", batch: "Batch rencana" };
/** Rows of the two v5 tiles: the mockup gives 3 (rows 9–11); the SKU table and the loop status need 5 at the v4 type
 * scale (76 px rows), and journey K wants the decisions readable without scrolling (Q-v5-50). */
const ROWS = 5;

/**
 * The v5 tiles placed into the Minggu ini grid: the simulation (7 columns) and the decisions + loop status (5 columns)
 * right after the P&L tile (from row 9 of the mockup); every tile below moves down. The main cards carry their source
 * label (K36).
 */
/** K36: the source label under the tiles that carry a main number (Manajemen, Commercial, PPIC). */
export function withSources(tiles: TileModel[], sources: Record<string, SourceLabel>): TileModel[] {
  return tiles.map((t) => {
    const src = sources[t.id];
    return src ? { ...t, source: src } : t;
  });
}

export function managementV5(tiles: TileModel[], x: ManagementV5Input, opts: { at: number }): TileModel[] {
  const out = tiles.map((t): TileModel => (t.pos.y >= opts.at ? { ...t, pos: { ...t.pos, y: t.pos.y + ROWS } } : t));
  const s = x.sim, row = s.result?.rows.find((r) => r.price.eq(s.price)) ?? null;
  const cols: Col[] = [{ key: "k", label: "SKU", kind: "key" }, { key: "kg", label: "kg", num: true, kind: "sup" }, { key: "p", label: "Harga list", num: true }, { key: "c", label: "COGS/kg", num: true }, { key: "m", label: "Margin/kg", num: true, kind: "key" }];
  const rows: TRow[] = (row?.skus ?? []).map((k) => ({
    id: k.key, redNeg: true,
    cells: { k: k.key.split("|").slice(1).join(" ").replace(/ n\/a$/, " n/a"), kg: kg(k.kg), p: k.priceRef ? rp(k.priceRef) : "belum ada", c: k.costPerKg ? rp(k.costPerKg) : "", m: k.marginPerKg ? minus(num(k.marginPerKg, 0)) : "" },
  }));
  out.push({
    id: "sim-lb", pos: { x: 0, y: opts.at, w: 7, h: ROWS }, kind: "tall", title: "Simulasi harga live bird · untuk Direktur Operasional",
    cara: {
      title: "Simulasi harga live bird", fn: "simulateLivebird (mode rencana, @kgr/engine)",
      rule: "COGS rencana = kg LB × (harga LB + tarif angkut dan maklon); k = COGS ÷ nilai jual pada harga list; COGS/kg SKU = k × harga list; breakeven = nilai jual ÷ kg LB − tarif.",
      sources: [{ label: "Basis", value: s.basis === "need" ? "PO kirim di horizon per kelas, yield per kelas (placeholder sampai diisi PPIC)" : "batch rencana di horizon (blok 2), karkas berisiko frozen" }, { label: "Harga list", value: "harga acuan minggu ini" }],
      status: "simulasi; keputusan oleh Direktur Operasional (K25)",
    },
    note: (s.dataDate && s.cutDate && addDays(s.cutDate, -1) !== s.dataDate ? `Data per ${dmShort(s.dataDate)} · potong ${dm(s.cutDate)}. ` : "")
      + `${K25_DECIDER} Simulasi, bukan rekomendasi.` + (s.decided ? ` Keputusan potong ${dm(s.decided.date)}: Rp ${rp(s.decided.price)}${s.decided.by ? ` (${s.decided.by})` : ""}.` : ""),
    content: s.result && row ? {
      type: "kpis",
      controls: [
        { label: "Basis", current: s.basis, options: s.available.map((b) => ({ value: b, label: s.labels[b] ?? LABEL[b], href: s.href(b, s.price) })) },
        { label: "Harga LB", current: s.price.toFixed(0), options: s.prices.map((p) => ({ value: p.toFixed(0), label: `${num(p, 0)}${s.todayPrice && p.eq(s.todayPrice) ? " · hari ini" : ""}`, href: s.href(s.basis, p) })) },
      ],
      items: [
        { label: "COGS rencana", value: jtV4(row.cogs), sub: `Rp jt · ${kg(s.result.kgLb)} kg LB` },
        { label: "GP rencana", value: jtV4(row.gp), sub: `Rp jt · ${row.gpPct ? pctV4(row.gpPct) : "—"} dari nilai jual`, negative: row.gp.lt(0) },
        { label: "Breakeven live bird", value: rp(s.result.breakeven), sub: "Rp/kg LB pada rencana ini" },
        { label: "Margin per kg LB", value: row.marginPerKgLb ? minus(num(row.marginPerKgLb, 0)) : "", sub: "breakeven − harga dipilih", negative: !!row.marginPerKgLb?.lt(0) },
      ],
      cols, rows,
      foot: row.k ? `Di harga ${num(s.price, 0)} setiap SKU menanggung COGS ${num(row.k.times(100), 0)}% dari harga list${row.k.gt(1) ? ", jadi semua output rugi pada harga list" : ""}.` : undefined,
    } : { type: "list", items: [], empty: "Belum ada basis simulasi: kebutuhan PO per kelas atau batch rencana minggu ini belum ada." },
  });
  const dcols: Col[] = [{ key: "t", label: "Keputusan", kind: "key", wrap: true }, { key: "o", label: "Pemilik", kind: "sup", wrap: true }];
  out.push({
    id: "keputusan", pos: { x: 7, y: opts.at, w: 5, h: ROWS }, kind: "tall", title: "Perlu keputusan minggu ini",
    content: {
      type: "table", cols: dcols,
      rows: [
        ...(x.decisions.length ? x.decisions.map((d, i): TRow => ({ id: `d${i}`, cells: { t: `${d.title}. ${d.sub}`, o: d.owner } })) : [{ id: "d-none", span: true, cells: { t: "Tidak ada keputusan yang menunggu minggu ini." } }]),
        // the loop status (§3.2) under the decisions, one line each
        { id: "l-head", kind: "sub", span: true, cells: { t: "Status putaran" } },
        ...x.loop.map((l, i): TRow => ({ id: `l${i}`, span: true, cells: { t: `${l.label}: ${l.late ? `${l.value} · lewat tenggat` : l.value}` } })),
      ],
      limit: 20,
    },
  });
  return withFailures(withSources(out, x.sources), x.failed);
}
