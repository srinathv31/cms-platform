// How a textblock (paragraph, heading) differs: a word diff of the inline content. Tokens are words, runs
// of whitespace and runs of punctuation ("1,000" and "isn't" are one word); a variable chip is one
// token; marks are part of a token, so bolding a word deletes the plain run and inserts the bold
// one. Deleted runs go back in place with a `delete` RedlineMark, new runs get `insert`, adjacent
// runs with the same marks merge, and a hunk's deletions come before its insertions.

import type { JSONContent } from "../types";
import type { Cx, Diffed } from "./context";
import { marksKey, nodeKey, withContent, redline, withMark, type RedlineOp } from "./nodes";
import { TOKEN, WORDISH } from "./similarity";

interface Token {
  /** Interned identity: text and marks, or the whole inline node (a chip, a break). */
  id: number;
  /** Text tokens: the text. Null for an inline node. */
  text: string | null;
  marks: JSONContent["marks"];
  marksKey: string;
  /** Inline node tokens: the node. */
  node: JSONContent | null;
  /** Holds a letter, digit or chip (not just whitespace or punctuation). */
  word: boolean;
}

const EQUAL = 0;
const DELETE = 1;
const INSERT = 2;

interface Step {
  op: typeof EQUAL | typeof DELETE | typeof INSERT;
  /** The base token (EQUAL, DELETE). */
  from: Token | null;
  /** The next token (EQUAL, INSERT). */
  to: Token | null;
}

/** Past this many LCS cells (about a 1,400-token paragraph rewritten whole), mark the middle replaced. */
const MAX_LCS_CELLS = 1 << 21;

export function diffTextblock(cx: Cx, base: JSONContent, next: JSONContent): Diffed {
  const ids = new Map<string, number>();
  const intern = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const steps = diffTokens(tokenize(cx, base.content, intern), tokenize(cx, next.content, intern));
  if (steps.every((s) => s.op === EQUAL)) return { node: next, changed: false };
  return { node: withContent(next, buildInline(tidy(steps))), changed: true };
}

function tokenize(cx: Cx, content: JSONContent[] | undefined, intern: (key: string) => number): Token[] {
  const out: Token[] = [];
  for (const child of content ?? []) {
    if (child.type === "text" && typeof child.text === "string") {
      const mk = marksKey(child.marks);
      for (const piece of child.text.match(TOKEN) ?? []) {
        out.push({
          id: intern(`t${mk}\u0000${piece}`),
          text: piece,
          marks: child.marks,
          marksKey: mk,
          node: null,
          word: WORDISH.test(piece),
        });
      }
    } else {
      out.push({ id: intern(`n${nodeKey(cx, child)}`), text: null, marks: child.marks, marksKey: "", node: child, word: true });
    }
  }
  return out;
}

/** A shortest edit script: common prefix and suffix, then an LCS of the middle. */
function diffTokens(a: readonly Token[], b: readonly Token[]): Step[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].id === b[pre].id) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf].id === b[b.length - 1 - suf].id) suf++;

  const steps: Step[] = [];
  for (let k = 0; k < pre; k++) steps.push({ op: EQUAL, from: a[k], to: b[k] });
  lcsSteps(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf), steps);
  for (let k = suf; k > 0; k--) steps.push({ op: EQUAL, from: a[a.length - k], to: b[b.length - k] });
  return steps;
}

function lcsSteps(a: readonly Token[], b: readonly Token[], out: Step[]) {
  const m = a.length;
  const n = b.length;
  let i = 0;
  let j = 0;
  if (m > 0 && n > 0 && m * n <= MAX_LCS_CELLS) {
    // L[i][j]: LCS length of a[i..] and b[j..].
    const w = n + 1;
    const L = new Uint32Array((m + 1) * w);
    for (let x = m - 1; x >= 0; x--) {
      for (let y = n - 1; y >= 0; y--) {
        L[x * w + y] = a[x].id === b[y].id ? L[(x + 1) * w + y + 1] + 1 : Math.max(L[(x + 1) * w + y], L[x * w + y + 1]);
      }
    }
    while (i < m && j < n) {
      if (a[i].id === b[j].id) out.push({ op: EQUAL, from: a[i++], to: b[j++] });
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) out.push({ op: DELETE, from: a[i++], to: null });
      else out.push({ op: INSERT, from: null, to: b[j++] });
    }
  }
  while (i < m) out.push({ op: DELETE, from: a[i++], to: null });
  while (j < n) out.push({ op: INSERT, from: null, to: b[j++] });
}

/**
 * Readability: a stretch of only whitespace or punctuation kept between two changes joins them
 * ("[-a b-]{+x y+}", not "[-a-]{+x+} [-b-]{+y+}"), and each change lists its deletions first.
 */
function tidy(steps: readonly Step[]): Step[] {
  const runs: { equal: boolean; steps: Step[] }[] = [];
  for (const step of steps) {
    const equal = step.op === EQUAL;
    const last = runs[runs.length - 1];
    if (last && last.equal === equal) last.steps.push(step);
    else runs.push({ equal, steps: [step] });
  }
  for (let r = 1; r < runs.length - 1; r++) {
    const run = runs[r];
    if (!run.equal || runs[r - 1].equal || runs[r + 1].equal || run.steps.some((s) => s.to!.word)) continue;
    runs[r] = {
      equal: false,
      steps: [
        ...run.steps.map((s): Step => ({ op: DELETE, from: s.from, to: null })),
        ...run.steps.map((s): Step => ({ op: INSERT, from: null, to: s.to })),
      ],
    };
  }
  const out: Step[] = [];
  let deletes: Step[] = [];
  let inserts: Step[] = [];
  const flush = () => {
    out.push(...deletes, ...inserts);
    deletes = [];
    inserts = [];
  };
  for (const run of runs) {
    if (run.equal) {
      flush();
      out.push(...run.steps);
    } else {
      for (const s of run.steps) (s.op === DELETE ? deletes : inserts).push(s);
    }
  }
  flush();
  return out;
}

/** Inline nodes from the steps: deleted runs back in place, adjacent runs with the same marks merged. */
function buildInline(steps: readonly Step[]): JSONContent[] {
  const out: JSONContent[] = [];
  let pending: { text: string; marks: JSONContent["marks"]; signature: string } | null = null;
  const flush = () => {
    if (pending) out.push(pending.marks?.length ? { type: "text", text: pending.text, marks: pending.marks } : { type: "text", text: pending.text });
    pending = null;
  };
  for (const step of steps) {
    const token = (step.op === DELETE ? step.from : step.to)!;
    const op: RedlineOp | null = step.op === DELETE ? "delete" : step.op === INSERT ? "insert" : null;
    if (token.text !== null) {
      const signature = `${token.marksKey}|${op ?? ""}`;
      if (pending && pending.signature === signature) {
        pending.text += token.text;
      } else {
        flush();
        pending = { text: token.text, marks: op ? [...(token.marks ?? []), redline(op)] : token.marks, signature };
      }
    } else {
      flush();
      out.push(op ? withMark(token.node!, op) : token.node!);
    }
  }
  flush();
  return out;
}
