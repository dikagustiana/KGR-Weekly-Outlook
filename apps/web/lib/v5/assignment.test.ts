/**
 * A7 — the pure rules of the assignment screen: the keys an assignment may name (base key vs form key, O21(b)), the one-line
 * cover summary per Sales user, the identity of "the same assignment" and the wording of a database error. What a key covers
 * is compared with the engine's `assignmentCovers`, the TypeScript twin of `public.assignment_covers` (proved in the
 * database by `scripts/test-rls.sh`).
 */
import { describe, expect, it } from "vitest";
import { assignmentCovers, baseKey } from "@kgr/engine";
import {
  DENIED, checkKey, coverLines, customerOf, knownKeys, salesRepFor, sameAssignment, sameCustomer, scopeText, sortAssignments, writeErrorText, type AssignmentRow,
} from "./assignment";

const SKUS = ["RPA|Karkas|Fresh", "RPA|Karkas|Frozen", "RPA|Karkas|n/a", "RPA|Sayap|Fresh", "RPA|Sayap|Frozen", "RPA|KRK (Kerangka)|Fresh", "Trading|Karkas|n/a", "Trading|Usus|Fresh"];
const known = knownKeys(SKUS);
const a = (o: Partial<AssignmentRow> & { id: string }): AssignmentRow => ({ sales_rep: "Budi", email: "budi@x.test", customer: null, key: "RPA|Karkas", active: true, note: null, ...o });

describe("knownKeys", () => {
  it("SKU keys of the master and the base key of each, sorted and unique", () => {
    expect(known.skus).toEqual([...SKUS].sort((x, y) => x.localeCompare(y)));
    expect(known.bases).toEqual(["RPA|Karkas", "RPA|KRK (Kerangka)", "RPA|Sayap", "Trading|Karkas", "Trading|Usus"].sort((x, y) => x.localeCompare(y)));
    expect(knownKeys(["RPA|A|Fresh", "RPA|A|Fresh"]).skus).toEqual(["RPA|A|Fresh"]);
  });
});

describe("scopeText = what the database cover says (O21(b))", () => {
  it("a base key covers every form of its SKU and nothing else; a key with a form covers only itself", () => {
    for (const k of known.bases) {
      const covered = known.skus.filter((s) => assignmentCovers(k, s));
      expect(covered, k).toEqual(known.skus.filter((s) => baseKey(s) === k));
      expect(scopeText(k)).toBe("semua bentuk");
    }
    for (const k of known.skus) {
      expect(known.skus.filter((s) => assignmentCovers(k, s)), k).toEqual([k]);
      expect(scopeText(k)).not.toBe("semua bentuk");
    }
  });
  it("the words", () => {
    expect(scopeText("RPA|Karkas")).toBe("semua bentuk");
    expect(scopeText("RPA|Karkas|Fresh")).toBe("hanya Fresh");
    expect(scopeText("RPA|Karkas|Frozen")).toBe("hanya Frozen");
    expect(scopeText("RPA|Karkas|n/a")).toBe("hanya bentuk n/a");
    expect(scopeText(null)).toBe("semua SKU");
  });
});

describe("checkKey", () => {
  it("a SKU key and a base key pass; the base flag tells which", () => {
    expect(checkKey("RPA|Karkas|Fresh", known)).toEqual({ ok: true, key: "RPA|Karkas|Fresh", base: false });
    expect(checkKey(" RPA|Karkas ", known)).toEqual({ ok: true, key: "RPA|Karkas", base: true });
    expect(checkKey("RPA|KRK (Kerangka)", known)).toEqual({ ok: true, key: "RPA|KRK (Kerangka)", base: true });
    expect(checkKey("Trading|Karkas|n/a", known)).toMatchObject({ ok: true, base: false });
  });
  it("anything else is refused, with the key quoted and an example of a key that works", () => {
    for (const bad of ["RPA|Nope", "RPA|Karkas|Chilled", "RPA|Karkas|Fresh|x", "Karkas", "Trading|Karkas|Fresh", "RPA|Karkas|"]) {
      const r = checkKey(bad, known);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) { expect(r.error).toContain(`Key "${bad}" tidak dikenal`); expect(r.error).toContain("(mis. RPA|Karkas|Fresh)"); expect(r.error).toContain("RPA|Karkas = semua bentuk"); }
    }
  });
  it("case or spacing apart: refused with the key meant", () => {
    const r = checkKey("rpa | karkas", known);
    expect(r).toEqual({ ok: false, error: 'Key "rpa | karkas" tidak dikenal; maksud Anda "RPA|Karkas"? Huruf besar/kecil dan spasi harus persis sama dengan master' });
  });
  it("empty, undefined and null are 'isi key'; a master without keys still answers", () => {
    for (const v of ["", "  ", undefined, null]) expect(checkKey(v, known)).toMatchObject({ ok: false, error: expect.stringContaining("Isi key SKU") });
    expect(checkKey("RPA|Karkas", knownKeys([]))).toMatchObject({ ok: false, error: expect.stringContaining("tidak dikenal") });
  });
});

describe("customer and identity", () => {
  it("customerOf trims and turns blank into every customer", () => {
    expect(customerOf("  PT A ")).toBe("PT A");
    for (const v of ["", "   ", null, undefined]) expect(customerOf(v)).toBeNull();
  });
  it("customers are the same apart from case and edge spaces (the database compares lower-cased); null and '' are one", () => {
    expect(sameCustomer("PT A", "pt a ")).toBe(true);
    expect(sameCustomer(null, "")).toBe(true);
    expect(sameCustomer(null, "PT A")).toBe(false);
  });
  it("the same assignment = e-mail, customer and key; the spelling of sales_rep does not make another one", () => {
    const row = a({ id: "1", sales_rep: "SALES-E2E", customer: "PT A", key: "RPA|Karkas", email: "Budi@x.test" });
    expect(sameAssignment(row, { email: "budi@x.test", customer: "pt a", key: "RPA|Karkas" })).toBe(true);
    expect(sameAssignment(row, { email: "budi@x.test", customer: null, key: "RPA|Karkas" })).toBe(false);
    expect(sameAssignment(row, { email: "budi@x.test", customer: "PT A", key: "RPA|Karkas|Fresh" })).toBe(false);
    expect(sameAssignment(row, { email: "siti@x.test", customer: "PT A", key: "RPA|Karkas" })).toBe(false);
  });
  it("salesRepFor: the oldest row of that e-mail (active or not), else the name, else the e-mail", () => {
    const rows = [a({ id: "2", sales_rep: "B-2", created_at: "2026-10-02" }), a({ id: "1", sales_rep: "B-1", created_at: "2026-10-01", active: false }), a({ id: "3", sales_rep: "S", email: "siti@x.test" })];
    expect(salesRepFor({ email: "budi@x.test", name: "Budi S" }, rows)).toBe("B-1");
    expect(salesRepFor({ email: "new@x.test", name: " Nama Baru " }, rows)).toBe("Nama Baru");
    expect(salesRepFor({ email: "new@x.test", name: null }, rows)).toBe("new@x.test");
  });
  it("sortAssignments: active first, then rep, key, customer", () => {
    const rows = [a({ id: "1", active: false, key: "A" }), a({ id: "2", sales_rep: "Zed", key: "B" }), a({ id: "3", sales_rep: "Ani", key: "Z" }), a({ id: "4", sales_rep: "Ani", key: "C", customer: "PT B" }), a({ id: "5", sales_rep: "Ani", key: "C", customer: "PT A" })];
    expect(sortAssignments(rows).map((r) => r.id)).toEqual(["5", "4", "3", "2", "1"]);
  });
});

describe("coverLines — one line per Sales user", () => {
  const users = [{ email: "budi@x.test", name: "Budi S" }, { email: "siti@x.test", name: "Siti" }, { email: "kosong@x.test", name: null }];
  const rows = [
    a({ id: "1", key: "RPA|Karkas" }),
    a({ id: "2", key: "RPA|Sayap|Fresh", customer: "PT A" }),
    a({ id: "3", key: "RPA|Usus", active: false }),
    a({ id: "4", email: "siti@x.test", sales_rep: "Siti", key: "Trading|Karkas|n/a" }),
    a({ id: "5", email: "lama@x.test", sales_rep: "Lama", key: "RPA|Karkas" }),
  ];
  it("lists what the active rows cover in the words of O21(b); inactive rows are counted, not listed", () => {
    const l = coverLines(users, rows);
    const budi = l.find((x) => x.email === "budi@x.test")!;
    expect(budi.line).toBe("RPA|Karkas = semua bentuk · RPA|Sayap|Fresh = hanya Fresh (hanya PT A)");
    expect(budi).toMatchObject({ name: "Budi S", active: 2, inactive: 1, orphan: false });
    expect(l.find((x) => x.email === "siti@x.test")!.line).toBe("Trading|Karkas|n/a = hanya bentuk n/a");
  });
  it("a Sales user without an active row gets an empty line (the screen says they see nothing); the name falls back to the e-mail", () => {
    const k = coverLines(users, rows).find((x) => x.email === "kosong@x.test")!;
    expect(k).toMatchObject({ line: "", active: 0, name: "kosong@x.test", orphan: false });
  });
  it("a row of an e-mail that is not an active Sales user is an orphan, listed last", () => {
    const l = coverLines(users, rows);
    expect(l.at(-1)).toMatchObject({ email: "lama@x.test", name: "Lama", orphan: true });
  });
  it("without the user list (it could not be read) the people are the e-mails of the rows and nobody is an orphan", () => {
    const l = coverLines(null, rows);
    expect(l.map((x) => x.email).sort()).toEqual(["budi@x.test", "lama@x.test", "siti@x.test"]);
    expect(l.every((x) => !x.orphan)).toBe(true);
  });
  it("a row without a key (made by SQL) reads 'semua SKU'", () => {
    expect(coverLines(users, [a({ id: "9", key: null })]).find((x) => x.email === "budi@x.test")!.line).toBe("semua SKU = semua SKU");
  });
});

describe("writeErrorText", () => {
  it("RLS (code 42501, or its words) is 'Tidak berwenang', with the database's message kept", () => {
    expect(writeErrorText({ code: "42501", message: "x" })).toBe(`${DENIED} (x)`);
    expect(writeErrorText({ message: 'new row violates row-level security policy for table "sales_assignment"' })).toMatch(/^Tidak berwenang/);
    expect(writeErrorText({ message: "permission denied for table sales_assignment" })).toMatch(/^Tidak berwenang/);
  });
  it("a duplicate and the rest", () => {
    expect(writeErrorText({ code: "23505", message: "duplicate key" })).toBe("Penugasan yang sama (Sales, pelanggan, key) sudah ada (duplicate key)");
    expect(writeErrorText({ code: "XX000", message: "boom" })).toBe("Penugasan tidak disimpan: boom");
  });
});
