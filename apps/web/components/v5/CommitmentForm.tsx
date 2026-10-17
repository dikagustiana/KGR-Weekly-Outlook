import { ActionForm, type ActionState } from "@/components/ActionForm";
import { num } from "@/lib/fmt";
import type { KomersialV5Input } from "@/lib/v5/komersial";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

/** The lock form; the "harga frozen" inputs of the commitment rows belong to it (sent with the lock, K46). */
export const LOCK_FORM = "kunci-komitmen";

/**
 * Next week's commitments (PRD v5 K26) under the tile "Untuk PPIC": the draft form of Sales / the commercial lead and
 * the lock of the commercial lead (PRD v5.1 K46, one RPC with the frozen prices of the form).
 */
export function CommitmentForm({ c, save, lock }: { c: KomersialV5Input["commitment"]; save: Action; lock: Action }) {
  const open = c.rows.some((r) => r.status !== "locked");
  return (
    <div className="actionbar">
      <ActionForm v4 action={save} submit="Simpan draft" className="tile-form">
        <input type="hidden" name="week_start" value={c.weekStart} /><input type="hidden" name="n" value={c.rows.length} />
        {c.rows.map((r, i) => {
          // PRD v5.1 R15: one rule for every input of a row — a locked commitment is changed by the commercial lead
          // (a new version with a reason); the frozen price goes with the lock (lock_commitments), so only the lead
          // fills it, and not for a price list row already locked
          const off = r.status === "locked" && !c.canLock;
          return (
            <span key={r.key}>
              <input type="hidden" name={`key_${i}`} value={r.key} />
              <label>{r.key.split("|")[1]} fresh <input name={`fresh_${i}`} size={6} defaultValue={r.fresh ? num(r.fresh, 0) : ""} disabled={off} /></label>
              <label> frozen <input name={`frozen_${i}`} size={6} defaultValue={r.frozen ? num(r.frozen, 0) : ""} disabled={off} /></label>
              <label> harga <input name={`price_${i}`} size={7} defaultValue={r.price ? num(r.price, 0) : ""} disabled={off} /></label>
              <label> harga frozen <input form={LOCK_FORM} name={`price_frozen|${r.key}`} size={7} defaultValue={r.priceFrozen && r.priceFrozenSource === "form" ? num(r.priceFrozen, 0) : ""} placeholder="acuan" disabled={off || !c.canLock || !!r.listLocked} /></label>
            </span>
          );
        })}
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
