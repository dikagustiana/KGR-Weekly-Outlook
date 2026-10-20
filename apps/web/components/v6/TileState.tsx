import Link from "next/link";
import type { ReactNode } from "react";
import { Reload } from "./Reload";

/**
 * PRD v6 R132 / R142 / K94: the four states of a tile in one shape — loading (TileSkeleton, aria-busy), empty (one line:
 * what is empty + where to fill it; the tile shrinks to 76 px), failed (role="alert", names the tile, "Muat ulang"), filled.
 */
export function TileEmpty({ what, action }: { what: string; action?: { href: string; label: string } }) {
  return (
    <p className="ts-empty" data-tile-empty="">
      {what}{action ? <> · <Link href={action.href}>{action.label}</Link></> : null}
    </p>
  );
}

export function TileError({ tile, message }: { tile: string; message: string }) {
  return (
    <div className="ts-err" role="alert" data-tile-error="">
      <span>{tile} gagal dimuat: {message}</span>
      <Reload />
    </div>
  );
}

export function TileFilled({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
