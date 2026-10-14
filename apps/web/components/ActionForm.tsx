"use client";
import { useActionState, type ReactNode } from "react";

export type ActionState = { ok?: string; error?: string };

/** A form bound to a server action returning {ok|error}; shows the message and a pending state. */
export function ActionForm({
  action, children, submit, confirm, className, danger,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submit: string;
  confirm?: string;
  className?: string;
  danger?: boolean;
}) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button className={`b ${danger ? "danger" : ""}`} disabled={pending}>{pending ? "Memproses…" : submit}</button>
      {state.ok ? <div className="msg ok">{state.ok}</div> : null}
      {state.error ? <div className="msg err">{state.error}</div> : null}
    </form>
  );
}
