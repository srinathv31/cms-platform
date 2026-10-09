// Keeps the docs true to the tree. Fails when:
//   - a Markdown link points at a file, or a heading in a Markdown file, that doesn't exist;
//   - a doc names a repo path in backticks (`src/…`, `@/…`, `docs/…`, `e2e/…`, `scripts/…`) that doesn't exist;
//   - a code comment points at a docs/ file that doesn't exist;
//   - a folder directly under src/ has no README.md.
// docs/archive is history and isn't checked; links into it are. Run with `npm run docs:check`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();

// Not ours to keep current: archived build-process docs, vendored agent skills, and agent worktrees.
const SKIP = ["docs/archive/", ".agents/", ".claude/"];

// Folders under src/ small enough to be covered by a neighbouring README (src/components/README.md).
const NO_README = new Set(["hooks", "lib", "styles"]);

// A backticked path is checked when it starts with one of these. Anything with a glob or placeholder is skipped.
const PATH_PREFIX = /^(?:(?:src|docs|e2e|scripts)\/|@\/)/;
const NOT_A_PATH = /[*…<>{}$|\s]/;
// How a path written without its extension (or as a folder import) can resolve.
const RESOLVE_AS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".css", ".json", "/index.ts", "/index.tsx"];

const CODE_FILE = /\.(?:ts|tsx|mts|mjs|js|cjs)$/;
const DOCS_REF_IN_CODE = /(?<![\w/.-])docs\/[\w./()-]*\.md/g;

// One level of balanced parentheses in the destination, for route groups such as `app/(product)/page.tsx`.
const INLINE_LINK = /!?\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*(<[^>]*>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;
const CODE_SPAN = /`([^`\n]+)`/g;

interface Problem {
  file: string;
  line: number;
  message: string;
}

const problems: Problem[] = [];
const counts = { docs: 0, links: 0, paths: 0, codeRefs: 0, readmes: 0 };

function report(file: string, line: number, message: string) {
  problems.push({ file: relative(ROOT, file), line, message });
}

// Every file git would commit (tracked, or untracked and not ignored), and every folder that holds one. Paths are
// checked against this rather than the disk, so a gitignored local file can't make the check pass on one machine
// and fail on another.
const files = new Set(
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((path) => path && existsSync(join(ROOT, path))),
);
const folders = new Set<string>();
for (const path of files) {
  for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
    folders.add(path.slice(0, slash));
  }
}

function exists(absolute: string): boolean {
  const path = relative(ROOT, absolute).replace(/\/$/, "");
  return files.has(path) || folders.has(path);
}

// Yields the lines outside fenced code blocks, with their 1-based line numbers.
function* proseLines(text: string): Generator<[number, string]> {
  let fence: { char: string; length: number } | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (marker) {
      const char = marker[1][0];
      const length = marker[1].length;
      if (!fence) fence = { char, length };
      else if (char === fence.char && length >= fence.length) fence = null;
      continue;
    }
    if (!fence) yield [i + 1, lines[i]];
  }
}

// GitHub's heading ids: the rendered text, lowercased, with punctuation dropped and spaces as hyphens.
function slug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

const anchorCache = new Map<string, Set<string>>();

function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const [, line] of proseLines(readFileSync(file, "utf8"))) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const base = slug(heading[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const html of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(html[1]);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

function resolves(absolute: string): boolean {
  return RESOLVE_AS.some((suffix) => exists(absolute + suffix));
}

function checkLink(from: string, line: number, raw: string) {
  const target = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) return; // URLs and mailto:
  counts.links++;
  const hash = target.indexOf("#");
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? "" : decodeURIComponent(target.slice(hash + 1));
  const file =
    pathPart === ""
      ? from
      : pathPart.startsWith("/")
        ? join(ROOT, decodeURI(pathPart))
        : resolve(dirname(from), decodeURI(pathPart));
  if (!exists(file)) {
    report(from, line, `link to ${target}: no such file`);
    return;
  }
  if (fragment && file.endsWith(".md") && !anchorsOf(file).has(fragment)) {
    report(from, line, `link to ${target}: no heading with id "${fragment}"`);
  }
}

function checkPath(from: string, line: number, raw: string) {
  if (!PATH_PREFIX.test(raw) || NOT_A_PATH.test(raw)) return;
  counts.paths++;
  const path = raw
    .replace(/^@\//, "src/")
    .replace(/:\d+(?:-\d+)?$/, "")
    .replace(/#.*$/, "");
  if (!resolves(join(ROOT, path))) report(from, line, `\`${raw}\` doesn't exist`);
}

function checkMarkdown(file: string) {
  counts.docs++;
  for (const [n, line] of proseLines(readFileSync(file, "utf8"))) {
    for (const span of line.matchAll(CODE_SPAN)) checkPath(file, n, span[1].trim());
    const prose = line.replace(CODE_SPAN, "``"); // a link inside a code span isn't a link
    for (const link of prose.matchAll(INLINE_LINK)) checkLink(file, n, link[1]);
    const definition = REFERENCE_DEFINITION.exec(prose);
    if (definition) checkLink(file, n, definition[1]);
  }
}

function checkCodeComments(file: string) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const ref of line.matchAll(DOCS_REF_IN_CODE)) {
      counts.codeRefs++;
      if (!exists(join(ROOT, ref[0]))) report(file, i + 1, `points at ${ref[0]}, which doesn't exist`);
    }
  });
}

function checkLayerReadmes() {
  const src = join(ROOT, "src");
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory() || NO_README.has(entry.name)) continue;
    counts.readmes++;
    const readme = join(src, entry.name, "README.md");
    if (!exists(readme)) report(readme, 0, "missing: every folder directly under src/ needs a README");
  }
}

function main() {
  for (const path of files) {
    if (SKIP.some((prefix) => path.startsWith(prefix))) continue;
    const file = join(ROOT, path);
    if (path.endsWith(".md")) checkMarkdown(file);
    else if (CODE_FILE.test(path)) checkCodeComments(file);
  }
  checkLayerReadmes();

  if (problems.length > 0) {
    console.error(`docs:check found ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
    for (const p of problems) console.error(`  ${p.file}${p.line ? `:${p.line}` : ""}  ${p.message}`);
    process.exit(1);
  }
  console.log(
    `docs:check: ${counts.docs} Markdown files, ${counts.links} links, ${counts.paths} paths, ` +
      `${counts.codeRefs} docs references in code, ${counts.readmes} layer READMEs. All good.`,
  );
}

main();
