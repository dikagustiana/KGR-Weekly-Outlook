/**
 * Management View v2 (PRD R1): two renders of the same data. The management role always gets the management
 * view; every other role prepares data (it has input areas) and may preview the management view.
 * Presentation only — what a user may read or write is still decided by the role and RLS.
 */
import type { Role } from "./roles";

export type ViewMode = "management" | "preparer";

/** Cookie holding a preparer's choice; ignored for the management role. */
export const VIEW_COOKIE = "kgr_view";

export function canToggleView(role: Role): boolean {
  return role !== "management";
}

export function viewModeFor(role: Role, cookie: string | null | undefined): ViewMode {
  if (!canToggleView(role)) return "management";
  return cookie === "management" ? "management" : "preparer";
}

export function parseViewMode(v: unknown): ViewMode | null {
  return v === "management" || v === "preparer" ? v : null;
}
