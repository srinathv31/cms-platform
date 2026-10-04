import { test as base, expect, type Locator, type Page } from "@playwright/test";

// Shared by the scenario specs that drive the workspace as a person would: a test that fails on any
// console or page error, the live-editor wait, caret and chip readers, and a click counter.

export const PERSONA_COOKIE = "ucomp_persona";

interface Fixtures {
  /** Uncaught page errors and console errors collected during the test; the test fails if any. */
  problems: string[];
}

export const test = base.extend<Fixtures>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console.error: ${msg.text()} @ ${msg.location().url}`);
      });
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("crash", () => problems.push("page crashed"));
      await page.addInitScript(countPointerPresses);
      await use(problems);
      expect(problems, "console errors and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Runs in the page before any script. Counts every real mouse press (capture phase, so nothing can
 * swallow it) from the start of the document, and every mouse move. A keyboard "click" (Enter on a
 * button) is not a press.
 */
function countPointerPresses() {
  const w = window as unknown as { __mousePresses: number; __mouseMoves: number };
  w.__mousePresses = 0;
  w.__mouseMoves = 0;
  document.addEventListener("mousemove", () => w.__mouseMoves++, true);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse") w.__mousePresses++;
    },
    true,
  );
}

export const mousePresses = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mousePresses: number }).__mousePresses);

export const mouseMoves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mouseMoves: number }).__mouseMoves);

export async function asPersona(page: Page, id: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page.context().addCookies([{ name: PERSONA_COOKIE, value: id, url: baseURL }]);
}

// ── The click counter ──

export interface ClickCounter {
  readonly count: number;
  /** A natural press-and-release (Playwright's default releases within ~1ms), counted. */
  click(target: Locator, options?: Parameters<Locator["click"]>[0]): Promise<void>;
}

export function clickCounter(): ClickCounter {
  let count = 0;
  return {
    get count() {
      return count;
    },
    async click(target, options) {
      count++;
      await target.click({ delay: 90, ...options });
    },
  };
}

// ── The page ──

/** Hydrated: React has attached its handlers to the shell (the profile button is interactive). */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("button[aria-label$='profile and persona']");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
}

/** The Library, once its rows are on screen and interactive. */
export async function openLibrary(page: Page, team = "coral-offers") {
  await page.goto(`/${team}/library`);
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await expect(page.locator("main ul > li > a[href*='/templates/']").filter({ visible: true }).first()).toBeVisible();
  await hydrated(page);
}

/** Next keeps previous routes alive (hidden) behind the new one, so only look at what is shown. */
export const editor = (page: Page): Locator => page.locator(".ProseMirror").filter({ visible: true });

/**
 * The server paints the document as static markup; the live editor swaps in after hydration.
 * ProseMirror stamps `pmViewDesc` on its root once it is live.
 */
export async function liveEditor(page: Page): Promise<Locator> {
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ProseMirror")].some(
      (el) => (el as HTMLElement).offsetParent !== null && "pmViewDesc" in el,
    ),
  );
  return editor(page);
}

export const nameField = (page: Page) => page.getByRole("textbox", { name: "Template name" });

/** The autosave indicator: "Saved", "Saving…" or why it did not save. */
export const saveIndicator = (page: Page) => page.locator("[data-status][aria-live='polite']").filter({ visible: true });

/** After the last edit: the indicator goes to "Saving…", then settles on "Saved". */
export async function expectAutosaved(page: Page) {
  const indicator = saveIndicator(page);
  await expect(indicator).toHaveText("Saving…");
  await expect(indicator).toHaveText("Saved", { timeout: 15_000 });
}

/** A chip in the document (the panel keeps an invisible drag image of every chip, so scope to the editor). */
export const chip = (page: Page, key: string) => editor(page).locator(`[data-variable="${key}"]`);

export const panelRow = (page: Page, key: string) =>
  page.locator(`[data-variable-row="${key}"]`).filter({ visible: true });

export const requiredHeading = (page: Page, key: string) =>
  editor(page).locator(`h2[data-required="${key}"]`);

interface LiveEditor {
  state: {
    doc: {
      forEach(fn: (node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }, offset: number) => void): void;
      textContent: string;
    };
    selection: { from: number; to: number; empty: boolean; constructor: { name: string }; $from: { parent: { textContent: string }; parentOffset: number } };
  };
  view: { dom: HTMLElement };
  can(): { undo(): boolean; redo(): boolean };
  commands: { setNodeSelection(pos: number): boolean };
}

export interface Caret {
  /** The document itself holds focus. */
  focused: boolean;
  /** Title of the required section the caret or selection starts in. */
  section: string | null;
  empty: boolean;
  /** The selection type: TextSelection, NodeSelection, AllSelection… */
  kind: string;
  /** Text of the block the selection starts in. */
  block: string;
  /** Offset of the selection start within that block. */
  offset: number;
}

/** Where the caret is, read from the live editor. */
export async function caret(page: Page): Promise<Caret> {
  return page.evaluate(() => {
    const SELECTION_KINDS: Record<string, string> = {
      text: "TextSelection",
      node: "NodeSelection",
      all: "AllSelection",
      cell: "CellSelection",
    };
    const dom = [...document.querySelectorAll(".ProseMirror")].find((el) => (el as HTMLElement).offsetParent !== null) as
      | (HTMLElement & { editor: LiveEditor })
      | undefined;
    if (!dom) throw new Error("no live editor on screen");
    const { selection, doc } = dom.editor.state;
    let section: string | null = null;
    doc.forEach((node, offset) => {
      if (node.type.name === "heading" && node.attrs.requiredKey && offset <= selection.from) section = node.textContent;
    });
    return {
      focused: document.activeElement === dom,
      section,
      empty: selection.empty,
      // Not constructor.name: production builds minify class names. toJSON().type is ProseMirror's
      // stable selection id ("text", "node", "all"; cell selections register their own).
      kind: SELECTION_KINDS[(selection as unknown as { toJSON(): { type: string } }).toJSON().type] ?? "Selection",
      block: selection.$from.parent.textContent,
      offset: selection.$from.parentOffset,
    };
  });
}

/** Whether undo and redo have anything left to do. */
export async function history(page: Page): Promise<{ undo: boolean; redo: boolean }> {
  return page.evaluate(() => {
    const dom = [...document.querySelectorAll(".ProseMirror")].find((el) => (el as HTMLElement).offsetParent !== null) as
      | (HTMLElement & { editor: LiveEditor })
      | undefined;
    if (!dom) throw new Error("no live editor on screen");
    const can = dom.editor.can();
    return { undo: can.undo(), redo: can.redo() };
  });
}

/** Which of these chips are in the document right now. */
export async function chipsPresent(page: Page, keys: readonly string[]): Promise<string[]> {
  return page.evaluate(
    (wanted) => {
      const dom = [...document.querySelectorAll(".ProseMirror")].find((el) => (el as HTMLElement).offsetParent !== null);
      return wanted.filter((key) => !!dom?.querySelector(`[data-variable="${key}"]`));
    },
    [...keys],
  );
}

/** The viewport rectangle of a block's text (not the block's full width), for aiming the mouse. */
export async function textRect(block: Locator) {
  return block.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });
}

/** The viewport point at `offset` characters into a block's first text node (for aiming a drop). */
export async function pointInText(block: Locator, offset: number) {
  return block.evaluate((el, at) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at);
    const r = range.getBoundingClientRect();
    return { x: r.left, y: (r.top + r.bottom) / 2 };
  }, offset);
}

/**
 * Drags a panel row into the document with the real mouse. `locator.dragTo` does not deliver the
 * HTML5 drop here, so: press on the row, nudge to start the drag, glide over the target in steps,
 * release.
 */
export async function dragRowTo(page: Page, row: Locator, target: { x: number; y: number }) {
  const box = (await row.boundingBox())!;
  const from = { x: box.x + 64, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.move(from.x - 12, from.y - 8, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/** `:focus-visible` matches the focused element, and something on it (outline or shadow) shows it. */
export async function expectVisibleFocus(target: Locator, what: string) {
  await expect(target, `${what} has focus`).toBeFocused();
  const state = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      focusVisible: el.matches(":focus-visible"),
      outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
      shadow: style.boxShadow !== "none",
    };
  });
  expect(state.focusVisible, `${what}: matches :focus-visible`).toBe(true);
  expect(state.outline || state.shadow, `${what}: draws a focus indicator (outline or ring)`).toBe(true);
}

export const NAME = "Spring Travel Rewards — Terms";
