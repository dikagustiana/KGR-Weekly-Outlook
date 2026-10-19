"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

export type ActionState = { ok?: string; error?: string; field?: string };

/**
 * A form bound to a server action returning {ok|error}; shows the message and a pending state.
 * PRD v6 R146 / R167: the result is announced — `role="status"` for ok, `role="alert"` for an error (naming the field when
 * the server returns one); the button is `aria-disabled` while pending. K93: no `window.confirm` — a `confirm` text asks in
 * the form itself (the question, "Ya, lanjutkan", "Batal"); decisions with money use DecisionDialog. R144: a number cell
 * that could not be read (aria-invalid) holds the submit.
 */
export function ActionForm({
  action, children, submit, confirm, className, danger, v4, disabled, id,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submit: string;
  confirm?: string;
  className?: string;
  danger?: boolean;
  /** Button in the v4 grammar (class v4b). */
  v4?: boolean | "primary";
  disabled?: boolean;
  /** Form id, for inputs placed elsewhere that belong to this form (`form` attribute). */
  id?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const [asking, setAsking] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) yes.current?.focus(); }, [asking]);
  const btn = v4 ? (v4 === "primary" ? "v4b primary" : "v4b") : `b ${danger ? "danger" : ""}`;
  const off = pending || disabled;
  return (
    <form
      id={id}
      action={run}
      className={className}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const bad = form.querySelectorAll('[aria-invalid="true"]').length + (id ? document.querySelectorAll(`[form="${id}"][aria-invalid="true"]`).length : 0);
        if (bad) { e.preventDefault(); setHeld(`${bad} sel tidak terbaca; perbaiki dulu (pakai koma untuk desimal)`); return; }
        setHeld(null);
        if (confirm && !asking) { e.preventDefault(); setAsking(true); return; }
        setAsking(false);
      }}
    >
      {children}
      {asking ? (
        <span className="af-confirm" role="group" aria-label="Konfirmasi">
          <span>{confirm}</span>
          <button ref={yes} className={btn} type="submit">Ya, lanjutkan</button>
          <button className={v4 ? "v4b" : "b sec"} type="button" onClick={() => setAsking(false)}>Batal</button>
        </span>
      ) : (
        <button className={btn} aria-disabled={off || undefined} disabled={off}>{pending ? "Memproses…" : submit}</button>
      )}
      <div role="status" aria-live="polite" className="af-live">{state.ok ? <div className="msg ok af-msg">{state.ok}</div> : null}</div>
      <div role="alert" className="af-live">
        {state.error ? <div className="msg err af-msg" data-field={state.field}>{state.field ? `${state.field}: ` : ""}{state.error}</div> : null}
        {held ? <div className="msg err af-msg">{held}</div> : null}
      </div>
    </form>
  );
}
