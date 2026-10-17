import "server-only";
/**
 * Overrides of PRD v4 §7.2: one row per control and scope (a week, or a month version "2026-08-01:V1"), with a reason
 * and evidence, written only by a role release_override_policy allows for that control (RLS). There is no generic
 * admin override: the policy names roles per control, and C32 / C45 / C48 name none. Only the §7.2 rule (flag
 * v4_release, or a v4 monthly version) lets an override lift a control; the v1 weekly rule ignores them.
 */
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { WriteError } from "../write";

export type OverrideScopeKind = "week" | "month";

export async function addOverride(sb: Supa, viewer: Viewer, x: { scopeKind: OverrideScopeKind; scope: string; code: string; reason: string; evidence: string }): Promise<string> {
  const reason = x.reason.trim(), evidence = x.evidence.trim();
  // a control C1–C99, or K35 (PRD v5: release with red cells of the completeness grid)
  if (!/^(C[0-9]{1,2}|K35)$/.test(x.code)) throw new WriteError("Kode kontrol tidak dikenal");
  if (reason.length < 10) throw new WriteError("Alasan minimal 10 karakter");
  if (evidence.length < 3) throw new WriteError("Bukti wajib: nomor voucher, nama file, atau tautan");
  const { data: pol } = await sb.from("release_override_policy").select("allowed_roles").eq("code", x.code).maybeSingle();
  const roles = ((pol as { allowed_roles?: string[] } | null)?.allowed_roles ?? []);
  if (!roles.length) throw new WriteError(`${x.code} tidak bisa di-override; perbaiki kontrolnya`);
  if (!viewer.role || !roles.includes(viewer.role)) throw new WriteError(`Override ${x.code} hanya oleh ${roles.join(", ")}`);
  const { error } = await sb.from("release_override").insert({ scope_kind: x.scopeKind, scope: x.scope, code: x.code, reason, evidence });
  if (error) throw new WriteError(error.message.includes("release_override_scope_code") ? `${x.code} sudah punya override untuk periode ini` : error.message);
  return `Override ${x.code} dicatat`;
}

export async function withdrawOverride(sb: Supa, viewer: Viewer, id: string): Promise<string> {
  const { data, error } = await sb.from("release_override").update({ deleted_at: new Date().toISOString(), deleted_by: viewer.email }).eq("id", id).is("deleted_at", null).select("code");
  if (error) throw new WriteError(error.message);
  const rows = data as { code: string }[];
  if (!rows.length) throw new WriteError("Override tidak ditemukan, atau peran Anda tidak boleh menariknya");
  return `Override ${rows[0].code} ditarik`;
}
