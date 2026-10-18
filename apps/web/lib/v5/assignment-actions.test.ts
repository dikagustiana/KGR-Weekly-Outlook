/**
 * A7 — Admin and Kepala Sales manage `sales_assignment` (K49, O21(b)): the role gate of both actions (area `sales_assignment`,
 * checked before anything is read), the schema gate (K57), key validation (a SKU key of the master or its base key; a base
 * key covers every form, a key with a form only itself), the upsert on the unique triple, the Sales user (only an active user
 * with role `sales`; read with the service client for Kepala Sales, who cannot read `app_user`), the toggle (never a delete)
 * and how a database error is told (RLS → "Tidak berwenang").
 * The in-memory client has no RLS, triggers or constraints: what the database does with these requests is proved on PostgreSQL
 * + PostgREST in tests/e2e (journey A7) and `scripts/test-rls.sh` ("cl insert assignment: OK").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { ROLES, can, type Role } from "../roles";
import { DENIED, DENIED_OR_GONE, SUFFIX_NOTE } from "./assignment";

vi.mock("server-only", () => ({}));
const revalidated: string[][] = [];
vi.mock("next/cache", () => ({ revalidatePath: (...a: string[]) => { revalidated.push(a); } }));
let viewer: { email: string; role: Role; fullName: string | null } = { email: "lead@x.test", role: "commercial_lead", fullName: "Kepala Sales" };
vi.mock("@/lib/session", () => ({ requireViewer: async () => viewer }));
let schemaBehind: string | null = null, schemaChecks = 0;
vi.mock("@/lib/schema-session", () => ({ assertSchemaCurrent: async () => { schemaChecks += 1; if (schemaBehind) throw new Error(schemaBehind); } }));
let sb: MemSb = memSb();
let svc: MemSb | null = null;
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/supabase-service", () => ({ supabaseService: () => svc }));
const { saveAssignmentAction, toggleAssignmentAction } = await import("@/app/komersial/assignment/actions");
const { loadSalesUsers } = await import("@/lib/v5/assignment-data");

const USERS: MemRow[] = [
  { email: "budi@x.test", full_name: "Budi S", role: "sales", active: true },
  { email: "siti@x.test", full_name: "Siti", role: "sales", active: true },
  { email: "nama@x.test", full_name: "Budi S", role: "sales", active: true }, // the same name as Budi
  { email: "off@x.test", full_name: "Off", role: "sales", active: false },
  { email: "ppic@x.test", full_name: "PPIC", role: "ppic", active: true },
];
const SKUS: MemRow[] = [
  ...["RPA|Karkas|Fresh", "RPA|Karkas|Frozen", "RPA|Karkas|n/a", "RPA|Sayap|Fresh", "RPA|Sayap|Frozen", "Trading|Karkas|n/a"].map((key) => ({ key, active: true })),
  { key: "RPA|Lama|Fresh", active: false },
];
const row = (id: string, o: MemRow = {}): MemRow => ({ id, sales_rep: "Budi S", email: "budi@x.test", customer: null, key: "RPA|Karkas", active: true, note: null, created_at: `2026-10-0${id.replace(/\D/g, "") || "1"}T00:00:00Z`, ...o });
const make = (assignments: MemRow[] = [], opts: Parameters<typeof memSb>[1] = {}) => memSb({ app_user: USERS, sku_key: SKUS, sales_assignment: assignments }, opts);
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };
const writes = (m: MemSb) => m.log.filter((l) => l.op === "insert" || l.op === "update" || l.op === "upsert" || l.op === "delete");
/** A writer whose UPDATE policy hides every row: PostgREST under RLS answers 0 rows and no error. */
function updatesMatchNothing(m: MemSb): MemSb {
  const from = m.from.bind(m);
  m.from = (t: string) => {
    const q = from(t) as Record<string, (...a: unknown[]) => unknown>;
    if (t === "sales_assignment") { const upd = q.update; q.update = (p: unknown, o?: unknown) => { upd(p, o); return q.eq("id", "__hidden__"); }; }
    return q;
  };
  return m;
}
const as = (role: Role, email = `${role}@x.test`) => { viewer = { email, role, fullName: null }; };

// Kepala Sales is the default viewer: the Sales users come from the service client (the session client cannot read app_user)
beforeEach(() => { svc = memSb({ app_user: USERS }); });
afterEach(() => { sb = memSb(); svc = null; revalidated.length = 0; schemaBehind = null; schemaChecks = 0; viewer = { email: "lead@x.test", role: "commercial_lead", fullName: "Kepala Sales" }; vi.restoreAllMocks(); });

describe("the role gate (area sales_assignment: Admin and Kepala Sales), before anything is read", () => {
  const denied = ROLES.filter((r) => !can(r, "sales_assignment"));
  it("the area names exactly admin and commercial_lead", () => {
    expect(ROLES.filter((r) => can(r, "sales_assignment")).sort()).toEqual(["admin", "commercial_lead"]);
    expect(denied).toHaveLength(8);
  });
  for (const role of denied) {
    it(`${role}: save and toggle are refused, nothing read, nothing written, nothing revalidated`, async () => {
      sb = make([row("a1")]); svc = make();
      as(role);
      const s = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
      const t = await toggleAssignmentAction({}, form({ id: "a1", active: "0" }));
      expect(s.error).toBe(DENIED);
      expect(t.error).toBe(DENIED);
      expect(sb.log).toEqual([]);
      expect(svc.log).toEqual([]);
      expect(schemaChecks).toBe(0);
      expect(revalidated).toEqual([]);
    });
  }
  for (const role of ["admin", "commercial_lead"] as Role[]) {
    it(`${role}: the schema is checked, then the write goes through`, async () => {
      sb = make(); svc = make();
      as(role);
      const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
      expect(r.error).toBeUndefined();
      expect(schemaChecks).toBe(1);
      expect(writes(sb)).toHaveLength(1);
    });
  }
  it("a database behind the code (K57) stops both actions with the banner's message, nothing written", async () => {
    sb = make([row("a1")]);
    schemaBehind = "Skema database belum diperbarui ke v5.2.6; hubungi Admin (DB v5.2.4)";
    const s = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    const t = await toggleAssignmentAction({}, form({ id: "a1", active: "0" }));
    expect(s.error).toBe(schemaBehind);
    expect(t.error).toBe(schemaBehind);
    expect(sb.log).toEqual([]);
  });
});

describe("the key: a SKU key of the master or its base key, nothing else", () => {
  it("a base key (RPA|Karkas) is saved and the message says it covers every form", async () => {
    sb = make(); svc = make();
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("RPA|Karkas");
    expect(r.ok).toContain("semua bentuk");
    expect(r.ok).not.toContain(SUFFIX_NOTE);
  });
  it("a key with its form (RPA|Karkas|Fresh) is saved as it is and the message says it covers only that form and why that matters for commitments", async () => {
    sb = make(); svc = make();
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas|Fresh" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("hanya Fresh");
    expect(r.ok).toContain(SUFFIX_NOTE);
    expect((writes(sb)[0].payload as MemRow).key).toBe("RPA|Karkas|Fresh");
  });
  it("Trading keys: the full key and its base key are known too", async () => {
    for (const key of ["Trading|Karkas|n/a", "Trading|Karkas"]) {
      sb = make();
      expect((await saveAssignmentAction({}, form({ email: "budi@x.test", key }))).error).toBeUndefined();
    }
  });
  for (const [key, why] of [
    ["RPA|Foo|Fresh", "a SKU that is not in the master"],
    ["RPA|Foo", "a base key of a SKU that is not in the master"],
    ["RPA|Karkas|Chilled", "a form the master does not have"],
    ["RPA|Lama|Fresh", "a SKU that is no longer active"],
    ["RPA|Lama", "the base key of a SKU that is no longer active"],
    ["Karkas", "a unit without its segment"],
    ["RPA|", "an empty unit"],
  ] as const) {
    it(`"${key}" (${why}) is refused with a clear message and nothing is written`, async () => {
      sb = make(); svc = make();
      const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key }));
      expect(r.ok).toBeUndefined();
      expect(r.error).toContain(`Key "${key}" tidak dikenal`);
      expect(r.error).toContain("RPA|Karkas|Fresh"); // an example of a key that works
      expect(writes(sb)).toEqual([]);
      expect(revalidated).toEqual([]);
    });
  }
  it("a key that differs only in case or spacing is refused with the key it probably means (the database compares the text as it is)", async () => {
    sb = make();
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "rpa|karkas|fresh" }));
    expect(r.error).toBe('Key "rpa|karkas|fresh" tidak dikenal; maksud Anda "RPA|Karkas|Fresh"? Huruf besar/kecil dan spasi harus persis sama dengan master');
    expect(writes(sb)).toEqual([]);
  });
  it("the key is required (this screen does not make an assignment for every SKU), and surrounding spaces are trimmed", async () => {
    sb = make();
    expect((await saveAssignmentAction({}, form({ email: "budi@x.test", key: "   " }))).error).toContain("Isi key SKU");
    expect(writes(sb)).toEqual([]);
    expect((await saveAssignmentAction({}, form({ email: "budi@x.test", key: "  RPA|Sayap  " }))).error).toBeUndefined();
    expect((writes(sb)[0].payload as MemRow).key).toBe("RPA|Sayap");
  });
  it("the keys come from the master read fail-closed: an unreadable master is an error, not an empty list", async () => {
    sb = make([], { fail: { sku_key: "permission denied for table sku_key" } });
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toContain("permission denied for table sku_key");
    expect(writes(sb)).toEqual([]);
  });
});

describe("the Sales user", () => {
  it("only an active user with role sales: another role, an inactive user and an unknown e-mail are refused", async () => {
    for (const email of ["ppic@x.test", "off@x.test", "nobody@x.test"]) {
      sb = make();
      const r = await saveAssignmentAction({}, form({ email, key: "RPA|Karkas" }));
      expect(r.error).toBe(`${email} bukan pengguna Sales yang aktif`);
      expect(writes(sb)).toEqual([]);
    }
    sb = make();
    expect((await saveAssignmentAction({}, form({ email: "", key: "RPA|Karkas" }))).error).toBe("Pilih pengguna Sales");
  });
  it("Kepala Sales cannot read app_user: the list is read with the service client, only role sales and active", async () => {
    sb = memSb({ app_user: [], sku_key: SKUS, sales_assignment: [] }); // the session client sees no user (RLS)
    svc = memSb({ app_user: USERS });
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toBeUndefined();
    expect(sb.calls("app_user:select")).toHaveLength(0);
    const read = svc.calls("app_user:select");
    expect(read).toHaveLength(1);
    expect(read[0].filters).toEqual(["eq role sales", "eq active true"]);
    expect(svc.log.filter((l) => l.op !== "select")).toEqual([]); // the service client reads, never writes
    expect(writes(sb)).toHaveLength(1); // the write is the session's (RLS applies)
  });
  it("Admin reads the users with the session client; the service client is not used", async () => {
    as("admin");
    sb = make(); svc = memSb({ app_user: [] });
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toBeUndefined();
    expect(sb.calls("app_user:select")).toHaveLength(1);
    expect(svc.log).toEqual([]);
  });
  it("Kepala Sales without SUPABASE_SERVICE_ROLE_KEY gets a clear error, nothing written (Admin can still pick a user)", async () => {
    sb = make(); svc = null;
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(writes(sb)).toEqual([]);
  });
  it("the service client is for the roles of the area only: any other role asking for the list is refused before the client is touched", async () => {
    for (const role of ROLES.filter((r) => !can(r, "sales_assignment"))) {
      const service = memSb({ app_user: USERS });
      await expect(loadSalesUsers(memSb({ app_user: USERS }) as never, { role }, service as never), role).rejects.toThrow("hanya Admin dan Kepala Sales membaca daftar Sales");
      expect(service.log, role).toEqual([]);
    }
    const ok = await loadSalesUsers(memSb({ app_user: USERS }) as never, { role: "commercial_lead" }, memSb({ app_user: USERS }) as never);
    expect(ok.map((u) => u.email)).toEqual(["budi@x.test", "nama@x.test", "siti@x.test"]); // sales and active only, ordered by e-mail
  });
  it("an unreadable user list is an error (K41), not an empty list", async () => {
    sb = make(); svc = memSb({ app_user: USERS }, { fail: { app_user: "boom" } });
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toContain("boom");
    expect(writes(sb)).toEqual([]);
  });
});

describe("add = upsert on the unique triple (sales_rep, customer, key)", () => {
  it("a new assignment: one upsert with onConflict sales_rep,customer,key; sales_rep = full name; customer null when empty; note kept", async () => {
    sb = make(); svc = make();
    const r = await saveAssignmentAction({}, form({ email: " Budi@X.test ", customer: "", key: "RPA|Karkas", note: " untuk Ramadan " }));
    expect(r.error).toBeUndefined();
    const w = writes(sb);
    expect(w.map((l) => l.call)).toEqual(["sales_assignment:upsert"]);
    expect(w[0].payload).toEqual({ sales_rep: "Budi S", email: "budi@x.test", customer: null, key: "RPA|Karkas", active: true, note: "untuk Ramadan" });
    expect(w[0].options).toEqual({ onConflict: "sales_rep,customer,key" });
    expect(r.ok).toBe("Penugasan disimpan: Budi S · RPA|Karkas · semua pelanggan (semua bentuk).");
  });
  it("the customer is trimmed; blank is every customer", async () => {
    sb = make();
    await saveAssignmentAction({}, form({ email: "budi@x.test", customer: "  PT Maju Jaya  ", key: "RPA|Karkas" }));
    await saveAssignmentAction({}, form({ email: "siti@x.test", customer: "   ", key: "RPA|Karkas" }));
    expect(writes(sb).map((l) => (l.payload as MemRow).customer)).toEqual(["PT Maju Jaya", null]);
  });
  it("a Sales user whose e-mail already has a row keeps that sales_rep (one rep, one name) — not the full name", async () => {
    sb = make([row("a1", { sales_rep: "SALES-E2E", key: "RPA|Sayap|Fresh" })]);
    await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect((writes(sb)[0].payload as MemRow).sales_rep).toBe("SALES-E2E");
  });
  it("a user without a name gets the e-mail as sales_rep", async () => {
    svc = memSb({ app_user: [{ email: "anon@x.test", full_name: null, role: "sales", active: true }] });
    sb = make();
    await saveAssignmentAction({}, form({ email: "anon@x.test", key: "RPA|Karkas" }));
    expect((writes(sb)[0].payload as MemRow).sales_rep).toBe("anon@x.test");
  });
  it("the same assignment again is not doubled: it is activated, its note is refreshed (or kept) and the row stays one", async () => {
    sb = make([row("a1", { active: false, note: "lama", customer: "PT A" })]);
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", customer: "PT A", key: "RPA|Karkas" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("sudah ada, diaktifkan");
    expect(sb.tables.sales_assignment).toHaveLength(1);
    expect(sb.tables.sales_assignment[0]).toMatchObject({ id: "a1", active: true, note: "lama" });
    await saveAssignmentAction({}, form({ email: "budi@x.test", customer: "PT A", key: "RPA|Karkas", note: "baru" }));
    expect(sb.tables.sales_assignment).toHaveLength(1);
    expect(sb.tables.sales_assignment[0]).toMatchObject({ note: "baru" });
  });
  it("the same assignment under another spelling of the rep or the customer's case is the same row (the access would be given twice, and one switch would not end it)", async () => {
    sb = make([row("a1", { sales_rep: "SALES-E2E", customer: "PT Maju" })]);
    await saveAssignmentAction({}, form({ email: "budi@x.test", customer: "pt maju", key: "RPA|Karkas" }));
    expect(sb.tables.sales_assignment).toHaveLength(1);
    expect(writes(sb)[0].payload).toMatchObject({ sales_rep: "SALES-E2E", customer: "PT Maju", active: true }); // the stored spelling is the conflict target
  });
  it("two Sales users with one name: the second does not take over the row of the first", async () => {
    sb = make([row("a1", { email: "budi@x.test" })]);
    const r = await saveAssignmentAction({}, form({ email: "nama@x.test", key: "RPA|Karkas" }));
    expect(r.error).toContain('Nama Sales "Budi S" sudah dipakai budi@x.test');
    expect(writes(sb)).toEqual([]);
    expect(sb.tables.sales_assignment[0].email).toBe("budi@x.test");
  });
  it("the same key for another customer or another Sales user is a new row", async () => {
    sb = make([row("a1", { customer: "PT A" })]);
    await saveAssignmentAction({}, form({ email: "budi@x.test", customer: "PT B", key: "RPA|Karkas" }));
    await saveAssignmentAction({}, form({ email: "siti@x.test", customer: "PT A", key: "RPA|Karkas" }));
    expect(sb.tables.sales_assignment).toHaveLength(3);
  });
  it("what is saved is revalidated: this screen and every page that reads an assignment", async () => {
    sb = make();
    await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(revalidated).toEqual([["/komersial/assignment"], ["/komersial"], ["/komersial/[key]", "page"], ["/input"], ["/admin/pengguna"]]);
  });
});

describe("change an assignment (field id)", () => {
  it("an update by id of e-mail, customer, key and note; the sales_rep stays while the e-mail is the same", async () => {
    sb = make([row("a1", { sales_rep: "SALES-E2E", customer: "PT A" })]);
    const r = await saveAssignmentAction({}, form({ id: "a1", email: "budi@x.test", customer: "PT B", key: "RPA|Sayap|Frozen", note: "ganti" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("Penugasan diubah");
    const w = writes(sb);
    expect(w.map((l) => l.call)).toEqual(["sales_assignment:update"]);
    expect(w[0].filters).toEqual(["eq id a1"]);
    expect(w[0].payload).toEqual({ email: "budi@x.test", sales_rep: "SALES-E2E", customer: "PT B", key: "RPA|Sayap|Frozen", note: "ganti" });
  });
  it("a row whose e-mail has another, older rep keeps its own rep when it is changed (no clash with itself, no silent rename)", async () => {
    sb = make([row("a1", { sales_rep: "B-1", key: "RPA|Sayap" }), row("a2", { sales_rep: "B-2", key: "RPA|Karkas", created_at: "2026-10-09T00:00:00Z" })]);
    const r = await saveAssignmentAction({}, form({ id: "a2", email: "budi@x.test", key: "RPA|Karkas|Fresh", note: "x" }));
    expect(r.error).toBeUndefined();
    expect((writes(sb)[0].payload as MemRow).sales_rep).toBe("B-2");
  });
  it("a new e-mail takes the sales_rep of that user (the one its rows already have, else its name)", async () => {
    sb = make([row("a1"), row("a2", { email: "siti@x.test", sales_rep: "SITI-01", key: "RPA|Sayap" })]);
    await saveAssignmentAction({}, form({ id: "a1", email: "siti@x.test", key: "RPA|Karkas" }));
    expect((writes(sb)[0].payload as MemRow).sales_rep).toBe("SITI-01");
  });
  it("a change into an assignment that already exists is refused, the id of an unknown row too", async () => {
    sb = make([row("a1"), row("a2", { key: "RPA|Sayap" })]);
    const dup = await saveAssignmentAction({}, form({ id: "a2", email: "budi@x.test", key: "RPA|Karkas" }));
    expect(dup.error).toContain("Penugasan yang sama sudah ada");
    const gone = await saveAssignmentAction({}, form({ id: "zzz", email: "budi@x.test", key: "RPA|Karkas|Fresh" }));
    expect(gone.error).toBe("Penugasan yang diubah tidak ditemukan");
    expect(writes(sb)).toEqual([]);
  });
  it("an update that RLS hides from the writer matches no row and answers no error: refused, not reported as saved", async () => {
    sb = updatesMatchNothing(make([row("a1")]));
    const r = await saveAssignmentAction({}, form({ id: "a1", email: "budi@x.test", key: "RPA|Sayap" }));
    expect(r.error).toBe(DENIED_OR_GONE);
    expect(revalidated).toEqual([]);
  });
});

describe("deactivate and activate (never a delete)", () => {
  it("deactivate: update active=false by id, message names the assignment; reactivate: active=true", async () => {
    sb = make([row("a1", { customer: "PT A" })]);
    const off = await toggleAssignmentAction({}, form({ id: "a1", active: "0" }));
    expect(off.error).toBeUndefined();
    expect(off.ok).toContain("Dinonaktifkan: Budi S · RPA|Karkas · PT A");
    expect(sb.tables.sales_assignment[0].active).toBe(false);
    const on = await toggleAssignmentAction({}, form({ id: "a1", active: "1" }));
    expect(on.ok).toContain("Diaktifkan: Budi S · RPA|Karkas · PT A");
    expect(sb.tables.sales_assignment[0].active).toBe(true);
    expect(sb.log.filter((l) => l.op === "update").map((l) => [l.payload, l.filters])).toEqual([[{ active: false }, ["eq id a1"]], [{ active: true }, ["eq id a1"]]]);
  });
  it("no request of this module ever deletes a row", async () => {
    sb = make([row("a1")]); svc = make();
    await toggleAssignmentAction({}, form({ id: "a1", active: "0" }));
    await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Sayap" }));
    await saveAssignmentAction({}, form({ id: "a1", email: "budi@x.test", key: "RPA|Karkas|Fresh" }));
    expect(sb.log.filter((l) => l.op === "delete")).toEqual([]);
    expect(sb.tables.sales_assignment).toHaveLength(2);
  });
  it("an id that matches no row (unknown, or hidden by RLS from this role) is refused, not reported as done", async () => {
    sb = make([row("a1")]);
    const r = await toggleAssignmentAction({}, form({ id: "zzz", active: "0" }));
    expect(r.error).toBe(DENIED_OR_GONE);
    expect(revalidated).toEqual([]);
    sb = updatesMatchNothing(make([row("a1")]));
    expect((await toggleAssignmentAction({}, form({ id: "a1", active: "0" }))).error).toBe(DENIED_OR_GONE);
    expect(revalidated).toEqual([]);
    expect((await toggleAssignmentAction({}, form({ active: "0" }))).error).toBe("Penugasan tidak dikenal");
  });
  it("a toggle is revalidated like a save", async () => {
    sb = make([row("a1")]);
    await toggleAssignmentAction({}, form({ id: "a1", active: "0" }));
    expect(revalidated.map((a) => a[0])).toEqual(["/komersial/assignment", "/komersial", "/komersial/[key]", "/input", "/admin/pengguna"]);
  });
});

describe("what the database answers is told as it is; an RLS denial is 'Tidak berwenang'", () => {
  const rls = { message: 'new row violates row-level security policy for table "sales_assignment"', code: "42501" };
  it("insert/upsert denied by RLS (42501)", async () => {
    sb = make([], { fail: { "sales_assignment:upsert": rls } });
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toMatch(/^Tidak berwenang/);
    expect(r.error).toContain("row-level security");
    expect(revalidated).toEqual([]);
  });
  it("the same by message alone (no code), 'permission denied' included", async () => {
    sb = make([], { fail: { "sales_assignment:upsert": { message: "permission denied for table sales_assignment" } } });
    expect((await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }))).error).toMatch(/^Tidak berwenang/);
  });
  it("update by id and toggle denied by RLS", async () => {
    sb = make([row("a1")], { fail: { "sales_assignment:update": rls } });
    expect((await saveAssignmentAction({}, form({ id: "a1", email: "budi@x.test", key: "RPA|Sayap" }))).error).toMatch(/^Tidak berwenang/);
    expect((await toggleAssignmentAction({}, form({ id: "a1", active: "0" }))).error).toMatch(/^Tidak berwenang/);
  });
  it("a duplicate (23505) and any other database error keep the database's own message", async () => {
    sb = make([], { fail: { "sales_assignment:upsert": { message: 'duplicate key value violates unique constraint "sales_assignment_sales_rep_customer_key_key"', code: "23505" } } });
    const dup = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(dup.error).toContain("Penugasan yang sama (Sales, pelanggan, key) sudah ada");
    expect(dup.error).toContain("sales_assignment_sales_rep_customer_key_key");
    sb = make([], { fail: { "sales_assignment:upsert": "canceling statement due to statement timeout" } });
    expect((await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }))).error).toBe("Penugasan tidak disimpan: canceling statement due to statement timeout");
  });
  it("the read of the existing assignments is fail-closed too: nothing is written on a failed read", async () => {
    sb = make([], { fail: { "sales_assignment:select": "boom" } });
    const r = await saveAssignmentAction({}, form({ email: "budi@x.test", key: "RPA|Karkas" }));
    expect(r.error).toContain("boom");
    expect(writes(sb)).toEqual([]);
  });
});
