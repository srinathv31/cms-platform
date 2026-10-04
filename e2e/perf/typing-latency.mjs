// Typing latency on the editor lab's long disclosure: ~200 real keystrokes (Chromium via
// Playwright) right after a variable chip, inside a table cell and in a list item, with a few
// Backspaces. Budget: under 16 ms per keystroke.
//
// Measured with the Event Timing API (PerformanceObserver "event" entries). Per keystroke, the
// keydown and the keypress / beforeinput / input events that follow it form one group:
//   keystroke   max(processingEnd) − keydown.startTime: input delay plus all handler work for
//               the keystroke (ProseMirror's DOM observer, transactions, plugins, React
//               subscribers run inside those handlers). This is the budgeted number.
//   perEvent    processingEnd − startTime for each event on its own.
//   toPaint     the keydown entry's duration (to the next paint, rounded by the browser to 8 ms);
//               informational: it includes the frame's style, layout and paint.
// Chrome reports only events whose duration (to paint) is at least 16 ms, the API's minimum
// threshold, so the statistics cover the slower keystrokes; every unreported one went from key
// press to paint in under 16 ms.
//
// Usage:  node e2e/perf/typing-latency.mjs [baseURL]     (default http://localhost:3000)
// Prints a JSON summary (median / p95 / max in ms) and exits 1 when a p95 is over budget.

import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";
const BUDGET_MS = 16;

const SEGMENTS = [
  { where: "after a chip", locator: ".ProseMirror [data-variable='purchase_apr']", text: " which applies to purchases and balance transfers made after opening", backspaces: 6 },
  { where: "in a table cell", locator: ".ProseMirror td:nth-child(2)", text: " plus a small note on how the fee is billed", backspaces: 5 },
  { where: "in a list item", locator: ".ProseMirror li p", text: " and it stays that way for as long as the account remains open", backspaces: 5 },
];

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n) => Math.round(n * 100) / 100;
  return { n: sorted.length, median: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), max: round(sorted.at(-1) ?? 0) };
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`${BASE}/editor-lab`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector(".ProseMirror")?.pmViewDesc, null, { timeout: 30_000 });
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__perf = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (["keydown", "keypress", "beforeinput", "input"].includes(entry.name)) {
        window.__perf.push({ name: entry.name, start: entry.startTime, end: entry.processingEnd, duration: entry.duration });
      }
    }
  });
  observer.observe({ type: "event", durationThreshold: 0, buffered: false });
});

let keystrokes = 0;
for (const segment of SEGMENTS) {
  const target = page.locator(segment.locator).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + box.width + 1, box.y + box.height / 2, { delay: 90 });
  await page.keyboard.press("End");
  await page.keyboard.type(segment.text, { delay: 35 });
  for (let i = 0; i < segment.backspaces; i++) await page.keyboard.press("Backspace", { delay: 35 });
  keystrokes += segment.text.length + segment.backspaces + 1;
}
await page.waitForTimeout(500);

const entries = (await page.evaluate(() => window.__perf)).sort((a, b) => a.start - b.start);
const groups = [];
for (const entry of entries) {
  if (entry.name === "keydown") groups.push({ start: entry.start, end: entry.end, toPaint: entry.duration });
  else if (groups.length) groups.at(-1).end = Math.max(groups.at(-1).end, entry.end);
}
const result = {
  url: `${BASE}/editor-lab`,
  keystrokes,
  reported: groups.length,
  budgetMs: BUDGET_MS,
  keystroke: summary(groups.map((g) => g.end - g.start)),
  perEvent: summary(entries.map((e) => e.end - e.start)),
  toPaint: summary(groups.map((g) => g.toPaint)),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.keystroke.p95 > BUDGET_MS ? 1 : 0);
