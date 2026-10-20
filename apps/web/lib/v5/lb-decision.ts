import "server-only";
/**
 * K25: the operations director records the LB price (and volume) for a cut date. A decision is never edited; a new
 * one replaces it (tg_lb_decision_stamp stamps the decider). The decision queues its date (trigger needs_rebuild, and
 * queueThrough up to the data date, K40), so the batch of that day takes the price as its sementara cost on the next
 * rebuild.
 */
import { D, isISODate } from "@kgr/engine";
import { parseNumber } from "@kgr/parsers";
import type { Supa } from "../supabase";
import { WriteError } from "../write";
import { queueThroughNote } from "../rebuild";
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
  const e = await sb.from("lb_price_decision").insert({ date, price, volume_kg_lb: volume, weight_class: cls, note: decisionNote(String(form.get("note") ?? ""), form.get("payload")) });
  if (e.error) throw new WriteError(e.error.message);
  // K40: the trigger queued the cut date; a cut date on or before the data date also re-runs every day after it.
  // R57: a queue that cannot be auto-queued (62-day range) is reported, not thrown — the decision is already saved.
  const qNote = await queueThroughNote(sb, [date], "keputusan harga LB");
  return `Harga LB potong ${date}${cls ? ` kelas ${cls}` : ""} diputuskan Rp ${num(price, 0)}/kg${volume ? `, volume ${num(volume, 0)} kg LB` : ""}; batch hari itu memakainya sebagai biaya sementara.${qNote}`;
}

/**
 * PRD v6 R143 / T40: what the decision dialog showed (price, volume, GP impact, who, when) goes with the decision, so the
 * audit trail (tg_audit copies the row) keeps the same content. Written after the user's own note; a payload that is not a
 * flat JSON object of short texts is ignored.
 */
export function decisionNote(note: string, payload: FormDataEntryValue | null): string | null {
  const own = note.trim();
  let summary = "";
  if (typeof payload === "string" && payload.length <= 2000) {
    try {
      const o = JSON.parse(payload) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every((v) => typeof v === "string" && v.length <= 200)) {
        summary = Object.entries(o as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("; ");
      }
    } catch { /* k41-ok: payload rusak = tanpa ringkasan; keputusan tetap tersimpan */ }
  }
  const out = [own, summary ? `[Dialog keputusan] ${summary}` : ""].filter(Boolean).join("\n");
  return out || null;
}
