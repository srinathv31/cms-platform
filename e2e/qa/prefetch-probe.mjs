import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "ucomp_persona", value: "maya", url: "http://localhost:3100" }]);
const page = await ctx.newPage();
const reqs = [];
page.on("response", async (res) => {
  const u = new URL(res.url());
  if (!u.search.includes("_rsc")) return;
  const h = res.headers();
  reqs.push({ path: u.pathname, status: res.status(), router: res.request().headers()["next-router-prefetch"] ?? "", seg: res.request().headers()["next-router-segment-prefetch"] ?? "", stale: h["x-nextjs-stale-time"] ?? "", postponed: h["x-nextjs-postponed"] ?? "", ct: (h["content-type"]||"").slice(0,30), len: h["content-length"] ?? "" });
});
await page.goto("http://localhost:3100/coral-offers/library");
await page.waitForTimeout(3000);
console.log("total _rsc responses in 3s:", reqs.length);
const byKey = {};
for (const r of reqs) { const k = `${r.path} st=${r.status} pf=${r.router} seg=${r.seg} stale=${r.stale}`; byKey[k] = (byKey[k] ?? 0) + 1; }
console.log(Object.entries(byKey).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>`${v}x ${k}`).join("\n"));
await browser.close();
