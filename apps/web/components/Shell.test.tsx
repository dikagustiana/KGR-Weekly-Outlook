/** PRD v5.2-A R44 (K57): one banner in the header when the database schema is behind the code; none otherwise. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
let schema: string | null = null;
vi.mock("@/lib/schema-session", () => ({ schemaStatus: async () => schema }));
vi.mock("@/lib/view-server", () => ({ currentView: async () => "preparer" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/modules", async () => {
  const core = await import("@/lib/modules-core");
  return { ...core, moduleSettings: async () => ({}) };
});
const { Shell } = await import("./Shell");

const render = async () => renderToStaticMarkup(await Shell({ viewer: { email: "fin@x.test", role: "finance", fullName: null } as never, weeks: [], week: null, active: "outlook", children: <p data-tile>isi</p> }));

describe("Shell schema banner (R44)", () => {
  it("shows the banner once when the probe reports the schema behind", async () => {
    schema = "Skema database belum diperbarui ke v5.1.0; hubungi Admin (price_list_week.deleted_at)";
    const html = await render();
    expect(html.match(/Skema database belum diperbarui/g)?.length).toBe(1);
    expect(html).toContain('role="alert"');
    expect(html).toContain("data-tile");
  });
  it("no banner when the schema is current", async () => {
    schema = null;
    expect(await render()).not.toContain("Skema database belum diperbarui");
  });
});
