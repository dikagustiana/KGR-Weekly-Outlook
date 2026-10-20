import type { ReactNode } from "react";

/**
 * PRD v6 K87 / R148: one visible <h1>, the page's finding (20/600, at most 2 lines on desktop, 3 on a phone); the context
 * (cut-off, as-of time) is one `note` line under it, never a second headline.
 */
export function Headline({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <>
      <h1 className="hl" data-headline="" data-tile-value="">{children}</h1>
      {note ? <p className="hl-note" data-headline-note="">{note}</p> : null}
    </>
  );
}
