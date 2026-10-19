import "server-only";
import type { Viewer } from "./session";
import { getRequestContext } from "./request-context";
import { viewModeFor, type ViewMode } from "./view";

/** The view mode of this request (R1): from the viewer's role, plus the preparer's toggle cookie (PRD v6: read once in the RequestContext). */
export async function currentView(viewer: Viewer): Promise<ViewMode> {
  return viewModeFor(viewer.role, (await getRequestContext()).viewCookie);
}
