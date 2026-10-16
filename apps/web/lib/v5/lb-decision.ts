import "server-only";
/**
 * K25: the operations director records the LB price (and volume) for a cut date. A decision is never edited; a new
 * one replaces it (tg_lb_decision_stamp stamps the decider). The decision queues its date itself (trigger
 * needs_rebuild), so the batch of that day takes the price as its sementara cost on the next rebuild.
 */
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import type { Supa } from "../supabase";
import { WriteError } from "../write";
import { num } from "../fmt";

export async function insertLbDecision(sb: Supa, form: FormData): Promise<string> {
  const date = String(form.get("date") ?? "");
  if (!isISODate(date)) throw new WriteError("Tanggal potong tidak valid");
  const price = parseNumber(String(form.get("price") ?? "").trim());
  if (price === null || D(price).lte(0)) throw new WriteError("Harga LB wajib diisi (Rp/kg LB)");
  const volRaw = String(form.get("volume") ?? "").trim();
  const volume = volRaw ? parseNumber(volRaw) : null;
  if (volume !== null && D(volume).lt(0)) throw new WriteError("Volume tidak boleh negatif");
  const cls = String(form.get("weight_class") ?? "").trim() || null;
  const e = await sb.from("lb_price_decision").insert({ date, price, volume_kg_lb: volume, weight_class: cls, note: String(form.get("note") ?? "").trim() || null });
  if (e.error) throw new WriteError(e.error.message);
  return `Harga LB potong ${date}${cls ? ` kelas ${cls}` : ""} diputuskan Rp ${num(price, 0)}/kg${volume ? `, volume ${num(volume, 0)} kg LB` : ""}; batch hari itu memakainya sebagai biaya sementara.`;
}
