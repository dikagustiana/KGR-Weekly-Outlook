/** Roles and what each may write (PRD §2, PRD v3 §2). Server actions check this; RLS enforces it again in the database. */
export type Role =
  | "admin" | "inventory_accounting" | "sales" | "ppic" | "purchasing" | "finance" | "management"
  | "commercial_lead" | "cost_accounting" | "operations_director";

export const ROLES: Role[] = [
  "admin", "inventory_accounting", "sales", "ppic", "purchasing", "finance", "management", "operations_director", "commercial_lead", "cost_accounting",
];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  inventory_accounting: "Inventory Accounting",
  sales: "Sales",
  ppic: "PPIC",
  purchasing: "Purchasing / Ops",
  finance: "Finance",
  management: "Management",
  commercial_lead: "Kepala Sales",
  cost_accounting: "Cost Accounting",
  operations_director: "Direktur Operasional",
};

/** PRD v5 §5.3, K37: these roles read every screen and write only what Bab 8 names (management: nothing). */
export const MANAGEMENT_READERS: Role[] = ["management", "operations_director"];
export const readsLikeManagement = (role: Role | null | undefined): boolean => !!role && MANAGEMENT_READERS.includes(role);

export type Area =
  | "orders" | "sales_actual" | "receipts_production" | "receipts_trading" | "receipts_actual" | "batch" | "cash_plan"
  | "parameter_lb" | "parameter_terms" | "parameter_accurate" | "parameter_all" | "price_sell" | "price_buy" | "runrate"
  | "opening_stock" | "gl" | "tb" | "master" | "users" | "week" | "update_date" | "release" | "gl_override"
  // v3 (PRD v3 §2)
  | "costing_upload" | "cost_pool" | "overhead_rate" | "allocation_run" | "lot_adjust" | "blast_event" | "po_line"
  | "forecast_line" | "sales_target" | "sales_assignment" | "discount_approval" | "yield_matrix" | "weight_class"
  | "capacity" | "lb_supply" | "plan_week" | "plan_day" | "fixed_cost_schedule" | "cost_driver" | "cash_daily"
  | "monthly_outlook_version" | "closing_adjustment" | "urgency_rule" | "price_floor_rule" | "rebuild"
  // v5 (PRD v5 §5.3, Bab 8)
  | "lb_decision" | "commitment" | "commitment_lock" | "price_list_lock" | "surplus_response" | "size_class_map";

const W: Record<Area, Role[]> = {
  orders: ["admin", "sales", "commercial_lead"],
  sales_actual: ["admin", "inventory_accounting", "sales", "commercial_lead"],
  receipts_production: ["admin", "inventory_accounting", "ppic"],
  receipts_trading: ["admin", "inventory_accounting", "purchasing"],
  receipts_actual: ["admin", "inventory_accounting"],
  batch: ["admin", "ppic"],
  cash_plan: ["admin", "finance", "purchasing"],
  parameter_lb: ["admin", "purchasing"],
  parameter_terms: ["admin", "purchasing", "finance"],
  parameter_accurate: ["admin", "inventory_accounting"],
  parameter_all: ["admin"],
  price_sell: ["admin", "sales", "commercial_lead"],
  price_buy: ["admin", "purchasing"],
  runrate: ["admin", "finance"],
  opening_stock: ["admin", "inventory_accounting"],
  gl: ["admin", "inventory_accounting"],
  gl_override: ["admin", "inventory_accounting", "finance"],
  tb: ["admin", "inventory_accounting"],
  master: ["admin"],
  users: ["admin"],
  week: ["admin"],
  // K69 (v5.2 A-REL-1, Q-v5.2-12): set by hand only by Admin and Finance, only while the week is open; the uploads of
  // Inventory/Cost Accounting move it forward through advance_update_date (K39), not through this area
  update_date: ["admin", "finance"],
  release: ["admin", "finance"],
  costing_upload: ["admin", "cost_accounting"],
  cost_pool: ["admin", "cost_accounting"],
  overhead_rate: ["admin", "cost_accounting"],
  allocation_run: ["admin", "cost_accounting"],
  lot_adjust: ["admin", "inventory_accounting"],
  blast_event: ["admin", "ppic"],
  po_line: ["admin", "sales"],
  forecast_line: ["admin", "sales", "commercial_lead"],
  sales_target: ["admin", "commercial_lead"],
  sales_assignment: ["admin", "commercial_lead"],
  discount_approval: ["admin", "commercial_lead", "finance"],
  yield_matrix: ["admin", "ppic"],
  weight_class: ["admin", "ppic"],
  capacity: ["admin", "ppic"],
  lb_supply: ["admin", "ppic", "purchasing"],
  plan_week: ["admin", "ppic"],
  plan_day: ["admin", "ppic"],
  fixed_cost_schedule: ["admin", "finance"],
  cost_driver: ["admin", "finance"],
  cash_daily: ["admin", "finance"],
  monthly_outlook_version: ["admin", "finance"],
  closing_adjustment: ["admin", "finance"],
  urgency_rule: ["admin", "finance", "commercial_lead"],
  price_floor_rule: ["admin", "finance", "commercial_lead"],
  rebuild: ["admin", "inventory_accounting", "sales", "ppic", "purchasing", "finance", "commercial_lead", "cost_accounting"],
  lb_decision: ["admin", "operations_director"],
  commitment: ["admin", "sales", "commercial_lead"],
  commitment_lock: ["admin", "commercial_lead"],
  price_list_lock: ["admin", "commercial_lead"],
  surplus_response: ["admin", "sales", "commercial_lead"],
  size_class_map: ["admin", "ppic"],
};

export function can(role: Role | null | undefined, area: Area): boolean {
  return !!role && W[area].includes(role);
}

/** Who may write an area (for labels and tests). */
export function writers(area: Area): Role[] {
  return [...W[area]];
}

/** Management sees no input pages (PRD §10 role test); the operations director neither (v5 §5.3: one decision form only). */
export function seesInputs(role: Role | null | undefined): boolean {
  return !!role && !readsLikeManagement(role);
}
