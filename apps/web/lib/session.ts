import "server-only";
import { redirect } from "next/navigation";
import { getRequestContext, type Viewer } from "./request-context";

export type { Viewer } from "./request-context";

/** The signed-in user and their role from the allow-list; null when signed in but not (or no longer) allowed. PRD v6 R126: from the RequestContext. */
export async function getViewer(): Promise<{ email: string | null; viewer: Viewer | null }> {
  const { email, viewer } = await getRequestContext();
  return { email, viewer };
}

export async function requireViewer(): Promise<Viewer> {
  const { email, viewer } = await getViewer();
  if (!email) redirect("/login");
  if (!viewer) redirect("/login?error=not-allowed");
  return viewer;
}
