/**
 * Model of the page "Komersial" (PRD v4 §6.7) in the grammar of §5.3. Pure: the commercial mart rows the role may see
 * (lib/v3/commercial-view.ts already drops the lot cost, and MA when sales may not see it), the discount requests and
 * the spot state in; tiles and the actions beside them out. Every number comes from @kgr/engine (commercialRows,
 * spotCheck); this file places and labels it. A price floor or MA that is missing reads "belum diisi", never 0.
 */
import { D, spotCheck } from "@kgr/engine";
import type { CommercialViewRow } from "../v3/commercial-view";
import { URGENCY_LABEL } from "../v3/commercial-view";
import { jtV4, minus, num, tglShort } from "../fmt";
import type { Col, TRow } from "@/components/v4/Table";
import type { TileModel } from "./minggu-ini";

export interface ApprovalRow {
  id: string;
  key: string;
  customer: string | null;
  requested_price: string;
  floor_price: string;
  rp_per_kg_below: string;
  kg: string;
  total_below: string;
  status: "pending" | "approved" | "rejected";
  used: boolean;
  mine: boolean;
  mayDecide: boolean;
}

export interface KomersialInput {
  today: string;
  /** Date of the commercial mart read (latest built day ≤ today); null = not built. */
  date: string | null;
  role: string;
  rows: CommercialViewRow[];
  /** Sales without any assignment: default deny (§8 S2). */
  unassigned: boolean;
  /** clock: the calendar date of the clock when it differs from `today` (the data date); spot sales are for that day only. */
  spot: { enabled: boolean; cutOffTime: string; now: string; canRecord: boolean; clock?: string };
  approvals: ApprovalRow[];
  controls: { code: string; name: string; status: string; action: string }[] | null;
}

export interface KomersialAction { tile: string; action: "spot" | "decide" | "order"; id: string; disabledReason: string | null }

export interface KomersialModel { title: string; tiles: TileModel[]; actions: KomersialAction[]; spotKeys: { key: string; free: string; floor: string | null }[] }

const MISSING = "belum diisi";
const rpkg = (v: string | null) => (v === null ? MISSING : num(v, 0));
const kg = (v: string | null) => (v === null ? "" : num(v, 0));
const sumJt = (t: ReturnType<typeof D> | null) => (t === null ? null : jtV4(t));
const sumKg = (t: ReturnType<typeof D> | null) => (t === null ? MISSING : num(t, 0));
const urgent = (r: CommercialViewRow) => r.urgency === "jual_hari_ini" || r.urgency === "di_atas_umur";

export function komersialModel(x: KomersialInput): KomersialModel {
  const rows = x.rows;
  // a total over SKUs is known only when every SKU has the value (after B5 the cost columns are null for Sales without sales_sees_cost): one blank makes it
  // "tidak tersedia", never a smaller number or "0 jt" (R64)
  const sum = (f: (r: CommercialViewRow) => string | null) => rows.every((r) => f(r) !== null) ? rows.reduce((a, r) => a.plus(D(f(r)!)), D(0)) : null;
  const hot = rows.filter(urgent);
  const pending = x.approvals.filter((a) => a.status === "pending");
  const tiles: TileModel[] = [];
  const actions: KomersialAction[] = [];

  tiles.push({
    id: "c-hari-ini", pos: { x: 0, y: 0, w: 3, h: 2 }, title: "SKU jual hari ini", kind: "card",
    content: { type: "card", value: x.date ? String(hot.length) : null, missing: "belum dibangun", compare: [
      { label: "tanpa order hari ini", value: String(hot.filter((r) => !D(r.ordered_today_kg).gt(0)).length) },
      { label: "di atas batas umur", value: String(rows.filter((r) => r.urgency === "di_atas_umur").length) },
    ] },
  });
  tiles.push({
    id: "c-risiko", pos: { x: 3, y: 0, w: 3, h: 2 }, title: "Risiko turun ke frozen", kind: "card",
    content: { type: "card", value: x.date ? sumJt(sum((r) => r.downgrade_risk_rp)) : null, unit: "Rp jt", missing: x.date ? "tidak tersedia" : "belum dibangun", compare: [
      { label: "rugi simpan per hari", value: (() => { const t = sum((r) => r.holding_loss_per_day); return t === null ? "tidak tersedia" : `${jtV4(t, 2)} jt`; })() },
    ] },
  });
  tiles.push({
    id: "c-bebas", pos: { x: 6, y: 0, w: 3, h: 2 }, title: "SKU dengan stok bebas", kind: "card",
    content: { type: "card", value: x.date ? String(rows.length) : null, missing: "belum dibangun", compare: [
      { label: "fresh kg", value: sumKg(sum((r) => r.free_fresh_kg)) }, { label: "frozen kg", value: sumKg(sum((r) => r.free_frozen_kg)) },
    ] },
  });
  tiles.push({
    id: "c-approval", pos: { x: 9, y: 0, w: 3, h: 2 }, title: "Approval diskon menunggu", kind: "card",
    content: { type: "card", value: String(pending.length), compare: [
      { label: "di bawah lantai", value: `${jtV4(pending.reduce((a, p) => a.plus(D(p.total_below)), D(0)), 1)} jt` },
    ] },
  });

  const showMa = rows.some((r) => r.cost_per_kg_ma !== null) || x.role !== "sales";
  // v5 §4.1 (flag v5_costing): the cost per kg comes from costing with its status as text; C54 says "periksa"
  const v5 = rows.some((r) => r.cost_status !== null);
  const cols: Col[] = [
    { key: "n", label: "#", num: true }, { key: "k", label: "SKU", kind: "key" }, { key: "u", label: "Status" },
    { key: "ff", label: "Fresh bebas kg", num: true }, { key: "fz", label: "Frozen bebas kg", num: true }, { key: "a", label: "Umur hari", num: true },
    ...(v5 ? [...(showMa ? [{ key: "c", label: "Biaya Rp/kg", num: true }] : []), { key: "cs", label: "Status biaya" }] : showMa ? [{ key: "ma", label: "MA Rp/kg", num: true }] : []),
    { key: "fl", label: "Lantai Rp/kg", num: true, kind: "key" as const }, { key: "pl", label: "List Rp/kg", num: true },
    { key: "ml", label: "Margin/kg list", num: true }, { key: "p7", label: "Harga 7 hari", num: true }, { key: "m7", label: "Margin/kg 7 hari", num: true },
    { key: "hl", label: "Rugi simpan/hari Rp", num: true, kind: "sup" }, { key: "ot", label: "Order hari ini kg", num: true, kind: "sup" },
  ];
  const tRows: TRow[] = rows.map((r) => ({
    id: r.key, href: `/komersial/${encodeURIComponent(r.key)}`,
    cells: {
      n: r.rank === null ? "" : String(r.rank), k: r.key, u: URGENCY_LABEL[r.urgency ?? "aman"] ?? r.urgency ?? "",
      ff: kg(r.free_fresh_kg), fz: kg(r.free_frozen_kg), a: r.oldest_age_days === null ? "" : String(r.oldest_age_days),
      ma: rpkg(r.cost_per_kg_ma), fl: rpkg(r.price_floor), pl: rpkg(r.price_list),
      c: rpkg(r.cost_per_kg), cs: r.cost_status === null ? "" : `${r.cost_status}${r.cost_check ? " · periksa biaya" : ""}`,
      ml: r.margin_per_kg_list === null ? MISSING : minus(num(r.margin_per_kg_list, 0)), p7: rpkg(r.realized_price_7d),
      m7: r.margin_per_kg_realized === null ? MISSING : minus(num(r.margin_per_kg_realized, 0)),
      hl: r.holding_loss_per_day === null ? "" : num(r.holding_loss_per_day, 0), ot: kg(r.ordered_today_kg),
    },
  }));
  tiles.push({
    id: "t-ranking", pos: { x: 0, y: 2, w: 12, h: 6 }, title: x.date ? `Stok yang harus dijual, per ${tglShort(x.date)}` : "Stok yang harus dijual",
    note: x.unassigned ? "Belum ada penugasan SKU untuk Anda. Minta penugasan ke commercial lead." : ["Urutan: di atas batas umur, jual hari ini, jual minggu ini, aman; lalu rugi simpan per hari dan risiko turun ke frozen.",
      ...(v5 ? ["Biaya per kg dari costing; status biaya: estimasi = kg LB × yield standar, sementara = dari WP potong, final = setelah alokasi diposting."] : []),
      ...(v5 && rows.some((r) => r.cost_check) ? [`Periksa biaya (C54): ${rows.filter((r) => r.cost_check).map((r) => r.key).join(", ")} — biaya per kg di atas batas kali harga acuan.`] : [])].join(" "),
    content: { type: "table", cols, rows: tRows, limit: 12 },
  });

  // spot (K8): fresh SKUs "jual hari ini" with free kg, before the cut-off
  const spotRows = rows.filter((r) => r.urgency === "jual_hari_ini" && D(r.free_fresh_kg).gt(0));
  const pageReason = spotCheck({ spotEnabled: x.spot.enabled, today: x.spot.clock ?? x.today, date: x.today, now: x.spot.now, cutOffTime: x.spot.cutOffTime, urgency: "jual_hari_ini", freeFreshKg: null, kg: null })[0] ?? null;
  const sCols: Col[] = [{ key: "k", label: "SKU", kind: "key" }, { key: "f", label: "Fresh bebas kg", num: true }, { key: "fl", label: "Lantai Rp/kg", num: true }, { key: "h", label: "Jam ke cut-off", num: true, kind: "sup" }];
  tiles.push({
    id: "t-spot", pos: { x: 0, y: 8, w: 6, h: 4 }, title: `Jual spot sebelum cut-off ${x.spot.cutOffTime.slice(0, 5)}`,
    note: !x.spot.canRecord ? "Penjualan spot dicatat Sales atau commercial lead." : pageReason ? `Spot tidak bisa dicatat: ${pageReason}.` : "Tanpa nomor PO; harga di bawah lantai butuh approval. Sisa yang belum terjual diblast saat cut-off.",
    content: { type: "table", cols: sCols, rows: spotRows.map((r) => ({ id: r.key, cells: { k: r.key, f: kg(r.free_fresh_kg), fl: rpkg(r.price_floor), h: r.hours_to_cutoff === null ? "" : String(r.hours_to_cutoff) } })) },
  });
  if (x.spot.canRecord && spotRows.length) actions.push({ tile: "t-spot", action: "spot", id: "spot", disabledReason: pageReason });

  const aCols: Col[] = [
    { key: "k", label: "SKU", kind: "key" }, { key: "c", label: "Pelanggan" }, { key: "p", label: "Harga", num: true }, { key: "f", label: "Lantai", num: true },
    { key: "b", label: "Di bawah Rp/kg", num: true }, { key: "q", label: "kg", num: true }, { key: "s", label: "Status" },
  ];
  const shown = x.approvals.filter((a) => a.status === "pending" || (a.status === "approved" && !a.used && a.mine));
  tiles.push({
    id: "t-approval", pos: { x: 6, y: 8, w: 6, h: 4 }, title: "Approval diskon",
    note: "Order di bawah lantai ditolak server sampai disetujui; satu approval untuk satu order. Pengaju tidak memutuskan permintaannya sendiri.",
    content: {
      type: "table", cols: aCols,
      rows: shown.map((a) => ({ id: a.id, cells: { k: a.key, c: a.customer ?? "", p: num(a.requested_price, 0), f: num(a.floor_price, 0), b: num(a.rp_per_kg_below, 0), q: num(a.kg, 0), s: a.status === "pending" ? "menunggu" : "disetujui, belum jadi order" } })),
    },
  });
  for (const a of shown) {
    if (a.status === "pending" && a.mayDecide) actions.push({ tile: "t-approval", action: "decide", id: a.id, disabledReason: a.mine ? "pengaju tidak memutuskan sendiri" : null });
    if (a.status === "approved" && a.mine && !a.used) actions.push({ tile: "t-approval", action: "order", id: a.id, disabledReason: null });
  }

  if (x.controls) {
    tiles.push({
      id: "t-kontrol", pos: { x: 0, y: 12, w: 12, h: 2 }, title: "Kontrol komersial",
      content: { type: "table", cols: [{ key: "c", label: "Kontrol", kind: "key" }, { key: "n", label: "Isi" }, { key: "s", label: "Status" }, { key: "a", label: "Tindakan", kind: "sup", wrap: true }],
        rows: x.controls.map((c) => ({ id: c.code, cells: { c: c.code, n: c.name, s: c.status, a: c.action } })) },
    });
  }
  return { title: "Komersial", tiles, actions, spotKeys: spotRows.map((r) => ({ key: r.key, free: r.free_fresh_kg, floor: r.price_floor })) };
}
