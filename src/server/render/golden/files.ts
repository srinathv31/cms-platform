// Where the golden cases live and how to read one. Shared by the tests and the import script.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { json, parseRenderFixture, type RenderFixture } from "@/server/render/testing/fixture";
import { FOCUSED_CASES } from "./focused-cases";

/** Every path is under the project root, which is the working directory for npm scripts and vitest. */
export const GOLDEN_DIR = path.join(process.cwd(), "src/server/render/golden");
export const CASES_DIR = path.join(GOLDEN_DIR, "cases");

/** True under `npm run golden:update`: write the files instead of comparing with them. */
export const UPDATING = process.env.GOLDEN_UPDATE === "1";

/** The case folders on disk, plus the hand-built ones (so an update can create them). */
export function caseSlugs(): string[] {
  const onDisk = existsSync(CASES_DIR) ? readdirSync(CASES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  return [...new Set([...onDisk, ...FOCUSED_CASES.map((c) => c.slug)])].sort();
}

export const caseDir = (slug: string) => path.join(CASES_DIR, slug);
export const inputPath = (slug: string) => path.join(caseDir(slug), "input.json");

export function readInput(slug: string): RenderFixture {
  if (!existsSync(inputPath(slug))) throw new Error(`cases/${slug}/input.json is missing. Run: npm run golden:update`);
  return parseRenderFixture(readFileSync(inputPath(slug), "utf8"));
}

/** The text a hand-built case's input.json must hold. */
export function focusedInputText(slug: string): string | null {
  const focused = FOCUSED_CASES.find((c) => c.slug === slug);
  return focused ? json(focused.input) : null;
}
