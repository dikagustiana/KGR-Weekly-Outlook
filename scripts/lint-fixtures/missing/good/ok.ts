// Nothing here is a missing value read as 0: the lint must stay silent.
type Row = Record<string, unknown>;
declare const r: Row, n: number | null, price: string | null, rows: Row[];

export const b1 = r.kg ?? null; // null stays null
export const b2 = n ?? 1; // another default is not this rule
export const b3 = Number(r.share ?? 0.5); // 0.5 is not zero
export const b4 = Number(r.rate ?? 0.25) + Number(price ?? "10"); // decimals that are not zero
export const b5 = rows.length || 10; // not a zero default
export const b6 = Number(r.n ?? 0); // missing-ok: jumlah baris (hitungan), bukan uang atau kg
export const b7 = (n ?? 0) + 1; /* missing-ok: indeks urut, mulai dari 0 */
// export const b8 = n ?? 0; a commented line is not code
export const b9 = "teks ?? 0 di dalam string"; // a string literal is not code
export const b10 = n ?? 0.0 + 1; // missing-ok: contoh angka nol dengan alasan di baris yang sama
export const b11 = r.kg ?? 0.05; // 0.05 is not zero
