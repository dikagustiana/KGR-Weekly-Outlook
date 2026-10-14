/** Roles and what each may write (PRD §2). Server actions check this; RLS enforces it again in the database. */
export type Role = "admin" | "inventory_accounting" | "sales" | "ppic" | "purchasing" | "finance" | "management";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  inventory_accounting: "Inventory Accounting",
  sales: "Sales",
  ppic: "PPIC",
  purchasing: "Purchasing / Ops",
  finance: "Finance",
  management: "Management",
};

export type Area =
  | "orders" | "sales_actual" | "receipts_production" | "receipts_trading" | "receipts_actual" | "batch" | "cash_plan"
  | "parameter_lb" | "parameter_terms" | "parameter_accurate" | "parameter_all" | "price_sell" | "price_buy" | "runrate"
  | "opening_stock" | "gl" | "tb" | "master" | "users" | "week" | "update_date" | "release" | "gl_override";

const W: Record<Area, Role[]> = {
  orders: ["admin", "sales"],
  sales_actual: ["admin", "inventory_accounting", "sales"],
  receipts_production: ["admin", "inventory_accounting", "ppic"],
  receipts_trading: ["admin", "inventory_accounting", "purchasing"],
  receipts_actual: ["admin", "inventory_accounting"],
  batch: ["admin", "ppic"],
  cash_plan: ["admin", "finance", "purchasing"],
  parameter_lb: ["admin", "purchasing"],
  parameter_terms: ["admin", "purchasing", "finance"],
  parameter_accurate: ["admin", "inventory_accounting"],
  parameter_all: ["admin"],
  price_sell: ["admin", "sales"],
  price_buy: ["admin", "purchasing"],
  runrate: ["admin", "finance"],
  opening_stock: ["admin", "inventory_accounting"],
  gl: ["admin", "inventory_accounting"],
  gl_override: ["admin", "inventory_accounting", "finance"],
  tb: ["admin", "inventory_accounting"],
  master: ["admin"],
  users: ["admin"],
  week: ["admin"],
  update_date: ["admin", "inventory_accounting", "finance", "ppic", "sales", "purchasing"],
  release: ["admin", "finance"],
};

export function can(role: Role | null | undefined, area: Area): boolean {
  return !!role && W[area].includes(role);
}

/** Management sees no input pages (PRD §10 role test). */
export function seesInputs(role: Role | null | undefined): boolean {
  return !!role && role !== "management";
}
