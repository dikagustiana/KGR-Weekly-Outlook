/**
 * Q-v5.2-5: Admin → Modul `setFlag` keeps the stored value fields it does not manage (costing_rows_mode of v5_pl, a note,
 * a later field) and sets the mode of v5_pl from the form; the fields it does manage are rewritten as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSb } from "./fake-sb";
import { mergeFlagValue } from "./modules-core";

vi.mock("server-only", () => ({}));
let sb = fakeSb();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({ requireViewer: async () => ({ email: "admin@x.id", role: "admin", fullName: null }) }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/rebuild", () => ({ processRebuildQueue: async () => ({ done: 0, failed: 0, notes: [] }), queueRebuild: async () => undefined }));
const { setFlag } = await import("@/app/admin/modul/actions");

afterEach(() => { sb = fakeSb(); });
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
const written = () => sb.args.filter((a) => a.call === "app_setting:upsert").map((a) => a.args[0] as { key: string; value: Record<string, unknown> });

describe("setFlag keeps what the form does not manage", () => {
  it("v5_pl toggled off: costing_rows_mode and a note stay; roles are rewritten from the form", async () => {
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, roles: ["finance"], costing_rows_mode: "memo", note: "O24 b" } }] } });
    const r = await setFlag({}, form({ key: "v5_pl", role_admin: "1" }));
    expect(r.error).toBeUndefined();
    expect(written()).toEqual([{ key: "v5_pl", value: { enabled: false, roles: ["admin"], costing_rows_mode: "memo", note: "O24 b" } }]);
    expect(r.ok).toContain("baris costing di laba rugi: memo");
  });
  it("v5_pl switched on for everyone: the roles of before are dropped, the mode stays 'memo'", async () => {
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: false, roles: ["admin"], costing_rows_mode: "memo" } }] } });
    await setFlag({}, form({ key: "v5_pl", enabled: "1" }));
    expect(written()[0].value).toEqual({ enabled: true, costing_rows_mode: "memo" });
  });
  it("the mode is set from the form; 'cogs' and 'memo' only", async () => {
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, costing_rows_mode: "cogs" } }] } });
    await setFlag({}, form({ key: "v5_pl", enabled: "1", costing_rows_mode: "memo" }));
    expect(written()[0].value).toEqual({ enabled: true, costing_rows_mode: "memo" });
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, costing_rows_mode: "memo" } }] } });
    await setFlag({}, form({ key: "v5_pl", enabled: "1", costing_rows_mode: "cogs" }));
    expect(written()[0].value).toEqual({ enabled: true, costing_rows_mode: "cogs" });
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, costing_rows_mode: "memo" } }] } });
    const bad = await setFlag({}, form({ key: "v5_pl", enabled: "1", costing_rows_mode: "opex" }));
    expect(bad.error).toBe("Mode baris costing tidak valid (cogs atau memo)");
    expect(written()).toEqual([]);
  });
  it("a flag without a stored value gets only what the form says (no mode invented)", async () => {
    sb = fakeSb({ rows: { app_setting: [] } });
    await setFlag({}, form({ key: "v5_pl", enabled: "1" }));
    expect(written()[0].value).toEqual({ enabled: true });
  });
  it("another flag keeps unknown fields too, and costing_rows_mode is not set by a form field on it", async () => {
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, owner: "Finance", since: "2026-08-01" } }] } });
    await setFlag({}, form({ key: "v5_input", enabled: "1", costing_rows_mode: "memo" }));
    expect(written()[0].value).toEqual({ enabled: true, owner: "Finance", since: "2026-08-01" });
  });
  it("v5_costing: the start date (typed, else kept) and other fields; an invalid date is refused", async () => {
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, since: "2026-08-01", cutover_note: "uji" } }] } });
    await setFlag({}, form({ key: "v5_costing", enabled: "1" }));
    expect(written()[0].value).toEqual({ enabled: true, since: "2026-08-01", cutover_note: "uji" });
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true, since: "2026-08-01" } }] } });
    await setFlag({}, form({ key: "v5_costing", enabled: "1", since: "2026-09-01" }));
    expect(written()[0].value).toEqual({ enabled: true, since: "2026-09-01" });
    sb = fakeSb({ rows: { app_setting: [{ value: { enabled: true } }] } });
    expect((await setFlag({}, form({ key: "v5_costing", enabled: "1", since: "01/09/2026" }))).error).toContain("tidak valid");
    expect(written()).toEqual([]);
  });
  it("a failed read of the stored value refuses the write (nothing is overwritten blind)", async () => {
    sb = fakeSb({ fail: { app_setting: "permission denied" } });
    const r = await setFlag({}, form({ key: "v5_pl", enabled: "1" }));
    expect(r.error).toContain("permission denied");
    expect(written()).toEqual([]);
  });
  it("an unknown module is refused before anything is read", async () => {
    expect((await setFlag({}, form({ key: "nope", enabled: "1" }))).error).toBe("Modul tidak dikenal");
    expect(sb.calls).toEqual([]);
  });
});

describe("mergeFlagValue", () => {
  const base = { allRoles: 10, enabled: true, roles: [] as never[] };
  it("a stored value that is not an object is treated as empty", () => {
    for (const prev of [null, undefined, "x", 5, [1]]) expect(mergeFlagValue(prev, { ...base, key: "v5_pl" })).toEqual({ enabled: true });
  });
  it("roles are written only for a proper subset", () => {
    expect(mergeFlagValue({}, { ...base, key: "v4_design", roles: ["admin"] })).toEqual({ enabled: true, roles: ["admin"] });
    expect(mergeFlagValue({}, { ...base, key: "v4_design", roles: new Array(10).fill("admin") as never[] })).toEqual({ enabled: true });
  });
});
