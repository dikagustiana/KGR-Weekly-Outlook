"use strict";
// Journey helpers for tests/e2e (PRD v5.2-A R70-R72): Playwright actors per role, the fake clock, SETUP SQL, request
// logging with role and HTTP status, checks, expected-to-fail checks (xfail) and a result file per journey.
//
// Everything comes from the environment, so the same journey can run against another origin (PRD v5.2-B T19: a
// Supabase staging URL behind a Vercel preview) by setting E2E_BASE_URL, E2E_SUPA_URL (optional, only for the request
// log of the mock), E2E_ENV_LABEL, E2E_EMAIL_DOMAIN / E2E_EMAIL_<ROLE>, E2E_PASSWORD and E2E_CLOCK=real, and leaving
// E2E_PG_URL unset (SETUP steps then stop the journey instead of writing to a database it does not own).
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = process.env.E2E_ROOT || path.resolve(__dirname, "../../..");
const WORK = process.env.E2E_WORK || path.join(ROOT, "tests/e2e/.work");

function loadKeysEnv() {
  try {
    for (const l of fs.readFileSync(path.join(WORK, "keys.env"), "utf8").split("\n")) {
      const m = /^(\w+)=(.*)$/.exec(l);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* keys.env only exists after up.sh */ }
}
loadKeysEnv();

const cfg = {
  root: ROOT,
  base: (process.env.E2E_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, ""),
  supa: (process.env.E2E_SUPA_URL || "http://127.0.0.1:54321").replace(/\/$/, ""),
  anon: process.env.E2E_ANON_KEY || "",
  pgUrl: process.env.E2E_PG_URL || (process.env.E2E_PG_PORT ? `postgresql://postgres@127.0.0.1:${process.env.E2E_PG_PORT}/${process.env.E2E_DB || "e2e_kgr"}` : ""),
  out: process.env.E2E_OUT || path.join(ROOT, "tests/e2e/out"),
  password: process.env.E2E_PASSWORD || "e2e-test-password",
  domain: process.env.E2E_EMAIL_DOMAIN || "e2e.test",
  env: process.env.E2E_ENV_LABEL || "PG16 lokal + PostgREST 12 + mock auth",
  clockSh: process.env.E2E_CLOCK_SH || path.join(ROOT, "tests/e2e/stack/clock.sh"),
  realClock: process.env.E2E_CLOCK === "real",
  cronSecret: process.env.E2E_CRON_SECRET || "e2e-local-test-cron-secret",
  headed: process.env.E2E_HEADED === "1",
};

const ALIAS = {
  finance: "finance", commercial_lead: "lead", sales: "sales", ppic: "ppic", operations_director: "opsdir", cost_accounting: "costacc",
  inventory_accounting: "invacc", purchasing: "purchasing", management: "mgmt", admin: "admin",
};
const emailOf = (role) => process.env[`E2E_EMAIL_${role.toUpperCase()}`] || `${ALIAS[role]}@${cfg.domain}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let actSeq = 0; // Actor.act: marks the form of each clicked button (K93 in-form confirm)

function playwright() {
  for (const m of ["playwright", process.env.E2E_PLAYWRIGHT_MODULE].filter(Boolean)) {
    try { return require(m); } catch { /* try the next */ }
  }
  throw new Error("Paket 'playwright' tidak ditemukan: pnpm install (devDependency root), lalu npx playwright install --with-deps chromium");
}

const isAsset = (u) => /\/_next\/(static|image)\//.test(u) || /\/(favicon\.ico|icon\.svg|robots\.txt)$/.test(u);
const short = (s, n = 160) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

class Journey {
  constructor(name, title) {
    this.name = name;
    this.title = title;
    fs.mkdirSync(path.join(cfg.out, "screens"), { recursive: true });
    this.logFile = path.join(cfg.out, `${name}.log`);
    fs.writeFileSync(this.logFile, "");
    this.pass = 0;
    this.fail = [];
    this.xfail = [];
    this.xpass = [];
    this.setups = [];
    this.steps = [];
    this.http = [];
    this.unexpected = [];
    this.actors = new Map();
    this.cur = null;
    this.t0 = Date.now();
    this.browser = null;
    this.log(`# journey ${name} — ${title}`);
    this.log(`# lingkungan: ${cfg.env} · app ${cfg.base} · jam dinding mesin ${new Date().toISOString()}${cfg.realClock ? " · jam nyata (tanpa faketime)" : ""}`);
  }

  log(line = "") {
    process.stdout.write(line + "\n");
    fs.appendFileSync(this.logFile, line + "\n");
  }

  // ------------------------------------------------------------------------------------------------------ the clock
  /** Moves the fake clock of PostgreSQL and `next start` (clock.sh). */
  clock(iso) {
    if (cfg.realClock) { this.log(`JAM UJI: jam nyata (E2E_CLOCK=real), langkah "${iso}" dilewati`); return; }
    const r = cp.spawnSync("bash", [cfg.clockSh, "set", iso], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`clock.sh set ${iso}: ${r.stderr || r.stdout}`);
    this.log(`JAM UJI → ${r.stdout.trim()}`);
  }
  now() {
    if (cfg.realClock) return new Date().toISOString();
    const r = cp.spawnSync("bash", [cfg.clockSh, "now"], { encoding: "utf8" });
    return r.stdout.trim();
  }

  // ----------------------------------------------------------------------------------------------------- SQL (setup)
  _psql(sql, vars, extra) {
    if (!cfg.pgUrl) throw new Error("E2E_PG_URL tidak diisi: langkah SETUP butuh database lokal (journey ini tidak menulis ke database lain)");
    const args = [cfg.pgUrl, "-X", "-v", "ON_ERROR_STOP=1", ...Object.entries(vars || {}).flatMap(([k, v]) => ["-v", `${k}=${v}`]), ...extra, "-f", "-"];
    const r = cp.spawnSync("psql", args, { input: sql, encoding: "utf8", env: { ...process.env, LD_PRELOAD: "" } });
    if (r.status !== 0) throw new Error(`psql gagal: ${short(r.stderr, 600)}\n--- SQL ---\n${short(sql, 400)}`);
    return r.stdout;
  }
  /** SETUP: a direct write to the database as postgres. Labelled `setup` in the log: it is not the flow under test. */
  setup(label, sql, vars) {
    this._psql(sql, vars, ["-q"]);
    this.setups.push(label);
    this.log(`SETUP (postgres, langsung ke tabel; bukan alur) — ${label}`);
  }
  setupFile(label, file, vars) {
    this._psql(fs.readFileSync(file, "utf8"), vars, ["-q"]);
    this.setups.push(label);
    this.log(`SETUP (postgres, langsung ke tabel; bukan alur) — ${label} [${path.relative(cfg.root, file)}]`);
  }
  /** Read-only look at the database (evidence lines "DB: …"). Returns rows of columns. */
  db(sql, vars) {
    const out = this._psql(sql, vars, ["-A", "-t", "-F", "\t"]);
    return out.split("\n").filter((l) => l.length).map((l) => l.split("\t"));
  }
  dbOne(sql, vars) { const r = this.db(sql, vars); return r.length ? r[0][0] : null; }

  // --------------------------------------------------------------------------------------------------------- checks
  check(name, cond, detail = "") {
    if (cond) { this.pass++; this.log(`    CEK lulus: ${name}${detail ? ` — ${short(detail)}` : ""}`); }
    else { this.fail.push(`${this.cur ? this.cur.id + ": " : ""}${name}${detail ? ` — ${short(detail)}` : ""}`); this.log(`    CEK GAGAL: ${name}${detail ? ` — ${short(detail)}` : ""}`); }
    return !!cond;
  }
  /**
   * An expected-to-fail check: `waits` names the R (or B-R) whose code is still being finished on another branch.
   * It does not fail the job when it fails; when it passes (XPASS) the marker should be removed.
   */
  xcheck(name, waits, cond, detail = "") {
    if (cond) { this.xpass.push({ step: this.cur?.id, name, waits }); this.log(`    XPASS (menunggu ${waits} — sudah terpenuhi; hapus penanda xfail): ${name}${detail ? ` — ${short(detail)}` : ""}`); }
    else { this.xfail.push({ step: this.cur?.id, name, waits, detail: short(detail) }); this.log(`    XFAIL (diharapkan gagal sampai ${waits}): ${name}${detail ? ` — ${short(detail)}` : ""}`); }
    return !!cond;
  }

  // ------------------------------------------------------------------------------------------------ browser, actors
  async launch() {
    if (this.browser) return;
    this.browser = await playwright().chromium.launch({ headless: !cfg.headed });
  }
  async actor(role) {
    if (this.actors.has(role)) return this.actors.get(role);
    await this.launch();
    const ctx = await this.browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "id-ID", timezoneId: "Asia/Jakarta", acceptDownloads: true });
    // Next's link prefetches are not user actions; the pages they would fetch are opened (and judged) by the journey
    await ctx.route("**/*", (route) => (route.request().headers()["next-router-prefetch"] ? route.abort() : route.continue()));
    const page = await ctx.newPage();
    page.on("dialog", (d) => { this.log(`    ${role}  dialog "${short(d.message(), 80)}" → ok`); d.accept().catch(() => {}); });
    const a = new Actor(this, role, ctx, page);
    page.on("response", (r) => a._onResponse(r));
    page.on("pageerror", (e) => { this.log(`    ${role}  ERROR halaman: ${short(e.message, 200)}`); (this.cur ? this.cur.pageErrors : (this.pageErrors ||= [])).push(`${role}: ${short(e.message, 200)}`); });
    this.actors.set(role, a);
    return a;
  }

  // ------------------------------------------------------------------------------------------------------- steps
  /**
   * Runs one step of the journey. `allow` lists responses that are expected to be 4xx/5xx in this step:
   *   { status, path?: RegExp, area?: "app" | "rest" | "auth" | "storage", why: string }
   * Anything else with status ≥ 400 (app responses of the actor, and requests the app made to the Supabase origin)
   * fails the step.
   */
  async step(id, actor, title, fn, opts = {}) {
    const role = actor ? (typeof actor === "string" ? actor : actor.role) : "-";
    this.cur = { id, role, title, allow: opts.allow || [], http: [], pageErrors: [], seq0: await this._supaSeq() };
    this.log("");
    this.log(`${id} ${role} — ${title}   [jam uji ${this.now()}]`);
    await this._supaStep(`${this.name} ${id}`, role);
    let ok = true;
    try { await fn(); }
    catch (e) {
      ok = false;
      this.fail.push(`${id}: langkah terhenti — ${short(e.message, 300)}`);
      this.log(`    LANGKAH TERHENTI: ${short(e.stack || e.message, 700)}`);
      try { if (actor && actor.page) await actor.shot(`${this.name}-${id}-error`); } catch { /* best effort */ }
    }
    await this._judge();
    const c = this.cur;
    this.steps.push({ id, role, title, ok: ok && !c.bad, statuses: summarize(c.http) });
    this.cur = null;
    await this._supaStep("", "");
  }

  _record(e) { // an app response seen by an actor's page
    this.http.push(e);
    if (this.cur) this.cur.http.push(e);
  }

  async _supaSeq() {
    try { const r = await fetch(`${cfg.supa}/__e2e/seq`); return (await r.json()).seq; } catch { return null; }
  }
  async _supaStep(label, role) {
    try { await fetch(`${cfg.supa}/__e2e/step`, { method: "POST", body: JSON.stringify({ label, role }) }); } catch { /* no mock origin (staging) */ }
  }
  async _supaSlice(since) {
    if (since === null || since === undefined) return [];
    try { const r = await fetch(`${cfg.supa}/__e2e/log?since=${since}`); return await r.json(); } catch { return []; }
  }

  _allowed(allow, kind) {
    return allow.find((a) => (a.area || "app") === kind.area && a.status === kind.status && (!a.path || a.path.test(kind.path)));
  }

  async _judge() {
    const c = this.cur;
    const bad = [];
    for (const e of c.http) {
      if (e.status < 400) continue;
      const a = this._allowed(c.allow, { area: "app", status: e.status, path: e.path });
      if (a) this.log(`    diharapkan: ${e.role} ${e.method} ${e.path} → HTTP ${e.status} (${a.why})`);
      else bad.push(`app ${e.role} ${e.method} ${e.path} → HTTP ${e.status}`);
    }
    const slice = await this._supaSlice(c.seq0);
    const by = {};
    for (const e of slice) {
      const k = `${e.area} ${e.status}`;
      by[k] = (by[k] || 0) + 1;
      if (e.status < 400) continue;
      const a = this._allowed(c.allow, { area: e.area, status: e.status, path: `${e.method} ${e.path}` });
      const who = e.email || e.role || "tanpa token";
      if (a) this.log(`    diharapkan: ${e.area} (${who}) ${e.method} ${e.path} → HTTP ${e.status} (${a.why})`);
      else bad.push(`${e.area === "rest" ? "PostgREST" : e.area} (${who}) ${e.method} ${e.path}${e.query ? short(e.query, 80) : ""} → HTTP ${e.status}`);
    }
    if (slice.length) this.log(`    Supabase (mock origin) selama langkah: ${Object.entries(by).sort().map(([k, n]) => `${n}× ${k}`).join(", ")}`);
    for (const m of c.pageErrors) bad.push(`galat JS halaman: ${m}`);
    if (bad.length) {
      c.bad = true;
      for (const b of bad) { this.unexpected.push({ step: c.id, what: b }); this.fail.push(`${c.id}: respons tak terduga — ${b}`); this.log(`    TAK TERDUGA: ${b}`); }
    }
  }

  async shot(actor, name, opts = {}) { return actor.shot(name, opts); }

  // ------------------------------------------------------------------------------------------------------ the end
  async done() {
    for (const a of this.actors.values()) { try { await a.ctx.close(); } catch { /* closing */ } }
    if (this.browser) { try { await this.browser.close(); } catch { /* closing */ } }
    const total = this.http.length;
    const counts = {};
    for (const e of this.http) counts[e.status] = (counts[e.status] || 0) + 1;
    this.log("");
    this.log(`RINGKASAN ${this.name}: ${this.pass} cek lulus, ${this.fail.length} gagal, ${this.xfail.length} xfail (diharapkan), ${this.xpass.length} xpass; respons app ${total} (${Object.entries(counts).sort().map(([k, n]) => `${n}× ${k}`).join(", ") || "-"}); respons tak terduga ${this.unexpected.length}; SETUP ${this.setups.length}`);
    for (const f of this.fail) this.log(`  GAGAL: ${f}`);
    for (const x of this.xfail) this.log(`  XFAIL ${x.step}: ${x.name} — menunggu ${x.waits}`);
    for (const x of this.xpass) this.log(`  XPASS ${x.step}: ${x.name} — ${x.waits} sudah terpenuhi`);
    const result = {
      journey: this.name, title: this.title, environment: cfg.env, durationSec: Math.round((Date.now() - this.t0) / 1000), pass: this.pass, fail: this.fail,
      xfail: this.xfail, xpass: this.xpass, unexpected: this.unexpected, setups: this.setups, steps: this.steps, appResponses: total, statusCounts: counts,
    };
    fs.writeFileSync(path.join(cfg.out, `${this.name}.result.json`), JSON.stringify(result, null, 2));
    return this.fail.length === 0 ? 0 : 1;
  }
}

function summarize(list) {
  const c = {};
  for (const e of list) c[e.status] = (c[e.status] || 0) + 1;
  return c;
}

class Actor {
  constructor(J, role, ctx, page) {
    this.J = J; this.role = role; this.ctx = ctx; this.page = page; this.email = emailOf(role);
    this.loggedIn = false;
  }
  _onResponse(r) {
    const url = r.url();
    if (!url.startsWith(cfg.base) || isAsset(url)) return;
    const req = r.request();
    const u = new URL(url);
    const p = u.pathname + (u.search && !u.search.includes("_rsc=") ? u.search : "");
    const kind = req.headers()["next-action"] ? "server action" : req.resourceType() === "document" ? "" : req.resourceType();
    const e = { role: this.role, method: req.method(), path: p, status: r.status(), kind };
    this.J._record(e);
    // one line per document, server action or API call (not per script)
    if (req.resourceType() === "document" || req.headers()["next-action"] || u.pathname.startsWith("/api/") || r.status() >= 400)
      this.J.log(`    ${this.role.padEnd(10)} ${e.method} ${e.path}${kind ? ` (${kind})` : ""} → HTTP ${e.status}`);
  }

  async login() {
    const p = this.page;
    await p.goto(`${cfg.base}/login`, { waitUntil: "load" });
    await p.fill("#email", this.email);
    await p.fill("#password", cfg.password);
    await p.getByRole("button", { name: "Masuk", exact: true }).click();
    await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    this.loggedIn = true;
    return this;
  }
  /** Opens a path; returns the main document response status. */
  async goto(p, opts = {}) {
    const res = await this.page.goto(`${cfg.base}${p}`, { waitUntil: "load", timeout: 60_000 });
    try { await this.page.waitForLoadState("networkidle", { timeout: opts.idleMs || 8_000 }); } catch { /* streaming tiles may keep the network busy */ }
    return res ? res.status() : 0;
  }
  async text(sel = "main") {
    const loc = this.page.locator(sel).first();
    return (await loc.count()) ? (await loc.innerText()).replace(/[ \t]+/g, " ") : "";
  }
  /** Click a button by (part of) its label, then wait for the server action to answer; returns { ok, error }. */
  async act(label, opts = {}) {
    const p = this.page;
    const btn = (opts.within ? p.locator(opts.within) : p).getByRole("button", { name: label, exact: opts.exact === true });
    await btn.first().waitFor({ state: "visible", timeout: 15_000 });
    if (await btn.first().isDisabled()) throw new Error(`tombol "${label}" nonaktif`);
    const answered = p.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: opts.timeout || 90_000 });
    // K93: a form with a `confirm` text asks in the form itself ("Ya, lanjutkan" / "Batal") instead of window.confirm. The
    // clicked button is replaced by the question, so the form is marked first (button.form: also a `form=` attribute)
    const mark = `act-${++actSeq}`;
    await btn.first().evaluate((b, m) => b.form && b.form.setAttribute("data-e2e-act", m), mark);
    const yes = p.locator(`form[data-e2e-act="${mark}"]`).getByRole("button", { name: "Ya, lanjutkan", exact: true });
    await btn.first().click();
    const asked = await Promise.race([answered.then(() => false, () => false), yes.waitFor({ state: "visible", timeout: opts.timeout || 90_000 }).then(() => true, () => false)]);
    if (asked) {
      this.J.log(`    ${this.role}  konfirmasi di form → Ya, lanjutkan`);
      await yes.click();
    }
    await answered;
    await p.waitForFunction(() => !document.querySelector("button[disabled]") || [...document.querySelectorAll("button[disabled]")].every((b) => !/Memproses|Mem…/.test(b.textContent || "")), null, { timeout: opts.timeout || 90_000 }).catch(() => {});
    await sleep(opts.settleMs ?? 400);
    return this.message(opts.within);
  }
  /** The last action message on the page: { ok, error } (components ActionForm / UploadPanel). */
  async message(within) {
    const root = within ? this.page.locator(within) : this.page;
    const ok = await root.locator(".msg.ok").allInnerTexts();
    const err = await root.locator(".msg.err").allInnerTexts();
    return { ok: ok.length ? ok[ok.length - 1].trim() : null, error: err.length ? err[err.length - 1].trim() : null };
  }
  /**
   * The upload panel of the Input screen (Tempel → "Cek tempelan" → "Simpan N baris yang lolos"). `rows` = array of
   * arrays (first row = header). Returns the check lines, the summary and the message of the save.
   */
  async paste(panel, rows, opts = {}) {
    await this.goto(`/input?panel=${panel}`);
    const tsv = rows.map((r) => r.join("\t")).join("\n");
    const box = this.page.locator(`[data-upload="${panel}"] textarea`);
    await box.waitFor({ state: "visible", timeout: 20_000 });
    await box.fill(tsv);
    await this.page.locator(`[data-upload="${panel}"]`).getByRole("button", { name: "Cek tempelan" }).click();
    const panelLoc = this.page.locator(`[data-upload="${panel}"]`);
    await panelLoc.locator(".upl-checks").waitFor({ state: "visible", timeout: 20_000 });
    const checks = (await panelLoc.locator(".upl-checks li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    const summary = (await panelLoc.locator("p.note").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
    this.J.log(`    ${this.role}  cek ${panel}: ${checks.map((c) => short(c, 110)).join(" | ")}`);
    if (opts.reason) { const rs = panelLoc.locator('input[name="reason"]'); if (await rs.count()) await rs.fill(opts.reason); }
    if (opts.noSave) return { checks, summary, ok: null, error: null };
    const save = panelLoc.getByRole("button", { name: /^Simpan \d+ baris/ });
    const label = (await save.count()) ? (await save.first().innerText()).trim() : "";
    const m = /Simpan (\d+) baris/.exec(label);
    if (!m) return { checks, summary, ok: null, error: `tidak ada baris yang lolos (${short(summary.join(" "), 160)})`, saved: 0 };
    const msg = await this.act(/^Simpan \d+ baris/, { within: `[data-upload="${panel}"]` });
    this.J.log(`    ${this.role}  simpan ${panel}: ${msg.ok || msg.error || "(tanpa pesan)"}`);
    return { checks, summary, saved: Number(m[1]), ...msg };
  }
  async shot(name, opts = {}) {
    const file = path.join(cfg.out, "screens", `${name}.png`);
    await this.page.screenshot({ path: file, fullPage: opts.fullPage !== false });
    this.J.log(`    ${this.role}  tangkapan layar: screens/${name}.png`);
    return file;
  }
}

module.exports = { cfg, Journey, Actor, emailOf, sleep, short, ALIAS };
