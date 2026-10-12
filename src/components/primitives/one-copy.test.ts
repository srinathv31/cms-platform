import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Each shared building block has one home. A screen that needs one imports it from there; it doesn't
// paste its classes, hand-roll its semantics or keep a private map. This reads the product's source
// (not the generated `ui/` kit, not the labs in `src/app/(dev)`, not the simulator, which has
// its own look on purpose) and fails on a second copy.

const ROOT = process.cwd();
const SKIP = new Set(["src/components/ui", "src/app/(dev)"]);

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (SKIP.has(path)) return [];
      if (entry.isDirectory()) return files(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    },
  );
}

const sources = ["src/components", "src/editor", "src/app"]
  .flatMap(files)
  .map((path) => ({
    path: relative(ROOT, join(ROOT, path)),
    text: readFileSync(join(ROOT, path), "utf8"),
  }));

// A "selected" fill on a pill, written inline: `rounded-full` and a pressed or checked `bg-selected` in one
// class string, or Base UI's own `data-pressed` fill (the product's pressed looks read `aria-pressed`).
// Picking one of a few is `Segmented`: a track with a tan segment, not pills. Square chips, buttons and
// list rows that fill when pressed (the Preview button, the channel chips) are other things and don't match.
const PRESSED_PILL =
  /rounded-full[^"'`]*(?:aria|data)-(?:pressed|checked):bg-selected|(?:aria|data)-(?:pressed|checked):bg-selected[^"'`]*rounded-full|data-pressed:bg-selected/;

const BLOCKS: { what: string; home: string; copy: RegExp }[] = [
  // The track's classes: a pasted segmented control.
  {
    what: "the segmented control",
    home: "src/components/primitives/segmented.tsx",
    copy: /bg-surface p-0\.5/,
  },
  // The Library's status filter was a row of pills, filled `bg-selected` when pressed: a third selected style.
  {
    what: "the selected segment",
    home: "src/components/primitives/segmented.tsx",
    copy: PRESSED_PILL,
  },
  // A hand-rolled tablist (a panel elsewhere on the page may still say role="tabpanel").
  {
    what: "the tabs",
    home: "src/components/primitives/tabs.tsx",
    copy: /role="tab(list)?"/,
  },
  {
    what: "copying to the clipboard",
    home: "src/components/primitives/copy.ts",
    copy: /navigator\.clipboard|execCommand\(/,
  },
  // The stat card's big number.
  {
    what: "the stat card",
    home: "src/components/primitives/stat-card.tsx",
    copy: /["\s]numeral[\s"]/,
  },
  {
    what: "the team icons",
    home: "src/components/primitives/team-icon.tsx",
    copy: /\bPiggyBank\b/,
  },
  // Channel names come from the domain (`CHANNEL_LABELS` in src/domain/render/errors.ts).
  {
    what: "the channel labels",
    home: "src/domain/render/errors.ts",
    copy: /\bpdf:\s*(\{\s*label:\s*)?"PDF"/,
  },
];

describe("one copy of each shared building block", () => {
  it("reads the product's components, editor and routes", () => {
    expect(sources.length).toBeGreaterThan(300);
    for (const { home } of BLOCKS)
      expect(readFileSync(join(ROOT, home), "utf8").length).toBeGreaterThan(0);
  });

  it("sees a pressed pill, as the Library's status filter once drew it", () => {
    const filter =
      "h-8 gap-1.5 rounded-full px-3 text-[13px] font-normal text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text data-pressed:bg-selected data-pressed:text-text";
    expect(PRESSED_PILL.test(filter)).toBe(true);
    expect(
      PRESSED_PILL.test(
        filter.replace("rounded-full ", "").replace(/ data-pressed:\S+/g, ""),
      ),
    ).toBe(false);
    // Not a pill: the Preview button, and a square chip that fills when pressed.
    expect(
      PRESSED_PILL.test("px-3.5 aria-pressed:bg-selected @max-[34rem]/bar:w-9"),
    ).toBe(false);
    expect(
      PRESSED_PILL.test(
        "rounded-md border aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-text",
      ),
    ).toBe(false);
  });

  it.each(BLOCKS)("has one copy of $what, in $home", ({ home, copy }) => {
    expect(
      sources
        .filter((s) => s.path !== home && copy.test(s.text))
        .map((s) => s.path),
    ).toEqual([]);
  });
});
