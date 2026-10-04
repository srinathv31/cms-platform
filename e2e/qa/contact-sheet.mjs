// Builds e2e/__screens__/phase-1/contact-sheet.png from the 1440x900 QA screenshots.
// Usage: node e2e/qa/contact-sheet.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve("e2e/__screens__/phase-1");
const QA = `${DIR}/qa`;

const SHEET = [
  ["maya-library", "Library", "Maya (Author): her team's templates; New template is the one primary button"],
  ["alex-library-recert", "Library + recertification card", "Alex (Team Admin): Review badge, Audit, Settings, dismissible card"],
  ["riley-all-library", "Library, All teams", "Riley (Platform Admin): every team, Team column"],
  ["alex-settings-members", "Settings modal", "Alex: grouped left nav, flat scrim, serif section title"],
  ["morgan-request-access", "Request access", "Morgan (no team yet): no nav, no Settings"],
  ["maya-workspace-balance-transfer", "Workspace, Active template", "Maya: ID, status, version, SHARE ring, tabs, read-only document"],
  ["maya-workspace-annual-fee-waiver", "Workspace, open draft", "Maya: the same editor, editable"],
  ["sam-workspace-view-only", "Workspace, View only", "Sam (Viewer): View only badge, no editor chrome"],
  ["integration-sheet", "Integration sheet", "Opened by the SHARE ring (frame; contract lands in Phase 5)"],
  ["profile-menu-persona-switcher", "Profile menu", "Persona switcher with one-line role summaries"],
  ["team-switcher", "Team switcher", "Riley: All teams first, then every team"],
  ["palette", "Command palette (⌘K)", "Pages and this team's templates"],
  ["demo-drawer", "Demo drawer", "Dashed pill + drawer: reset, clock, simulator (demo only)"],
  ["design-top", "/design", "Type pairings on real content"],
  ["editor-lab-slash", "/editor-lab", "The slash menu in the production editor"],
];

const cards = SHEET.map(
  ([file, title, note], i) => `
  <figure>
    <div class="shot"><img src="file://${QA}/${file}-1440.png" /></div>
    <figcaption><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="t">${title}</span><span class="d">${note}</span></figcaption>
  </figure>`,
).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --app:#F5F3EF; --canvas:#FCFBF9; --hair:#E6E2DB; --text:#1B1B1B; --muted:#6F6B65; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 2400px; background: var(--app); color: var(--text); font: 400 20px/1.4 -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; padding: 56px 48px 64px; }
  header { display:flex; align-items:baseline; justify-content:space-between; padding-bottom: 28px; margin-bottom: 36px; border-bottom: 1px solid var(--hair); }
  h1 { font: 400 52px/1.1 "Instrument Serif", "Iowan Old Style", Georgia, serif; letter-spacing: -0.01em; }
  header p { color: var(--muted); font-size: 22px; }
  .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 44px 36px; }
  figure { display:flex; flex-direction:column; gap: 14px; }
  .shot { border-radius: 16px; overflow:hidden; border: 1px solid var(--hair); background: var(--canvas); line-height:0; }
  img { width:100%; height:auto; display:block; }
  figcaption { display:grid; grid-template-columns: auto 1fr; column-gap: 14px; row-gap: 2px; align-items: baseline; }
  .n { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 18px; grid-row: 1 / span 2; }
  .t { font-weight: 500; font-size: 24px; }
  .d { color: var(--muted); font-size: 19px; }
</style></head><body>
<header><h1>UCOMP, Phase 1</h1><p>Key screens at 1440 × 900 · fresh demo data</p></header>
<div class="grid">${cards}</div>
</body></html>`;

const htmlPath = `${QA}/_contact-sheet.html`;
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2400, height: 1200 } });
await page.goto(`file://${htmlPath}`);
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
await page.screenshot({ path: `${DIR}/contact-sheet.png`, fullPage: true });
await browser.close();
console.log("wrote", `${DIR}/contact-sheet.png`);
