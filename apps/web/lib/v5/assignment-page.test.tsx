/**
 * A7 — /komersial/assignment: a 404 for every role the area `sales_assignment` does not name (before anything is read), the
 * list (active first, fail-closed), the summary per Sales user, the form (Sales from the user list, keys from the master),
 * edit mode, the management view (list only) and a user list that cannot be read (the list stays, the form says why not).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { ROLES, can, type Role } from "../roles";
import { AssignmentLink } from "@/components/v5/AssignmentLink";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
let viewer: { email: string; role: Role; fullName: string | null } = { email: "lead@x.test", role: "commercial_lead", fullName: "Kepala Sales" };
vi.mock("@/lib/session", () => ({ requireViewer: async () => viewer }));
vi.mock("@/lib/schema-session", () => ({ assertSchemaCurrent: async () => {} }));
vi.mock("@/lib/page", () => ({ plainContext: async () => ({ viewer, weeks: [], week: null }) }));
vi.mock("@/components/Shell", () => ({ Shell: ({ children }: { children: unknown }) => <div data-shell="">{children as never}</div> }));
let view: "management" | "preparer" = "preparer";
vi.mock("@/lib/view-server", () => ({ currentView: async () => view }));
vi.mock("@/lib/modules", () => ({ moduleEnabled: async () => true }));
let sb: MemSb = memSb();
let svc: MemSb | null = null;
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/supabase-service", () => ({ supabaseService: () => svc }));
const { default: AssignmentPage } = await import("@/app/komersial/assignment/page");

const USERS: MemRow[] = [
  { email: "budi@x.test", full_name: "Budi S", role: "sales", active: true },
  { email: "siti@x.test", full_name: "Siti", role: "sales", active: true },
  { email: "baru@x.test", full_name: "Belum Ditugasi", role: "sales", active: true },
  { email: "ppic@x.test", full_name: "PPIC", role: "ppic", active: true },
];
const SKUS = ["RPA|Karkas|Fresh", "RPA|Karkas|Frozen", "RPA|Sayap|Fresh", "RPA|Usus|Fresh"].map((key) => ({ key, active: true }));
const ROWS: MemRow[] = [
  { id: "a0", sales_rep: "Budi S", email: "budi@x.test", customer: null, key: "RPA|Usus", active: false, note: "lama" },
  { id: "a1", sales_rep: "Budi S", email: "budi@x.test", customer: null, key: "RPA|Karkas", active: true, note: "untuk Ramadan" },
  { id: "a2", sales_rep: "Siti", email: "siti@x.test", customer: "PT Maju", key: "RPA|Sayap|Fresh", active: true, note: null },
  { id: "a3", sales_rep: "Siti", email: "siti@x.test", customer: null, key: "RPA|Hilang|Fresh", active: true, note: null },
];
const setup = () => { sb = memSb({ app_user: USERS, sku_key: SKUS, sales_assignment: ROWS }); svc = memSb({ app_user: USERS }); };
const render = async (sp: Record<string, string | undefined> = {}) => renderToStaticMarkup(await AssignmentPage({ searchParams: Promise.resolve(sp) }));
const as = (role: Role) => { viewer = { email: `${role}@x.test`, role, fullName: null }; };

afterEach(() => { viewer = { email: "lead@x.test", role: "commercial_lead", fullName: "Kepala Sales" }; view = "preparer"; sb = memSb(); svc = null; vi.restoreAllMocks(); });

describe("who opens the page", () => {
  for (const role of ROLES.filter((r) => !can(r, "sales_assignment"))) {
    it(`${role}: 404, and nothing is read`, async () => {
      setup(); as(role);
      await expect(render()).rejects.toThrow("404");
      expect(sb.log).toEqual([]);
      expect(svc?.log).toEqual([]);
    });
  }
  for (const role of ["admin", "commercial_lead"] as Role[]) {
    it(`${role}: the page renders`, async () => {
      setup(); as(role);
      expect(await render()).toContain("Penugasan Sales");
    });
  }
});

describe("the list, the summary and the form", () => {
  it("lists every assignment, active first; marks a key that is not in the master; the summary names O21(b)", async () => {
    setup();
    const html = await render();
    const ids = [...html.matchAll(/data-assignment="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["a1", "a3", "a2", "a0"]); // active first (Budi < Siti; by key within a rep), then the inactive one
    expect(html).toContain("Daftar penugasan (3 aktif, 1 nonaktif)");
    expect(html).toContain("RPA|Karkas = semua bentuk");
    expect(html).toContain("RPA|Sayap|Fresh = hanya Fresh (hanya PT Maju)");
    expect(html).toContain("1 nonaktif");
    expect(html.match(/tidak ada di master/g)).toHaveLength(1); // RPA|Hilang|Fresh only
    expect(html).toContain("RPA|Hilang|Fresh");
    // a Sales user without an assignment is listed, with what that means
    expect(html).toMatch(/Belum Ditugasi[\s\S]*?belum ada penugasan aktif, tidak melihat SKU apa pun/);
  });
  it("the form: Sales users (role sales only) from the user list, keys of the master and their base keys in the datalist", async () => {
    setup();
    const html = await render();
    expect(html).toContain('<option value="budi@x.test">Budi S (budi@x.test)</option>');
    expect(html).not.toContain("ppic@x.test</option>");
    expect(html).toContain('<option value="RPA|Karkas" label="semua bentuk"></option>');
    expect(html).toContain('<option value="RPA|Karkas|Fresh" label="hanya Fresh"></option>');
    expect(html).toContain('<option value="RPA|Sayap" label="semua bentuk"></option>');
    expect(html).toContain("Simpan penugasan");
    // Kepala Sales reads the user list with the service client (the session client cannot read app_user)
    expect(svc!.calls("app_user:select")).toHaveLength(1);
    expect(sb.calls("app_user:select")).toHaveLength(0);
  });
  it("edit mode: the row is in the form (hidden id, e-mail, key, customer, note) and the button says so", async () => {
    setup();
    const html = await render({ edit: "a2" });
    expect(html).toContain('<input type="hidden" name="id" value="a2"/>');
    expect(html).toContain("Simpan perubahan");
    expect(html).toContain("Ubah penugasan");
    expect(html).toContain('value="RPA|Sayap|Fresh"');
    expect(html).toContain('value="PT Maju"');
    expect(html).toMatch(/<option value="siti@x.test" selected="">/);
    expect(html).toContain("Batal ubah");
  });
  it("an edit id that is not a row opens the plain add form", async () => {
    setup();
    const html = await render({ edit: "nope" });
    expect(html).toContain("Tambah penugasan");
    expect(html).not.toContain("Simpan perubahan");
    expect(html).not.toContain("Batal ubah");
  });
  it("each row has Ubah and the switch (Nonaktifkan for an active row, Aktifkan for an inactive one)", async () => {
    setup();
    const html = await render();
    expect(html.match(/>Nonaktifkan</g)).toHaveLength(3);
    expect(html.match(/>Aktifkan</g)).toHaveLength(1);
    expect(html).toContain('href="/komersial/assignment?edit=a1"');
  });
});

describe("management view and failures", () => {
  it("management view: the list and the summary, no form, no row actions", async () => {
    setup(); as("admin"); view = "management";
    const html = await render();
    expect(html).toContain("Tampilan Manajemen");
    expect(html).toContain("Daftar penugasan");
    expect(html).not.toContain("<form");
    expect(html).not.toContain(">Ubah<");
  });
  it("Kepala Sales without the service key: the list stays, the form says why it cannot be used (K41: the error is shown, not an empty picker)", async () => {
    setup(); svc = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    expect(html).toContain("Formulir tidak bisa dipakai");
    expect(html).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(html).toContain("Daftar penugasan (3 aktif, 1 nonaktif)");
    expect(html).not.toContain("Simpan penugasan");
    // the summary still lists the e-mails of the rows, with nobody called an orphan
    expect(html).not.toContain("bukan pengguna Sales yang aktif");
  });
  it("Admin without the service key reads the user list with the session client", async () => {
    setup(); as("admin"); svc = null;
    expect(await render()).toContain("Simpan penugasan");
  });
  it("a master that cannot be read: the form is replaced by the error, the list stays", async () => {
    setup();
    sb = memSb({ app_user: USERS, sku_key: SKUS, sales_assignment: ROWS }, { fail: { sku_key: "permission denied for table sku_key" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    expect(html).toContain("Formulir tidak bisa dipakai");
    expect(html).toContain("permission denied for table sku_key");
    expect(html).toContain("Daftar penugasan (3 aktif, 1 nonaktif)");
  });
  it("the list is the page: a failed read of sales_assignment stops it (K41), it is not rendered as 'belum ada penugasan'", async () => {
    setup();
    sb = memSb({ app_user: USERS, sku_key: SKUS }, { fail: { sales_assignment: "permission denied for table sales_assignment" } });
    await expect(render()).rejects.toThrow("permission denied for table sales_assignment");
  });
  it("an empty table says what it means for Sales", async () => {
    setup(); sb = memSb({ app_user: USERS, sku_key: SKUS, sales_assignment: [] });
    expect(await render()).toContain("Tanpa penugasan, Sales tidak melihat SKU apa pun");
  });
});

describe("the link to the screen", () => {
  it("AssignmentLink points at /komersial/assignment", () => {
    const html = renderToStaticMarkup(<AssignmentLink />);
    expect(html).toContain('href="/komersial/assignment"');
    expect(html).toContain("Penugasan Sales");
  });
});
