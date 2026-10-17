/**
 * PRD v5.1 R39 (K20): one cost status for a group of SKUs or batches — the status when they all share it, "campur"
 * when they do not, null when none has one.
 */
export function statusMode(xs: (string | null | undefined)[]): string | null {
  const set = new Set(xs.filter((x): x is string => !!x));
  return set.size === 0 ? null : set.size === 1 ? [...set][0] : "campur";
}
