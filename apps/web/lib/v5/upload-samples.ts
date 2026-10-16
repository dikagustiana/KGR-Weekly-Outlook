/**
 * The example files of the Input screen ("Pakai file contoh"), verbatim from `TPL[kind].sample` of the mockup
 * reference/design/v5/Input.dc.html. Illustrative (PRD Lampiran D): never seeded, never saved — the screen previews
 * them with saving disabled. They are also the golden inputs of PRD §9.2 `upload-samples` (Lampiran B.5): the files in
 * fixtures/upload-samples are written from this module by scripts/upload-samples.ts.
 */
import type { Grid, UploadKindV5 } from "@kgr/engine";

export const UPLOAD_SAMPLES: Partial<Record<UploadKindV5, { file: string; grid: Grid }>> = {
  po_lines: {
    file: "po_sample.xlsx",
    grid: [
      ["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan"],
      ["KGR26.00341", "2026-08-27", "JLB1857", 811.3, 30000, "Pelanggan A"],
      ["KGR26.00349", "2026-08-29", "JLB0829", 1755.0, 36705, "Pelanggan B"],
      ["KGR26.00350", "2026-08-29", "JLB0922", 1496.6, 36705, "Pelanggan B"],
      ["KGR26.00353", "2026-08-27", "TRD0010", 3229.2, 43086, "Pelanggan C"],
      ["KGR26.00357", "2026-08-29", "JLB0763", 302.8, 36705, "Pelanggan D"],
      ["KGR26.00360", "2026-08-26", "JLB0763", 120.0, 36705, "Pelanggan E"],
      ["KGR26.00361", "2026-08-31", "X-999", 50.0, 0, "Pelanggan F"],
    ],
  },
  costing_wp: {
    file: "wp_sample.xlsx",
    grid: [
      ["batch", "kg_lb", "ekor", "kode_item", "kg"],
      ["B260826", 7512, 3902, "JLB0763", 612.4],
      ["B260826", "", "", "JLB0829", 2081.0],
      ["B260826", "", "", "JLB0922", 1108.7],
      ["B260826", "", "", "JLB0856", 1710.0],
      ["B260826", "", "", "X-HATI", 401.2],
      ["B260826", "", "", "KPL-01", 338.0],
      ["B260826", "", "", "JLB0078", 213.9],
      ["B260826", "", "", "JLB0135", 317.6],
    ],
  },
  yield_matrix: {
    file: "yield_sample.xlsx",
    grid: [
      ["kelas", "kunci", "yield_pct"],
      ["K", "Karkas", 70.2], ["K", "Kepala", 4.8], ["K", "Ceker", 3.1], ["K", "Usus", 4.3], ["K", "HJA", 5.6], ["K", "Lemak", 1.2],
      ["S", "Karkas", 71.5], ["S", "Kepala", 4.5], ["S", "Ceker", 2.9], ["S", "Usus", 4.2], ["S", "HJA", 5.4], ["S", "Lemak", 1.4],
      ["B", "Karkas", 72.4], ["B", "Kepala", 4.3], ["B", "Ceker", 2.8], ["B", "Usus", 4.1], ["B", "HJA", 5.3], ["B", "Lemak", 1.5],
    ],
  },
};
