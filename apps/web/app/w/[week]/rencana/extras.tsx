import { ActionForm } from "@/components/ActionForm";
import type { Role } from "@/lib/roles";
import type { PpicV5Input } from "@/lib/v5/ppic";
import { approvePlanAction, copyClassPlanAction, reasonAction, saveClassPlanAction } from "./actions";
import type { ReactNode } from "react";

const bar = (children: ReactNode, reason: string | null) => <div className="actionbar">{children}{reason ? <span className="reason">{reason}</span> : null}</div>;

/**
 * The forms under the tiles of PPIC · Rencana v5, by role (a pure function so the screen test runs it as the page does):
 * PPIC and admin save the plan, copy it (and write the C58 reason); Finance and admin approve a plan whose downgrade is above
 * the limit (R53, the form belongs to the tile "t-approval", which only exists then); nobody else gets a form.
 */
export function rencanaV5Extras({ role, week, latest, input }: { role: Role; week: string; latest: Record<string, unknown> | null; input: PpicV5Input }): Record<string, ReactNode> {
  const extras: Record<string, ReactNode> = {};
  const canPlan = role === "admin" || role === "ppic";
  if (canPlan) {
    const c42 = input.controls.find((c) => c.code === "C42")?.status;
    extras["t-mingguan"] = bar(
      <ActionForm v4="primary" action={saveClassPlanAction} submit={`Simpan rencana versi ${(latest ? Number(latest.version) : 0) + 1}`} disabled={input.saveBlockers.length > 0}>
        <input type="hidden" name="week" value={week} />
      </ActionForm>,
      input.saveBlockers.length ? `Belum bisa disimpan: ${input.saveBlockers.join(", ")}` : c42 && c42 !== "LULUS" ? "yield sementara: boleh disimpan, tidak boleh disalin ke batch" : null,
    );
    // PRD v5.1 R29: C58 (supply short of the class need) opens with a written reason of this plan version; C57 never does (§7)
    const c58Open = input.copyBlockers.some((b) => b.startsWith("C58 "));
    extras["t-harian"] = bar(
      <>
        <ActionForm v4 action={copyClassPlanAction} submit="Salin ke batch rencana" disabled={!latest || input.copyBlockers.length > 0} confirm="Batch rencana minggu ini (salinan sebelumnya) diganti. Lanjut?">
          <input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={latest ? String(latest.id) : ""} />
        </ActionForm>
        {c58Open ? (
          <ActionForm v4 action={reasonAction} submit="Simpan alasan C58" className="tile-form">
            <input type="hidden" name="week" value={week} /><input type="hidden" name="code" value="C58" />
            <input name="reason" size={36} placeholder="alasan supply LB kurang dari kebutuhan kelas" aria-label="alasan C58" />
          </ActionForm>
        ) : null}
      </>,
      !latest ? "Simpan rencana dulu" : input.copyBlockers.length ? `Belum bisa: ${input.copyBlockers.join(", ")}${input.copyBlockers.some((b) => b.startsWith("C57 ")) ? " (C57: keputusan harga LB Direktur Operasional, tanpa pengecualian)" : ""}` : input.c58Reason ? `C58 dengan alasan: ${input.c58Reason}` : null,
    );
  }
  // R53: Finance / admin approve a plan with a downgrade above the limit; the status is the text of the tile itself
  if ((role === "admin" || role === "finance") && input.approval?.needs && !input.approval.approvedBy) {
    extras["t-approval"] = bar(
      <ActionForm v4="primary" action={approvePlanAction} submit={`Setujui rencana v${input.approval.version}`} confirm="Setujui rencana dengan downgrade di atas batas?">
        <input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={input.approval.planId} />
      </ActionForm>,
      "Downgrade di atas batas perlu persetujuan Finance",
    );
  }
  return extras;
}
