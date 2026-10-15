/**
 * Feature flags per module (PRD v3 §4.9, rule: default off). Pure — the flag rows come from `app_setting`.
 * A flag value is {"enabled": bool, "roles"?: Role[]}: no role list = every role that may see the page.
 */
import type { Role } from "./roles";

export type ModuleKey =
  | "m1_costing" | "m2_ledger" | "m3_planning" | "m4_monthly" | "m5_drivers" | "m6_cash" | "m7_commercial" | "m7_approval";

export const MODULE_KEYS: ModuleKey[] = [
  "m1_costing", "m2_ledger", "m3_planning", "m4_monthly", "m5_drivers", "m6_cash", "m7_commercial", "m7_approval",
];

export const MODULE_LABEL: Record<ModuleKey, string> = {
  m1_costing: "M1 Costing per batch → SKU",
  m2_ledger: "M2 Lot ledger + stok per SKU",
  m3_planning: "M3 Demand → rencana → alokasi",
  m4_monthly: "M4 Outlook bulanan",
  m5_drivers: "M5 Biaya dengan driver",
  m6_cash: "M6 Kas, CCC, solvabilitas",
  m7_commercial: "M7 Commercial view",
  m7_approval: "M7 Approval diskon + scorecard",
};

export interface ModuleSetting {
  enabled: boolean;
  roles?: Role[] | null;
}

export type ModuleSettings = Partial<Record<ModuleKey, ModuleSetting>>;

export function parseSetting(v: unknown): ModuleSetting {
  if (!v || typeof v !== "object") return { enabled: false };
  const o = v as { enabled?: unknown; roles?: unknown };
  return {
    enabled: o.enabled === true,
    roles: Array.isArray(o.roles) ? (o.roles.filter((r) => typeof r === "string") as Role[]) : null,
  };
}

/** On for this role: the flag is enabled and the role is in its list (or there is no list). Missing flag = off. */
export function isModuleOn(setting: ModuleSetting | undefined, role: Role | null | undefined): boolean {
  if (!setting || !setting.enabled || !role) return false;
  return !setting.roles || setting.roles.length === 0 || setting.roles.includes(role);
}

export interface NavCtx {
  week?: string | null;
  month?: string | null;
  today?: string | null;
}

interface NavDef {
  module: ModuleKey;
  label: string;
  /** Who may open the page at all (PRD v3 §6), independent of the flag. "all" = every role. */
  roles: Role[] | "all";
  href: (c: Required<NavCtx>) => string | null;
  /** Shown in the management view (read pages only). */
  management?: boolean;
}

const PREP: Role[] = ["admin", "inventory_accounting", "ppic", "purchasing", "finance", "commercial_lead", "cost_accounting"];

/** Sales reads SKU stock through the commercial view (M7); the lot ledger itself is not for sales (PLAN F2). */
export const SKU_READERS: Role[] = [...PREP, "management"];

export const MODULE_NAV: NavDef[] = [
  // cost per batch is finance detail: not for sales (PRD v3 Q17)
  { module: "m1_costing", label: "Costing", roles: [...PREP, "management"], href: (c) => (c.week ? `/w/${c.week}/costing` : null), management: true },
  { module: "m1_costing", label: "Input costing", roles: ["admin", "cost_accounting"], href: (c) => (c.week ? `/w/${c.week}/input/costing` : null) },
  { module: "m2_ledger", label: "Stok per SKU", roles: [...PREP, "management"], href: () => "/sku", management: true },
  { module: "m3_planning", label: "Demand", roles: ["admin", "sales", "commercial_lead", "ppic", "management"], href: (c) => (c.week ? `/w/${c.week}/demand` : null), management: true },
  { module: "m3_planning", label: "Rencana", roles: ["admin", "ppic"], href: (c) => (c.week ? `/w/${c.week}/rencana` : null) },
  { module: "m3_planning", label: "Alokasi hari ini", roles: ["admin", "ppic", "sales", "commercial_lead"], href: (c) => (c.today ? `/hari/${c.today}/alokasi` : null) },
  { module: "m4_monthly", label: "Bulanan", roles: "all", href: (c) => (c.month ? `/m/${c.month}` : null), management: true },
  { module: "m4_monthly", label: "Tutup buku", roles: ["admin", "finance"], href: (c) => (c.month ? `/m/${c.month}/tutup-buku` : null) },
  { module: "m5_drivers", label: "Biaya", roles: ["admin", "finance"], href: (c) => (c.month ? `/m/${c.month}/biaya` : null) },
  { module: "m6_cash", label: "Kas", roles: ["admin", "finance", "management"], href: () => "/kas", management: true },
  { module: "m6_cash", label: "CCC", roles: ["admin", "finance", "management"], href: () => "/kas/ccc", management: true },
  { module: "m7_commercial", label: "Komersial", roles: ["admin", "sales", "commercial_lead", "management", "finance"], href: () => "/komersial", management: true },
  { module: "m7_approval", label: "Approval diskon", roles: ["admin", "commercial_lead", "finance"], href: () => "/komersial/approval" },
  { module: "m7_approval", label: "Scorecard", roles: ["admin", "commercial_lead", "management"], href: () => "/komersial/scorecard", management: true },
];

export interface NavItem {
  module: ModuleKey;
  label: string;
  href: string;
}

/** The module links one viewer sees: flag on for the role, page allowed for the role, and (management view) read pages only. */
export function navModules(settings: ModuleSettings, role: Role, ctx: NavCtx, managementView = false): NavItem[] {
  const c: Required<NavCtx> = { week: ctx.week ?? null, month: ctx.month ?? null, today: ctx.today ?? null };
  const out: NavItem[] = [];
  for (const d of MODULE_NAV) {
    if (!isModuleOn(settings[d.module], role)) continue;
    if (d.roles !== "all" && !d.roles.includes(role)) continue;
    if (managementView && !d.management) continue;
    const href = d.href(c);
    if (href) out.push({ module: d.module, label: d.label, href });
  }
  return out;
}
