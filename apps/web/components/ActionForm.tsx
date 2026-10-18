"use client";
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { requestFormReset } from "react-dom";

export type ActionState = { ok?: string; error?: string };

/** A form bound to a server action returning {ok|error}; shows the message and a pending state. */
export function ActionForm({
  action, children, submit, confirm, className, danger, v4, disabled, id, keep,
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
  /**
   * A8 (Q-v5.2-114): what was typed stays when the server refuses it. React 19 empties a `<form action>` after every action, a
   * refusal included, so a refused save cost the typist every number; with `keep` the form is emptied (back to the stored values)
   * only after an answer with `ok`. Without scripts the form still posts to the action as before.
   */
  keep?: boolean;
}) {
  const [state, run, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  // after a saved answer the form returns to what the page now shows (React does this itself for a plain action; `keep` runs the action by hand)
  useEffect(() => {
    const f = form.current;
    if (keep && state.ok && f) startTransition(() => requestFormReset(f));
  }, [keep, state]);
  return (
    <form
      ref={form}
      id={id}
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) { e.preventDefault(); return; }
        // `keep`: run the action here, not through the form's own action, so React does not reset the form when the action is done
        if (keep) { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => run(fd)); }
      }}
    >
      {children}
      <button className={v4 ? (v4 === "primary" ? "v4b primary" : "v4b") : `b ${danger ? "danger" : ""}`} disabled={pending || disabled}>{pending ? "Memproses…" : submit}</button>
      {state.ok ? <div className="msg ok">{state.ok}</div> : null}
      {state.error ? <div className="msg err">{state.error}</div> : null}
    </form>
  );
}
