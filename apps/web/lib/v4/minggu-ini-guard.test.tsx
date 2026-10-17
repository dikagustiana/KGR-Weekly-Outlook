/** PRD v5.1 R6 (K48): the Minggu ini page refuses every role but admin, management, operations director and finance. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { role: "sales" };
const loaded = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/lib/page", () => ({ weekContext: async () => ({ viewer: { email: "x@t", role: state.role }, weeks: [], week: { week_start: "2026-08-24" } }) }));
vi.mock("@/lib/modules", () => ({ moduleSettings: async () => ({ v4_design: { enabled: true } }) }));
vi.mock("@/lib/v4/minggu-ini-data", () => ({ loadMingguIni: async () => { loaded(); return { v5Mgmt: null }; } }));
vi.mock("@/lib/v4/minggu-ini", () => ({ mingguIniModel: () => ({ tiles: [] }) }));
vi.mock("@/components/Shell", () => ({ Shell: () => null }));
vi.mock("@/components/ActionForm", () => ({ ActionForm: () => null }));
vi.mock("@/components/v4/TilePage", () => ({ TilePage: () => null }));
vi.mock("@/app/minggu-ini/actions-v5", () => ({ decideLbPriceV5Action: async () => undefined }));
const { default: MingguIniPage } = await import("@/app/minggu-ini/[week]/page");

const open = () => MingguIniPage({ params: Promise.resolve({ week: "2026-08-24" }), searchParams: Promise.resolve({}) } as never);

describe("Minggu ini per role (v4_design on for everyone)", () => {
  beforeEach(() => loaded.mockClear());
  for (const role of ["sales", "commercial_lead", "ppic", "purchasing", "inventory_accounting", "cost_accounting"]) {
    it(`${role}: 404, nothing loaded`, async () => {
      state.role = role;
      await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(loaded).not.toHaveBeenCalled();
    });
  }
  for (const role of ["finance", "management", "operations_director", "admin"]) {
    it(`${role}: rendered`, async () => {
      state.role = role;
      await expect(open()).resolves.toBeTruthy();
      expect(loaded).toHaveBeenCalledTimes(1);
    });
  }
});
