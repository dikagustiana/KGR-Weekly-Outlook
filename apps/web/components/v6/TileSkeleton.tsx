import type { TilePos } from "../v4/Tile";

/**
 * PRD v6 R130: the loading shape of a page — the tiles at their real positions and sizes, text replaced by grey blocks.
 * No animation. `data-tile-skeleton` is what T31 looks for in the 300 ms screenshot.
 */
export function TileSkeleton({ pos, kind }: { pos: TilePos; kind?: "card" | "table" | "headline" }) {
  return (
    <div
      className={`tile${kind === "card" ? " card" : ""}${kind === "headline" ? " bare" : ""}`}
      data-tile-skeleton="" aria-hidden="true"
      style={{ gridColumn: `${pos.x + 1} / span ${pos.w}`, gridRow: `${pos.y + 1} / span ${pos.h}` }}
    >
      {kind === "headline" ? <div className="sk sk-h" /> : (
        <>
          <div className="sk sk-t" />
          {kind === "card" ? <div className="sk sk-v" /> : null}
          <div className="sk sk-l" />
          <div className="sk sk-l" style={{ width: "60%" }} />
        </>
      )}
    </div>
  );
}

/** The generic skeleton of a tile page: headline, a row of four cards, two wide tiles. */
export const DEFAULT_SKELETON: { pos: TilePos; kind?: "card" | "table" | "headline" }[] = [
  { pos: { x: 0, y: 0, w: 12, h: 1 }, kind: "headline" },
  { pos: { x: 0, y: 1, w: 3, h: 2 }, kind: "card" }, { pos: { x: 3, y: 1, w: 3, h: 2 }, kind: "card" },
  { pos: { x: 6, y: 1, w: 3, h: 2 }, kind: "card" }, { pos: { x: 9, y: 1, w: 3, h: 2 }, kind: "card" },
  { pos: { x: 0, y: 3, w: 8, h: 4 }, kind: "table" }, { pos: { x: 8, y: 3, w: 4, h: 4 }, kind: "table" },
];

export function PageSkeleton({ tiles = DEFAULT_SKELETON, label }: { tiles?: typeof DEFAULT_SKELETON; label: string }) {
  return (
    <div className="tg" role="region" aria-label={label} aria-busy="true">
      <span className="sr-only" role="status">Memuat {label}…</span>
      {tiles.map((t, i) => <TileSkeleton key={i} pos={t.pos} kind={t.kind} />)}
    </div>
  );
}
