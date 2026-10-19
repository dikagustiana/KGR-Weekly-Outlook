import "server-only";
import { redirect } from "next/navigation";
import { seesInputs } from "./roles";
import type { WeekCtx } from "./page";

export function lists(ctx: WeekCtx) {
  // PRD v6 R120: from the result (prepared.items / prepared.master are the item_map and sku_key rows, one to one)
  const p = ctx.computed.result.prepared;
  return {
    items: p.items.map((x) => ({ code: x.item_code, name: x.item_name ?? null })),
    keys: p.master.map((k) => k.key),
  };
}

export function guardInputs(ctx: WeekCtx) {
  if (!seesInputs(ctx.viewer.role)) redirect(`/w/${ctx.week.week_start}/outlook`);
}

export function readOnly(ctx: WeekCtx) {
  return ctx.week.status === "closed" && ctx.viewer.role !== "admin";
}
