/** PRD v5.1 K40 (R12): a change queues its dates through the data date, at most 62 days. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { throughDates, QUEUE_THROUGH_MAX_DAYS } = await import("./rebuild-dates");

describe("throughDates", () => {
  it("WP of 26 Aug with data on 27 Aug: 26 and 27 Aug", () => {
    expect(throughDates(["2026-08-26"], "2026-08-27")).toEqual(["2026-08-26", "2026-08-27"]);
  });
  it("several dates: from the earliest through the data date, once each; later dates only themselves", () => {
    expect(throughDates(["2026-08-27", "2026-08-25", "2026-08-25", "2026-09-01"], "2026-08-27")).toEqual(["2026-08-25", "2026-08-26", "2026-08-27", "2026-09-01"]);
  });
  it("only future dates (a PO for next week, tomorrow's LB decision): just those", () => {
    expect(throughDates(["2026-10-18"], "2026-08-27")).toEqual(["2026-10-18"]);
  });
  it(`more than ${QUEUE_THROUGH_MAX_DAYS} days back is refused with the manual rebuild named`, () => {
    expect(throughDates(["2026-06-27"], "2026-08-27")).toHaveLength(62);
    expect(() => throughDates(["2026-06-26"], "2026-08-27")).toThrow(/63 hari.*rebuild manual dari Admin/);
  });
});
