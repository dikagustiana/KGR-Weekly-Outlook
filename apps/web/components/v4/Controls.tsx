import Link from "next/link";
import type { ReactNode } from "react";

export interface SlicerOption { value: string; label: string; href: string }

/** Slicer (§5.3): single-select buttons; `required` (one option is always selected); empty state as text. */
export function Slicer({ label, options, current, empty = "belum ada minggu", hideLabel }: { label: string; options: SlicerOption[]; current: string | null; empty?: string; hideLabel?: boolean }) {
  if (!options.length) return <div className="seg"><span className="seg-l">{label}</span><span className="off">{empty}</span></div>;
  return (
    <nav className={`seg${hideLabel ? " nowrap" : ""}`} aria-label={label}>
      {hideLabel ? null : <span className="seg-l">{label}</span>}
      {options.map((o) => <Link key={o.value} href={o.href} aria-current={o.value === current ? "true" : undefined}>{o.label}</Link>)}
    </nav>
  );
}

/** ModeToggle (§5.3): two choices. */
export function ModeToggle({ label, options, current }: { label: string; options: [SlicerOption, SlicerOption]; current: string }) {
  return <Slicer label={label} options={options} current={current} hideLabel />;
}

/** "Rilis 27 Agu 2026 · 18/20 kontrol lulus · 2 belum diisi" (MV v2 R12) + the release action. */
export function ReleaseLine({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="release"><span data-tile-value="">{text}</span>{action}</div>;
}

/** One primary action per page plus secondary ones; a disabled action says why. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="actionbar">{children}</div>;
}

export function ActionLink({ href, children, primary, disabledReason }: { href: string | null; children: ReactNode; primary?: boolean; disabledReason?: string | null }) {
  if (!href || disabledReason) {
    return <span className="actionbar"><span className={`v4b${primary ? " primary" : ""}`} aria-disabled="true">{children}</span>{disabledReason ? <span className="reason">{disabledReason}</span> : null}</span>;
  }
  return <a className={`v4b${primary ? " primary" : ""}`} href={href}>{children}</a>;
}

export interface StepDef { n: number; label: string; status: string; href?: string; locked?: string | null }

/** Stepper (§5.3, PPIC steps 1–4). A locked step says which step comes first. */
export function Stepper({ steps, current }: { steps: StepDef[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Langkah">
      {steps.map((s) => {
        const body = (<><span className="n">Langkah {s.n}</span><span>{s.label}</span><span className="s">{s.locked ?? s.status}</span></>);
        return (
          <li key={s.n} className="step" aria-current={s.n === current ? "step" : undefined}>
            {s.href && !s.locked ? <Link href={s.href}>{body}</Link> : body}
          </li>
        );
      })}
    </ol>
  );
}
