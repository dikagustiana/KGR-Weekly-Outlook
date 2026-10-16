import Link from "next/link";
import type { ReactNode } from "react";

export interface CardCompare {
  label: string;
  value: string;
  /** Colour of the value: only for deltas (better = green, worse = red) or a negative amount (§5.1 rule 3). */
  tone?: "better" | "worse" | "neg";
}

/**
 * Card body (§5.3): value in --fs-value, up to 3 comparison rows. A missing value is written as text ("belum diisi"),
 * never as 0.
 */
export function CardBody({ value, unit, compare = [], href, missing, negative }: {
  value: string | null;
  /** Unit beside the value ("Rp jt"): the value itself stays a bare number so it fits a 2-column card at 30 px. */
  unit?: string;
  compare?: CardCompare[];
  href?: string;
  /** Text when value is null. */
  missing?: string;
  negative?: boolean;
}) {
  const v = value === null
    ? <div className="card-v missing" data-tile-value="">{missing ?? "belum diisi"}</div>
    : <div className="card-n"><div className={`card-v${negative ? " neg" : ""}`} data-tile-value="">{value}</div>{unit ? <span className="card-u">{unit}</span> : null}</div>;
  const body: ReactNode = (
    <>
      {v}
      {compare.length ? (
        <dl className="card-c">
          {compare.slice(0, 3).map((c) => (
            <div key={c.label} style={{ display: "contents" }}><dt>{c.label}</dt><dd className={c.tone ?? ""} data-tile-value="">{c.value}</dd></div>
          ))}
        </dl>
      ) : null}
    </>
  );
  return href ? <Link href={href} className="cover">{body}</Link> : body;
}
