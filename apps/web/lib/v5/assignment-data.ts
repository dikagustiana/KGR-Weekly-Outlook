import "server-only";
/**
 * Reads of the A7 screen (K41: a failed read throws, it is never "no rows"): the assignments, the SKU keys of the master and
 * the Sales users to pick from.
 *
 * `app_user` is readable by its own row and by Admin only (policy app_user_select), so Kepala Sales cannot list the Sales
 * users with the session client. The list is read with the service client instead — server side, after the role check of the
 * page or action, only the e-mail and name of the active users with role `sales`. Without SUPABASE_SERVICE_ROLE_KEY only
 * Admin can pick a user (Q-v5.2-120).
 */
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { fetchAll } from "../data";
import { LoaderError } from "../loader";
import { can } from "../roles";
import type { AssignmentRow, SalesUser } from "./assignment";

type Row = Record<string, unknown>;

const COLUMNS = "id, sales_rep, email, customer, key, active, note, created_at, updated_at, updated_by";

export async function loadAssignments(sb: Supa): Promise<AssignmentRow[]> {
  const rows = await fetchAll<Row>((a, b) => sb.from("sales_assignment").select(COLUMNS).order("id").range(a, b));
  return rows.map((r) => ({
    id: String(r.id), sales_rep: String(r.sales_rep), email: r.email === null || r.email === undefined ? null : String(r.email),
    customer: r.customer === null || r.customer === undefined ? null : String(r.customer), key: r.key === null || r.key === undefined ? null : String(r.key),
    active: r.active === true, note: r.note === null || r.note === undefined ? null : String(r.note),
    created_at: r.created_at === null || r.created_at === undefined ? null : String(r.created_at),
    updated_at: r.updated_at === null || r.updated_at === undefined ? null : String(r.updated_at),
    updated_by: r.updated_by === null || r.updated_by === undefined ? null : String(r.updated_by),
  }));
}

/** The active SKU keys of the master: what an assignment may name (with the base key of each, `knownKeys`). */
export async function loadSkuKeys(sb: Supa): Promise<string[]> {
  const rows = await fetchAll<Row>((a, b) => sb.from("sku_key").select("key").eq("active", true).order("key").range(a, b));
  return rows.map((r) => String(r.key));
}

/** The active users with role `sales`: Admin with the session client, Kepala Sales with the service client (see above). */
export async function loadSalesUsers(sb: Supa, viewer: Pick<Viewer, "role">, service: Supa | null): Promise<SalesUser[]> {
  // the service client bypasses RLS: only the roles of the area read the list with it, whoever calls this
  if (!can(viewer.role, "sales_assignment")) throw new LoaderError("penugasan.app_user", "hanya Admin dan Kepala Sales membaca daftar Sales");
  const client = viewer.role === "admin" ? sb : service;
  if (!client) throw new LoaderError("penugasan.app_user", "daftar Sales hanya bisa dibaca Admin: server belum punya SUPABASE_SERVICE_ROLE_KEY untuk Kepala Sales");
  const rows = await fetchAll<Row>((a, b) => client.from("app_user").select("email, full_name").eq("role", "sales").eq("active", true).order("email").range(a, b));
  return rows.map((r) => ({ email: String(r.email).toLowerCase(), name: r.full_name === null || r.full_name === undefined || r.full_name === "" ? null : String(r.full_name) }));
}
