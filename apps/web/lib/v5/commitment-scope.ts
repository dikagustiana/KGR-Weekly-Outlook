import { assignmentCovers, baseKey } from "@kgr/engine";

/**
 * Q-v5.2-122 (K43, A8): the base keys a viewer may write a commitment for. A commitment is one row per BASE key ("RPA|Karkas"), and the
 * database lets a Sales user write (or even read) it only when an active assignment of theirs covers that key: `public.assignment_covers`
 * in tg_commitment_guard and sales_commitment_read (supabase/migrations/20261025000200_v52_security.sql), O21(b). An assignment of the base
 * key ("RPA|Karkas") covers every form; one of a form ("RPA|Karkas|Fresh") covers only that exact key, which is not the base key.
 * Admin and Kepala Sales ("all") write every key.
 *
 * `rows` are the candidates the save will accept. `formOnly` are the candidates the viewer holds only by form ("RPA|Karkas|Fresh"): the
 * tile does not offer them (the save is refused) and says why. A candidate with no assignment at all is in neither.
 */
export function commitmentScope(assigned: Set<string> | "all", candidates: string[]): { rows: string[]; formOnly: string[] } {
  if (assigned === "all") return { rows: candidates, formOnly: [] };
  // an empty key covers nothing in the database (assignment_covers('', k) is false), unlike `assignmentCovers` of the engine
  const keys = [...assigned].filter((a) => a !== "");
  const rows = candidates.filter((k) => keys.some((a) => assignmentCovers(a, k)));
  const formOnly = candidates.filter((k) => !rows.includes(k) && keys.some((a) => baseKey(a) === k));
  return { rows, formOnly };
}
