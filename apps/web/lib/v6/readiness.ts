/**
 * PRD v6 R151: the one source of "Siap rilis" — the card and the headline of Input read it, so they never disagree
 * (bukti a7: card "Siap rilis: ya" on a screen whose headline refused the release). Not ready when a cell of the week's
 * completeness grid is late (unless Finance recorded the exception, K35), or a task that holds the release is late.
 * Pure.
 */
import type { InputV5Input } from "../v5/input";

export interface Readiness {
  ready: boolean;
  /** One reason per blocking input, in the user's words. */
  reasons: string[];
  /** The exception Finance recorded (K35), when it is what makes the week ready. */
  exception: string | null;
}

export function releaseReadiness(x: Pick<InputV5Input, "grid" | "tasks">): Readiness {
  const reasons: string[] = [];
  const g = x.grid;
  const lateRows = g ? g.rows.filter((r) => r.cells.some((c) => c.status === "late")) : [];
  if (lateRows.length && !g?.override) for (const r of lateRows) reasons.push(`${r.title} lewat tenggat`);
  const lateRelease = x.tasks.filter((t) => t.kind === "release_week" && t.status === "late");
  if (!reasons.length && lateRelease.length) reasons.push(...lateRelease.map((t) => `${t.title} terlambat`));
  if (!g) reasons.push("kelengkapan data harian minggu ini belum dihitung");
  return { ready: reasons.length === 0, reasons, exception: lateRows.length && g?.override ? g.override.reason : null };
}
