/**
 * PRD v6 K95 / K96 / R154 / R155: the one glossary of words a user reads (docs/v6/glossary.md is its readable copy, reviewed by
 * Finance and the Kepala Sales before irisan 5 merges). Specification codes (C50, K35, O8, R12, Q-…) and internal terms
 * (table names, `committed`, "tempelan", "mart") are never shown outside the "cara hitung" drawer: `plain()` turns a text
 * written for the PRD into the user's words. Pure; used by the v6 screens (flag v6_pages).
 */
import type { Role } from "../roles";

/** K96: role names, all Indonesian. */
export const ROLE_NAME: Record<Role, string> = {
  management: "Manajemen", operations_director: "Direktur Operasional", finance: "Keuangan", cost_accounting: "Akuntansi Biaya",
  inventory_accounting: "Akuntansi Persediaan", ppic: "PPIC", commercial_lead: "Kepala Sales", sales: "Sales", purchasing: "Pembelian", admin: "Admin",
};

/** Rule codes → the rule's name in the user's words (from the engine's control names, shortened). */
export const CODE_NAME: Record<string, string> = {
  C21: "alokasi biaya batch lengkap", C22: "hasil SKU sesuai hasil potong", C23: "cost pool sama dengan buku besar", C24: "alokasi batch sudah diposting",
  C25: "keluar tanpa lot", C26: "saldo stok sama dengan kartu stok", C27: "nilai persediaan sama dengan neraca", C28: "PO lewat tanggal kirim",
  C29: "alokasi tidak melebihi PO", C30: "rencana harian dalam kapasitas", C31: "blast tanpa lot tujuan", C32: "jembatan V1 ke V2 menutup",
  C33: "setiap biaya punya driver", C34: "biaya tetap sesuai jadwal", C35: "saldo rekening sama dengan kas neraca", C36: "hari kerja tanpa upload kas",
  C37: "utang bersaldo debit", C38: "order di bawah harga lantai", C39: "SKU terjual tanpa order", C40: "sales tanpa penugasan",
  C41: "by-product kurang dari order", C42: "yield bukan angka contoh", C43: "biaya tetap bulan ini diperbarui", C44: "forecast SKU tersedia",
  C45: "data harian stok diperbarui", C46: "harga fresh dan frozen terisi", C47: "kapasitas tanggal rencana terisi", C48: "batch punya output SKU",
  C49: "P&L harian sama dengan P&L bulan", C50: "ukuran karkas wajib di PO", C51: "kelas berat terdaftar", C52: "komitmen dikunci tepat waktu",
  C53: "WP potong tepat waktu", C54: "biaya per kg di bawah harga acuan", C55: "beban tetap tanpa jadwal", C56: "costing final tepat waktu",
  C57: "harga live bird diputuskan", C58: "supply LB menutup kebutuhan", C59: "rekonsiliasi dengan laporan keuangan",
  K20: "status biaya", K25: "keputusan Direktur Operasional", K32: "kunci komitmen", K35: "rilis dengan pengecualian", K36: "sumber angka",
};

/** Internal words → the user's words (R155 and the glossary of PRD v6 bagian F). */
export const TERMS: [RegExp, string][] = [
  [/\bgrid kelengkapan\b/gi, "kelengkapan data harian"],
  [/\bgagal-tertutup\b/gi, "halaman tidak dimuat sebagian"],
  [/\bdata mart\b/gi, "data harian terhitung"],
  [/\bmart\b/gi, "data harian terhitung"],
  [/\bcommitted\b/g, "tersimpan"],
  [/\btempelan\b/gi, "tempel dari Excel"],
  [/\bsupplier_invoice\b/g, "faktur pemasok"],
  [/\bcosting_wp\b/g, "WP potong"],
  [/\bidempotent\b/gi, "aman diulang"],
];

const CODE = /\b(?:C\d{2}|K\d{2,3}|O\d{1,2}|R\d{2,3}|B-R\d{2,3}|Q-v[\d.]+-\d+)\b/;

/**
 * The text a user reads: a code in brackets or as a label ("(C55)", "K35:", "C50 ") goes; a code standing for its rule in
 * a sentence is replaced by the rule's name; table names and internal words become the glossary's.
 */
export function plain(text: string): string {
  let t = text;
  // "(C55)", "(K35, C59)", "(O8)": references only
  t = t.replace(/\s*\((?:\s*(?:C\d{2}|K\d{2,3}|O\d{1,2}|R\d{2,3}|B-R\d{2,3}|Q-v[\d.]+-\d+)\s*[,;/]?\s*)+\)/g, "");
  // "C50: ukuran …", "K35 override" → the name ("rilis dengan pengecualian")
  t = t.replace(/\bK35 override\b/g, "rilis dengan pengecualian");
  t = t.replace(/\b(C\d{2}|K\d{2,3})(?::\s*|\s+)(?=\S)/g, (m, c: string) => (CODE_NAME[c] ? "" : m));
  // a bare code left in a sentence → its name, else removed
  t = t.replace(/\b(C\d{2}|K\d{2,3}|O\d{1,2}|R\d{2,3}|B-R\d{2,3}|Q-v[\d.]+-\d+)\b/g, (c: string) => CODE_NAME[c] ?? "");
  for (const [re, w] of TERMS) t = t.replace(re, w);
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/\(\s*\)/g, "").trim();
}

/** Does a text still carry a specification code (the lint rule R156a and the v6 screen tests use it)? */
export const hasCode = (text: string) => CODE.test(text);
