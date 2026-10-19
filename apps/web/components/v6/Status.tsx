import { STATUS_WORD, statusOf, type StatusKind } from "@/lib/v6/status-map";

const ICON: Record<StatusKind, string> = { lolos: "✓", catatan: "◐", terlambat: "✕", belum: "○" };

/**
 * PRD v6 K90 / R140: icon + word + colour, never one of them alone. The icon is announced once with the word (aria-label on
 * the icon, the visible word hidden from the accessibility tree), so a screen reader says "terlambat" once.
 */
export function Status({ value, kind, size = "md", label }: {
  /** A stored word (control, upload, grid, task); mapped by statusOf. */
  value?: string | null;
  kind?: StatusKind;
  size?: "sm" | "md";
  /** Visible text other than the bare word ("terlambat 2 jam"). */
  label?: string;
}) {
  const k = kind ?? statusOf(value);
  return (
    <span className={`st6 ${size} ${k}`} data-status={k}>
      <span role="img" aria-label={label ?? STATUS_WORD[k]}>{ICON[k]}</span>
      <span aria-hidden="true">{label ?? STATUS_WORD[k]}</span>
    </span>
  );
}
