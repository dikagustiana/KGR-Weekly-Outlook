import Link from "next/link";
import { Drawer } from "./Drawer";
import type { CaraHitungContent } from "../v4/CaraHitung";

export interface CardRow { label: string; value: string; tone?: "better" | "worse" | "neg" }

/**
 * PRD v6 K89 / R139: four fixed rows — metric name → value + unit → one finding with a tone → source as ⓘ. At most three
 * comparison rows between the value and the finding. The value is the decided metric (GP, not revenue; a ratio, not the
 * nominal equity) and keeps the text colour; only the finding carries the tone. K91: an openable card links the value and
 * a chevron ("Buka <metric>"), never the whole card.
 */
export function Card6({ id, title, value, unit, missing, compare = [], finding, href, cara }: {
  id: string;
  title: string;
  value: string | null;
  unit?: string;
  missing?: string;
  compare?: CardRow[];
  finding?: { text: string; tone?: "plain" | "good" | "warn" | "bad" } | null;
  href?: string;
  cara?: CaraHitungContent;
}) {
  const hid = `c6-${id}`;
  const v = value === null
    ? <span className="v missing" data-tile-value="">{missing ?? "belum diisi"}</span>
    : <><span className="v" data-tile-value="">{value}</span>{unit ? <span className="u">{unit}</span> : null}</>;
  return (
    <section className="c6" aria-labelledby={hid} data-card6={id}>
      <h2 className="c6-t" id={hid}>{title}</h2>
      <div className="c6-v">
        {href ? <Link className="open" href={href} aria-label={`Buka ${title}`}>{v}<span className="chev" aria-hidden="true">›</span></Link> : v}
      </div>
      {compare.length ? (
        <dl className="c6-c">
          {compare.slice(0, 3).map((c) => <div key={c.label} style={{ display: "contents" }}><dt>{c.label}</dt><dd className={c.tone ?? ""}>{c.value}</dd></div>)}
        </dl>
      ) : null}
      {finding?.text ? <p className={`c6-f ${finding.tone && finding.tone !== "plain" ? finding.tone : ""}`} data-tile-note="">{finding.text}</p> : null}
      {cara ? <div className="c6-s"><Drawer content={cara} icon label={`Sumber dan cara hitung ${title}`} /></div> : null}
    </section>
  );
}
