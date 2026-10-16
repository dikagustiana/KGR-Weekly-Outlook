import "server-only";
import { createHash } from "node:crypto";
import { addDays, computeWeek, releaseVerdict, snapshotJsonV3, v1Codes } from "@kgr/engine";
import type { Supa } from "./supabase";
import { loadWeek } from "./data";
import { outlookPdf } from "./pdf";
import { WriteError } from "./write";
import { moduleSettings } from "./modules";
import { moduleSettingsGlobal } from "./rebuild";
import { v3ForWeek } from "./v3/week";

/** Overrides and pending rebuilds of a scope, and whether the §7.2 rule is on (flag v4_release). */
export async function releaseContext(sb: Supa, scopeKind: "week" | "month", scope: string, from: string, to: string) {
  const [{ data: ov }, { data: q }, { data: pol }, { data: flag }] = await Promise.all([
    sb.from("release_override").select("id, code, reason, evidence, created_by, created_role, created_at").eq("scope_kind", scopeKind).eq("scope", scope).is("deleted_at", null),
    sb.from("rebuild_queue").select("date").in("status", ["queued", "running"]).gte("date", from).lte("date", to),
    sb.from("release_override_policy").select("code, allowed_roles"),
    sb.from("app_setting").select("value").eq("key", "v4_release").maybeSingle(),
  ]);
  return {
    overrides: (ov ?? []) as { id: string; code: string; reason: string; evidence: string; created_by: string | null; created_role: string | null; created_at: string }[],
    staleDates: [...new Set(((q ?? []) as { date: string }[]).map((r) => r.date))].sort(),
    policy: Object.fromEntries(((pol ?? []) as { code: string; allowed_roles: string[] }[]).map((p) => [p.code, p.allowed_roles])),
    strict: ((flag as { value?: { enabled?: boolean } } | null)?.value?.enabled) === true,
  };
}

/**
 * Release = frozen snapshot (JSON + PDF) of the computed outlook. The rule of PRD v4 §7.2 is checked here first (so no
 * file is stored for a release that will be refused) and again by public.release_week inside the release
 * transaction, which is the only way a release row is written.
 */
export async function releaseWeek(sb: Supa, weekStart: string, releasedBy: string) {
  const loaded = await loadWeek(sb, weekStart);
  if (!loaded) throw new WriteError("Minggu tidak ada");
  const result = computeWeek(loaded.inputs);
  const rc = await releaseContext(sb, "week", weekStart, weekStart, addDays(weekStart, 6));
  const verdict = releaseVerdict({ controls: v1Codes(result.controls.controls), mandatory: null, overrides: rc.overrides.map((o) => o.code), strict: rc.strict, staleDates: rc.staleDates, policy: rc.policy });
  if (!verdict.ok) {
    const name = (code: string) => result.controls.controls.find((c) => `C${c.no}` === code)?.name ?? (code === "STALE" ? `mart belum dibangun ulang (${rc.staleDates.join(", ")})` : code);
    throw new WriteError(`Rilis ditolak — ${verdict.rejections.map((r) => `${r.code} ${r.status}: ${name(r.code)}${r.overridable ? " (bisa override dengan alasan dan bukti)" : ""}`).join("; ")}`);
  }
  // v3 module outputs (only modules that are on) under their own keys; all flags off = the v1 snapshot byte for byte
  const v3 = await v3ForWeek(sb, loaded.week, moduleSettingsGlobal(await moduleSettings()), result);
  const json = snapshotJsonV3(result, v3.snapshot);
  const sha = createHash("sha256").update(json).digest("hex");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${weekStart}/${loaded.week.update_date}_${stamp}`;
  const now = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const pdf = await outlookPdf(result, { releasedBy, generatedAt: now });
  const up1 = await sb.storage.from("releases").upload(`${base}.json`, new Blob([json], { type: "application/json" }), { contentType: "application/json" });
  if (up1.error) throw new WriteError(`Simpan snapshot: ${up1.error.message}`);
  const up2 = await sb.storage.from("releases").upload(`${base}.pdf`, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (up2.error) throw new WriteError(`Simpan PDF: ${up2.error.message}`);
  const i = loaded.inputs;
  const ops = [
    ...i.sales_lines.filter((r) => r.source === "Ops").map((r) => ({ table: "sales_line", id: r.id, document_ref: r.document_ref })),
    ...i.receipt_lines.filter((r) => r.source === "Ops").map((r) => ({ table: "receipt_line", id: r.id, document_ref: r.document_ref })),
    ...i.batches.filter((r) => r.source === "Ops").map((r) => ({ table: "batch", id: r.id, document_ref: r.document_ref })),
    ...i.opening_stock.filter((r) => r.source === "Ops").map((r) => ({ table: "opening_stock", id: r.id, document_ref: r.document_ref })),
  ];
  // PRD v4 §7.2: the release row is written only by public.release_week, which checks again in the transaction
  const { data, error } = await sb.rpc("release_week", { p_week_id: loaded.week.id, p_json: json, p_sha: sha, p_pdf_path: `${base}.pdf`, p_ops: ops });
  if (error) throw new WriteError(error.message);
  return { id: String(data), sha, overall: result.controls.overall, ops: ops.length };
}
