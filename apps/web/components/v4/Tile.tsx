import type { ReactNode } from "react";

/**
 * TileGrid (PRD v4 §5.3): 12 columns, rows of 76 px, gap 12 px; each tile has x, y, w, h. Below 900 px the grid has
 * 2 columns and cards take 1 (v4.css). data-* attributes are read by the screenshot checker (§9.4).
 */
export function TileGrid({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="tg" role="region" aria-label={label}>{children}</div>;
}

export interface TilePos { x: number; y: number; w: number; h: number }

export function Tile({
  id, pos, title, children, extra, note, kind, titleLevel = 2,
}: {
  id: string;
  pos: TilePos;
  title?: ReactNode;
  children?: ReactNode;
  /** Right side of the header (e.g. "cara hitung"). */
  extra?: ReactNode;
  /** Finding under the tile (1–3 sentences). */
  note?: ReactNode;
  kind?: "card" | "tall" | "bare";
  titleLevel?: 2 | 3;
}) {
  const H = titleLevel === 2 ? "h2" : "h3";
  return (
    <section
      className={`tile${kind ? ` ${kind}` : ""}`}
      data-tile={id} data-x={pos.x} data-y={pos.y} data-w={pos.w} data-h={pos.h}
      style={{ gridColumn: `${pos.x + 1} / span ${pos.w}`, gridRow: `${pos.y + 1} / span ${pos.h}` }}
      aria-label={typeof title === "string" ? title : undefined}
    >
      {title || extra ? (
        <div className="tile-h">
          {title ? <H className="tile-t" data-tile-title="">{title}</H> : <span />}
          {extra}
        </div>
      ) : null}
      <div className="tile-b">{children}</div>
      {note ? <p className="note" data-tile-note="">{note}</p> : null}
    </section>
  );
}

/** Finding text under a tile. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

/** Status as text, without colour or icon (§5.1 rule 3). */
export function StatusText({ children }: { children: ReactNode }) {
  return <span className="status">{children}</span>;
}
