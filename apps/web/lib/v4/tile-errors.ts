/**
 * PRD v5.1 K41: a failed read shows on the tiles it feeds (state error, v4 §5.3), never as "belum diisi". Loaders
 * collect `failed` (tile id → message, `fail`); the model passes its tiles through `withFailures` at the end. A tile
 * "x-pending" (mart not built) of a failed "x" shows the error as well. Pure.
 */
import type { TileData } from "../loader";
import type { TileModel } from "./minggu-ini";

export type Failed = Record<string, string>;

/** Records the error of `t` for the tiles `ids`; returns the value or `fallback`. */
export function fail<T>(failed: Failed, ids: string[], t: TileData<T>, fallback: T): T {
  if ("ok" in t) return t.ok;
  for (const id of ids) failed[id] = failed[id] ? `${failed[id]}; ${t.error}` : t.error;
  return fallback;
}

export function withFailures(tiles: TileModel[], failed?: Failed | null): TileModel[] {
  if (!failed || !Object.keys(failed).length) return tiles;
  return tiles.map((t) => {
    const e = failed[t.id] ?? failed[t.id.replace(/-pending$/, "")];
    return e ? { ...t, error: e } : t;
  });
}
