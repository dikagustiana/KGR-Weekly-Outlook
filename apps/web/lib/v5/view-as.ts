/**
 * "Lihat sebagai" (PRD v5 §6, K37, Bab 8; flag v5_management): links between the three main screens and Input in
 * the header, only those the role may read. Management, the operations director, Finance and Admin read all four;
 * Sales and the commercial lead Commercial; PPIC its own screen; every role that fills data in has Input. Pure.
 */
import type { Role } from "../roles";
import { isModuleOn, type ModuleSettings } from "../modules-core";

export type ViewAsId = "manajemen" | "commercial" | "ppic" | "input";
export interface ViewAsItem { id: ViewAsId; label: string; href: string }

const ALL: ViewAsId[] = ["manajemen", "commercial", "ppic", "input"];
const READS: Record<Role, ViewAsId[]> = {
  admin: ALL, management: ALL, operations_director: ALL, finance: ALL,
  commercial_lead: ["commercial", "input"], sales: ["commercial", "input"], ppic: ["ppic", "input"],
  purchasing: ["input"], cost_accounting: ["input"], inventory_accounting: ["input"],
};
const LABEL: Record<ViewAsId, string> = { manajemen: "Manajemen", commercial: "Commercial", ppic: "PPIC", input: "Input" };

/** The items of a role (a screen whose module is off is left out); fewer than two = no "Lihat sebagai". */
export function viewAsItems(role: Role, settings: ModuleSettings, ctx: { week: string | null }): ViewAsItem[] {
  if (!isModuleOn(settings.v5_management, role)) return [];
  const href: Record<ViewAsId, string | null> = {
    manajemen: ctx.week && isModuleOn(settings.v4_design, role) ? `/minggu-ini/${ctx.week}` : null,
    commercial: isModuleOn(settings.m7_commercial, role) ? "/komersial" : null,
    ppic: ctx.week && isModuleOn(settings.m3_planning, role) ? `/w/${ctx.week}/rencana` : null,
    input: isModuleOn(settings.v5_input, role) ? "/input" : null,
  };
  const items = READS[role].flatMap((id) => (href[id] ? [{ id, label: LABEL[id], href: href[id]! }] : []));
  return items.length >= 2 ? items : [];
}

/** Which item a page is (Shell `active` key). */
export function viewAsActive(active: string): ViewAsId | null {
  if (active === "minggu-ini") return "manajemen";
  if (active.startsWith("/komersial")) return "commercial";
  if (active.endsWith("/rencana") || active === "rencana") return "ppic";
  if (active === "/input") return "input";
  return null;
}

/** Roles that read the PPIC screen through K37 besides its own (read only; writes stay admin / ppic). */
export const PPIC_READERS_K37: Role[] = ["management", "operations_director"];
