import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, type Locator, type Page } from "@playwright/test";

// Gate media as a by-product of the scenario specs. `npm run gate:media` runs them in two projects
// (playwright.config.ts):
//   - `demo`: 1440×900, records a video, presentation pacing. A visible cursor, pauses at the narrative
//     moments and eased mouse moves are what a recording needs and a test does not.
//   - `stills-1280`: 1280×800, no video, full speed. Only the stills.
// Both take the gate stills with `shoot()` at whatever size they run at; nothing resizes mid-run, so the
// recording never shows a resize. Outside these projects every helper here is a no-op, so a spec runs
// at its normal speed.
//
// Demo mode (pacing, cursor) is `UCOMP_DEMO=1`; shooting is on in demo mode or with `UCOMP_STILLS=1`.
// The projects turn them on per test (the fixture in helpers/scenario.ts); set them yourself to get the
// same in any other project.

export const isDemo = () => process.env.UCOMP_DEMO === "1";

/** Whether `shoot()` takes pictures: in the demo project, and in the stills-only one. */
export const isShooting = () => isDemo() || process.env.UCOMP_STILLS === "1";

/** A timeout that leaves room for demo pacing: the pauses and the stills add up to a few times the run. */
export const demoTimeout = (ms: number, factor = 3) => (isDemo() ? ms * factor : ms);

/** The size of the recording, and the fallback when a page reports no viewport. */
export const DEMO_VIEWPORT = { width: 1440, height: 900 } as const;

/** A pause that only exists in demo mode: the time a viewer needs to take in what just happened. */
export async function beat(page: Page, ms = 700) {
  if (isDemo()) await page.waitForTimeout(ms);
}

// ── The cursor ───────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface CursorApi {
  pos: Point | null;
  set(x: number, y: number): void;
  hide(): void;
  show(): void;
}

type CursorWindow = Window & { __ucompCursor?: CursorApi };

/** Where the cursor was last seen, so a fresh document (after a full navigation) can start there. */
const lastSeen = new WeakMap<Page, Point>();
const withCursor = new WeakSet<Page>();

/**
 * Runs in the page. A 14px grey dot at 50% opacity that follows the mouse, shrinks while a button is
 * down and sends out a ring on each press. It is a plain element on the root, `pointer-events: none`,
 * so nothing can hit it and `elementFromPoint` never sees it. Idempotent: a document gets one.
 */
function installCursor(start: Point | null) {
  const w = window as CursorWindow;
  if (w.__ucompCursor) return;

  const dot = document.createElement("div");
  dot.setAttribute("aria-hidden", "true");
  dot.setAttribute("data-demo-cursor", "");
  dot.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:14px",
    "height:14px",
    "margin:-7px 0 0 -7px",
    "border-radius:50%",
    "background:rgb(88 88 88)",
    "box-shadow:0 0 0 1px rgb(255 255 255 / 0.55)",
    "opacity:0",
    "pointer-events:none",
    "z-index:2147483647",
    "will-change:translate,scale",
    "transition:scale 90ms ease-out",
    // A page change runs a view transition; naming the dot keeps it above the snapshots.
    "view-transition-name:ucomp-demo-cursor",
  ].join(";");

  const api: CursorApi = {
    pos: null,
    set(x, y) {
      api.pos = { x, y };
      // `translate` and `scale` are separate properties: the scale of a press applies around the dot, not the page.
      dot.style.translate = `${x}px ${y}px`;
      dot.style.opacity = "0.5";
    },
    hide() {
      dot.style.visibility = "hidden";
    },
    show() {
      dot.style.visibility = "visible";
    },
  };

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    "::view-transition-group(ucomp-demo-cursor){animation:none}" +
      "::view-transition-old(ucomp-demo-cursor){display:none}" +
      "::view-transition-new(ucomp-demo-cursor){animation:none}",
  );
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const ripple = (x: number, y: number) => {
    const ring = document.createElement("div");
    ring.setAttribute("aria-hidden", "true");
    ring.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "width:14px",
      "height:14px",
      "margin:-7px 0 0 -7px",
      "border-radius:50%",
      "border:2px solid rgb(88 88 88)",
      "box-sizing:border-box",
      "pointer-events:none",
      "z-index:2147483646",
      `translate:${x}px ${y}px`,
    ].join(";");
    document.documentElement.appendChild(ring);
    const animation = ring.animate(
      [
        { scale: "1", opacity: 0.55 },
        { scale: "3.2", opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" },
    );
    animation.onfinish = () => ring.remove();
  };

  const follow = (event: MouseEvent) => api.set(event.clientX, event.clientY);
  window.addEventListener("mousemove", follow, true);
  // During a native drag the browser sends drag events instead of mouse moves.
  window.addEventListener("dragover", follow, true);
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse") return;
      api.set(event.clientX, event.clientY);
      dot.style.scale = "0.72";
      ripple(event.clientX, event.clientY);
    },
    true,
  );
  const release = () => {
    dot.style.scale = "1";
  };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);

  const mount = () => {
    document.documentElement.appendChild(dot);
    w.__ucompCursor = api;
    if (start) api.set(start.x, start.y);
  };
  if (document.documentElement) mount();
  else document.addEventListener("readystatechange", mount, { once: true });
}

/**
 * Puts the cursor dot on the MAIN page of a demo run, now and after every navigation. Not an init
 * script: that would also run in the sandboxed preview frames, and Chrome logs "Blocked script
 * execution" for it. This evaluates in the main frame only. Safe to call again; a no-op outside demo
 * mode.
 */
export async function demoCursor(page: Page) {
  if (!isDemo() || withCursor.has(page)) return;
  withCursor.add(page);
  const inject = async () => {
    try {
      await page.evaluate(installCursor, lastSeen.get(page) ?? null);
    } catch {
      // The document was replaced while we looked, or the page closed: a later event tries again.
    }
  };
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) void inject();
  });
  page.on("domcontentloaded", () => void inject());
  page.on("load", () => void inject());
  await inject();
}

/** The cursor as the page last drew it, if it has one. */
async function cursorPosition(page: Page): Promise<Point | null> {
  const seen = await page.evaluate(() => (window as CursorWindow).__ucompCursor?.pos ?? null).catch(() => null);
  return seen ?? lastSeen.get(page) ?? null;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Moves the real mouse from where it is to `to` along a gentle arc, eased, in steps small enough to
 * show up as motion in a 25fps recording. The dot follows because the page sees real mouse moves.
 */
export async function glide(page: Page, to: Point) {
  const viewport = page.viewportSize() ?? DEMO_VIEWPORT;
  let from = await cursorPosition(page);
  if (!from) {
    // First move of the run: arrive from the lower left rather than sweeping out of the corner.
    from = {
      x: Math.min(Math.max(to.x - 220, 8), viewport.width - 8),
      y: Math.min(Math.max(to.y + 120, 8), viewport.height - 8),
    };
    await page.mouse.move(from.x, from.y);
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= 1) {
    const duration = Math.min(700, Math.max(240, 200 + distance * 0.45));
    const steps = Math.max(8, Math.round(duration / 16));
    const bow = Math.min(distance * 0.05, 28);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = easeInOut(t);
      const arc = Math.sin(Math.PI * t) * bow;
      // The arc leans on the normal of the straight line.
      await page.mouse.move(from.x + dx * e - (dy / distance) * arc, from.y + dy * e + (dx / distance) * arc);
      await page.waitForTimeout(duration / steps);
    }
  }
  await page.mouse.move(to.x, to.y);
  lastSeen.set(page, to);
  // The pointer over a frame is the frame's to hear: set the dot ourselves so it ends where it should.
  await page.evaluate(({ x, y }) => (window as CursorWindow).__ucompCursor?.set(x, y), to).catch(() => {});
}

/**
 * Before a click, in demo mode: an eased, stepped mouse move to the centre of `target` (or to `at`,
 * from its top left, as a click's `position`). Best effort: if the target is not there yet the click
 * that follows does its own waiting and reports the real problem.
 */
export async function moveTo(page: Page, target: Locator, at?: Point) {
  if (!isDemo()) return;
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 2_000 });
    const box = await target.boundingBox({ timeout: 2_000 });
    if (!box) return;
    await glide(page, { x: box.x + (at?.x ?? box.width / 2), y: box.y + (at?.y ?? box.height / 2) });
  } catch {
    // Not found, not unique, or gone: let the click say so.
  }
}

// ── The stills ───────────────────────────────────────────────────────────────

/** `scenario-02.spec.ts` → `scenario-02`. */
export const specName = () => path.basename(test.info().file).replace(/\.spec\.[cm]?[jt]s$/, "");

/** Where this spec's gate media goes: e2e/__screens__/gate/<spec-name>/. */
const stillsDir = () => path.join(test.info().project.testDir, "__screens__", "gate", specName());

/** Waits (in the page) until what a still would show is on screen, drawn, and not about to change. */
async function untilRendered(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

  // Preview frames: loaded, with content, their own images and fonts in.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLIFrameElement>("iframe[title]")]
        .filter((frame) => frame.checkVisibility())
        .every((frame) => {
          const doc = frame.contentDocument;
          if (!doc) return true; // not ours to read (cross-origin): nothing to wait on
          return (
            doc.readyState === "complete" &&
            !!doc.body &&
            doc.body.children.length > 0 &&
            [...doc.images].every((image) => image.complete) &&
            doc.fonts.status === "loaded"
          );
        }),
    undefined,
    { timeout: 10_000, polling: 100 },
  );

  // The PDF: every page on screen has its canvas, sized for the page as it is now, with something on it.
  await page.waitForFunction(
    () => {
      const region = document.querySelector<HTMLElement>('[role="region"][aria-label="PDF preview"]');
      if (!region || !region.checkVisibility()) return true; // no PDF in view
      if (region.getAttribute("aria-busy") === "true") return false;
      const sheets = [...region.querySelectorAll<HTMLElement>('[role="group"]')].filter((sheet) => {
        const r = sheet.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
      });
      if (sheets.length === 0) return false;
      const dpr = window.devicePixelRatio || 1;
      return sheets.every((sheet) => {
        const canvas = sheet.querySelector("canvas");
        if (!canvas || canvas.width < 2) return false;
        if (canvas.width < sheet.getBoundingClientRect().width * dpr * 0.9) return false; // an old, smaller draw
        const hasText = [...sheet.querySelectorAll("span")].some((span) => (span.textContent ?? "").trim());
        if (!hasText) return true;
        const context = canvas.getContext("2d");
        if (!context) return true;
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 16) {
          if (data[i + 3] > 0 && (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250)) return true;
        }
        return false; // still blank paper
      });
    },
    undefined,
    { timeout: 15_000, polling: 150 },
  );

  // Two frames, so that what was just laid out has been painted.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/**
 * A gate still, when shooting is on (the demo and stills-1280 projects; a no-op otherwise):
 * `e2e/__screens__/gate/<spec-name>/<width>-<name>.png`, at the viewport the project runs at (1440 or
 * 1280). It never resizes: a resize would show in the recording. It waits until the page is rendered,
 * hides the cursor for the shot, shoots. A page that does not settle is shot anyway and the test notes
 * it, rather than failing the gate over its own photograph.
 */
export async function shoot(page: Page, name: string) {
  if (!isShooting()) return;
  const dir = stillsDir();
  await mkdir(dir, { recursive: true });
  const { width } = page.viewportSize() ?? DEMO_VIEWPORT;
  await page.evaluate(() => (window as CursorWindow).__ucompCursor?.hide()).catch(() => {});
  try {
    await untilRendered(page);
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] : String(error);
    test.info().annotations.push({ type: "shoot", description: `${width}-${name}: not settled (${why})` });
    console.warn(`shoot ${specName()}/${width}-${name}: not settled, shot anyway (${why})`);
  }
  await page.screenshot({ path: path.join(dir, `${width}-${name}.png`), animations: "disabled", caret: "hide" });
  await page.evaluate(() => (window as CursorWindow).__ucompCursor?.show()).catch(() => {});
}
