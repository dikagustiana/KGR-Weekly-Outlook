import "server-only";
import { getRequestContext } from "../request-context";
import { isModuleOn } from "../modules-core";

/** PRD v6 irisan 4: the v6 shell and components for the viewer's role (flag v6_shell). */
export async function v6ShellOn(): Promise<boolean> {
  const ctx = await getRequestContext();
  return !!ctx.viewer && isModuleOn(ctx.settings.v6_shell, ctx.viewer.role);
}

/** PRD v6 irisan 5: the v6 screen content for the viewer's role (flag v6_pages; needs v6_shell). */
export async function v6PagesOn(): Promise<boolean> {
  const ctx = await getRequestContext();
  return !!ctx.viewer && isModuleOn(ctx.settings.v6_shell, ctx.viewer.role) && isModuleOn(ctx.settings.v6_pages, ctx.viewer.role);
}
