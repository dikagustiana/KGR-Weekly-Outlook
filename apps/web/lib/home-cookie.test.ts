/** PRD v6 R127: the remembered home of `/`. */
import { describe, expect, it } from "vitest";
import { homeCookieValue, homeFromCookie, jakartaMonday } from "./home-cookie";
import { jakartaToday, mondayOf } from "@kgr/engine";

describe("kgr_home", () => {
  it("is used only in the week it was written for", () => {
    const v = homeCookieValue("2026-10-19", "/minggu-ini/2026-10-19");
    expect(homeFromCookie(v, "2026-10-19")).toBe("/minggu-ini/2026-10-19");
    expect(homeFromCookie(v, "2026-10-26")).toBeNull();
  });
  it("accepts same-origin paths only", () => {
    expect(homeFromCookie("2026-10-19|//evil.example", "2026-10-19")).toBeNull();
    expect(homeFromCookie("2026-10-19|https://evil.example", "2026-10-19")).toBeNull();
    expect(homeFromCookie("garbage", "2026-10-19")).toBeNull();
    expect(homeFromCookie(undefined, "2026-10-19")).toBeNull();
  });
  it("Monday in WIB equals the engine's", () => {
    for (const iso of ["2026-10-18T16:59:00Z", "2026-10-18T17:00:00Z", "2026-10-25T23:00:00Z", "2026-03-01T00:00:00Z"]) {
      const d = new Date(iso);
      expect(jakartaMonday(d)).toBe(mondayOf(jakartaToday(d)));
    }
  });
});
