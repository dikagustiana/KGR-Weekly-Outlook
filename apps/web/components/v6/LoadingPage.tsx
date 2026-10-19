import { getRequestContext } from "@/lib/request-context";
import { isModuleOn } from "@/lib/modules-core";
import { Shell } from "../Shell";
import { PageSkeleton } from "./TileSkeleton";

/**
 * PRD v6 R130: what a page shows while its data loads (loading.tsx): the shell from the RequestContext (one parallel round,
 * shared with the page that follows) and the tile skeleton. Before v6_shell the skeleton alone, in the v4 frame, so a
 * click never leaves the old screen frozen.
 */
export async function LoadingPage({ label }: { label: string }) {
  const ctx = await getRequestContext();
  if (ctx.viewer && isModuleOn(ctx.settings.v6_shell, ctx.viewer.role)) {
    return <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={null} active=""><PageSkeleton label={label} /></Shell>;
  }
  return <div className="v4"><main className="v4-main"><PageSkeleton label={label} /></main></div>;
}
