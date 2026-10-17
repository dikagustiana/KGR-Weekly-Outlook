/**
 * PRD v5.2-A R68 (T15, O25–O27): reconcile the app's numbers against the FS (management report) per line. Pure — the
 * numbers come from the caller (PL FINAL of the month, month-end balance sheet, bank balance). A mapped pair outside the
 * tolerance is a C59 GAGAL.
 */
import { D, ZERO, type Decimal, type Num } from "./decimal";
import type { ControlV3 } from "./controls-v3";

export type ReconStatus = "sama" | "beda" | "tidak ada di app" | "tidak ada di FS";

export interface ReconLine {
  /** The app-side key (e.g. "PL b.12", "BS b.14"). */
  key: string;
  app: Decimal | null;
  fs: Decimal | null;
  selisih: Decimal | null;
  status: ReconStatus;
}

export interface ReconInput {
  app: { key: string; amount: Num }[];
  fs: { key: string; amount: Num }[];
  /** [appKey, fsKey] pairs; lines outside the map are reported as missing on one side. */
  map: [string, string][];
  /** |selisih| ≤ tolerance counts as "sama" (default Rp 1, O26). */
  tolerance?: Num;
}

/** Per-line reconciliation + the C59 control (GAGAL while any mapped pair differs beyond the tolerance). */
export function fsRecon(x: ReconInput): { lines: ReconLine[]; c59: ControlV3 } {
  const tol = D(x.tolerance ?? "1");
  const appBy = new Map(x.app.map((a) => [a.key, D(a.amount)]));
  const fsBy = new Map(x.fs.map((f) => [f.key, D(f.amount)]));
  const lines: ReconLine[] = [];
  const usedApp = new Set<string>(), usedFs = new Set<string>();
  for (const [appKey, fsKey] of x.map) {
    usedApp.add(appKey); usedFs.add(fsKey);
    const a = appBy.get(appKey) ?? null, f = fsBy.get(fsKey) ?? null;
    const selisih = a !== null && f !== null ? a.minus(f) : null;
    const status: ReconStatus = a === null ? "tidak ada di app" : f === null ? "tidak ada di FS" : selisih!.abs().lte(tol) ? "sama" : "beda";
    lines.push({ key: appKey, app: a, fs: f, selisih, status });
  }
  for (const [key, a] of appBy) if (!usedApp.has(key)) lines.push({ key, app: a, fs: null, selisih: null, status: "tidak ada di FS" });
  for (const [key, f] of fsBy) if (!usedFs.has(key)) lines.push({ key, app: null, fs: f, selisih: null, status: "tidak ada di app" });
  const beda = lines.filter((l) => l.status === "beda");
  const c59: ControlV3 = {
    code: "C59", module: "M4", name: "Rekonsiliasi angka app vs FS", value: D(beda.length), comparator: ZERO, difference: D(beda.length),
    status: beda.length ? "GAGAL" : "LULUS",
    action: beda.length ? "Selisih app vs FS di atas toleransi; periksa baris yang beda" : "",
    detail: beda.map((l) => `${l.key}: app ${l.app!.toFixed(2)} vs FS ${l.fs!.toFixed(2)} = selisih ${l.selisih!.toFixed(2)}`),
  };
  return { lines, c59 };
}
