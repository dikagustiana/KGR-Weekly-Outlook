/**
 * PRD v5.2 O16 (decided 17 Okt 2026; PRD v5 §4.6): the free stock of Commercial is the lot balance less the allocation reservations
 * **less the locked commitments of next week that no PO line covers yet**. A locked commitment (fresh kg and frozen kg per SKU) is kg
 * Commercial has promised for next week: until a PO line of that week takes it, it is not stock to sell today. The kg a key's PO lines
 * of the week already cover are not counted twice — the same rule as K26 (`commitmentDemand`, the demand PPIC plans on Monday).
 *
 * Pure. Per SKU key (with its form): deducted = min(free, uncovered); the part of a commitment that the stock cannot carry is `short`
 * (production need, not stock). Missing is not 0 (R64): a PO line without kg covers nothing and is counted aside; a reservation that
 * could not be read is `null`, and the note says "belum ada".
 */
import { D, commitmentDemand, type Commitment, type Decimal } from "@kgr/engine";
import { minus, num } from "../fmt";

type Num = Decimal | string | number;

export interface ReservationInput {
  /** The free stock per SKU key (full key with form: RPA|Karkas|Fresh). */
  free: { key: string; kg: Num }[];
  /** The commitments of next week (any status; only the locked ones count, the highest locked version per key and size). */
  commitments: Commitment[];
  /** The PO lines of next week that cover commitments (Confirmed, status Order); kg null = the line has no kg. */
  orders: { key: string; kg: Num | null }[];
  weekStart: string;
  /** Which base keys the viewer sees (Sales: the assigned ones); default all. */
  inScope?: (baseKey: string) => boolean;
}

export interface Reservation {
  weekStart: string;
  /** Per SKU key in the stock: what the locked commitment leaves uncovered by POs, and what is taken off its free stock. */
  byKey: Map<string, { uncovered: Decimal; deducted: Decimal }>;
  grossKg: Decimal;
  deductedKg: Decimal;
  netKg: Decimal;
  /** Uncovered locked kg the stock cannot carry (no stock of that SKU, or less than the commitment). */
  shortKg: Decimal;
  /** Locked commitments of next week: SKUs (base keys) in scope. */
  lockedSkus: number;
  /** PO lines of the week without kg: they cover nothing and are not counted as 0. */
  poWithoutKg: number;
}

const base = (k: string) => k.replace(/\|(Fresh|Frozen|n\/a)$/, "");

export function reserveForCommitments(x: ReservationInput): Reservation {
  const inScope = x.inScope ?? (() => true);
  const commitments = x.commitments.filter((c) => inScope(c.key));
  const covered = x.orders.filter((o) => o.kg !== null && o.kg !== undefined).map((o) => ({ key: o.key, kg: o.kg as Num }));
  const uncoveredByKey = new Map<string, Decimal>();
  for (const l of commitmentDemand({ commitments, orders: covered, weekStart: x.weekStart })) uncoveredByKey.set(l.key, (uncoveredByKey.get(l.key) ?? D(0)).plus(D(l.kg)));
  const free = new Map<string, Decimal>();
  for (const f of x.free) free.set(f.key, (free.get(f.key) ?? D(0)).plus(D(f.kg)));
  const byKey = new Map<string, { uncovered: Decimal; deducted: Decimal }>();
  let deducted = D(0), uncovered = D(0), gross = D(0);
  for (const [key, kg] of free) {
    gross = gross.plus(kg);
    const u = uncoveredByKey.get(key) ?? D(0);
    const d = u.lt(kg) ? u : kg;
    if (u.gt(0)) byKey.set(key, { uncovered: u, deducted: d });
    deducted = deducted.plus(d);
  }
  for (const u of uncoveredByKey.values()) uncovered = uncovered.plus(u);
  return {
    weekStart: x.weekStart, byKey, grossKg: gross, deductedKg: deducted, netKg: gross.minus(deducted), shortKg: uncovered.minus(deducted),
    lockedSkus: new Set(commitments.filter((c) => c.status === "locked").map((c) => c.key)).size,
    poWithoutKg: x.orders.length - covered.length,
  };
}

/** The free kg of a key after the reservation (never below 0). */
export function netFreeKg(r: Reservation | null, key: string, freeKg: Num): Decimal {
  const d = r?.byKey.get(key)?.deducted;
  return d ? D(freeKg).minus(d) : D(freeKg);
}

const kg = (v: Decimal) => minus(num(v, 0));

/**
 * The note under the tile "Stok bebas" (both numbers of the subtraction). `reservation` null = the commitments of next week are not
 * known (not read): "belum ada", and the stock is shown as it is.
 */
export function freeStockNote(r: Reservation | null): string {
  if (r === null) return "Komitmen terkunci minggu depan: belum ada (belum bisa dibaca), jadi stok bebas belum dikurangi.";
  const aside = r.poWithoutKg ? ` ${r.poWithoutKg} baris PO minggu depan tanpa kg tidak dihitung menutup komitmen.` : "";
  if (r.lockedSkus === 0) return `Tidak ada komitmen terkunci minggu depan; stok bebas tidak dikurangi.${aside}`;
  if (r.deductedKg.isZero() && r.shortKg.isZero()) return `Komitmen terkunci minggu depan (${r.lockedSkus} SKU) sudah tertutup PO; stok bebas tidak dikurangi.${aside}`;
  if (r.deductedKg.isZero()) return `Stok bebas ${kg(r.grossKg)} kg tidak dikurangi: komitmen terkunci minggu depan yang belum tertutup PO ${kg(r.shortKg)} kg tidak punya stok bebas di SKU-nya (kebutuhan produksi, bukan stok).${aside}`;
  const short = r.shortKg.gt(0) ? ` ${kg(r.shortKg)} kg komitmen melebihi stok bebas SKU-nya: itu kebutuhan produksi, bukan stok.` : "";
  return `Stok bebas ${kg(r.grossKg)} kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO ${kg(r.deductedKg)} kg = ${kg(r.netKg)} kg.${short}${aside}`;
}
