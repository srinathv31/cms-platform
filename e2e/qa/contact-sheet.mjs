// The final contact sheet: every still the gate media run took (`npm run gate:media`), one labelled card
// per still, grouped by spec (the demo script first, in story order, then each scenario spec).
//
//   node e2e/qa/contact-sheet.mjs
//
// Reads e2e/__screens__/gate/<spec>/<width>-<name>.png (1440 from the `demo` project, 1280 from
// `stills-1280`) and writes, next to them:
//   e2e/__screens__/gate/contact-sheet.html  (links to the full-size stills, relative paths)
//   e2e/__screens__/gate/contact-sheet.png   (the same sheet rendered from small copies)
// The small copies are made with macOS `sips` in a temporary folder and removed afterwards.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(root, "e2e", "__screens__", "gate");
const THUMB_WIDTH = 480;
const MAX_HEIGHT = 16_000; // Chromium's full-page capture stays reliable below about 16k pixels.

if (!existsSync(GATE)) {
  console.error(`No stills: ${path.relative(root, GATE)} does not exist. Run \`npm run gate:media\` first.`);
  process.exit(1);
}

/** "demo-05-v3-available" → "v3 available" (the demo script's step number is shown on its own). */
const describe = (name) => name.replace(/^demo-\d+-/, "").replace(/-/g, " ");
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Sections: the demo script first, then the scenario specs in number order, then anything else.
const order = (spec) => (spec === "demo-script" ? -1 : Number(/^scenario-(\d+)/.exec(spec)?.[1] ?? 999));
const sections = readdirSync(GATE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => {
    const stills = readdirSync(path.join(GATE, entry.name))
      .map((file) => {
        const [, width, name] = /^(\d+)-(.+)\.png$/.exec(file) ?? [];
        return width ? { spec: entry.name, file, width: Number(width), name } : null;
      })
      .filter(Boolean)
      // The same screen at both sizes sits side by side: by name, then 1440 before 1280.
      .sort((a, b) => a.name.localeCompare(b.name) || b.width - a.width);
    return { spec: entry.name, stills };
  })
  .filter((section) => section.stills.length > 0)
  .sort((a, b) => order(a.spec) - order(b.spec) || a.spec.localeCompare(b.spec));

const total = sections.reduce((n, s) => n + s.stills.length, 0);
if (total === 0) {
  console.error(`No stills under ${path.relative(root, GATE)}.`);
  process.exit(1);
}

function sheet(src, columns) {
  let n = 0;
  const body = sections
    .map(({ spec, stills }) => {
      const cards = stills
        .map((still) => {
          n += 1;
          const step = /^demo-(\d+)-/.exec(still.name)?.[1];
          const label = `${spec}/${still.width}-${still.name}`;
          return `
    <figure>
      <a class="shot" href="${escape(`${spec}/${still.file}`)}"><img src="${escape(src(still))}" alt="${escape(label)}" loading="eager" /></a>
      <figcaption><span class="n">${String(n).padStart(3, "0")}</span><span class="t">${escape(describe(still.name))}</span><span class="d">${escape(spec)}${step ? ` · step ${Number(step)}` : ""} · ${still.width}</span></figcaption>
    </figure>`;
        })
        .join("");
      return `
  <section>
    <h2>${escape(spec)} <span>${stills.length} stills</span></h2>
    <div class="grid">${cards}
    </div>
  </section>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UCOMP contact sheet</title><style>
  :root { --app:#F5F3EF; --canvas:#FCFBF9; --hair:#E6E2DB; --text:#1B1B1B; --muted:#6F6B65; --columns:${columns}; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 3200px; background: var(--app); color: var(--text); font: 400 17px/1.35 -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; padding: 48px 44px 56px; }
  header { display:flex; align-items:baseline; justify-content:space-between; padding-bottom: 22px; margin-bottom: 28px; border-bottom: 1px solid var(--hair); }
  h1 { font: 400 46px/1.1 "Newsreader", "Iowan Old Style", Georgia, serif; letter-spacing: -0.01em; }
  header p { color: var(--muted); font-size: 20px; }
  section + section { margin-top: 40px; }
  h2 { font-weight: 500; font-size: 24px; margin-bottom: 16px; }
  h2 span { color: var(--muted); font-weight: 400; font-size: 18px; margin-left: 10px; }
  .grid { display:grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: 26px 20px; }
  figure { display:flex; flex-direction:column; gap: 8px; min-width: 0; }
  .shot { display:block; border-radius: 10px; overflow:hidden; border: 1px solid var(--hair); background: var(--canvas); line-height:0; }
  img { width:100%; height:auto; display:block; }
  figcaption { display:grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: baseline; }
  .n { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 14px; grid-row: 1 / span 2; }
  .t { font-weight: 500; font-size: 16px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
  .d { color: var(--muted); font-size: 14px; }
</style></head><body>
<header><h1>UCOMP, every screen</h1><p>${total} stills from the gate media run · 1440 × 900 and 1280 × 800 · fresh demo data</p></header>${body}
</body></html>`;
}

// The browsable sheet: full-size stills by relative path.
const htmlPath = path.join(GATE, "contact-sheet.html");
writeFileSync(htmlPath, sheet((still) => `${still.spec}/${still.file}`, 6));

// The picture: the same sheet from small copies, so the browser never holds hundreds of full stills.
const thumbs = mkdtempSync(path.join(tmpdir(), "ucomp-contact-"));
try {
  for (const { stills } of sections)
    for (const still of stills) {
      execFileSync("sips", ["--resampleWidth", String(THUMB_WIDTH), path.join(GATE, still.spec, still.file), "--out", path.join(thumbs, `${still.spec}__${still.file}`)], { stdio: "ignore" });
    }
  const renderPath = path.join(thumbs, "sheet.html");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 3200, height: 1200 } });
    let columns = 6;
    for (;;) {
      writeFileSync(renderPath, sheet((still) => pathToFileURL(path.join(thumbs, `${still.spec}__${still.file}`)).href, columns));
      await page.goto(pathToFileURL(renderPath).href);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      if (height <= MAX_HEIGHT || columns >= 12) break;
      columns += 1;
    }
    await page.screenshot({ path: path.join(GATE, "contact-sheet.png"), fullPage: true });
    console.log(`${total} stills in ${sections.length} sections (${columns} columns)`);
  } finally {
    await browser.close();
  }
} finally {
  rmSync(thumbs, { recursive: true, force: true });
}
console.log("wrote", path.relative(root, path.join(GATE, "contact-sheet.png")), "and", path.relative(root, htmlPath));
