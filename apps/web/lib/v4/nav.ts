/**
 * Navigation per role (PRD v4 §5.4): one row, at most 7 items; an item whose module flag is off for the role, or
 * whose page the role may not open, is not rendered. Pure. Pages that the PRD names but that do not exist yet point
 * to the page that holds the same work today (docs/v4/irisan-1.md, "Navigasi").
 */
import type { Role } from "../roles";
import { isModuleOn, type ModuleKey, type ModuleSettings } from "../modules-core";

export interface V4NavItem { id: string; label: string; href: string }

export interface V4NavCtx { week: string | null; month: string | null; today: string }

interface Def {
  id: string;
  label: string;
  href: (c: V4NavCtx) => string | null;
  /** Module whose flag must be on for the role; absent = always (v1 page). */
  module?: ModuleKey;
  /** Module that, when on, replaces the href by `alt`. */
  alt?: { module: ModuleKey; href: (c: V4NavCtx) => string | null };
}

const w = (p: string) => (c: V4NavCtx) => (c.week ? `/w/${c.week}/${p}` : null);
const m = (p: string) => (c: V4NavCtx) => (c.month ? `/m/${c.month}${p}` : null);

const D: Record<string, Def> = {
  mingguIni: { id: "minggu-ini", label: "Minggu ini", href: (c) => (c.week ? `/minggu-ini/${c.week}` : null) },
  outlookBulan: { id: "outlook-bulan", label: "Outlook bulan", href: m(""), module: "m4_monthly" },
  kasSolv: { id: "kas", label: "Kas & solvabilitas", href: () => "/kas", module: "m6_cash" },
  kas: { id: "kas", label: "Kas", href: () => "/kas", module: "m6_cash" },
  stok: { id: "stok", label: "Stok", href: w("stok"), alt: { module: "m2_ledger", href: () => "/sku" } },
  stokSku: { id: "stok", label: "Stok per SKU", href: w("stok"), alt: { module: "m2_ledger", href: () => "/sku" } },
  rekon: { id: "rekon", label: "Rekon kartu stok", href: () => "/sku", module: "m2_ledger" },
  komersial: { id: "komersial", label: "Komersial", href: () => "/komersial", module: "m7_commercial" },
  rilis: { id: "rilis", label: "Rilis", href: w("rilis") },
  rencana: { id: "rencana", label: "Rencana", href: w("rencana"), module: "m3_planning" },
  alokasi: { id: "alokasi", label: "Alokasi hari ini", href: (c) => `/hari/${c.today}/alokasi`, module: "m3_planning" },
  batch: { id: "batch", label: "Batch", href: w("input/batch") },
  upload: { id: "upload", label: "Upload", href: w("upload") },
  // PRD v5 §6.4 (flag v5_input): one Input screen for every role; same id, so it replaces "Upload" in the row
  input: { id: "upload", label: "Input", href: () => "/input", module: "v5_input" },
  pesanan: { id: "pesanan", label: "Pesanan", href: w("input/penjualan") },
  approval: { id: "approval", label: "Approval", href: () => "/komersial/approval", module: "m7_approval" },
  scorecard: { id: "scorecard", label: "Scorecard", href: () => "/komersial/scorecard", module: "m7_approval" },
  supplyLb: { id: "supply-lb", label: "Supply LB", href: w("input/parameter") },
  harga: { id: "harga", label: "Harga acuan", href: w("input/harga") },
  kontrol: { id: "kontrol", label: "Kontrol", href: w("kontrol") },
  costing: { id: "costing", label: "Costing", href: w("costing"), module: "m1_costing" },
  kontrolCosting: { id: "kontrol", label: "Kontrol costing", href: w("kontrol") },
  biaya: { id: "biaya", label: "Biaya tetap & driver", href: m("/biaya"), module: "m5_drivers" },
  tutupBuku: { id: "tutup-buku", label: "Tutup buku", href: m("/tutup-buku"), module: "m4_monthly" },
  admin: { id: "admin", label: "Admin", href: () => "/admin" },
};

/** Workspace per role in nav order (§5.4). Admin: the management workspace, PPIC and sales entries, then Admin. */
export const WORKSPACE: Record<Role, Def[]> = {
  management: [D.mingguIni, D.outlookBulan, D.kasSolv, D.stok, D.komersial, D.rilis, D.input],
  // PRD v5 §5.3: reads like management (the LB price decision form comes with irisan 1 / 6)
  operations_director: [D.mingguIni, D.outlookBulan, D.kasSolv, D.stok, D.komersial, D.rilis, D.input],
  ppic: [D.rencana, D.alokasi, D.stok, D.batch, D.input, D.upload],
  sales: [D.komersial, D.pesanan, D.input, D.upload],
  commercial_lead: [D.komersial, D.pesanan, D.approval, D.scorecard, D.input, D.upload],
  purchasing: [D.supplyLb, D.harga, D.input, D.upload],
  inventory_accounting: [D.stokSku, D.rekon, D.input, D.upload, D.kontrol],
  cost_accounting: [D.costing, D.kontrolCosting, D.input, D.upload],
  finance: [D.outlookBulan, D.biaya, D.tutupBuku, D.kas, D.rilis, D.kontrol, D.input, D.upload],
  admin: [D.mingguIni, D.outlookBulan, D.rencana, D.komersial, D.stok, D.rilis, D.admin],
};

export const NAV_MAX = 7;

/**
 * PRD v5.1 K48: the roles that open Manajemen · Minggu ini (cash, P&L, the LB price simulation and the input status of
 * every owner). Other roles get a 404 even with the URL, also when v4_design is on for them.
 */
export const MINGGU_INI_ROLES: readonly Role[] = ["admin", "management", "operations_director", "finance"];
export const mingguIniAllowed = (role: Role) => MINGGU_INI_ROLES.includes(role);

export function v4Nav(role: Role, settings: ModuleSettings, ctx: V4NavCtx): V4NavItem[] {
  const out: V4NavItem[] = [];
  for (const d of WORKSPACE[role] ?? []) {
    if (d.module && !isModuleOn(settings[d.module], role)) continue;
    const href = d.alt && isModuleOn(settings[d.alt.module], role) ? d.alt.href(ctx) : d.href(ctx);
    if (href && !out.some((x) => x.id === d.id)) out.push({ id: d.id, label: d.label, href });
  }
  return out.slice(0, NAV_MAX);
}

/** First page of the role's workspace (§5.4 "Halaman awal"); null when none applies (then the v1 outlook). */
export function v4Home(role: Role, settings: ModuleSettings, ctx: V4NavCtx): string | null {
  return v4Nav(role, settings, ctx)[0]?.href ?? null;
}

/** Is the v4 shell on for this role (flag v4_design, irisan 1)? */
export const v4On = (settings: ModuleSettings, role: Role) => isModuleOn(settings.v4_design, role);
