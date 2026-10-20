"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { ActionState } from "../ActionForm";

export interface DecisionRow { label: string; value: string }

/**
 * PRD v6 K93 / R143: a decision with money (LB price, month close, release, override) is taken in a native <dialog>
 * opened with showModal(): what is decided and its effect (price, volume, GP impact of the week, who decides, the time),
 * an optional note, and a primary button that names the decision ("Putuskan Rp 25.000"). The submit is the same server
 * action as before; the summary rows go with it as `payload` (JSON) so the audit keeps what the dialog showed (T40).
 * Native dialog: focus trapped, Esc cancels, focus returns to the opener.
 */
export function DecisionDialog({ action, opener, title, rows, submit, hidden = {}, note = true, children, v4 = "primary", disabled }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  /** The button that opens the dialog ("Putuskan harga LB"). */
  opener: string;
  title: string;
  rows: DecisionRow[];
  /** The primary button, naming the decision ("Putuskan Rp 25.000"). */
  submit: string;
  hidden?: Record<string, string>;
  /** Optional free-text note (name="note"). */
  note?: boolean;
  /** Extra fields inside the dialog (e.g. volume). */
  children?: React.ReactNode;
  v4?: boolean | "primary";
  disabled?: boolean;
}) {
  const [state, run, pending] = useActionState(action, {});
  const dlg = useRef<HTMLDialogElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [sent, setSent] = useState(false);
  const tid = useId();
  useEffect(() => {
    if (sent && !pending && state.ok) { dlg.current?.close(); setSent(false); }
  }, [sent, pending, state]);
  const payload = JSON.stringify(Object.fromEntries(rows.map((r) => [r.label, r.value])));
  return (
    <>
      <button ref={btn} type="button" className={v4 === "primary" ? "v4b primary" : "v4b"} disabled={disabled} aria-haspopup="dialog" onClick={() => dlg.current?.showModal()}>{opener}</button>
      <dialog ref={dlg} className="dd" aria-labelledby={tid} onClose={() => btn.current?.focus()}>
        <form action={(f) => { setSent(true); run(f); }}>
          <h2 id={tid}>{title}</h2>
          <dl>{rows.map((r) => <div key={r.label} style={{ display: "contents" }}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="payload" value={payload} />
          {children}
          {note ? <label>Catatan (opsional)<textarea name="note" rows={2} /></label> : null}
          <div role="alert">{state.error ? <p className="msg err af-msg">{state.error}</p> : null}</div>
          <div className="row">
            <button type="button" className="v4b" onClick={() => dlg.current?.close()}>Batal</button>
            <button type="submit" className="v4b primary" aria-disabled={pending || undefined} disabled={pending}>{pending ? "Memproses…" : submit}</button>
          </div>
        </form>
      </dialog>
      <span role="status" aria-live="polite" className="af-live">{state.ok && !pending ? <span className="msg ok af-msg">{state.ok}</span> : null}</span>
    </>
  );
}
