/**
 * v3 controls C21–C40 (PRD v3 §4). Kept apart from the v1 Z_Kontrol list (controls 1–20): they live under the
 * snapshot key `controls_v3` and never change the weekly release status of v1.
 */
import { D, Decimal, ZERO, max, sum, type Num } from "./decimal";
import type { ControlStatus } from "./controls";
import { yieldGap, type AllocationResult, type CostPoolResult } from "./costing";

export type V3Module = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7";

export interface ControlV3 {
  code: string;
  module: V3Module;
  name: string;
  value: Decimal;
  comparator: Decimal | null;
  difference: Decimal | null;
  status: ControlStatus;
  action: string;
  /** Rows behind the status (batch, key, date …), for the preparer view. */
  detail: string[];
}

export interface ControlV3Summary {
  controls: ControlV3[];
  counts: Record<ControlStatus, number>;
  overall: "ADA GAGAL" | "PERIKSA" | "LULUS";
}

export function summarizeV3(controls: ControlV3[]): ControlV3Summary {
  const counts: Record<ControlStatus, number> = { LULUS: 0, GAGAL: 0, PERIKSA: 0, "BELUM DIISI": 0 };
  for (const c of controls) counts[c.status]++;
  return { controls, counts, overall: counts.GAGAL ? "ADA GAGAL" : counts.PERIKSA || counts["BELUM DIISI"] ? "PERIKSA" : "LULUS" };
}

const n = (x: number) => new Decimal(x);

export interface CostingBatchState {
  ref: string;
  status: string | null;
  processed_kg: Num | null;
  output_kg: Num;
  /** Status of the latest allocation_run of the batch (null = never allocated). */
  allocation_status: "draft" | "posted" | null;
}

/** C21–C24 (PRD v3 §4.2). */
export function costingControls(x: {
  allocations: Pick<AllocationResult, "batchRef" | "diff">[];
  batches: CostingBatchState[];
  pools: CostPoolResult[];
  yieldGapTolerance: Num;
}): ControlV3[] {
  const out: ControlV3[] = [];

  // C21 Σ allocated = total cost per batch (± Rp 1)
  const bad21 = x.allocations.filter((a) => a.diff.abs().gt(1));
  const worst = x.allocations.reduce((m, a) => max(m, a.diff.abs()), ZERO);
  out.push({
    code: "C21", module: "M1", name: "Alokasi biaya batch: Σ teralokasi = total biaya batch (± Rp 1)",
    value: n(bad21.length), comparator: n(0), difference: worst,
    status: x.allocations.length === 0 ? "BELUM DIISI" : bad21.length ? "GAGAL" : "LULUS",
    action: bad21.length ? "Lengkapi output SKU / harga acuan batch berikut, lalu Alokasikan ulang" : "",
    detail: bad21.map((a) => `${a.batchRef}: selisih ${a.diff.toFixed(0)}`),
  });

  // C22 Σ batch_output_sku.kg vs processed kg within tolerance (D1: 8–10% now → GAGAL until PPIC confirms)
  const tol = D(x.yieldGapTolerance);
  const rows22 = x.batches.filter((b) => b.status === "Aktual").map((b) => ({ b, g: yieldGap(b.processed_kg, b.output_kg) }));
  const known = rows22.filter((r) => r.g.gapPct !== null);
  const bad22 = known.filter((r) => r.g.gapPct!.abs().gt(tol) || D(r.b.output_kg).isZero());
  const worst22 = known.reduce((m, r) => max(m, r.g.gapPct!.abs()), ZERO);
  out.push({
    code: "C22", module: "M1", name: "Hasil SKU vs hasil potong per batch (toleransi parameter.yield_gap_tolerance)",
    value: n(bad22.length), comparator: tol, difference: worst22,
    status: rows22.length === 0 || known.length === 0 ? "BELUM DIISI" : bad22.length ? "GAGAL" : "LULUS",
    action: bad22.length ? "PPIC: cocokkan hasil potong per batch dengan Σ hasil SKU (WP); batch tanpa output diisi dulu" : "",
    detail: [
      ...bad22.map((r) => `${r.b.ref}: hasil potong ${D(r.b.processed_kg).toFixed(2)} kg, Σ SKU ${D(r.b.output_kg).toFixed(2)} kg (${r.g.gapPct!.times(100).toFixed(1)}%)`),
      ...rows22.filter((r) => r.g.gapPct === null).map((r) => `${r.b.ref}: hasil potong kosong`),
    ],
  });

  // C23 cost pool tie-out PI vs GL (± Rp 1)
  const bad23 = x.pools.filter((p) => p.diff !== null && !p.tied);
  const open23 = x.pools.filter((p) => p.diff === null);
  out.push({
    code: "C23", module: "M1", name: "Cost pool: Σ PI pemasok = Σ GL akun biaya RPA periode (± Rp 1)",
    value: n(bad23.length), comparator: n(0),
    difference: x.pools.reduce((m, p) => (p.diff === null ? m : max(m, p.diff.abs())), ZERO),
    status: x.pools.length === 0 || open23.length === x.pools.length ? "BELUM DIISI" : bad23.length ? "GAGAL" : open23.length ? "PERIKSA" : "LULUS",
    action: bad23.length ? "Cocokkan daftar PI dengan jurnal akun biaya RPA (akrual tanpa PI, PI belum diposting)" : open23.length ? "Isi total GL cost pool" : "",
    detail: bad23.map((p) => `PI ${p.totalPi.toFixed(0)} vs GL ${p.totalGl!.toFixed(0)}`),
  });

  // C24 every Aktual batch is allocated and posted before the monthly release
  const act = x.batches.filter((b) => b.status === "Aktual");
  const bad24 = act.filter((b) => b.allocation_status !== "posted");
  out.push({
    code: "C24", module: "M1", name: "Setiap batch Aktual punya alokasi berstatus posted (syarat rilis bulanan)",
    value: n(bad24.length), comparator: n(0), difference: null,
    status: act.length === 0 ? "BELUM DIISI" : bad24.length ? "GAGAL" : "LULUS",
    action: bad24.length ? "Cost accounting: Alokasikan lalu Posting batch berikut" : "",
    detail: bad24.map((b) => `${b.ref}: ${b.allocation_status ?? "belum dialokasikan"}`),
  });
  return out;
}

/** C25–C27 (PRD v3 §4.3) from reconcile(). */
export function ledgerControls(x: {
  assumedPct: Decimal | null;
  assumedKg: Decimal;
  outKg: Decimal;
  cardDiffs: { key: string; ledgerKg: Decimal; cardKg: Decimal; diff: Decimal }[] | null;
  cardDate?: string | null;
  bsDiff: Decimal | null;
  reconciling?: Decimal;
}): ControlV3[] {
  const bad26 = (x.cardDiffs ?? []).filter((d) => d.diff.abs().gt("0.01"));
  return [
    {
      code: "C25", module: "M2", name: "Porsi kg keluar dengan lot diduga (DO tanpa lot → FIFO)",
      value: x.assumedPct ?? ZERO, comparator: n(0), difference: x.assumedKg,
      status: x.assumedPct === null ? "BELUM DIISI" : x.assumedPct.isZero() ? "LULUS" : "PERIKSA",
      action: x.assumedPct && !x.assumedPct.isZero() ? "Catat lot di DO (alokasi M3) agar biaya per lot tidak diduga" : "",
      detail: x.assumedPct === null ? [] : [`${x.assumedKg.toFixed(2)} dari ${x.outKg.toFixed(2)} kg keluar memakai FIFO (assumed)`],
    },
    {
      code: "C26", module: "M2", name: "Saldo kg ledger per key = kartu stok Accurate (± 0,01 kg)",
      value: n(bad26.length), comparator: n(0), difference: bad26.reduce((m, d) => max(m, d.diff.abs()), ZERO),
      status: x.cardDiffs === null ? "BELUM DIISI" : bad26.length ? "GAGAL" : "LULUS",
      action: x.cardDiffs === null ? "Upload kartu stok / saldo stok Accurate" : bad26.length ? "Cocokkan mutasi key berikut dengan kartu stok Accurate" : "",
      detail: bad26.slice(0, 50).map((d) => `${d.key}: ledger ${d.ledgerKg.toFixed(2)} vs kartu stok ${d.cardKg.toFixed(2)}${x.cardDate ? ` (${x.cardDate})` : ""}`),
    },
    {
      code: "C27", module: "M2", name: "Nilai persediaan MA ledger = persediaan neraca (± Rp 1, setelah pos rekonsiliasi)",
      value: x.bsDiff ?? ZERO, comparator: n(0), difference: x.bsDiff,
      status: x.bsDiff === null ? "BELUM DIISI" : x.bsDiff.abs().lte(1) ? "LULUS" : "GAGAL",
      action: x.bsDiff !== null && x.bsDiff.abs().gt(1) ? "Cari selisih nilai persediaan (penyesuaian tutup buku, D3) dan bukukan" : "",
      detail: x.reconciling && !x.reconciling.isZero() ? [`pos rekonsiliasi Rp ${x.reconciling.toFixed(0)} (data_fix D3 / penyesuaian)`] : [],
    },
  ];
}

/** C28–C31 (PRD v3 §4.4). */
export function planningControls(x: {
  today: string;
  /** Confirmed PO lines (status Order). */
  orders: { ref: string; key: string; delivery_date: string | null; demand_status: string | null; kg: Num; fulfilled_kg: Num | null }[];
  /** Allocation kg per sales line × lot (M3b); summed per line. */
  allocated?: { sales_ref: string; kg: Num; line_kg: Num }[];
  planDays?: { date: string; head_count: number; capacity: number | null }[];
  blasts?: { ref: string; lot_ref_to: string | null }[];
}): ControlV3[] {
  const late = x.orders.filter((o) => o.demand_status !== "Tentative" && o.demand_status !== "Forecast" && o.delivery_date !== null && o.delivery_date < x.today && D(o.fulfilled_kg ?? 0).lt(D(o.kg)));
  // Σ per sales line (one row per line × lot comes in)
  const perLine = new Map<string, { sales_ref: string; kg: Decimal; line_kg: Num }>();
  for (const a of x.allocated ?? []) {
    const p = perLine.get(a.sales_ref);
    perLine.set(a.sales_ref, { sales_ref: a.sales_ref, kg: (p?.kg ?? ZERO).plus(D(a.kg)), line_kg: a.line_kg });
  }
  const over = [...perLine.values()].filter((a) => a.kg.gt(D(a.line_kg).plus("0.005")));
  const cap = (x.planDays ?? []).filter((p) => p.capacity !== null && p.head_count > p.capacity);
  const noLot = (x.blasts ?? []).filter((b) => !b.lot_ref_to);
  return [
    {
      code: "C28", module: "M3", name: "PO Confirmed lewat tanggal kirim dan belum terkirim penuh",
      value: n(late.length), comparator: n(0), difference: sum(late.map((o) => D(o.kg).minus(D(o.fulfilled_kg ?? 0)))),
      status: x.orders.length === 0 ? "BELUM DIISI" : late.length ? "PERIKSA" : "LULUS",
      action: late.length ? "Tandai terkirim, geser tanggal kirim, atau batalkan PO" : "",
      detail: late.slice(0, 50).map((o) => `${o.key} ${o.delivery_date}: sisa ${D(o.kg).minus(D(o.fulfilled_kg ?? 0)).toFixed(2)} kg`),
    },
    {
      code: "C29", module: "M3", name: "Σ alokasi per baris PO ≤ kg PO",
      value: n(over.length), comparator: n(0), difference: over.reduce((m, a) => max(m, D(a.kg).minus(D(a.line_kg))), ZERO),
      status: x.allocated === undefined ? "BELUM DIISI" : over.length ? "GAGAL" : "LULUS",
      action: over.length ? "Kurangi alokasi lot pada baris PO berikut" : "", detail: over.map((a) => `${a.sales_ref}: ${D(a.kg).toFixed(2)} > ${D(a.line_kg).toFixed(2)} kg`),
    },
    {
      code: "C30", module: "M3", name: "Rencana harian: ekor ≤ kapasitas potong",
      value: n(cap.length), comparator: n(0), difference: cap.reduce((m, p) => max(m, n(p.head_count - (p.capacity ?? 0))), ZERO),
      status: x.planDays === undefined || x.planDays.length === 0 ? "BELUM DIISI" : cap.length ? "GAGAL" : "LULUS",
      action: cap.length ? "Pindahkan ekor ke hari lain atau tambah kapasitas" : "", detail: cap.map((p) => `${p.date}: ${p.head_count} > ${p.capacity}`),
    },
    {
      code: "C31", module: "M3", name: "Blast tanpa lot tujuan (frozen)",
      value: n(noLot.length), comparator: n(0), difference: null,
      status: x.blasts === undefined ? "BELUM DIISI" : noLot.length ? "GAGAL" : "LULUS",
      action: noLot.length ? "Bangun ulang data harian (lot tujuan dibuat oleh ledger)" : "", detail: noLot.map((b) => b.ref),
    },
  ];
}
