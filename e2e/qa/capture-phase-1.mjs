// Phase 1 visual QA: screenshots of the key screens at 1440x900 and 1280x800.
// Usage: node e2e/qa/capture-phase-1.mjs   (server on :3100 after `npm run db:reset`)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "e2e/__screens__/phase-1/qa";
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
];

const browser = await chromium.launch();

async function open(size, persona, path) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "ucomp_persona", value: persona, url: BASE }]);
  // Keep the library calm: answer template-link prefetches with an empty 204 (see e2e/phase-1.spec.ts).
  await ctx.route(/\/templates\/UC-[A-Z0-9]+\?_rsc=/, (r) =>
    r.request().headers()["next-router-prefetch"] === "1" ? r.fulfill({ status: 204 }) : r.continue(),
  );
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(BASE + path);
  await page.waitForFunction(() => {
    const el = document.querySelector("button[aria-label$='profile and persona']");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, problems };
}

async function liveEditor(page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ProseMirror")].some((el) => el.offsetParent !== null && "pmViewDesc" in el),
  );
}

const SCREENS = [
  { name: "maya-library", persona: "maya", path: "/coral-offers/library", ready: (p) => p.getByRole("link", { name: /Annual Fee Waiver/ }).waitFor() },
  { name: "alex-library-recert", persona: "alex", path: "/coral-offers/library", ready: (p) => p.locator("[data-slot='sidebar-card']").waitFor() },
  {
    name: "alex-settings-members",
    persona: "alex",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("link", { name: "Settings" }).click();
      await p.getByRole("dialog").waitFor();
    },
  },
  { name: "riley-all-library", persona: "riley", path: "/all/library", ready: (p) => p.getByRole("link", { name: /Statement Insert — Rate Change/ }).waitFor() },
  { name: "morgan-request-access", persona: "morgan", path: "/request-access", ready: (p) => p.getByRole("heading", { name: "Request access" }).waitFor() },
  {
    name: "maya-workspace-balance-transfer",
    persona: "maya",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("link", { name: /^Balance Transfer/ }).click();
      await p.locator("[data-slot='share-ring']").waitFor();
      await liveEditor(p);
    },
  },
  {
    name: "maya-workspace-annual-fee-waiver",
    persona: "maya",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("link", { name: /^Annual Fee Waiver/ }).click();
      await liveEditor(p);
    },
  },
  {
    name: "sam-workspace-view-only",
    persona: "sam",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("link", { name: /^Balance Transfer/ }).click();
      await p.getByText("View only", { exact: true }).waitFor();
      await liveEditor(p);
    },
  },
  {
    name: "integration-sheet",
    persona: "maya",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("link", { name: /^Balance Transfer/ }).click();
      await p.locator("[data-slot='share-ring']").click();
      await p.getByRole("dialog").waitFor();
    },
  },
  {
    name: "profile-menu-persona-switcher",
    persona: "maya",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("button", { name: /profile and persona/ }).click();
      await p.getByRole("menuitemradio").first().waitFor();
    },
  },
  {
    name: "team-switcher",
    persona: "riley",
    path: "/all/library",
    run: async (p) => {
      await p.getByRole("button", { name: "Switch team" }).click();
      await p.getByRole("menuitem").first().waitFor();
    },
  },
  {
    name: "palette",
    persona: "maya",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.keyboard.press("ControlOrMeta+K");
      await p.getByRole("dialog").waitFor();
    },
  },
  {
    name: "demo-drawer",
    persona: "maya",
    path: "/coral-offers/library",
    run: async (p) => {
      await p.getByRole("button", { name: "Demo", exact: true }).click();
      await p.getByRole("dialog").waitFor();
    },
  },
  { name: "design-top", persona: "maya", path: "/design", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  {
    name: "editor-lab-slash",
    persona: "maya",
    path: "/editor-lab",
    run: async (p) => {
      await liveEditor(p);
      const ed = p.locator(".ProseMirror").filter({ visible: true }).first();
      const last = ed.locator("p").last();
      const box = await last.boundingBox();
      await last.click({ position: { x: box.width - 3, y: box.height - 9 }, delay: 90 });
      await p.keyboard.press("Enter");
      await p.keyboard.type("/");
      await p.getByRole("option").first().waitFor();
    },
  },
];

const only = process.argv[2];
const report = [];
for (const size of SIZES) {
  for (const s of SCREENS) {
    if (only && !s.name.includes(only)) continue;
    const { ctx, page, problems } = await open(size, s.persona, s.path);
    try {
      await s.ready?.(page);
      await s.run?.(page);
      await page.waitForTimeout(900); // let entrance motion finish
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // elements wider than the viewport
        wide: [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed")
          .slice(0, 3)
          .map((el) => el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40)),
      }));
      await page.screenshot({ path: `${OUT}/${s.name}-${size.w}.png` });
      report.push(`${s.name} ${size.w}: ok overflowX=${overflow.x} wide=${JSON.stringify(overflow.wide)} errors=${problems.length}`);
    } catch (e) {
      await page.screenshot({ path: `${OUT}/${s.name}-${size.w}-FAILED.png` }).catch(() => {});
      report.push(`${s.name} ${size.w}: FAILED ${String(e).split("\n")[0]}`);
    }
    await ctx.close();
  }
}
console.log(report.join("\n"));
await browser.close();
