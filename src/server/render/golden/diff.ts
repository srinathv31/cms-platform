// Comparing lines: a line diff that prints what differs, the line equality that allows for the marks
// the PDF line breaker leaves, and compareContent, which compares a channel's content (lines and
// links) with the reference. Nothing here knows a channel's format.

import { TABLE_MARK, type Content, type LinkRef } from "./content-text";
import { JOIN_MARK, WRAP_MARK } from "./extract-pdf";

// ── Comparison ───────────────────────────────────────────────────────────────

/**
 * expected equals actual, where actual may carry marks left by the PDF line breaker: WRAP_MARK after
 * a hyphen that ended a line (a real hyphen or an inserted one) and JOIN_MARK where two lines were
 * joined (a space, or nothing when a long URL was cut at a separator).
 */
export function eq(expected: string, actual: string): boolean {
  if (expected.startsWith(TABLE_MARK) !== actual.startsWith(TABLE_MARK))
    return false;
  if (!/[\u0001\u0003]/.test(actual)) return expected === actual;
  const parts = actual.split(/([\u0001\u0003])/);
  let at = 0;
  for (let k = 0; k < parts.length; k += 2) {
    const part = parts[k]!;
    const mark = parts[k + 1];
    if (expected.startsWith(part, at)) {
      at += part.length;
      if (mark === WRAP_MARK && expected[at] === " ") at += 1; // "pre- and": the break fell on the space
    } else if (
      mark === WRAP_MARK &&
      part.endsWith("-") &&
      expected.startsWith(part.slice(0, -1), at)
    ) {
      at += part.length - 1; // an inserted hyphen: not in the source
    } else return false;
    if (mark === JOIN_MARK && expected[at] === " ") at += 1;
  }
  return at === expected.length;
}

export interface Diff {
  ok: boolean;
  /** Unified-style lines: "- expected only", "+ actual only", two spaces for context. */
  lines: string[];
}

export function diffLines(
  expected: readonly string[],
  actual: readonly string[],
  same: (e: string, a: string) => boolean = (e, a) => e === a,
): Diff {
  return diffBy(expected, actual, same, (e) => e);
}

/** diffLines for expected lines of any kind: `same` decides a match, `show` prints an expected line. */
export function diffBy<E>(
  expected: readonly E[],
  actual: readonly string[],
  same: (e: E, a: string) => boolean,
  show: (e: E) => string,
): Diff {
  const n = expected.length;
  const m = actual.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = same(expected[i]!, actual[j]!)
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  let context = ""; // the last line both sides agree on, shown once before a change
  const visible = (s: string) =>
    s.replace(/\u0000/g, "␀").replace(/[\u0001\u0003]/g, "");
  while (i < n || j < m) {
    if (i < n && j < m && same(expected[i]!, actual[j]!)) {
      context = `  ${show(expected[i]!)}`;
      i += 1;
      j += 1;
    } else {
      if (context) {
        out.push(context);
        context = "";
      }
      if (j < m && (i === n || table[i]![j + 1]! >= table[i + 1]![j]!))
        out.push(`+ ${visible(actual[j++]!)}`);
      else out.push(`- ${show(expected[i++]!)}`);
    }
  }
  return { ok: !out.some((l) => l[0] === "-" || l[0] === "+"), lines: out };
}

export interface CompareOptions {
  /** The PDF line breaker's marks may be in the actual text. */
  pdf?: boolean;
}

/** Problems found comparing a channel's content with the reference ([] when they agree). */
export function compareContent(
  channel: string,
  ref: Content,
  got: Content,
  opts: CompareOptions = {},
): string[] {
  const problems: string[] = [];
  const d = diffLines(ref.lines, got.lines, opts.pdf ? eq : undefined);
  if (!d.ok)
    problems.push(
      `${channel}: content differs from the RenderDoc\n${d.lines.map((l) => "    " + l).join("\n")}`,
    );
  const key = (l: LinkRef) => `${l.url}  <-  ${l.text}`;
  const dl = diffLines(
    ref.links.map(key),
    got.links.map(key),
    opts.pdf ? eq : undefined,
  );
  if (!dl.ok)
    problems.push(
      `${channel}: links differ (url <- text)\n${dl.lines.map((l) => "    " + l).join("\n")}`,
    );
  return problems;
}
