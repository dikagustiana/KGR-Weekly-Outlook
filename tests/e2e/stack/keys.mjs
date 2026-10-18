#!/usr/bin/env node
// HS256 JWTs for the local e2e stack (PRD v5.2-A R70). The secret is a fixed TEST value from E2E_JWT_SECRET (env.sh);
// it signs nothing outside the throwaway local database.
//   node keys.mjs anon | service_role      print the API key for that role
//   node keys.mjs env                      shell assignments E2E_ANON_KEY=… / E2E_SERVICE_KEY=… (up.sh → $E2E_WORK/keys.env)
//   import { sign, verify } from "./keys.mjs"
import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function secret() {
  const s = process.env.E2E_JWT_SECRET;
  if (!s || s.length < 32) throw new Error("E2E_JWT_SECRET kosong atau < 32 karakter (source tests/e2e/stack/env.sh)");
  return s;
}

export function sign(payload, key = secret()) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", key).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** The claims of a valid, unexpired token signed with the secret; null otherwise. */
export function verify(token, key = secret()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const want = createHmac("sha256", key).update(`${parts[0]}.${parts[1]}`).digest();
  const got = fromB64url(parts[2]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let claims;
  try {
    claims = JSON.parse(fromB64url(parts[1]).toString("utf8"));
  } catch {
    return null;
  }
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

/** Claims without checking the signature (for log lines only). */
export function peek(token) {
  try {
    return JSON.parse(fromB64url(String(token).split(".")[1]).toString("utf8"));
  } catch {
    return null;
  }
}

/** API keys: fixed claims (iat 2025-01-01, exp 2100-01-01), so the same secret always gives the same key and a `next build` stays valid. */
export function apiKey(role) {
  if (!["anon", "service_role"].includes(role)) throw new Error(`role kunci tidak dikenal: ${role}`);
  return sign({ iss: "kgr-e2e-mock", role, iat: 1735689600, exp: 4102444800 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === "env") process.stdout.write(`E2E_ANON_KEY=${apiKey("anon")}\nE2E_SERVICE_KEY=${apiKey("service_role")}\n`);
  else process.stdout.write(apiKey(arg));
}
