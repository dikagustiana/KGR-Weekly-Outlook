"use server";
/**
 * A7: Kepala Sales and Admin manage `sales_assignment` (K49, O21(b)) — who sees and writes which SKU and customer. The role
 * is checked here (area `sales_assignment`, as RLS: admin and commercial_lead insert and update; nobody deletes), the schema
 * must be current (K57), and what the database answers is told as it is, an RLS denial as "Tidak berwenang".
 * A row is never deleted: deactivating it ends the access, activating it gives it back.
 */
import { revalidatePath } from "next/cache";
import { can } from "@/lib/roles";
import { requireViewer, type Viewer } from "@/lib/session";
import { assertSchemaCurrent } from "@/lib/schema-session";
import { supabaseServer } from "@/lib/supabase";
import { supabaseService } from "@/lib/supabase-service";
import { WriteError } from "@/lib/write";
import { loadAssignments, loadSalesUsers, loadSkuKeys } from "@/lib/v5/assignment-data";
import {
  DENIED, DENIED_OR_GONE, SUFFIX_NOTE, checkKey, customerOf, emailOf, hasFormSuffix, knownKeys, salesRepFor, sameAssignment, sameCustomer, scopeText, writeErrorText,
} from "@/lib/v5/assignment";

export type ActionState = { ok?: string; error?: string };

/** Role first, then the schema: nothing is read or written for a role the area does not name. */
async function gate(): Promise<Viewer> {
  const v = await requireViewer();
  if (!can(v.role, "sales_assignment")) throw new WriteError(DENIED);
  await assertSchemaCurrent();
  return v;
}

/** Every page that reads an assignment (the Komersial screens, the SKU page, the Input screen of Sales) and this screen. */
function done() {
  revalidatePath("/komersial/assignment");
  revalidatePath("/komersial");
  revalidatePath("/komersial/[key]", "page");
  revalidatePath("/input");
  revalidatePath("/admin/pengguna");
}

const label = (r: { sales_rep: string; key: string | null; customer: string | null }) => `${r.sales_rep} · ${r.key ?? "semua SKU"} · ${r.customer ?? "semua pelanggan"}`;

/**
 * Add an assignment, or change one (field `id`). Add = upsert on the unique triple (sales_rep, customer, key): the same
 * assignment again is activated and its note refreshed, never doubled. The Sales user is one of the active users with role
 * `sales`; `sales_rep` is the one that e-mail already has, else the name of the user, else the e-mail. The key is one the app
 * knows: a SKU key of the master, or its base key (every form).
 */
export async function saveAssignmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = await gate();
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const customer = customerOf(form.get("customer"));
    const note = String(form.get("note") ?? "").trim() || null;
    if (!email) throw new WriteError("Pilih pengguna Sales");
    const user = (await loadSalesUsers(sb, v, supabaseService())).find((u) => u.email === email);
    if (!user) throw new WriteError(`${email} bukan pengguna Sales yang aktif`);
    const k = checkKey(form.get("key"), knownKeys(await loadSkuKeys(sb)));
    if (!k.ok) throw new WriteError(k.error);
    const all = await loadAssignments(sb);
    const cur = id ? all.find((r) => r.id === id) : undefined;
    if (id && !cur) throw new WriteError("Penugasan yang diubah tidak ditemukan");
    const same = all.find((r) => r.id !== id && sameAssignment(r, { email, customer, key: k.key }));
    if (id && same) throw new WriteError(`Penugasan yang sama sudah ada (${label(same)}); ubah atau nonaktifkan yang itu`);
    // the rep of the row: that of the same assignment, of the row being changed while its e-mail stays, else the one the e-mail has / the name
    const rep = same?.sales_rep ?? (cur && emailOf(cur) === email ? cur.sales_rep : salesRepFor(user, all));
    // two Sales users with the same name would share a `sales_rep`: the upsert would take the row of the other one
    const clash = same ? undefined : all.find((r) => r.id !== id && r.sales_rep === rep && sameCustomer(r.customer, customer) && r.key === k.key && emailOf(r) !== email);
    if (clash) throw new WriteError(`Nama Sales "${rep}" sudah dipakai ${clash.email ?? "pengguna lain"} untuk key dan pelanggan yang sama; ubah nama salah satu pengguna di Admin → Pengguna`);
    const tail = hasFormSuffix(k.key) ? ` ${SUFFIX_NOTE}` : "";

    if (id) {
      const patch = { email, sales_rep: rep, customer, key: k.key, note };
      const { data, error } = await sb.from("sales_assignment").update(patch).eq("id", id).select("id");
      if (error) throw new WriteError(writeErrorText(error));
      if (!data || data.length === 0) throw new WriteError(DENIED_OR_GONE);
      done();
      return { ok: `Penugasan diubah: ${label(patch)} (${scopeText(k.key)}).${tail}` };
    }

    const rec = same
      ? { sales_rep: rep, email, customer: same.customer, key: k.key, active: true, note: note ?? same.note }
      : { sales_rep: rep, email, customer, key: k.key, active: true, note };
    const { error } = await sb.from("sales_assignment").upsert(rec, { onConflict: "sales_rep,customer,key" });
    if (error) throw new WriteError(writeErrorText(error));
    done();
    const what = `${label(rec)} (${scopeText(k.key)})`;
    return { ok: same ? `Penugasan sudah ada, diaktifkan dan catatannya diperbarui: ${what}.${tail}` : `Penugasan disimpan: ${what}.${tail}` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Deactivate (`active` = 0) or activate (1) an assignment by its id. RLS hides a row from a role that may not write it: no row back = refused. */
export async function toggleAssignmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await gate();
    const sb = await supabaseServer();
    const id = String(form.get("id") ?? "").trim();
    const on = String(form.get("active") ?? "") === "1";
    if (!id) throw new WriteError("Penugasan tidak dikenal");
    const { data, error } = await sb.from("sales_assignment").update({ active: on }).eq("id", id).select("id, sales_rep, key, customer");
    if (error) throw new WriteError(writeErrorText(error));
    const row = (data as { sales_rep: string; key: string | null; customer: string | null }[] | null)?.[0];
    if (!row) throw new WriteError(DENIED_OR_GONE);
    done();
    return { ok: `${on ? "Diaktifkan" : "Dinonaktifkan"}: ${label(row)}. ${on ? "Sales melihat SKU ini lagi pada muat ulang berikutnya." : "Sales tidak lagi melihat atau menulis SKU ini lewat penugasan ini."}` };
  } catch (e) { return { error: (e as Error).message }; }
}
