"use client";
import { useState, type ReactNode } from "react";

/**
 * PRD v6 R144: a plain form (server action with redirect) that holds the submit while a NumberInput cell could not be read
 * (aria-invalid), and says so in an alert; the server refuses the same cell again by name.
 */
export function GuardedForm({ action, children, className }: { action: (f: FormData) => void | Promise<void>; children: ReactNode; className?: string }) {
  const [held, setHeld] = useState<string | null>(null);
  return (
    <form action={action} className={className} onSubmit={(e) => {
      const bad = e.currentTarget.querySelectorAll('[aria-invalid="true"]');
      if (bad.length) {
        e.preventDefault();
        setHeld(`${bad.length} sel tidak terbaca: ${Array.from(bad).slice(0, 3).map((x) => x.getAttribute("aria-label")).join(", ")}${bad.length > 3 ? ", …" : ""}. Pakai koma untuk desimal.`);
        (bad[0] as HTMLElement).focus();
      } else setHeld(null);
    }}>
      {children}
      <div role="alert" className="af-live">{held ? <p className="msg err af-msg">{held}</p> : null}</div>
    </form>
  );
}
