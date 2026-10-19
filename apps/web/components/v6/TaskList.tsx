import Link from "next/link";
import { Status } from "./Status";
import type { StatusKind } from "@/lib/v6/status-map";

export interface TaskItem { id: string; title: string; due: string; status: StatusKind; statusText?: string; detail: string; href?: string }

const ORDER: Record<StatusKind, number> = { terlambat: 0, catatan: 1, belum: 2, lolos: 3 };

/**
 * PRD v6 R152: one line per task — name · due · Status; late tasks first; the full text opens under the line (<details>).
 * The impact of the open tasks is said once above the list (`impact`), not on every row.
 */
export function TaskList({ tasks, impact, empty = "Tidak ada tugas minggu ini." }: { tasks: TaskItem[]; impact?: string | null; empty?: string }) {
  const sorted = [...tasks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  if (!sorted.length) return <p className="ts-empty">{empty}</p>;
  return (
    <>
      {impact ? <p className="note" data-task-impact="">{impact}</p> : null}
      <ul className="tl6" aria-label="Tugas saya">
        {sorted.map((t) => (
          <li key={t.id} data-task-status={t.status}>
            <details>
              <summary>
                <span>{t.href ? <Link href={t.href}>{t.title}</Link> : t.title}</span>
                <span className="due">{t.due}</span>
                <Status kind={t.status} label={t.statusText} />
              </summary>
              <div>{t.detail}</div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
