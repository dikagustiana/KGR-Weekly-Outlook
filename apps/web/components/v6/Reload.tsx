"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** R132: reloads the page's data (router.refresh) without leaving it; the tile that failed asks again. */
export function Reload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="v4b" aria-disabled={pending} onClick={() => !pending && start(() => router.refresh())}>
      {pending ? "Memuat…" : "Muat ulang"}
    </button>
  );
}
