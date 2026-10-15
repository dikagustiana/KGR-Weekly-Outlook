"use client";
import { useRouter } from "next/navigation";
import { tgl } from "@/lib/fmt";

export function WeekSelect({ weeks, current, active, longDates = false }: { weeks: { start: string; end: string; status: string }[]; current: string; active: string; longDates?: boolean }) {
  const router = useRouter();
  // Management View v2 R11: the management view writes every date as "24 Agu 2026"
  const period = (w: { start: string; end: string }) =>
    longDates ? `${tgl(w.start)} – ${tgl(w.end)}` : `${w.start.slice(8)}/${w.start.slice(5, 7)} – ${w.end.slice(8)}/${w.end.slice(5, 7)}/${w.end.slice(0, 4)}`;
  const label = (w: { start: string; end: string; status: string }) =>
    `Minggu ${period(w)}${w.status === "closed" ? " (ditutup)" : w.status === "released" ? " (rilis)" : ""}`;
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
