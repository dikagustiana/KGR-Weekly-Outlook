"use client";
import { useRouter } from "next/navigation";

export function WeekSelect({ weeks, current, active }: { weeks: { start: string; end: string; status: string }[]; current: string; active: string }) {
  const router = useRouter();
  const label = (w: { start: string; end: string; status: string }) =>
    `Minggu ${w.start.slice(8)}/${w.start.slice(5, 7)} – ${w.end.slice(8)}/${w.end.slice(5, 7)}/${w.end.slice(0, 4)}${w.status === "closed" ? " (ditutup)" : w.status === "released" ? " (rilis)" : ""}`;
  return (
    <select
      aria-label="Pilih minggu"
      value={current}
      onChange={(e) => router.push(`/w/${e.target.value}/${active.startsWith("admin") || active.startsWith("master") ? "outlook" : active}`)}
    >
      {weeks.map((w) => (
        <option key={w.start} value={w.start}>{label(w)}</option>
      ))}
    </select>
  );
}
