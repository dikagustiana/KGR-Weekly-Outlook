import "server-only";
import { redirect } from "next/navigation";
import { seesInputs } from "./roles";
import type { WeekCtx } from "./page";

export function lists(ctx: WeekCtx) {
  const i = ctx.computed.loaded.inputs;
  return {
    items: i.item_map.map((x) => ({ code: x.item_code, name: x.item_name ?? null })),
    keys: i.sku_keys.map((k) => k.key),
  };
}

export function guardInputs(ctx: WeekCtx) {
  if (!seesInputs(ctx.viewer.role)) redirect(`/w/${ctx.week.week_start}/outlook`);
}

export function readOnly(ctx: WeekCtx) {
  return ctx.week.status === "closed" && ctx.viewer.role !== "admin";
}
