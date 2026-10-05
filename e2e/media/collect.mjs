// After the gate media run (`playwright test --project=demo --project=stills-1280`, i.e. `npm run gate:media`):
// turns each scenario spec's recording into e2e/__screens__/gate/<spec-name>.mp4, next to its stills.
//
//   node e2e/media/collect.mjs
//
// The stills are already in place: both projects write them to e2e/__screens__/gate/<spec-name>/ as
// <width>-<name>.png (1440 from `demo`, 1280 from `stills-1280`). This lists them and says so if the two
// sizes do not hold the same set.
//
// Playwright keeps one folder per test under test-results/demo/, named for the spec file, the test and
// the project (`scenario-02-scenario-2-create-…-demo`) and holding `video.webm`. The spec name is the
// start of that folder's name. If a spec has more than one test, the last recording wins.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultsDir = path.join(root, "test-results", "demo");
const gateDir = path.join(root, "e2e", "__screens__", "gate");

if (!existsSync(FFMPEG)) {
  console.error(`ffmpeg not found at ${FFMPEG} (set FFMPEG to its path)`);
  process.exit(1);
}
if (!existsSync(resultsDir)) {
  console.error(`No recordings: ${path.relative(root, resultsDir)} does not exist. Run \`npx playwright test --project=demo\` first.`);
  process.exit(1);
}

/** Duration in seconds, read from ffmpeg's banner (it exits non-zero with no output file, which is fine here). */
function duration(file) {
  let banner = "";
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    banner = String(error.stderr ?? "");
  }
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(banner);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

mkdirSync(gateDir, { recursive: true });

// Newest recording per spec.
const recordings = new Map();
for (const entry of readdirSync(resultsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const spec = /^(scenario-\d+)-/.exec(entry.name)?.[1];
  const video = path.join(resultsDir, entry.name, "video.webm");
  if (!spec || !existsSync(video)) continue;
  const mtime = statSync(video).mtimeMs;
  if (!recordings.has(spec) || recordings.get(spec).mtime < mtime) recordings.set(spec, { video, mtime });
}

if (recordings.size === 0) {
  console.error(`No video.webm under ${path.relative(root, resultsDir)}.`);
  process.exit(1);
}

const produced = [];
for (const [spec, { video }] of [...recordings].sort(([a], [b]) => a.localeCompare(b))) {
  const out = path.join(gateDir, `${spec}.mp4`);
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", video, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", "23", out], {
    stdio: "inherit",
  });
  produced.push({ file: out, seconds: duration(out) });
}

// What the gate left behind: the recordings, and every still beside them.
console.log("");
for (const { file, seconds } of produced) {
  console.log(`${path.relative(root, file)}  ${seconds === null ? "?" : seconds.toFixed(1)}s  ${(statSync(file).size / 1e6).toFixed(1)}MB`);
}
let incomplete = false;
for (const entry of readdirSync(gateDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const stills = readdirSync(path.join(gateDir, entry.name)).filter((name) => name.endsWith(".png")).sort();
  for (const still of stills) console.log(path.relative(root, path.join(gateDir, entry.name, still)));
  const bySize = new Map();
  for (const still of stills) {
    const [, width, name] = /^(\d+)-(.+)\.png$/.exec(still) ?? [];
    if (!width) continue;
    bySize.set(width, [...(bySize.get(width) ?? []), name]);
  }
  const names = new Set([...bySize.values()].flat());
  for (const [width, have] of bySize) {
    const missing = [...names].filter((name) => !have.includes(name));
    if (missing.length > 0) {
      incomplete = true;
      console.warn(`${entry.name}: no ${width}-wide still for ${missing.join(", ")}`);
    }
  }
  if (bySize.size < 2) {
    incomplete = true;
    console.warn(`${entry.name}: stills at ${[...bySize.keys()].join(", ") || "no size"} only (did the stills-1280 project run?)`);
  }
}
if (incomplete) process.exitCode = 1;
