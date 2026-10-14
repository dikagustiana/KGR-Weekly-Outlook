import type { Area } from "./roles";

/** parameter column → permission area (PRD §2: Admin all; Purchasing LB price & terms; Inventory Accounting the Accurate totals). */
export const PARAM_AREA: Record<string, Area> = {
  lb_price_today: "parameter_lb", min_trading_spread: "parameter_lb",
  terms_lb_days: "parameter_terms", terms_trading_days: "parameter_terms", terms_freight_maklon_days: "parameter_terms",
  accurate_sales_kg: "parameter_accurate", accurate_opening_stock_value: "parameter_accurate",
  horizon_fresh_days: "parameter_all", target_shrink: "parameter_all", freight_plan_per_kg_lb: "parameter_all", maklon_per_kg_processed: "parameter_all",
  stock_age_limit_days: "parameter_all", yield_karkas: "parameter_all", yield_kepala: "parameter_all", yield_ceker: "parameter_all",
  yield_usus: "parameter_all", yield_hja: "parameter_all", yield_lemak: "parameter_all",
};
