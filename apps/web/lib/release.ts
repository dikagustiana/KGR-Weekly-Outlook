import "server-only";
import { createHash } from "node:crypto";
import { addDays, computeWeek, k35, releaseVerdict, snapshotJsonV3, v1Codes, type CellStatus } from "@kgr/engine";
import type { Supa } from "./supabase";
import { loadWeek, WORKER_PAGES } from "./data";
import { inputsHash, writeSnapshot } from "./snapshot";
import { outlookPdf } from "./pdf";
import { WriteError } from "./write";
import { must, mustRows } from "./loader";
import { moduleSettings } from "./modules";
import { moduleSettingsGlobal } from "./rebuild";
import { v3ForWeek } from "./v3/week";
import { wallNow } from "./clock";
import { buildInputDay, v5InputOn } from "./v5/input-data";
import { assertSchemaCurrent } from "./schema";
import { supabaseService } from "./supabase-service";

/** Overrides and pending rebuilds of a scope, and whether the §7.2 rule is on (flag v4_release). */
export async function releaseContext(sb: Supa, scopeKind: "week" | "month", scope: string, from: string, to: string) {
  const [ovRes, qRes, polRes, flagRes] = await Promise.all([
    sb.from("release_override").select("id, code, reason, evidence, created_by, created_role, created_at").eq("scope_kind", scopeKind).eq("scope", scope).is("deleted_at", null),
    sb.from("rebuild_queue").select("date").in("status", ["queued", "running"]).gte("date", from).lte("date", to),
    sb.from("release_override_policy").select("code, allowed_roles"),
    sb.from("app_setting").select("value").eq("key", "v4_release").maybeSingle(),
  ]);
  // R42 (K56): a failing read must not read as "no overrides / not stale / not strict".
  const ov = mustRows(ovRes, "releaseContext.release_override");
  const q = mustRows(qRes, "releaseContext.rebuild_queue");
  const pol = mustRows(polRes, "releaseContext.release_override_policy");
  const flag = must(flagRes, "releaseContext.app_setting");
  return {
    overrides: ov as { id: string; code: string; reason: string; evidence: string; created_by: string | null; created_role: string | null; created_at: string }[],
    staleDates: [...new Set((q as { date: string }[]).map((r) => r.date))].sort(),
    policy: Object.fromEntries((pol as { code: string; allowed_roles: string[] }[]).map((p) => [p.code, p.allowed_roles])),
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
  const cells = mustRows(await sb.from("input_completeness_daily").select("date, kind, owner_role, status, due_at, note").gte("date", weekStart).lte("date", addDays(weekStart, 6)), "k35State.input_completeness_daily");
  // K38: "late" against now on the wall clock
  const now = wallNow().now;
  return k35({
    cells: (cells as Record<string, unknown>[]).map((c) => ({ date: String(c.date), kind: String(c.kind), owner_role: String(c.owner_role), status: String(c.status) as CellStatus, due_at: c.due_at ? String(c.due_at) : null, note: c.note ? String(c.note) : null })),
    weekStart, now, override: overrides.includes("K35"),
  });
}

export const k35Message = (k: NonNullable<Awaited<ReturnType<typeof k35State>>>) => !k.built ? K45_MESSAGE
  : `Rilis ditolak — K35 kelengkapan data merah: ${k.red.map((c) => `${c.kind} ${c.date.slice(8, 10)}/${c.date.slice(5, 7)}`).join(", ")}. Lengkapi input, atau Finance mencatat alasan di layar Input ("Rilis dengan alasan").`;

/**
 * Release = frozen snapshot (JSON + PDF) of the computed outlook. The rule of PRD v4 §7.2 is checked here first (so no
 * file is stored for a release that will be refused) and again by public.release_week inside the release
 * transaction, which is the only way a release row is written.
 */
/** `k25`: the PDF writes the live-bird block as a simulation (K25 for the releasing role, K54). */
export async function releaseWeek(sb: Supa, weekStart: string, releasedBy: string, opts: { k25?: boolean } = {}) {
  await assertSchemaCurrent(sb);
  const loaded = await loadWeek(sb, weekStart, WORKER_PAGES);
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
  // R79: rebuild the week's completeness grid first, so a just-saved input is not missed by the K35 pre-check. It is written with the
  // service client: mart_replace is granted to the service role only (PRD v4 S1) and the caller has checked that this role releases.
  // Without the key the stored grid is judged as before (public.release_week judges the stored cells too) and the gap is logged.
  if (await v5InputOn(sb)) {
    const svc = supabaseService();
    if (svc) for (let i = 0; i < 7; i++) await buildInputDay(svc, addDays(weekStart, i));
    else console.error("[release] SUPABASE_SERVICE_ROLE_KEY tidak ada: grid kelengkapan tidak dibangun ulang sebelum pre-check K35");
  }
  const k = await k35State(sb, weekStart, rc.overrides.map((o) => o.code));
  if (k && !k.ok) throw new WriteError(k35Message(k));
  const json = snapshotJsonV3(result, v3.snapshot);
  const sha = createHash("sha256").update(json).digest("hex");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${weekStart}/${loaded.week.update_date}_${stamp}`;
  const now = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const pdf = await outlookPdf(result, { releasedBy, generatedAt: now, k25: opts.k25 === true });
  const i = loaded.inputs;
  const ops = [
    ...i.sales_lines.filter((r) => r.source === "Ops").map((r) => ({ table: "sales_line", id: r.id, document_ref: r.document_ref })),
    ...i.receipt_lines.filter((r) => r.source === "Ops").map((r) => ({ table: "receipt_line", id: r.id, document_ref: r.document_ref })),
    ...i.batches.filter((r) => r.source === "Ops").map((r) => ({ table: "batch", id: r.id, document_ref: r.document_ref })),
    ...i.opening_stock.filter((r) => r.source === "Ops").map((r) => ({ table: "opening_stock", id: r.id, document_ref: r.document_ref })),
  ];
  // V7 (review v5.3): the files are stored before public.release_week runs (the release row names the PDF path), so a
  // release the RPC refuses — or a PDF upload that fails after the JSON — would leave files without a release row. The
  // files stored so far are removed on any failure past the first upload (lib/release-orphans.test.ts).
  const stored: string[] = [];
  try {
    const up1 = await sb.storage.from("releases").upload(`${base}.json`, new Blob([json], { type: "application/json" }), { contentType: "application/json" });
    if (up1.error) throw new WriteError(`Simpan snapshot: ${up1.error.message}`);
    stored.push(`${base}.json`);
    const up2 = await sb.storage.from("releases").upload(`${base}.pdf`, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (up2.error) throw new WriteError(`Simpan PDF: ${up2.error.message}`);
    stored.push(`${base}.pdf`);
    // PRD v4 §7.2: the release row is written only by public.release_week, which checks again in the transaction
    const { data, error } = await sb.rpc("release_week", { p_week_id: loaded.week.id, p_json: json, p_sha: sha, p_pdf_path: `${base}.pdf`, p_ops: ops });
    if (error) throw new WriteError(error.message);
    const snapshotId = await freezeSnapshot(String(data), loaded.week.id, result, inputsHash(loaded.inputs), releasedBy);
    return { id: String(data), sha, overall: result.controls.overall, ops: ops.length, snapshotId };
  } catch (e) {
    await removeReleaseFiles(sb, stored, `${base}.pdf`);
    throw e;
  }
}

/**
 * PRD v6 R124 (B-R120): the release names the snapshot it froze. The result released is the one computed from the inputs
 * just read; the latest snapshot with the same inputs_hash is that same result (deterministic engine, T29), so it is
 * linked as is, else the result is written as a new version first. Best effort after the release row exists: without the
 * server key or the v6 bundle the release stands and the gap is logged (a missing link is filled by the next rebuild).
 */
async function freezeSnapshot(releaseId: string, weekId: string, result: Awaited<ReturnType<typeof computeWeek>>, hash: string, by: string): Promise<string | null> {
  const svc = supabaseService();
  if (!svc) { console.error("[release] SUPABASE_SERVICE_ROLE_KEY tidak ada: release.snapshot_id tidak diisi"); return null; }
  try {
    const snap = await writeSnapshot(svc, weekId, result, { inputsHash: hash, builtBy: `rilis ${by}` });
    const { error } = await svc.from("release").update({ snapshot_id: snap.meta.id }).eq("id", releaseId);
    if (error) throw new Error(error.message);
    return snap.meta.id;
  } catch (e) {
    console.error(`[release] snapshot rilis ${releaseId} tidak tercatat: ${(e as Error).message}`);
    return null;
  }
}

/**
 * V7: remove the files of a release that did not happen. `storage.objects` has no delete policy for a session
 * (kgr_storage_release allows insert only), so the service client removes them; without the key the session client is
 * tried, and whatever stays is logged by path so Admin can remove it by hand. Never throws: the caller's error is the one
 * the user must see.
 * An RPC error is not always a refusal: when the transaction committed and only its answer was lost, a release row already
 * names the PDF. So before anything is removed the `release` table is asked for that path; a row there (or a read that
 * fails) keeps the files — a release without its files is worse than two orphan files.
 */
export async function removeReleaseFiles(sb: Supa, paths: string[], pdfPath?: string): Promise<void> {
  if (!paths.length) return;
  if (pdfPath) {
    const rel = await sb.from("release").select("id").eq("pdf_path", pdfPath).limit(1);
    if (rel.error) { console.error(`[release] berkas tidak dihapus: tidak bisa memastikan apakah rilis tercatat (${rel.error.message}); periksa release.pdf_path = ${pdfPath}`); return; }
    if ((rel.data as unknown[] | null)?.length) { console.error(`[release] berkas tidak dihapus: rilis ${pdfPath} ternyata tercatat walau RPC menjawab galat`); return; }
  }
  const client = supabaseService() ?? sb;
  let left = paths, why = "";
  try {
    const r = await client.storage.from("releases").remove(paths);
    if (r.error) why = `: ${r.error.message}`;
    else {
      // the storage API lists the objects it removed; a list without a path = RLS kept it (no delete policy for a session)
      const gone = new Set((r.data as { name?: string }[] | null ?? []).map((o) => String(o.name ?? ""))); // k41-ok: r.error sudah ditangani di cabang atas; data kosong = tidak ada yang terhapus, dicatat sebagai yatim
      left = paths.filter((p) => !gone.has(p));
    }
  } catch (e) {
    why = `: ${(e as Error).message}`;
  }
  if (left.length || why) console.error(`[release] berkas yatim di bucket releases (rilis tidak terjadi sesudah berkas diunggah): ${left.join(", ") || "-"}${why}`);
}
