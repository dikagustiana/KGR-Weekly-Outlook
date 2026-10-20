import Link from "next/link";
import { Status } from "./Status";
import type { StatusKind } from "@/lib/v6/status-map";

export interface Step6 { id: string; name: string; status: StatusKind; statusText?: string; href?: string }

/**
 * PRD v6 R147: each step is an <li> with three separate lines (number, name, status) whether or not it is a link; the
 * status uses Status; steps are at least 160 px wide and stack vertically on a phone.
 */
export function Stepper6({ steps, current }: { steps: Step6[]; current: string | null }) {
  return (
    <ol className="stepper" aria-label="Langkah">
      {steps.map((s, i) => {
        const inner = (
          <>
            <span className="n">Langkah {i + 1}</span>
            <span className="nm">{s.name}</span>
            <span className="s"><Status kind={s.status} size="sm" label={s.statusText} /></span>
          </>
        );
        return (
          <li key={s.id} className="step" aria-current={s.id === current ? "step" : undefined}>
            {s.href ? <Link href={s.href}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ol>
  );
}
