/**
 * The server half of K34 (PRD v5 §4.9), without I/O so the tests run it as the save action does: read the raw grid the
 * browser sent, validate it again with the same module, and refuse when the result is not the one previewed.
 */
import { UPLOAD_KINDS_V5, validateUpload, type Cell, type Grid, type UploadContext, type UploadKindV5, type UploadResult } from "@kgr/engine";

export class UploadRejected extends Error {}

const MAX_ROWS = 5000, MAX_COLS = 40;

/** The grid of a save request: an array of rows of plain cells, within the size limits. */
export function parseGridPayload(json: string): Grid {
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new UploadRejected("Isi upload tidak terbaca"); }
  if (!Array.isArray(v) || v.length > MAX_ROWS + 1) throw new UploadRejected(`Upload maksimal ${MAX_ROWS} baris`);
  return v.map((row) => {
    if (!Array.isArray(row) || row.length > MAX_COLS) throw new UploadRejected(`Upload maksimal ${MAX_COLS} kolom`);
    return row.map((c): Cell => {
      if (c === null || typeof c === "string" || typeof c === "number" || typeof c === "boolean") return typeof c === "string" ? c.slice(0, 500) : c;
      throw new UploadRejected("Sel upload harus teks atau angka");
    });
  });
}

export const isUploadKind = (k: string): k is UploadKindV5 => (UPLOAD_KINDS_V5 as string[]).includes(k);

/** Validate again on the server; the preview fingerprint must match (the grid, the context and so the checks are the same). */
export function recheck(kind: UploadKindV5, grid: Grid, previewFingerprint: string, ctx: UploadContext): UploadResult {
  const r = validateUpload(kind, grid, ctx);
  if (r.fingerprint !== previewFingerprint) throw new UploadRejected("Hasil cek server berbeda dari pratinjau (file atau data master berubah). Cek ulang lalu simpan lagi.");
  return r;
}
