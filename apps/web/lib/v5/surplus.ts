import { num } from "../fmt";

/**
 * PRD v5.2-A R56 (A-UI-20): the SKU an answer to PPIC's surplus is about. The plan lists its surplus per production unit
 * ("Karkas") or per SKU key; the answer stores the key a Sales assignment names — a SKU key stays as it is, a unit is the
 * base key of its RPA SKU ("RPA|Karkas"). The action takes the key from the form and checks it against this list: an
 * answer never carries a key hard-coded by the screen, and a key the plan has no surplus for is refused.
 */
export function surplusKeys(surplus: Record<string, unknown> | null | undefined): { key: string; kg: string }[] {
  return Object.entries(surplus ?? {})
    .filter(([, kg]) => kg !== null && kg !== undefined && Number(kg) > 0)
    .map(([k, kg]) => ({ key: k.includes("|") ? k : `RPA|${k}`, kg: String(kg) }));
}

/**
 * Q-v5.2-112 (A8): the surplus rows of the answer form come from the SAVED plan (`plan_week.surplus_kg_by_key` as the plan was saved), while the
 * "Karkas surplus dari batch rencana" row of the tile is recomputed from today's data: two numbers for one word. The saved one is what the answer
 * is about and what PPIC uses, so its option says so.
 */
export const surplusOptionLabel = (key: string, kg: string): string => `${key.replace(/^RPA\|/, "")} · ${num(kg, 0)} kg (surplus rencana tersimpan)`;
