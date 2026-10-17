import "server-only";
import { createHash } from "node:crypto";
import { addDays, computeWeek, k35, releaseVerdict, snapshotJsonV3, v1Codes, type CellStatus } from "@kgr/engine";
import type { Supa } from "./supabase";
import { loadWeek } from "./data";
import { outlookPdf } from "./pdf";
import { WriteError } from "./write";
import { moduleSettings } from "./modules";
import { moduleSettingsGlobal } from "./rebuild";
import { v3ForWeek } from "./v3/week";
import { jakartaNow } from "./v3/allocation";
import { v5InputOn } from "./v5/input-data";

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

/** K45: the text of public.release_week for a week without completeness grid. */
export const K45_MESSAGE = "Rilis ditolak — K35: grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas";

/** C53 of the v3 controls of a week (PRD v5.1 K47): a release control like the v1 ones; [] while v5_costing is off. */
export const c53Of = (v3: { controls_v3?: unknown }) => ((v3.controls_v3 ?? []) as { code: string; status: string; name?: string }[]).filter((c) => c.code === "C53");

/** K35 / K45 of a week (flag v5_input), as public.release_week sees it now; null with the flag off. */
export async function k35State(sb: Supa, weekStart: string, overrides: string[]) {
  if (!(await v5InputOn(sb))) return null;
  const { data: cells } = await sb.from("input_completeness_daily").select("date, kind, owner_role, status, due_at, note").gte("date", weekStart).lte("date", addDays(weekStart, 6));
  const n = jakartaNow();
  return k35({
    cells: ((cells ?? []) as Record<string, unknown>[]).map((c) => ({ date: String(c.date), kind: String(c.kind), owner_role: String(c.owner_role), status: String(c.status) as CellStatus, due_at: c.due_at ? String(c.due_at) : null, note: c.note ? String(c.note) : null })),
    weekStart, now: `${n.date}T${n.time}:00+07:00`, override: overrides.includes("K35"),
  });
}

export const k35Message = (k: NonNullable<Awaited<ReturnType<typeof k35State>>>) => !k.built ? K45_MESSAGE
  : `Rilis ditolak — K35 kelengkapan data merah: ${k.red.map((c) => `${c.kind} ${c.date.slice(8, 10)}/${c.date.slice(5, 7)}`).join(", ")}. Lengkapi input, atau Finance mencatat alasan di layar Input ("Rilis dengan alasan").`;

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
  // v3 module outputs (only modules that are on) under their own keys; all flags off = the v1 snapshot byte for byte
  const v3 = await v3ForWeek(sb, loaded.week, moduleSettingsGlobal(await moduleSettings()), result);
  // PRD v5.1 K47: C53 of the v3 controls (WP past its deadline; there while v5_costing is on) holds the release like a
  // v1 control, lifted by a Finance override in strict mode; public.release_week checks the same
  const c53 = c53Of(v3.snapshot);
  const verdict = releaseVerdict({ controls: [...v1Codes(result.controls.controls), ...c53], mandatory: null, overrides: rc.overrides.map((o) => o.code), strict: rc.strict, staleDates: rc.staleDates, policy: rc.policy });
  if (!verdict.ok) {
    const name = (code: string) => result.controls.controls.find((c) => `C${c.no}` === code)?.name ?? c53.find((c) => c.code === code)?.name
      ?? (code === "STALE" ? `mart belum dibangun ulang (${rc.staleDates.join(", ")})` : code);
    throw new WriteError(`Rilis ditolak — ${verdict.rejections.map((r) => `${r.code} ${r.status}: ${name(r.code)}${r.overridable ? " (bisa override dengan alasan dan bukti)" : ""}`).join("; ")}`);
  }
  // PRD v5 K35 (flag v5_input): red cells of the completeness grid hold the release unless Finance recorded K35, and a
  // week without any grid row is not released (v5.1 K45); public.release_week checks the same in the release transaction
  const k = await k35State(sb, weekStart, rc.overrides.map((o) => o.code));
  if (k && !k.ok) throw new WriteError(k35Message(k));
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
