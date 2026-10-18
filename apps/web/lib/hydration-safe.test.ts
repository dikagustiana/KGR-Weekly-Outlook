/**
 * Q-v5.2-100 (A8): a guard, not a fix. React error #418 (hydration failed) was seen once on /komersial (Kepala Sales) and never again.
 * Only code that RUNS ON THE CLIENT during hydration can make the server HTML differ from the client render: the "use client" components
 * and the modules they import (server components are not re-rendered in the browser). Nothing of that kind may read the clock or a
 * random number, or format a date or number with the local zone or locale; the known-safe formatters (`lib/fmt`: Intl.NumberFormat("id-ID"),
 * UTC date arithmetic) are the way. This test reads those files and fails when such a construct is added; docs/v5.2/a8.md §5 lists what was checked.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = resolve(__dirname, "..");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === ".next") return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const resolveImport = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? join(WEB, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((f) => existsSync(f) && statSync(f).isFile()) ?? null;
};
const isClient = (src: string) => /^\s*(\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);
const isServerOnly = (src: string) => /^\s*["']use server["']/.test(src) || /import\s+["']server-only["']/.test(src);

/** Every "use client" file of the app and the local modules it pulls into the browser bundle (server actions and server-only modules are references only). */
function clientBundle(): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f)) return;
    const src = readFileSync(f, "utf8");
    if (isServerOnly(src)) return;
    seen.add(f);
    for (const m of strip(src).matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
      const t = resolveImport(f, m[1] ?? m[2]);
      if (t) visit(t);
    }
  };
  for (const f of [...walk(join(WEB, "components")), ...walk(join(WEB, "app"))]) if (isClient(readFileSync(f, "utf8"))) visit(f);
  return [...seen].sort();
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bDate\.now\s*\(/, "Date.now()"],
  [/\bnew Date\s*\(\s*\)/, "new Date() (the clock)"],
  [/\bMath\.random\s*\(/, "Math.random()"],
  [/\bcrypto\.randomUUID\s*\(/, "crypto.randomUUID()"],
  [/\.toLocale(Date|Time)?String\s*\(/, "toLocale*String (the viewer's locale and zone)"],
  [/\bIntl\.DateTimeFormat\b/, "Intl.DateTimeFormat (give it a fixed zone in a server component instead)"],
  [/\bIntl\.(NumberFormat|PluralRules|Collator)\s*\(\s*(undefined|\))/, "Intl without an explicit locale"],
  [/\.(getHours|getMinutes|getDate|getDay|getMonth|getFullYear|getTimezoneOffset)\s*\(/, "local-zone Date getter (use the getUTC* ones)"],
];

/** Constructs that sit in an event handler, never in a render: the one exception to the rule, with its reason. */
const HANDLER_ONLY = new Set(["app/w/[week]/upload/UploadWizard.tsx: crypto.randomUUID()" /* the storage path of an upload, made in the click handler of "Cek" */]);

describe("client components render the same on the server and in the browser (Q-v5.2-100)", () => {
  const files = clientBundle();
  it("the scan reaches the client components of /komersial and the formatter they use", () => {
    const rel = files.map((f) => f.slice(WEB.length + 1));
    for (const must of ["components/ActionForm.tsx", "components/v5/CommitmentRows.tsx", "components/WeekSelect.tsx", "components/ViewToggle.tsx", "components/v4/CaraHitung.tsx", "lib/fmt.ts"]) expect(rel, must).toContain(must);
  });
  it("none of them reads the clock, a random number, or formats with the viewer's locale or zone", () => {
    const hits = files.flatMap((f) => {
      const code = strip(readFileSync(f, "utf8"));
      return FORBIDDEN.filter(([re]) => re.test(code)).map(([, what]) => `${f.slice(WEB.length + 1)}: ${what}`);
    }).filter((h) => !HANDLER_ONLY.has(h));
    expect(hits).toEqual([]);
  });
  it("the guard sees what it should: each pattern matches its example", () => {
    const examples = ["Date.now()", "new Date()", "Math.random()", "crypto.randomUUID()", "d.toLocaleString('id-ID')", "new Intl.DateTimeFormat('id-ID')", "new Intl.NumberFormat()", "d.getHours()"];
    expect(examples.map((e) => FORBIDDEN.some(([re]) => re.test(e)))).toEqual(examples.map(() => true));
    for (const ok of ["new Date(Date.UTC(y, m - 1, d)).getUTCDay()", 'new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })', "new Date(iso)"]) expect(FORBIDDEN.some(([re]) => re.test(ok)), ok).toBe(false);
  });
});
