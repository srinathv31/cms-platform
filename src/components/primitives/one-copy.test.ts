import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Each shared building block has one home. A screen that needs one imports it from there; it doesn't
// paste its classes, hand-roll its semantics or keep a private map. This reads the product's source
// (not the generated `ui/` kit, not the design mocks in `src/app/(dev)`, not the simulator, which has
// its own look on purpose) and fails on a second copy.

const ROOT = process.cwd();
const SKIP = new Set(["src/components/ui", "src/app/(dev)"]);

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (SKIP.has(path)) return [];
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const sources = ["src/components", "src/editor", "src/app"].flatMap(files).map((path) => ({
  path: relative(ROOT, join(ROOT, path)),
  text: readFileSync(join(ROOT, path), "utf8"),
}));

const BLOCKS: { what: string; home: string; copy: RegExp }[] = [
  // The track's classes: a pasted segmented control.
  { what: "the segmented control", home: "src/components/primitives/segmented.tsx", copy: /bg-surface p-0\.5/ },
  // A hand-rolled tablist (a panel elsewhere on the page may still say role="tabpanel").
  { what: "the tabs", home: "src/components/primitives/tabs.tsx", copy: /role="tab(list)?"/ },
  { what: "copying to the clipboard", home: "src/components/primitives/copy.ts", copy: /navigator\.clipboard|execCommand\(/ },
  // The stat card's big number.
  { what: "the stat card", home: "src/components/primitives/stat-card.tsx", copy: /["\s]numeral[\s"]/ },
  { what: "the team icons", home: "src/components/primitives/team-icon.tsx", copy: /\bPiggyBank\b/ },
  // Channel names come from the domain (`CHANNEL_LABELS` in src/domain/render/errors.ts).
  { what: "the channel labels", home: "src/domain/render/errors.ts", copy: /\bpdf:\s*(\{\s*label:\s*)?"PDF"/ },
];

describe("one copy of each shared building block", () => {
  it("reads the product's components, editor and routes", () => {
    expect(sources.length).toBeGreaterThan(300);
    for (const { home } of BLOCKS) expect(readFileSync(join(ROOT, home), "utf8").length).toBeGreaterThan(0);
  });

  it.each(BLOCKS)("has one copy of $what, in $home", ({ home, copy }) => {
    expect(sources.filter((s) => s.path !== home && copy.test(s.text)).map((s) => s.path)).toEqual([]);
  });
});
