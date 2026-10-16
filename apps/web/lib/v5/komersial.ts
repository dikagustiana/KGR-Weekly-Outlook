/**
 * Model of the Commercial screen v5 (PRD v5 §4.6, §6.2; mockup reference/design/v5/Commercial.dc.html), pure: stock
 * to sell (@kgr/engine stockSellRows / stockSummary / filterRows / spotRows), next week's commitments (K26), PPIC's
 * surplus and by-product shortfall, C52. Numbers come from the engine; this file places and labels them.
 */
import type { ControlV3, Decimal, SpotRow, StockFilter, StockSellRow, StockSummary } from "@kgr/engine";
import { jtV4, minus, num, pctV4, tglShort } from "../fmt";
import type { Col, TRow } from "@/components/v4/Table";
import type { TilePos } from "@/components/v4/Tile";
import type { TileModel } from "../v4/minggu-ini";

export interface CommitmentRow {
  /** Base key (RPA|Karkas). */
  key: string;
  thisWeekKg: Decimal | null;
  fresh: string | null;
  frozen: string | null;
  price: string | null;
  status: "draft" | "locked" | "belum diisi";
  version: number | null;
}

export interface KomersialV5Input {
  today: string;
  roleLabel: string;
  sales: boolean;
  base: string;
  filter: StockFilter;
  stockDate: string | null;
  rows: StockSellRow[];
  summary: StockSummary;
  holdingRate: Decimal | null;
  approvalsWaiting: number;
  cutOffTime: string;
  commitment: { weekStart: string; weekEnd: string; deadline: string; rows: CommitmentRow[]; canEdit: boolean; canLock: boolean; priceListLocked: boolean };
  ppic: {
    shipRange: string; surplusKg: Decimal | null; downgrade: Decimal | null; planCostKarkas: Decimal | null; lbPrice: Decimal | null;
    answered: string | null; byProducts: { unit: string; order: Decimal; output: Decimal; short: Decimal }[];
  } | null;
  spot: SpotRow[];
  controls: ControlV3[];
}

const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const kg = (v: Decimal | string | null | undefined) => (v === null || v === undefined ? "" : minus(num(v, 0)));
const rp = (v: Decimal | string | null | undefined, missing = "belum diisi") => (v === null || v === undefined ? missing : minus(num(v, 0)));
const URG: Record<string, string> = { jual_hari_ini: "jual hari ini", di_atas_umur: "di atas batas umur", jual_minggu_ini: "jual minggu ini", aman: "aman" };
const STATUS: Record<string, string> = { estimasi: "estimasi", sementara: "sementara", final: "final", rencana: "rencana" };
const skuLabel = (key: string) => { const [seg, sku, form] = key.split("|"); return `${sku}${form && form !== "n/a" ? ` ${form.toLowerCase()}` : ""} · ${seg}`; };
const FILTERS: [StockFilter, string][] = [["all", "Semua stok bebas"], ["hari", "Jual hari ini"], ["batas", "Di atas batas umur"], ["below", "Di bawah biaya"]];

export function komersialV5Model(x: KomersialV5Input): { title: string; tiles: TileModel[] } {
  const tiles: TileModel[] = [];
  const s = x.summary;
  const href = (f: StockFilter) => (f === "all" ? x.base : `${x.base}?filter=${f}`);
  tiles.push({ id: "filter", pos: P(0, 0, 7, 1), kind: "bare", content: { type: "slicer", label: "Tampilkan", current: x.filter, options: FILTERS.map(([v, label]) => ({ value: v, label, href: href(v) })) } });
  tiles.push({
    id: "konteks", pos: P(7, 0, 5, 1), kind: "bare",
    content: { type: "headline", text: `${tglShort(x.today)} · ${x.roleLabel}. Cut-off fresh ${x.cutOffTime}. Komitmen minggu depan dikunci ${x.commitment.deadline}. ${x.sales ? "Anda melihat SKU dan pelanggan yang ditugaskan." : "Kepala Sales melihat semua SKU dan pelanggan."}` },
  });
  tiles.push({
    id: "headline", pos: P(0, 1, 12, 1), kind: "bare",
    content: { type: "headline", text: s.skus ? `Stok Rp ${jtV4(s.value)} jt belum punya PO; ${kg(s.fresh.kg)} kg fresh harus laku hari ini${s.below.skus ? `, dan ${s.below.skus} SKU di bawah biaya pada harga acuan` : ""}.` : "Tidak ada stok bebas pada data mart terakhir." },
  });

  // ---------------------------------------------------------------- rows 2–3: cards
  tiles.push({ id: "c-stok", pos: P(0, 2, 3, 2), kind: "card", title: "Stok bebas belum ke PO", content: { type: "card", value: jtV4(s.value), unit: "Rp jt", compare: [{ label: "kg", value: kg(s.kg) }, { label: "SKU", value: String(s.skus) }, ...(s.missingCost ? [{ label: "tanpa biaya", value: `${s.missingCost} SKU` }] : [])] } });
  tiles.push({ id: "c-hari", pos: P(3, 2, 2, 2), kind: "card", title: "Jual hari ini (fresh)", content: { type: "card", value: kg(s.fresh.kg), unit: "kg", compare: [{ label: "Rp jt", value: jtV4(s.fresh.value) }, { label: "SKU", value: String(s.fresh.skus) }] } });
  tiles.push({ id: "c-bawah", pos: P(5, 2, 3, 2), kind: "card", title: "Di bawah biaya pada harga acuan", content: { type: "card", value: String(s.below.skus), unit: "SKU", compare: [{ label: "bila dijual di acuan", value: `${jtV4(s.below.loss.neg())} jt`, tone: s.below.loss.gt(0) ? "neg" : undefined }] } });
  tiles.push({ id: "c-simpan", pos: P(8, 2, 2, 2), kind: "card", title: "Rugi simpan per hari", content: s.holdingPerDay ? { type: "card", value: jtV4(s.holdingPerDay), unit: "Rp jt", compare: [{ label: "tarif", value: x.holdingRate ? `${pctV4(x.holdingRate, 3)} per hari` : "" }] } : { type: "card", value: null, missing: "tarif simpan belum ada", compare: [] } });
  tiles.push({ id: "c-approval", pos: P(10, 2, 2, 2), kind: "card", title: "Approval diskon menunggu", content: { type: "card", value: String(x.approvalsWaiting), unit: "permintaan", compare: [], href: "/komersial/approval" } });

  // ---------------------------------------------------------------- rows 4–9: ranking
  const cols: Col[] = [
    { key: "i", label: "#", num: true }, { key: "k", label: "SKU", kind: "key" }, { key: "u", label: "Urgensi" }, { key: "kg", label: "Bebas kg", num: true }, { key: "a", label: "Umur", num: true },
    { key: "o", label: "> batas", num: true }, { key: "cs", label: "Status biaya" }, { key: "fl", label: "Lantai/kg", num: true, kind: "key" }, { key: "ref", label: "Acuan/kg", num: true },
    { key: "m", label: "Margin/kg", num: true }, { key: "h", label: "Rugi simpan/hari", num: true, kind: "sup" }, { key: "l", label: "Rugi di acuan", num: true },
  ];
  const tRows: TRow[] = x.rows.map((r, i) => ({
    id: r.key, href: `/komersial/${encodeURIComponent(r.key)}`, redNeg: true,
    cells: {
      i: String(i + 1), k: skuLabel(r.key), u: URG[r.urgency ?? "aman"] ?? r.urgency ?? "", kg: kg(r.free_kg), a: r.oldest_age_days === null ? "" : `${num(r.oldest_age_days, 1)} hr`,
      o: r.over_age_kg.isZero() ? "" : kg(r.over_age_kg), cs: r.cost_status ? (STATUS[r.cost_status] ?? r.cost_status) : r.key.startsWith("Trading|") ? "final (faktur beli)" : "MA penerimaan",
      fl: rp(r.cost_per_kg), ref: rp(r.price_ref), m: r.margin_per_kg === null ? "—" : `${r.margin_per_kg.gt(0) ? "+" : ""}${minus(num(r.margin_per_kg, 0))}`,
      h: r.holding_per_day === null ? "" : `${num(r.holding_per_day.div(1000), 1)} rb`, l: r.loss_at_ref.isZero() ? "" : `${jtV4(r.loss_at_ref.neg())} jt`,
    },
  }));
  const filterLabel = (FILTERS.find((f) => f[0] === x.filter)?.[1] ?? "").toLowerCase();
  const checked = x.rows.filter((r) => r.cost_check === true);
  tiles.push({
    id: "t-ranking", pos: P(0, 4, 12, 6), title: `Stok yang harus dijual, urut prioritas · ${filterLabel}`,
    note: [x.rows.length > 16 ? `Menampilkan 16 dari ${x.rows.length} SKU.` : null,
      checked.length ? `${checked.map((r) => skuLabel(r.key)).join(", ")}: biaya per kg di atas batas kali harga acuan (C54, periksa biaya).` : null,
      x.stockDate ? `Stok per ${tglShort(x.stockDate)}.` : null].filter(Boolean).join(" ") || undefined,
    cara: {
      title: "Ranking stok", fn: "stockSellRows + filterRows", rule: "Urgensi: fresh = jual hari ini; frozen di atas batas umur; mendekati batas = jual minggu ini. Harga lantai = biaya per kg (markup default 0). Rugi simpan per hari = nilai stok × beban storage bulan lalu ÷ persediaan akhir bulan lalu ÷ hari. Rugi di acuan = (biaya − acuan) × kg bila acuan di bawah biaya.",
      basis: "commercial_daily", status: "draft", sources: [{ label: "Tabel", value: "commercial_daily (biaya dan status dari costing)" }, { label: "Tarif simpan", value: x.holdingRate ? pctV4(x.holdingRate, 3) : "belum ada" }],
    },
    content: { type: "table", cols, rows: tRows, limit: 16 },
  });

  // ---------------------------------------------------------------- rows 10–14: commitments, from PPIC
  const c = x.commitment;
  const locked = c.rows.length > 0 && c.rows.every((r) => r.status === "locked");
  const kCols: Col[] = [{ key: "k", label: "SKU", kind: "key" }, { key: "w", label: "Minggu ini", num: true, kind: "sup" }, { key: "f", label: "Fresh kg", num: true }, { key: "z", label: "Frozen kg", num: true }, { key: "p", label: "Harga list", num: true }, { key: "s", label: "Status" }];
  const kRows: TRow[] = c.rows.map((r) => ({ id: r.key, cells: { k: r.key.split("|")[1] ?? r.key, w: kg(r.thisWeekKg), f: r.fresh === null ? "" : kg(r.fresh), z: r.frozen === null ? "" : kg(r.frozen), p: r.price === null ? "" : rp(r.price), s: r.status === "locked" ? `terkunci v${r.version}` : r.status === "draft" ? `draft v${r.version}` : "belum diisi" } }));
  const c52 = x.controls.find((k) => k.code === "C52");
  tiles.push({
    id: "t-komitmen", pos: P(0, 10, 7, 5), kind: "tall", title: `Untuk PPIC: komitmen minggu depan, ${Number(c.weekStart.slice(8, 10))}–${tglShort(c.weekEnd)}`,
    note: `${locked ? "Terkunci" : `Belum dikunci; tenggat ${c.deadline}`}${c52 && c52.status === "BELUM DIISI" ? " (C52: rencana Senin memakai PO saja)" : ""}. Kg yang sanggup dijual per SKU dan harga list minggu depan; harga list dipakai costing minggu depan${c.priceListLocked ? " (terkunci)" : ""}.`,
    content: { type: "table", cols: kCols, rows: kRows },
  });
  const p = x.ppic;
  const pRows: TRow[] = p ? [
    { id: "sur", cells: { s: "Karkas surplus dari batch rencana", o: "", p: p.surplusKg === null ? "—" : `± ${kg(p.surplusKg)} kg`, k: p.downgrade === null ? "" : `turun ${jtV4(p.downgrade.neg())} jt` } },
    ...p.byProducts.filter((b) => b.short.gt(0)).sort((a, b) => b.short.cmp(a.short)).map((b) => ({ id: b.unit, redNeg: true, cells: { s: b.unit.split(" ")[0], o: kg(b.order), p: kg(b.output), k: minus(num(b.short.neg(), 0)) } })),
  ] : [];
  tiles.push({
    id: "t-ppic", pos: P(7, 10, 5, 5), kind: "tall", title: p ? `Dari PPIC: output rencana yang belum punya pembeli · ${p.shipRange}` : "Dari PPIC",
    note: p ? [p.surplusKg && p.surplusKg.gt(0) ? `Jadi frozen bila tidak terjual fresh${p.planCostKarkas ? `; biaya rencana ${rp(p.planCostKarkas)}/kg di LB ${rp(p.lbPrice)}` : ""}.` : "Rencana tidak menghasilkan surplus karkas.", p.answered ? `Jawaban: ${p.answered}.` : p.surplusKg && p.surplusKg.gt(0) ? "Belum dijawab; PPIC menunggu jawaban sebelum potong." : null, "By-product kurang: beli trading untuk menutup order, atau kurangi order."].filter(Boolean).join(" ") : "Belum ada rencana PPIC minggu ini.",
    content: { type: "table", cols: [{ key: "s", label: "SKU", kind: "key", wrap: true }, { key: "o", label: "Order", num: true }, { key: "p", label: "Output", num: true }, { key: "k", label: "Kurang", num: true }], rows: pRows },
  });

  // ---------------------------------------------------------------- rows 15–17: spot
  const sCols: Col[] = [{ key: "s", label: "SKU", kind: "key" }, { key: "kg", label: "Fresh bebas kg", num: true }, { key: "f", label: "Lantai/kg", num: true }, { key: "r", label: "Acuan/kg", num: true }, { key: "z", label: "Frozen/kg", num: true }, { key: "d", label: "Turun bila blast", num: true }, { key: "n", label: "Catatan", kind: "sup" }];
  tiles.push({
    id: "t-spot", pos: P(0, 15, 12, 3), title: `Jual spot sebelum cut-off ${x.cutOffTime} · fresh tanpa PO`,
    note: "Penjualan spot dicatat tanpa nomor PO dan masuk scorecard. Sisa yang belum laku saat cut-off diblast oleh PPIC.",
    content: { type: "table", cols: sCols, rows: x.spot.map((r) => ({ id: r.key, redNeg: true, cells: { s: skuLabel(r.key), kg: kg(r.free_kg), f: rp(r.floor), r: rp(r.price_ref), z: rp(r.price_frozen), d: r.downgrade === null ? "" : `${jtV4(r.downgrade.neg())} jt`, n: r.belowCost ? "acuan di bawah biaya: butuh approval" : "" } })) },
  });
  return { title: "Commercial", tiles };
}
