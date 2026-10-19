/** PRD v6 R127: `/` redirects to the viewer's home on the same origin (relative Location) and remembers it in kgr_home. */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/request-context", () => ({ getRequestContext: async () => ctx.value }));

describe("GET /", () => {
  it("a relative Location, not the server's own host (localhost behind a proxy drops the session after login)", async () => {
    ctx.value = {
      email: "a@x", viewer: { email: "a@x", role: "admin", fullName: "A" }, settings: {}, today: "2026-08-27",
      weeks: [{ id: "w", week_start: "2026-08-24", update_date: "2026-08-27", status: "open" }],
    };
    const { GET } = await import("../app/route");
    const r = await GET(new NextRequest("http://localhost:3100/"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("/w/2026-08-24/outlook");
    expect(r.cookies.get("kgr_home")?.value).toBe("2026-08-24|/w/2026-08-24/outlook");
  });
  it("without a session: to /login, nothing remembered", async () => {
    ctx.value = { email: null, viewer: null, settings: {}, weeks: [], today: "2026-08-27" };
    const { GET } = await import("../app/route");
    const r = await GET(new NextRequest("http://localhost:3100/"));
    expect(r.headers.get("location")).toBe("/login");
    expect(r.cookies.get("kgr_home")).toBeUndefined();
  });
});
