import "server-only";
/**
 * PRD v5.2 O16: what the free stock is reduced by — the commitments of next week (locked ones count) and the PO lines of that week
 * that already cover them. Read with the caller's client; a refused read is an error (K41/K56), never "no commitment".
 */
import { addDays, type Commitment } from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import type { Row } from "../v3/uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export async function loadCommitmentCover(sb: Supa, nextWeek: string): Promise<{ commitments: Commitment[]; orders: { key: string; kg: string | null }[] }> {
  const end = addDays(nextWeek, 6);
  const [commits, lines, items] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("sales_commitment").select("key, size_kg, fresh_kg, frozen_kg, price, status, version").eq("week_start", nextWeek).is("deleted_at", null).neq("status", "superseded").order("id").range(a, b)),
    // the PO lines of the week as the plan reads them (planning.ts): status Order, ship date in the week (the order date when it has none)
    fetchAll<Row>((a, b) => sb.from("sales_line").select("item_code, key_manual, kg, demand_status").eq("status", "Order").is("deleted_at", null).is("superseded_at", null)
      .or(`and(delivery_date.gte.${nextWeek},delivery_date.lte.${end}),and(delivery_date.is.null,date.gte.${nextWeek},date.lte.${end})`).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).order("item_code").range(a, b)),
  ]);
  const keyOf = new Map(items.map((i) => [String(i.item_code), String(i.key)]));
  return {
    commitments: commits.map((c) => ({ key: String(c.key), size_kg: s(c.size_kg), fresh_kg: String(c.fresh_kg), frozen_kg: String(c.frozen_kg), price: s(c.price), status: String(c.status) as Commitment["status"], version: Number(c.version ?? 1) })),
    // only the Confirmed lines cover a commitment (the plan counts the commitment against Confirmed demand only)
    orders: lines.filter((l) => (s(l.demand_status) ?? "Confirmed") === "Confirmed")
      .map((l) => ({ key: s(l.key_manual) ?? keyOf.get(String(l.item_code)) ?? null, kg: s(l.kg) }))
      .filter((l): l is { key: string; kg: string | null } => l.key !== null),
  };
}
