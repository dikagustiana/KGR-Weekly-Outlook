/**
 * PRD v5.1 R7 (K49): the existing PO lines that a PO upload may replace or retire. Only lines of this channel (line
 * key "<po_ref>|<item>|<n>"), of a PO and customer present in the file, and for Sales only lines of their customers:
 * a partial file, or a PO number that another customer also uses, never deletes another customer's lines. Pure.
 */
const norm = (s: unknown) => (s === null || s === undefined ? "" : String(s).trim().toLowerCase());

export function poLinesInScope<T extends Record<string, unknown>>(
  existing: T[], file: { po_ref: string | null; customer: string | null }[], customers: "all" | string[],
): T[] {
  const pairs = new Set(file.filter((f) => f.po_ref).map((f) => `${f.po_ref}\u0000${norm(f.customer)}`));
  const mine = customers === "all" ? null : new Set(customers.map(norm));
  return existing.filter((e) => String(e.line_key ?? "").startsWith(`${String(e.po_ref)}|`)
    && pairs.has(`${String(e.po_ref)}\u0000${norm(e.customer)}`)
    && (mine === null || mine.has(norm(e.customer))));
}
