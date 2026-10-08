// The golden files: for each case in cases/, input.json goes through the engine and every artifact is
// compared with the file on disk.
//
//   expected/  engine-neutral; the Java engine must produce these (see docs/render-spec.md section 13)
//   node/      what depends on the Node PDF engine's fonts and layout
//
// `npm run golden:update` rewrites them (GOLDEN_UPDATE=1); without it a missing file, an extra file or
// a difference fails, in CI and locally. Whether the channels agree with one another is NOT decided
// here: parity.test.ts asserts that, and -u cannot approve it.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { UPDATING, caseDir, caseSlugs, focusedInputText, inputPath, readInput } from "./files";
import { expectedFiles, nodeFiles, runCase, type CaseRun } from "./pipeline";

const HINT = "Run: npm run golden:update";

const listFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

/**
 * Compares `files` (name -> text) with the folder, or rewrites the folder under GOLDEN_UPDATE=1. A
 * missing file, a file nobody produces any more and a file that differs each fail and name the file.
 * JSON compares as parsed JSON (key order and whitespace do not matter); every other file byte for byte.
 */
function syncFolder(dir: string, files: Record<string, string>, label: string) {
  if (UPDATING) {
    for (const stale of listFiles(dir)) if (!(stale in files)) rmSync(path.join(dir, stale));
    if (Object.keys(files).length > 0) mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    if (existsSync(dir) && listFiles(dir).length === 0) rmSync(dir, { recursive: true });
    return;
  }
  const have = listFiles(dir);
  const want = Object.keys(files).sort();
  expect.soft(want.filter((n) => !have.includes(n)), `${label}: files missing. ${HINT}`).toEqual([]);
  expect.soft(have.filter((n) => !want.includes(n)), `${label}: files the engine no longer produces. ${HINT}`).toEqual([]);
  for (const name of want.filter((n) => have.includes(n))) {
    const onDisk = readFileSync(path.join(dir, name), "utf8");
    const message = `${label}/${name} differs from the engine's output. ${HINT}`;
    if (name.endsWith(".json")) expect.soft(JSON.parse(files[name]!), message).toEqual(JSON.parse(onDisk));
    else expect.soft(files[name], message).toBe(onDisk);
  }
}

describe.each(caseSlugs())("golden %s", (slug) => {
  let run: CaseRun;

  beforeAll(async () => {
    if (UPDATING) {
      const text = focusedInputText(slug);
      if (text !== null) {
        mkdirSync(caseDir(slug), { recursive: true });
        writeFileSync(inputPath(slug), text);
      }
    }
    run = await runCase(readInput(slug));
  }, 60_000);

  it("input.json is the hand-built case", () => {
    const text = focusedInputText(slug);
    if (text === null || UPDATING) return; // frozen cases (golden:import) are the source of truth
    expect(readFileSync(inputPath(slug), "utf8"), `${slug}/input.json differs from focused-cases.ts. ${HINT}`).toBe(text);
  });

  it("expected/ (engine-neutral)", () => {
    syncFolder(path.join(caseDir(slug), "expected"), expectedFiles(run), `${slug}/expected`);
  });

  it("node/ (PDF fonts and layout)", () => {
    syncFolder(path.join(caseDir(slug), "node"), nodeFiles(run), `${slug}/node`);
  });
});
