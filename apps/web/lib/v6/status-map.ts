/**
 * PRD v6 K90 / R140: one status vocabulary on screen — lolos, catatan, terlambat, belum. The words stored in the database
 * (upload status, control status, grid cells, task states) stay as they are; this maps them for display only.
 */
export type StatusKind = "lolos" | "catatan" | "terlambat" | "belum";

export const STATUS_WORD: Record<StatusKind, string> = { lolos: "lolos", catatan: "catatan", terlambat: "terlambat", belum: "belum" };

const MAP: Record<string, StatusKind> = {
  // controls (v1 / v3)
  LULUS: "lolos", PERIKSA: "catatan", GAGAL: "terlambat", "BELUM DIISI": "belum", "ADA GAGAL": "terlambat", STALE: "catatan",
  // uploads
  committed: "lolos", tersimpan: "lolos", ok: "lolos", "masuk, ada catatan": "catatan", warning: "catatan", warn: "catatan",
  failed: "terlambat", error: "terlambat", fail: "terlambat", rejected: "terlambat", pending: "belum", draft: "belum",
  // completeness grid and tasks (CellStatus, input_task)
  green: "lolos", done: "lolos", lengkap: "lolos", amber: "catatan", partial: "catatan", sebagian: "catatan",
  red: "terlambat", late: "terlambat", overdue: "terlambat", terlambat: "terlambat",
  grey: "belum", gray: "belum", open: "belum", todo: "belum", belum: "belum", "not_due": "belum",
  // already in the new vocabulary
  lolos: "lolos", catatan: "catatan",
};

/** The display status of a stored word; anything unknown is "catatan" (shown, never silently green). */
export function statusOf(stored: string | null | undefined): StatusKind {
  if (stored === null || stored === undefined || stored === "") return "belum";
  return MAP[stored] ?? MAP[stored.toLowerCase()] ?? MAP[stored.toUpperCase()] ?? "catatan";
}
