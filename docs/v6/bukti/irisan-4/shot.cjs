const { chromium } = require("/home/user/KGR-Weekly-Outlook/node_modules/playwright");
const fs = require("fs");
const S = process.argv[2], file = process.argv[3];
(async () => {
  const b = await chromium.launch();
  const axe = fs.readFileSync(S + "/axe/node_modules/axe-core/axe.min.js", "utf8");
  for (const [w, h] of [[1366, 900], [1280, 900], [390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto("file://" + file);
    await p.screenshot({ path: `${S}/v6/shot-${w}.png`, fullPage: false });
    const m = await p.evaluate(() => {
      const first = [...document.querySelectorAll("[data-tile-value]")].find((e) => e.getBoundingClientRect().height > 0);
      const nav = document.querySelector("nav.v6-tabs");
      return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, navOverflow: nav ? nav.scrollWidth > nav.clientWidth : null, firstValueY: first ? Math.round(first.getBoundingClientRect().top) : null, h1: document.querySelectorAll("h1").length, headerH: Math.round(document.querySelector(".v6-top").getBoundingClientRect().height) };
    });
    // ScrollFocus (client effect) emulated on the static page
    await p.evaluate(() => { for (const el of document.querySelectorAll(".tile-b, .t6-wrap")) { if (el.scrollWidth > el.clientWidth + 1 && !el.querySelector("a[href], button, input, select, textarea, [tabindex]")) { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", "x"); } } });
    await p.addScriptTag({ content: axe });
    const r = await p.evaluate(async () => { const r = await axe.run(document, { resultTypes: ["violations"] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 2).map((x) => x.target.join(" ") + " :: " + (x.failureSummary || "").split("\n")[1]) })); });
    console.log(w, JSON.stringify(m));
    for (const v of r) console.log("  axe", v.impact, v.id, v.n, JSON.stringify(v.ex));
    await p.close();
  }
  await b.close();
})();
