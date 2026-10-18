import { ActionForm, type ActionState } from "@/components/ActionForm";
import type { KomersialV5Input } from "@/lib/v5/komersial";
import { CommitmentRows, LOCK_FORM } from "./CommitmentRows";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

export { LOCK_FORM };

/**
 * Next week's commitments (PRD v5 K26) under the tile "Untuk PPIC": the draft form of Sales / the commercial lead and
 * the lock of the commercial lead (PRD v5.1 K46, one RPC with the frozen prices of the form).
 */
export function CommitmentForm({ c, save, lock }: { c: KomersialV5Input["commitment"]; save: Action; lock: Action }) {
  const open = c.rows.some((r) => r.status !== "locked");
  return (
    <div className="actionbar">
      <ActionForm v4 keep action={save} submit="Simpan draft" className="tile-form">
        <input type="hidden" name="week_start" value={c.weekStart} /><input type="hidden" name="n" value={c.rows.length} />
        <CommitmentRows c={c} />
        <input name="reason" size={24} placeholder="alasan (wajib bila sudah dikunci)" aria-label="alasan versi baru" />
      </ActionForm>
      {c.canLock ? (
        <ActionForm v4="primary" id={LOCK_FORM} action={lock} submit="Kunci komitmen dan price list" disabled={!open} confirm="Kunci komitmen dan price list minggu depan? Perubahan sesudahnya menjadi versi baru dengan alasan.">
          <input type="hidden" name="week_start" value={c.weekStart} />
        </ActionForm>
      ) : <span className="reason">Dikunci Kepala Sales.</span>}
    </div>
  );
}
