import { getRequestContext } from "@/lib/request-context";
import { isModuleOn } from "@/lib/modules-core";
import { Shell } from "../Shell";
import { PageSkeleton } from "./TileSkeleton";

/**
 * NOT MOUNTED (e2e matrix, 19 Okt): a `loading.tsx` streams the response, so the HTTP status is 200 before the page runs
 * its role / flag guard — `notFound()` and `redirect()` then arrive as a 200 page and the role matrix (404 per role) breaks.
 * The skeleton is mounted again once the guards move into the segments' layouts (they run before the loading boundary).
 *
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
