// Phase 1 walkthrough recording (1440x900, under 60s) against a fresh demo on :3100.
// Usage: npm run db:reset && npx next start -p 3100   (then)   node e2e/qa/walkthrough-phase-1.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, rmSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "e2e/__screens__/phase-1";
const TMP = `${OUT}/_video-tmp`;
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: TMP, size: { width: 1440, height: 900 } },
});
await ctx.addCookies([{ name: "ucomp_persona", value: "maya", url: BASE }]);
// Quiet the library's router prefetch (see e2e/phase-1.spec.ts): answered with an empty 204.
await ctx.route(/\/templates\/UC-[A-Z0-9]+\?_rsc=/, (r) =>
  r.request().headers()["next-router-prefetch"] === "1" ? r.fulfill({ status: 204 }) : r.continue(),
);

// A small pointer overlay: Playwright's recordings have no cursor, which makes hovers and drags hard to follow.
await ctx.addInitScript(() => {
  window.addEventListener("load", () => {
    setTimeout(() => {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(27,27,27,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);transition:transform .12s ease,background .12s ease;transform:translate(-100px,-100px)";
      host.appendChild(dot);
      document.documentElement.appendChild(host);
      let x = -100, y = -100, down = false;
      const paint = () => {
        dot.style.transform = `translate(${x}px,${y}px) scale(${down ? 0.75 : 1})`;
        dot.style.background = down ? "rgba(45,90,92,.75)" : "rgba(27,27,27,.55)";
      };
      addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; paint(); }, true);
      addEventListener("mousedown", () => { down = true; paint(); }, true);
      addEventListener("mouseup", () => { down = false; paint(); }, true);
    }, 600);
  });
});

const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(e.message));

const beat = (ms) => page.waitForTimeout(ms);
const started = Date.now();
const log = (s) => console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${s}`);

async function center(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}
async function glide(loc, { dx = 0, dy = 0, steps = 28 } = {}) {
  const { x, y } = await center(loc);
  await page.mouse.move(x + dx, y + dy, { steps });
}
async function clickOn(loc, opts) {
  await glide(loc, opts);
  await beat(180);
  await page.mouse.down();
  await beat(90);
  await page.mouse.up();
}
async function liveEditor() {
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ProseMirror")].some((el) => el.offsetParent !== null && "pmViewDesc" in el),
  );
  return page.locator(".ProseMirror").filter({ visible: true });
}
async function hydrated() {
  await page.waitForFunction(() => {
    const el = document.querySelector("button[aria-label$='profile and persona']");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
}
const profile = () => page.getByRole("button", { name: /profile and persona/ });

// 1. Maya's library
await page.goto(`${BASE}/coral-offers/library`);
await page.getByRole("link", { name: /Annual Fee Waiver/ }).waitFor();
await hydrated();
await page.mouse.move(700, 500);
await beat(2200);
log("library");

// 2. Open Balance Transfer: SHARE ring (hover ~2s, click, close)
await clickOn(page.getByRole("link", { name: /^Balance Transfer/ }));
const ring = page.locator("[data-slot='share-ring']");
await ring.waitFor();
await liveEditor();
await beat(1200);
await glide(ring, { steps: 35 });
await beat(2000); // hover: the ring turns
await clickOn(ring, { steps: 4 });
await page.getByRole("dialog").waitFor();
await beat(1800);
await clickOn(page.getByRole("dialog").getByRole("button", { name: "Close" }));
await page.getByRole("dialog").waitFor({ state: "hidden" });
await beat(700);
log("share ring");

// 3. Annual Fee Waiver
await clickOn(page.getByRole("navigation").getByRole("link", { name: "Library" }).first().or(page.getByRole("link", { name: "Library" }).first()));
await page.getByRole("link", { name: /^Annual Fee Waiver/ }).waitFor();
await beat(700);
await clickOn(page.getByRole("link", { name: /^Annual Fee Waiver/ }));
const ed = await liveEditor();
await beat(1500);
log("editor open");

// 4. Type a sentence at the end of the document (scroll down to it first)
await page.mouse.move(700, 500, { steps: 10 });
await page.mouse.wheel(0, 260);
await beat(500);
await page.mouse.wheel(0, 260);
await beat(900);
const last = ed.locator("p").last();
const lastBox = await last.boundingBox();
await glide(last, { dx: lastBox.width / 2 - 4, dy: 0 });
await beat(150);
await page.mouse.down();
await beat(90);
await page.mouse.up();
await page.keyboard.press("Enter");
await page.keyboard.type("Waived fees are reviewed once a year.", { delay: 42 });
await beat(900);

// 5. Slash menu -> Heading 2
await page.keyboard.press("Enter");
await page.keyboard.type("/");
await page.getByRole("option").first().waitFor();
await beat(1500);
await page.keyboard.type("head", { delay: 110 });
await beat(500);
await page.keyboard.press("ArrowDown");
await beat(600);
await page.keyboard.press("Enter");
await page.keyboard.type("Questions", { delay: 60 });
await beat(1200);
log("typed + slash");

// 6. Hover a block and drag it up one place (scroll back to the top first)
await page.mouse.move(700, 500, { steps: 10 });
await page.mouse.wheel(0, -700);
await beat(500);
await page.mouse.wheel(0, -700);
await beat(900);
const paras = ed.locator("p");
const second = paras.nth(2); // "The waiver ends on your first account anniversary."
const first = paras.nth(1); // "The waiver is automatic..."
await glide(second, { dx: -120, steps: 30 });
await glide(second, { dx: -60, dy: 2, steps: 8 });
const grip = page.getByLabel("Drag to move block");
await grip.waitFor({ state: "visible" });
await beat(1100);
const g = await center(grip);
const target = await first.boundingBox();
await page.mouse.move(g.x, g.y, { steps: 6 });
await beat(200);
await page.mouse.down();
await beat(200);
await page.mouse.move(g.x + 30, g.y - 20, { steps: 8 });
await page.mouse.move(target.x + 120, target.y + 4, { steps: 30 });
await beat(700);
await page.mouse.up();
await beat(1400);
const order = await ed.locator("p").evaluateAll((els) => els.slice(0, 4).map((e) => e.textContent.slice(0, 24)));
log(`dragged; first paragraphs now: ${JSON.stringify(order)}`);

// 7. Select text, bubble toolbar, Bold
const typed = ed.locator("p", { hasText: "The waiver ends on your first account anniversary." });
const r = await typed.evaluate((el) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const b = range.getBoundingClientRect();
  return { left: b.left, right: b.right, y: b.top + b.height / 2 };
});
await page.mouse.move(r.left + 1, r.y, { steps: 30 });
await beat(200);
await page.mouse.down();
await beat(120);
await page.mouse.move(r.right - 1, r.y, { steps: 24 });
await beat(150);
await page.mouse.up();
const toolbar = page.getByRole("toolbar", { name: "Format text" });
await toolbar.waitFor();
await beat(1200);
await clickOn(toolbar.getByRole("button", { name: "Bold" }));
await beat(1600);
log("bold");

// 8. Switch persona to Jordan (Review badge)
await clickOn(profile());
await page.getByRole("menuitemradio").first().waitFor();
await beat(1300);
await clickOn(page.getByRole("menuitemradio", { name: /Jordan Ellis/ }));
await page.getByRole("button", { name: /^Jordan Ellis,/ }).waitFor();
await page.locator("[aria-label='1 waiting']").waitFor();
await beat(2000);
log("jordan");

// 9. Riley, then All teams
await clickOn(profile());
await page.getByRole("menuitemradio").first().waitFor();
await beat(900);
await clickOn(page.getByRole("menuitemradio", { name: /Riley Brooks/ }));
await page.getByRole("button", { name: /^Riley Brooks,/ }).waitFor();
await beat(1500);
await clickOn(page.getByRole("button", { name: "Switch team" }));
await page.getByRole("menuitem", { name: "All teams" }).waitFor();
await beat(900);
await clickOn(page.getByRole("menuitem", { name: "All teams" }));
await page.waitForURL(/\/all\/library$/);
await page.getByRole("link", { name: /Statement Insert — Rate Change/ }).waitFor();
await beat(1900);
log("riley all teams");

// 10. Settings modal, then close
await clickOn(page.getByRole("link", { name: "Settings" }));
await page.getByRole("dialog").waitFor();
await beat(2300);
await clickOn(page.getByRole("button", { name: "Close settings" }));
await page.getByRole("dialog").waitFor({ state: "hidden" });
await beat(1000);
log("settings closed");

const video = page.video();
await ctx.close();
const path = await video.path();
renameSync(path, `${OUT}/walkthrough.webm`);
rmSync(TMP, { recursive: true, force: true });
await browser.close();
console.log("console/page errors:", JSON.stringify(problems));
console.log("saved", `${OUT}/walkthrough.webm`, `${((Date.now() - started) / 1000).toFixed(1)}s`);
