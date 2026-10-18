// PRD v5.2-A R55 — bukti ke PostgREST sungguhan: `upsert(rows, { onConflict: "id", defaultToNull: false })` untuk komitmen.
// Lingkungan: PostgreSQL 16 lokal + shim + SEMUA migrasi + seed (termasuk B2), PostgREST v12.2.3 (binari statis), JWT HS256
// dengan role `authenticated` dan e-mail pengguna app_user. BUKAN Supabase. Bukan bagian dari `pnpm test`.
// Pakai: node docs/v5.2/bukti/a2-r55-postgrest.mjs   (env: PGRST_URL, PGRST_SECRET, WEEK = Senin yang belum pernah dipakai)
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const req = createRequire(path.join(root, "apps/web/package.json"));
const sup = createRequire(req.resolve("@supabase/supabase-js"));
const { PostgrestClient } = sup("@supabase/postgrest-js");
const URL_ = process.env.PGRST_URL ?? "http://127.0.0.1:3917";
const SECRET = process.env.PGRST_SECRET ?? "a2-local-test-secret-0123456789abcdef0123456789";
const WEEK = process.env.WEEK ?? "2027-01-04";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role: "authenticated", email, sub: crypto.randomUUID(), aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const client = (email) => new PostgrestClient(URL_, { headers: { Authorization: `Bearer ${jwt(email)}` } });
const lead = client("lead@test.id"), sales = client("sales@test.id");
const opt = { onConflict: "id", defaultToNull: false };
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "GAGAL"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fails++; };
const state = async () => (await lead.from("sales_commitment").select("key, version, status, fresh_kg").eq("week_start", WEEK).is("deleted_at", null).order("key").order("version")).data.map((x) => `${x.key}:v${x.version}:${x.status}:${Number(x.fresh_kg)}`);
console.log(`PostgREST ${URL_}, minggu ${WEEK}`);

let r = await lead.from("sales_commitment").insert(["A", "B", "C", "D", "E"].map((k) => ({ week_start: WEEK, key: `RPA|${k}`, fresh_kg: "100", frozen_kg: "0", price: "30000" }))).select("id, key, version, status");
check("5 draft dalam satu insert", !r.error && r.data.length === 5, r.error?.message);
r = await lead.rpc("lock_commitments", { p_week_start: WEEK, p_price_frozen: {} });
check("lock_commitments mengunci 5", !r.error && r.data === 5, r.error?.message);
const before = await state();

// 1) lead mengubah 1 dari 5 SKU terkunci → tepat 1 versi baru
r = await lead.from("sales_commitment").upsert([{ week_start: WEEK, key: "RPA|C", fresh_kg: "250", frozen_kg: "0", price: "31000", reason: "naik permintaan" }], opt).select("id, key, version, status");
check("1 dari 5 berubah → tepat 1 versi baru (draft v2)", !r.error && r.data.length === 1 && r.data[0].version === 2 && r.data[0].status === "draft", r.error?.message);
const draftC = r.data?.[0];
check("4 SKU lain tidak menerima versi baru", (await state()).length === before.length + 1);

// 2) satu request: draft yang ada diupdate dengan id-nya + versi baru D di-insert tanpa id
r = await lead.from("sales_commitment").upsert([
  { id: draftC.id, week_start: WEEK, key: "RPA|C", fresh_kg: "260", frozen_kg: "0", price: "31000", reason: "naik permintaan" },
  { week_start: WEEK, key: "RPA|D", fresh_kg: "120", frozen_kg: "0", price: "30000", reason: "tambah D" },
], opt).select("id, key, version, status, fresh_kg");
check("campuran (update by id + insert) dalam SATU request", !r.error && r.data.length === 2, r.error?.message);
check("draft C diupdate di tempat (id sama, versi tetap 2, fresh 260)", r.data?.[0].id === draftC.id && r.data[0].version === 2 && Number(r.data[0].fresh_kg) === 260);
check("D mendapat versi baru 2", r.data?.[1].key === "RPA|D" && r.data[1].version === 2);

// 3) atomik: baris kedua tanpa alasan → seluruh request gagal, baris pertama tidak tersimpan
const mid = await state();
r = await lead.from("sales_commitment").upsert([
  { week_start: WEEK, key: "RPA|A", fresh_kg: "500", frozen_kg: "0", price: "30000", reason: "alasan cukup panjang" },
  { week_start: WEEK, key: "RPA|B", fresh_kg: "500", frozen_kg: "0", price: "30000" },
], opt).select("id");
check("satu baris melanggar guard → seluruh request ditolak (23514)", r.error?.code === "23514", r.error?.message);
check("tidak ada tulisan parsial (A tidak mendapat versi baru)", JSON.stringify(await state()) === JSON.stringify(mid));

// 4) update draft tanpa alasan ditolak guard INSERT → aksi mengirim ulang reason draft
r = await lead.from("sales_commitment").upsert([{ id: draftC.id, week_start: WEEK, key: "RPA|C", fresh_kg: "270", frozen_kg: "0", price: "31000" }], opt).select("id");
check("update draft tanpa reason ditolak (guard INSERT berlaku di jalur upsert)", r.error?.code === "23514", r.error?.message);
r = await lead.from("sales_commitment").upsert([{ id: draftC.id, week_start: WEEK, key: "RPA|C", fresh_kg: "270", frozen_kg: "0", price: "31000", reason: "naik permintaan" }], opt).select("id, fresh_kg");
check("update draft dengan reason lama diterima", !r.error && Number(r.data[0].fresh_kg) === 270, r.error?.message);

// 5) Sales: key ter-assign diterima; satu key tak ter-assign menggagalkan seluruh request
r = await sales.from("sales_commitment").upsert([{ week_start: WEEK, key: "RPA|Karkas", fresh_kg: "10", frozen_kg: "0", price: "30000" }], opt).select("id, key");
check("Sales: key ter-assign (RPA|Karkas) diterima", !r.error && r.data.length === 1, r.error?.message);
const sk = r.data?.[0];
r = await sales.from("sales_commitment").upsert([{ id: sk.id, week_start: WEEK, key: "RPA|Karkas", fresh_kg: "20", frozen_kg: "0", price: "30000" }, { week_start: WEEK, key: "RPA|Z", fresh_kg: "5", frozen_kg: "0", price: "30000" }], opt).select("id");
check("Sales: key tak ter-assign menggagalkan seluruh request (42501)", r.error?.code === "42501", r.error?.message);
r = await lead.from("sales_commitment").select("fresh_kg").eq("id", sk.id).single();
check("Sales: draft RPA|Karkas tetap 10 (tidak ikut berubah)", Number(r.data.fresh_kg) === 10);

console.log("STATE", (await state()).join(" | "));
console.log(fails ? `${fails} GAGAL` : "SEMUA OK");
process.exit(fails ? 1 : 0);
