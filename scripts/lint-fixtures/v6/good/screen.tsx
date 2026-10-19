// PRD v6 R156 fixture: no hit
export const codes = ["C50", "K35"];
export const cara = {
  rule: "C50: ukuran karkas wajib di PO",
  fn: "c50 (K35)",
};
export const t = "ukuran karkas wajib di PO";
export function F() {
  return <input name="x" placeholder="catatan" aria-label="Catatan keputusan" />;
}
export const legacy = "kode C50 tetap"; // v6-ok: fixture of a marked line
