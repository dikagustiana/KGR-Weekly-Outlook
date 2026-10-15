"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";
import { VIEW_COOKIE, canToggleView, parseViewMode } from "@/lib/view";

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

/** Preparer toggle between the preparer view and a preview of the management view (R1). */
export async function setViewMode(form: FormData) {
  const viewer = await requireViewer();
  const mode = parseViewMode(form.get("mode"));
  if (mode && canToggleView(viewer.role)) {
    (await cookies()).set(VIEW_COOKIE, mode, {
      path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect(safeNext(form.get("next")));
}
