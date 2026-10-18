/** PRD v5.1 R7 (K49): a PO upload (input-save po_lines) replaces only the lines of the POs and customers in the file. */
import { describe, expect, it } from "vitest";
import { poLinesInScope } from "./po-lines";
import { tieNote } from "./input-save";

const db = [
  { id: "a1", po_ref: "PO-1", customer: "PT A", line_key: "PO-1|JLB0593|1" },
  { id: "a2", po_ref: "PO-1", customer: "PT A", line_key: "PO-1|JLB0092|1" },
  { id: "b1", po_ref: "PO-1", customer: "PT B", line_key: "PO-1|JLB0593|2" },   // same PO number, another customer
  { id: "c1", po_ref: "PO-2", customer: "PT C", line_key: "PO-2|JLB0593|1" },
  { id: "m1", po_ref: "PO-1", customer: "PT A", line_key: "manual-7" },         // not from this upload channel
];

describe("existing PO lines in the scope of an upload", () => {
  it("a partial file with only PT A's PO-1 does not touch PT B under the same number, PO-2 or manual lines", () => {
    const file = [{ po_ref: "PO-1", customer: "PT A" }];
    expect(poLinesInScope(db, file, "all").map((e) => e.id)).toEqual(["a1", "a2"]);
  });
  it("customer names match without case or spaces", () => {
    expect(poLinesInScope(db, [{ po_ref: "PO-1", customer: " pt b " }], "all").map((e) => e.id)).toEqual(["b1"]);
  });
  it("Sales: only lines of their own customers, even when the file names another", () => {
    const file = [{ po_ref: "PO-1", customer: "PT A" }, { po_ref: "PO-1", customer: "PT B" }];
    expect(poLinesInScope(db, file, ["PT A"]).map((e) => e.id)).toEqual(["a1", "a2"]);
    expect(poLinesInScope(db, file, []).map((e) => e.id)).toEqual([]);
  });
  it("a file of every customer of PO-1 covers all of them", () => {
    const file = [{ po_ref: "PO-1", customer: "PT A" }, { po_ref: "PO-1", customer: "PT B" }];
    expect(poLinesInScope(db, file, "all").map((e) => e.id)).toEqual(["a1", "a2", "b1"]);
  });
});

describe("R60: a tied invoice names the next step, it does not make the cost final", () => {
  it("tied batches (once each) are 'belum final' with the step Posting alokasi; untied rows stay sementara; nothing tied says nothing more", () => {
    expect(tieNote(["126/PO/KGR/08/2026", "126/PO/KGR/08/2026", "127/PO/KGR/08/2026"], 4)).toBe(
      "3 faktur tie ke GL; 1 masih sementara. Biaya batch 126/PO/KGR/08/2026, 127/PO/KGR/08/2026 belum final: langkah berikutnya Posting alokasi (Input costing → Alokasikan → Posting); sampai itu biaya tetap sementara.");
    expect(tieNote([], 2)).toBe("0 faktur tie ke GL; 2 masih sementara.");
  });
});
