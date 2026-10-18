import { inAssignmentScope, type SalesAssignment } from "@kgr/engine";

/**
 * PRD v5.1 R7 (K49) and v5.2 R58 (O21(b)): the existing PO lines that a PO upload may replace or retire. Only lines of this
 * channel (line key "<po_ref>|<item>|<n>"), of a PO and customer present in the file, and for Sales only lines inside one
 * of their assignment rows — customer AND key together (an assignment key with a form suffix covers that exact key, one
 * without covers both forms, no key covers all): a partial file, a PO number another customer also uses, or a SKU of
 * another rep never deletes or updates a line that is not theirs. Pure.
 *
 * `scope`: "all" (commercial lead, admin), a list of customers (customers only, as before), or the assignment rows with the
 * key of a stored line.
 */
const norm = (s: unknown) => (s === null || s === undefined ? "" : String(s).trim().toLowerCase());

export type PoScope = "all" | string[] | { assignments: SalesAssignment[]; keyOf: (line: Record<string, unknown>) => string | null };

export function poLinesInScope<T extends Record<string, unknown>>(
  existing: T[], file: { po_ref: string | null; customer: string | null }[], scope: PoScope,
): T[] {
  const pairs = new Set(file.filter((f) => f.po_ref).map((f) => `${f.po_ref}\u0000${norm(f.customer)}`));
  const inScope = (e: T): boolean => {
    if (scope === "all") return true;
    if (Array.isArray(scope)) return scope.some((c) => norm(c) === norm(e.customer));
    return inAssignmentScope(scope.assignments, { customer: e.customer === null || e.customer === undefined ? null : String(e.customer), key: scope.keyOf(e) });
  };
  return existing.filter((e) => String(e.line_key ?? "").startsWith(`${String(e.po_ref)}|`) && pairs.has(`${String(e.po_ref)}\u0000${norm(e.customer)}`) && inScope(e));
}
