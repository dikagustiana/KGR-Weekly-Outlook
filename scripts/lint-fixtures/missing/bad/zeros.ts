// Every numbered line below is a missing value read as 0 (R64): the lint must report each of them once.
type Row = Record<string, unknown>;
declare const r: Row, n: number | null, price: string | null, kg: string | undefined;

export const a1 = Number(r.kg ?? 0); // 1: kg of a row that may be blank
export const a2 = String(price ?? "0"); // 2: price as a string
export const a3 = n || 0; // 3: || 0
export const a4 = (kg || "0") + "x"; // 4: || "0"
export const a5 = Number(r.rate ?? '0'); // 5: single quotes
export const a6 = Number(r.amount ?? `0`); // 6: template literal
export const a7 = String(r.cost ?? "0.00"); // 7: zero with decimals is still zero
export const a8 = n ?? 0; // missing-ok:
// 8: a marker without a reason is itself a hit
export const a9 = n ?? 0; // missing-ok sama sekali tanpa titik dua
// 9: a marker without the colon is no marker
export const a10 = [n ?? 0, price ?? "0"]; // 10: two on one line count once
export const a11 = `${Number(r.kg ?? 0)} kg`; // 11: inside a template string
