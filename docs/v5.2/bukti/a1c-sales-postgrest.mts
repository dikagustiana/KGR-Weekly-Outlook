// PRD v5.2-A A1c, Q-v5.2-15 — bukti ke PostgREST sungguhan: jalur baca Sales memakai view, bukan plan_week/demand_weekly.
// Lingkungan: PostgreSQL 16 lokal + shim + semua migrasi + seed, PostgREST v12.2.3 (binari statis), JWT HS256 role `authenticated`
// dengan e-mail pengguna app_user. BUKAN Supabase. Dijalankan terhadap dua database: skema 5.2.4 (tanpa B6) dan 5.2.5 (dengan B6).
// Kode yang dijalankan adalah kode aplikasi: `loadSurplusForSales` (apps/web/lib/v5/surplus-view.ts) dan isi sisipan jawaban surplus
// persis seperti `answerSurplusAction` (apps/web/app/komersial/actions-v5.ts).
// Pakai: NODE_OPTIONS=--conditions=react-server PGRST_URL=http://127.0.0.1:3919 pnpm exec tsx docs/v5.2/bukti/a1c-sales-postgrest.mts
//   (--conditions=react-server: paket server-only kosong di luar Next, seperti di server component)
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";

const mod: any = await import("../../../apps/web/lib/v5/surplus-view.ts"); // CommonJS under tsx: the named export sits on default
const { loadSurplusForSales } = mod.loadSurplusForSales ? mod : mod.default;
const root = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const req = createRequire(path.join(root, "apps/web/package.json"));
const sup = createRequire(req.resolve("@supabase/supabase-js"));
const { PostgrestClient } = sup("@supabase/postgrest-js");
const URL_ = process.env.PGRST_URL ?? "http://127.0.0.1:3919";
const SECRET = process.env.PGRST_SECRET ?? "a1c-local-test-secret-0123456789abcdef0123456789";
const AFTER_B6 = (process.env.AFTER_B6 ?? "1") === "1";
const WS = "2033-08-01";
const PLAN = "11111111-1111-4111-8111-111111111111";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email: string) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role: "authenticated", email, sub: crypto.randomUUID(), aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const client = (email: string) => new PostgrestClient(URL_, { headers: { Authorization: `Bearer ${jwt(email)}` } });
const sales = client("sales@test.id"), sales2 = client("sales2@test.id"), lead = client("lead@test.id");
let fails = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "OK  " : "GAGAL"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fails++; };
const rows = async (c: typeof sales, table: string, filter?: (q: any) => any) => { const q = c.from(table).select("*"); const r = await (filter ? filter(q) : q); if (r.error) throw new Error(`${table}: ${r.error.message}`); return r.data as unknown[]; };

console.log(`PostgREST ${URL_}, skema ${AFTER_B6 ? "5.2.5 (dengan B6)" : "5.2.4 (tanpa B6)"}, minggu ${WS}`);

// 1) what Sales can read of the plan and the demand
const planRows = (await rows(sales, "plan_week")).length, demandRows = (await rows(sales, "demand_weekly")).length;
check(`Sales membaca plan_week: ${planRows} baris`, AFTER_B6 ? planRows === 0 : planRows === 1);
check(`Sales membaca demand_weekly: ${demandRows} baris`, AFTER_B6 ? demandRows === 0 : demandRows === 1);
const auditRows = (await rows(sales, "audit_log", (q) => q.in("table_name", ["plan_week", "plan_week_class", "demand_weekly", "demand_class_weekly"]))).length;
check(`Sales membaca jejak audit keempat tabel: ${auditRows} baris`, AFTER_B6 ? auditRows === 0 : auditRows > 0);
check("Sales tidak membaca plan_week_class dan demand_class_weekly (B2)", (await rows(sales, "plan_week_class")).length === 0 && (await rows(sales, "demand_class_weekly")).length === 0);
check("Kepala Sales tetap membaca plan_week dan demand_weekly", (await rows(lead, "plan_week")).length === 1 && (await rows(lead, "demand_weekly")).length === 1);

// 2) the code of A1c: the surplus of the assigned SKUs through the view (the plan lists "Karkas", the answer says "RPA|Karkas")
const s = await loadSurplusForSales(sales as never, WS);
console.log("loadSurplusForSales(Sales A) =", JSON.stringify(s));
check("loadSurplusForSales: rencana versi 1 dari view", s !== null && s.planWeekId === PLAN && s.version === 1);
const karkas = s?.rows.find((r) => r.key === "RPA|Karkas");
if (AFTER_B6) check("RPA|Karkas: surplus 6.332 kg dan jawaban 'absorb' dalam satu baris (kunci unit dinamai SKU)", s?.rows.length === 1 && Number(karkas?.kg) === 6332 && karkas?.response === "absorb");
else check("sebelum B6 view hanya memberi baris jawaban (kg surplus kosong): kode membaca sama, daftar surplus bagi Sales kosong sampai B6", s?.rows.length === 1 && karkas?.kg === null && karkas.response === "absorb");
const s2 = await loadSurplusForSales(sales2 as never, WS);
check("Sales B (assignment RPA|Kepala|Fresh): satu baris, 55 kg, belum dijawab", s2?.rows.length === 1 && s2.rows[0].key === "RPA|Kepala|Fresh" && Number(s2.rows[0].kg) === 55 && s2.rows[0].response === null);
check("minggu tanpa rencana: null", (await loadSurplusForSales(sales as never, "2033-08-08")) === null);

// 3) the answer: the insert of answerSurplusAction, for the plan version the view gave
const answer = { plan_week_id: s!.planWeekId, key: "RPA|Karkas", surplus_kg: "6332.00", response: "partial", absorb_kg: "3000", price: "28500", note: null };
let r = await sales.from("surplus_response").insert(answer).select("id, key, responded_by");
check("Sales A menjawab SKU yang ditugaskan (FK ke plan_week diperiksa pemilik tabel)", !r.error && r.data.length === 1 && r.data[0].responded_by === "sales@test.id", r.error?.message);
r = await sales.from("surplus_response").insert({ ...answer, key: "RPA|Kepala|Fresh", surplus_kg: "55.00" }).select("id");
check("Sales A menjawab SKU Sales B: ditolak (42501)", !!r.error && r.error.code === "42501", r.error?.message);
if (AFTER_B6) {
  const again = await loadSurplusForSales(sales as never, WS);
  check("sesudah jawaban kedua kunci tetap satu baris", again?.rows.length === 1 && Number(again.rows[0].kg) === 6332);
}
console.log(fails ? `${fails} GAGAL` : "SEMUA OK");
process.exit(fails ? 1 : 0);
