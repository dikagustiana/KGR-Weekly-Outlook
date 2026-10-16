/**
 * Feature flags per module (PRD v3 §4.9, rule: default off). Pure — the flag rows come from `app_setting`.
 * A flag value is {"enabled": bool, "roles"?: Role[]}: no role list = every role that may see the page.
 */
import type { Role } from "./roles";

export type ModuleKey =
  | "m1_costing" | "m2_ledger" | "m3_planning" | "m4_monthly" | "m5_drivers" | "m6_cash" | "m7_commercial" | "m7_approval"
  | "v4_design" | "v4_release"
  | "v5_costing" | "v5_pl" | "v5_ppic_class" | "v5_commercial" | "v5_input" | "v5_management";

export const MODULE_KEYS: ModuleKey[] = [
  "m1_costing", "m2_ledger", "m3_planning", "m4_monthly", "m5_drivers", "m6_cash", "m7_commercial", "m7_approval",
  "v4_design", "v4_release",
  "v5_costing", "v5_pl", "v5_ppic_class", "v5_commercial", "v5_input", "v5_management",
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
  v4_design: "v4 Tampilan baru: navigasi per peran, Minggu ini",
  v4_release: "v4 Rilis ketat (§7.2): kontrol wajib BELUM DIISI / STALE menolak rilis kecuali ada override",
  v5_costing: "v5 Costing rencana → final, simulasi live bird",
  v5_pl: "v5 Laba rugi dua tampilan, beban tetap, kumulatif lima ukuran",
  v5_ppic_class: "v5 Demand per ukuran → kelas → kg LB, layar PPIC",
  v5_commercial: "v5 Komitmen, price list mingguan, jawaban surplus, layar Commercial",
  v5_input: "v5 Layar Input per role, upload tervalidasi, grid kelengkapan",
  v5_management: "v5 Layar Manajemen, Lihat sebagai",
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

/** Any module enabled (for any role). None = nothing v3 to rebuild, so v1 flows never touch the v3 tables. */
export function anyModuleOn(settings: ModuleSettings): boolean {
  return Object.values(settings).some((s) => s?.enabled === true);
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
export const SKU_READERS: Role[] = [...PREP, "management", "operations_director"];

export const MODULE_NAV: NavDef[] = [
  // cost per batch is finance detail: not for sales (PRD v3 Q17)
  { module: "m1_costing", label: "Costing", roles: [...PREP, "management", "operations_director"], href: (c) => (c.week ? `/w/${c.week}/costing` : null), management: true },
  { module: "m1_costing", label: "Input costing", roles: ["admin", "cost_accounting"], href: (c) => (c.week ? `/w/${c.week}/input/costing` : null) },
  { module: "m2_ledger", label: "Stok per SKU", roles: [...PREP, "management", "operations_director"], href: () => "/sku", management: true },
  { module: "m3_planning", label: "Demand", roles: ["admin", "sales", "commercial_lead", "ppic", "management", "operations_director"], href: (c) => (c.week ? `/w/${c.week}/demand` : null), management: true },
  { module: "m3_planning", label: "Rencana", roles: ["admin", "ppic", "finance"], href: (c) => (c.week ? `/w/${c.week}/rencana` : null) },
  { module: "m3_planning", label: "Alokasi hari ini", roles: ["admin", "ppic", "sales", "commercial_lead"], href: (c) => (c.today ? `/hari/${c.today}/alokasi` : null) },
  { module: "m4_monthly", label: "Bulanan", roles: "all", href: (c) => (c.month ? `/m/${c.month}` : null), management: true },
  { module: "m4_monthly", label: "Tutup buku", roles: ["admin", "finance"], href: (c) => (c.month ? `/m/${c.month}/tutup-buku` : null) },
  { module: "m5_drivers", label: "Biaya", roles: ["admin", "finance"], href: (c) => (c.month ? `/m/${c.month}/biaya` : null) },
  { module: "m6_cash", label: "Kas", roles: ["admin", "finance", "management", "operations_director"], href: () => "/kas", management: true },
  { module: "m6_cash", label: "CCC", roles: ["admin", "finance", "management", "operations_director"], href: () => "/kas/ccc", management: true },
  { module: "m7_commercial", label: "Komersial", roles: ["admin", "sales", "commercial_lead", "management", "operations_director", "finance"], href: () => "/komersial", management: true },
  { module: "m7_approval", label: "Approval diskon", roles: ["admin", "commercial_lead", "finance"], href: () => "/komersial/approval" },
  { module: "m7_approval", label: "Scorecard", roles: ["admin", "commercial_lead", "management", "operations_director"], href: () => "/komersial/scorecard", management: true },
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

/**
 * What a rebuild run does (PRD v4 §8 S1): nothing when no module is on; with a module on it needs the server key,
 * because only the service role may call mart_replace.
 */
export function rebuildMode(settings: ModuleSettings, hasServiceKey: boolean): "skip" | "no_key" | "run" {
  if (!anyModuleOn(settings)) return "skip";
  return hasServiceKey ? "run" : "no_key";
}

export const REBUILD_NO_KEY =
  "Data harian tidak dibangun: server belum punya SUPABASE_SERVICE_ROLE_KEY (PRD v4 S1). Antrian tetap menunggu sampai kunci dipasang.";
