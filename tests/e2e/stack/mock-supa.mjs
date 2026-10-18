#!/usr/bin/env node
// One origin acting as the Supabase project URL for the local e2e stack (PRD v5.2-A R70). NOT Supabase:
//   /rest/v1/*     → PostgREST 12 (same path, JWT passed through; PostgREST verifies it with the shared TEST secret)
//   /auth/v1/*     → minimal GoTrue: password grant, refresh, user, logout (HS256 JWT, role authenticated, email, sub = auth.users.id)
//   /storage/v1/*  → minimal object store for the `uploads` and `releases` buckets (files under $E2E_WORK/storage)
//   /__e2e/*       → harness endpoints: health, step label, request log slice
// Every request is logged (JSONL, $E2E_OUT/stack/mock-requests.jsonl) with the journey step, the e-mail and role in the
// token and the HTTP status; journeys read the log slice of a step to find unexpected 4xx/5xx.
// Env: E2E_SUPA_PORT, E2E_PGRST_URL, E2E_PG_URL (password check via psql), E2E_JWT_SECRET, E2E_WORK, E2E_OUT,
//      E2E_CLOCK_FILE (the fake clock, only for the log line).
import http from "node:http";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { sign, verify, peek } from "./keys.mjs";

const PORT = Number(process.env.E2E_SUPA_PORT || 54321);
const PGRST = new URL(process.env.E2E_PGRST_URL || "http://127.0.0.1:54330");
const PG_URL = process.env.E2E_PG_URL;
const WORK = process.env.E2E_WORK || ".work";
const OUT = process.env.E2E_OUT || "out";
const CLOCK_FILE = process.env.E2E_CLOCK_FILE || join(WORK, "faketime.offset");
const STORE = join(WORK, "storage");
const LOG_FILE = join(OUT, "stack", "mock-requests.jsonl");
const TOKEN_LIFETIME_S = 7 * 86400; // real clock; the app's fake clock is earlier or later, so be lenient

mkdirSync(dirname(LOG_FILE), { recursive: true });
mkdirSync(STORE, { recursive: true });
writeFileSync(LOG_FILE, "");

let step = { label: "", role: "" };
const log = [];

const fakeNowIso = () => {
  try {
    const off = Number(readFileSync(CLOCK_FILE, "utf8").trim().replace("+", "")) || 0;
    return new Date(Date.now() + off * 1000 + 7 * 3600e3).toISOString().slice(0, 19).replace("T", " ") + " WIB";
  } catch {
    return "";
  }
};

function record(e) {
  e.seq = log.length + 1;
  log.push(e);
  appendFileSync(LOG_FILE, JSON.stringify(e) + "\n");
}

function claimsOf(req) {
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || "");
  const t = m ? m[1] : req.headers.apikey;
  const c = t ? peek(t) : null;
  return { token: t || null, claims: c, email: c?.email || null, role: c?.role || null };
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "authorization,apikey,content-type,x-client-info,x-upsert,cache-control,prefer,range,accept-profile,content-profile,x-supabase-api-version");
  res.setHeader("Access-Control-Expose-Headers", "content-range,content-length,content-type");
  res.setHeader("Access-Control-Max-Age", "600");
}

const json = (res, status, body, headers = {}) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s), ...headers });
  res.end(s);
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

// -------------------------------------------------------------------------------------------------------------- auth
/** psql with variables (never string-built SQL): the password check against the bcrypt hash set by set_login_password. */
function psqlRow(sql, vars) {
  return new Promise((resolve, reject) => {
    const args = [PG_URL, "-X", "-A", "-t", "-F", "|", ...Object.entries(vars).flatMap(([k, v]) => ["-v", `${k}=${v}`]), "-f", "-"];
    const p = spawn("psql", args, { env: { ...process.env, LD_PRELOAD: "" } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exit ${code}`))));
    p.stdin.end(sql);
  });
}

async function userByPassword(email, password) {
  const row = await psqlRow(
    "select id || '|' || email || '|' || coalesce(created_at::text,'') from auth.users where lower(email) = lower(:'email') and email_confirmed_at is not null and encrypted_password = extensions.crypt(:'pw', encrypted_password) limit 1;",
    { email, pw: password },
  );
  if (!row) return null;
  const [id, em, created] = row.split("|");
  return { id, email: em, created_at: created };
}

async function userById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await psqlRow("select id || '|' || email || '|' || coalesce(created_at::text,'') from auth.users where id = :'id'::uuid limit 1;", { id });
  if (!row) return null;
  const [uid, em, created] = row.split("|");
  return { id: uid, email: em, created_at: created };
}

const userJson = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at || null, phone: "",
  confirmed_at: u.created_at || null, last_sign_in_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {}, identities: [], created_at: u.created_at || null, updated_at: new Date().toISOString(), is_anonymous: false,
});

function session(u) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_LIFETIME_S;
  const access = sign({
    aud: "authenticated", exp, iat, iss: "kgr-e2e-mock/auth/v1", sub: u.id, email: u.email, phone: "",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, role: "authenticated", aal: "aal1",
    amr: [{ method: "password", timestamp: iat }], session_id: randomUUID(), is_anonymous: false,
  });
  const refresh = sign({ typ: "refresh", sub: u.id, email: u.email, iat, exp: iat + 30 * 86400, jti: randomUUID() });
  return { access_token: access, token_type: "bearer", expires_in: TOKEN_LIFETIME_S, expires_at: exp, refresh_token: refresh, user: userJson(u) };
}

const authError = (res, status, code, msg) => json(res, status, { code: status, error_code: code, msg });

async function auth(req, res, url, sub) {
  if (sub === "token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString("utf8") || "{}"); } catch { return authError(res, 400, "bad_json", "Body bukan JSON"); }
    if (grant === "password") {
      const email = String(body.email || "").trim(), pw = String(body.password || "");
      if (!email || !pw) return authError(res, 400, "validation_failed", "Isi e-mail dan kata sandi");
      const u = await userByPassword(email, pw);
      if (!u) return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      return json(res, 200, session(u));
    }
    if (grant === "refresh_token") {
      const c = verify(String(body.refresh_token || ""));
      if (!c || c.typ !== "refresh") return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      const u = await userById(c.sub);
      if (!u) return authError(res, 400, "user_not_found", "User tidak ada");
      return json(res, 200, session(u));
    }
    return authError(res, 400, "unsupported_grant_type", `grant_type tidak didukung: ${grant}`);
  }
  if (sub === "user" && req.method === "GET") {
    const { token } = claimsOf(req);
    const c = token ? verify(token) : null;
    if (!c || c.role !== "authenticated" || !c.sub) return authError(res, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature, token is malformed or expired");
    const u = await userById(c.sub);
    if (!u) return authError(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
    return json(res, 200, userJson(u));
  }
  if (sub === "logout" && req.method === "POST") { res.writeHead(204); return res.end(); }
  if (sub === "settings") return json(res, 200, { external: { email: true, google: false }, disable_signup: true, mailer_autoconfirm: false });
  if (sub === "signup" || sub === "authorize" || sub === "otp" || sub === "recover") return authError(res, 422, "signup_disabled", "Pendaftaran mandiri tidak tersedia di mock e2e");
  return authError(res, 404, "not_found", `endpoint auth tidak ada: ${sub}`);
}

// ----------------------------------------------------------------------------------------------------------- storage
const safePath = (bucket, name) => {
  if (!/^[a-z0-9_-]+$/i.test(bucket)) return null;
  const rel = normalize(decodeURIComponent(name)).replace(/^([/\\])+/, "");
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) return null;
  return join(STORE, bucket, rel);
};
const storageError = (res, status, message) => json(res, status, { statusCode: String(status), error: status === 404 ? "not_found" : "error", message });

async function storage(req, res, url, rest) {
  const { token, claims } = claimsOf(req);
  const c = token ? verify(token) : null;
  const m = /^object\/(?:(sign|authenticated|list)\/)?([^/]+)(?:\/(.*))?$/.exec(rest);
  if (!m) return storageError(res, 404, `endpoint storage tidak ada: ${rest}`);
  const [, mode, bucket, name] = m;
  if (mode === "sign" && req.method === "GET") { // the signed URL: token in the query; no JWT needed
    const p = name ? safePath(bucket, name) : null;
    if (!p || !existsSync(p)) return storageError(res, 404, "Object not found");
    const buf = readFileSync(p);
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": buf.length });
    return res.end(buf);
  }
  if (!c || !["authenticated", "service_role"].includes(c.role)) return storageError(res, 403, "new row violates row-level security policy (mock: butuh JWT authenticated)");
  void claims;
  if (mode === "list" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const dir = safePath(bucket, body.prefix || "") || join(STORE, bucket);
    const names = existsSync(dir) ? readdirSync(dir) : [];
    return json(res, 200, names.map((n) => ({ name: n, id: n, updated_at: statSync(join(dir, n)).mtime.toISOString(), metadata: { size: statSync(join(dir, n)).size } })));
  }
  if (mode === "sign" && req.method === "POST") {
    const p = name ? safePath(bucket, name) : null;
    if (!p || !existsSync(p)) return storageError(res, 404, "Object not found");
    return json(res, 200, { signedURL: `/object/sign/${bucket}/${name}?token=${randomUUID()}` });
  }
  if (!mode && (req.method === "POST" || req.method === "PUT") && name) {
    const p = safePath(bucket, name);
    if (!p) return storageError(res, 400, "Invalid path");
    const upsert = req.headers["x-upsert"] === "true";
    if (existsSync(p) && !upsert) return json(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const raw = await readBody(req);
    let data = raw;
    const ct = req.headers["content-type"] || "";
    if (ct.startsWith("multipart/form-data")) { // supabase-js sends a File/Blob as FormData ('' = the file part)
      const form = await new Response(raw, { headers: { "content-type": ct } }).formData();
      const file = [...form.entries()].map(([, v]) => v).find((v) => typeof v === "object" && typeof v.arrayBuffer === "function");
      if (!file) return storageError(res, 400, "Tidak ada bagian file di multipart");
      data = Buffer.from(await file.arrayBuffer());
    }
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    return json(res, 200, { Id: randomUUID(), Key: `${bucket}/${name}` });
  }
  if (req.method === "GET" && name) {
    const p = safePath(bucket, name);
    if (!p || !existsSync(p)) return storageError(res, 404, "Object not found");
    const buf = readFileSync(p);
    const t = name.endsWith(".json") ? "application/json" : name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": t, "Content-Length": buf.length });
    return res.end(buf);
  }
  if (req.method === "DELETE" && !name) {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const gone = [];
    for (const n of body.prefixes || []) { const p = safePath(bucket, n); if (p && existsSync(p)) { rmSync(p); gone.push({ name: n }); } }
    return json(res, 200, gone);
  }
  return storageError(res, 404, `operasi storage tidak didukung: ${req.method} ${rest}`);
}

// ------------------------------------------------------------------------------------------------------------- rest
const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
function rest(req, res, url, rest_) {
  const { token } = claimsOf(req);
  const headers = { ...req.headers };
  delete headers.host; delete headers.connection; delete headers.origin; delete headers.referer;
  if (!headers.authorization && token) headers.authorization = `Bearer ${token}`;
  const p = http.request({
    host: PGRST.hostname, port: PGRST.port, method: req.method, path: `/${rest_}${url.search}`, headers, agent,
  }, (r) => {
    cors(req, res);
    const h = { ...r.headers };
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  p.on("error", (e) => { if (!res.headersSent) json(res, 502, { message: `PostgREST tidak terjangkau: ${e.message}` }); else res.end(); });
  req.pipe(p);
}

// ---------------------------------------------------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { email, role } = claimsOf(req);
  res.on("close", () => {
    const area = url.pathname.startsWith("/rest/") ? "rest" : url.pathname.startsWith("/auth/") ? "auth" : url.pathname.startsWith("/storage/") ? "storage" : "e2e";
    if (url.pathname.startsWith("/__e2e/")) return;
    record({
      t: new Date().toISOString(), fake: fakeNowIso(), step: step.label, stepRole: step.role, area, email, role,
      method: req.method, path: url.pathname.replace(/^\/(rest|auth|storage)\/v1\//, ""), query: url.search.slice(0, 300), status: res.statusCode, ms: Date.now() - t0,
    });
  });
  try {
    if (req.method === "OPTIONS") { cors(req, res); res.writeHead(204); return res.end(); }
    if (url.pathname === "/__e2e/health") return json(res, 200, { ok: true, env: "PG16 lokal + PostgREST 12 + mock auth" });
    if (url.pathname === "/__e2e/step" && req.method === "POST") {
      const b = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      step = { label: String(b.label || ""), role: String(b.role || "") };
      return json(res, 200, { ok: true, seq: log.length });
    }
    if (url.pathname === "/__e2e/seq") return json(res, 200, { seq: log.length });
    if (url.pathname === "/__e2e/log") {
      const since = Number(url.searchParams.get("since") || 0);
      return json(res, 200, log.slice(since));
    }
    cors(req, res);
    if (url.pathname.startsWith("/rest/v1/")) return rest(req, res, url, url.pathname.slice("/rest/v1/".length));
    if (url.pathname.startsWith("/auth/v1/")) return await auth(req, res, url, url.pathname.slice("/auth/v1/".length));
    if (url.pathname.startsWith("/storage/v1/")) return await storage(req, res, url, url.pathname.slice("/storage/v1/".length));
    return json(res, 404, { message: `mock Supabase: tidak ada ${url.pathname}` });
  } catch (e) {
    console.error(`[mock] ${req.method} ${url.pathname}: ${e.stack || e}`);
    if (!res.headersSent) json(res, 500, { message: `mock error: ${e.message}` });
    else res.end();
  }
});
server.keepAliveTimeout = 30_000;
server.listen(PORT, "127.0.0.1", () => console.log(`[mock] Supabase mock di http://127.0.0.1:${PORT} (rest → ${PGRST.origin}; auth; storage ${STORE})`));
