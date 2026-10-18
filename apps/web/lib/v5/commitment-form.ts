import { parseNumber } from "@kgr/parsers";

const num = (v: FormDataEntryValue | null) => { const t = String(v ?? "").trim(); return t === "" ? null : parseNumber(t); };

export interface CommitmentEntry { key: string; rec: { fresh_kg: string; frozen_kg: string; price: string | null } }

/**
 * Form "Komitmen Sales" → one entry per SKU with something filled in. A commitment names both kg (0 typed on purpose when
 * there is none): a blank kg is "belum diisi", not a commitment of 0 (R64); such SKUs come back in `incomplete` and nothing is saved.
 */
export function commitmentEntries(form: FormData): { entries: CommitmentEntry[]; incomplete: string[] } {
  const n = Number(form.get("n") ?? 0); // missing-ok: jumlah baris form (hitungan), bukan uang atau kg
  const entries: CommitmentEntry[] = [];
  const incomplete: string[] = [];
  for (let i = 0; i < n; i++) {
    const key = String(form.get(`key_${i}`) ?? "");
    const fresh = num(form.get(`fresh_${i}`)), frozen = num(form.get(`frozen_${i}`)), price = num(form.get(`price_${i}`));
    if (!key || (fresh === null && frozen === null && price === null)) continue;
    if (fresh === null || frozen === null) { incomplete.push(key); continue; }
    entries.push({ key, rec: { fresh_kg: fresh, frozen_kg: frozen, price } });
  }
  return { entries, incomplete };
}
