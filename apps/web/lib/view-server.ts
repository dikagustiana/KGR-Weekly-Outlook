import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Viewer } from "./session";
import { VIEW_COOKIE, viewModeFor, type ViewMode } from "./view";

/** The view mode of this request (R1): from the viewer's role, plus the preparer's toggle cookie. */
export const currentView = cache(async (viewer: Viewer): Promise<ViewMode> => {
  const store = await cookies();
  return viewModeFor(viewer.role, store.get(VIEW_COOKIE)?.value);
});
