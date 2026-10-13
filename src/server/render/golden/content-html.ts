// Reading web and email HTML back into content, with happy-dom: the content text (compared with
// content-text.ts's), the verbatim view (typed spaces and hard breaks as typed) and a check that the
// markup never lets a browser or mail client number a list itself. See the header of content-text.ts
// for what each channel is compared with.

import { Window } from "happy-dom";
import {
  BREAK,
  MARKER,
  NBSP,
  norm,
  segments,
  verbatimLines,
  type Content,
} from "./content-text";
import { diffLines } from "./diff";

const ITEM_LINE = new RegExp(`^${MARKER}(?: |$)`);
const MARKER_ONLY = new RegExp(`^${MARKER}$`);

// ── HTML (web and email) ─────────────────────────────────────────────────────

type K = "text" | "item" | "head" | "blank";
interface L {
  t: string;
  k: K;
  /** Came from inline text before the first block of its container (a list marker, in a list item). */
  lead?: boolean;
}

interface Nd {
  nodeType: number;
  textContent: string | null;
  childNodes: Iterable<Nd>;
}
interface El extends Nd {
  tagName: string;
  parentElement: El | null;
  children: Iterable<El>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): Iterable<El>;
}

let windowSingleton: Window | null = null;
const BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "UL",
  "OL",
  "TABLE",
  "DIV",
  "HR",
  "LI",
  "TR",
  "TD",
  "TH",
  "THEAD",
  "TBODY",
  "SECTION",
  "ARTICLE",
  "MAIN",
]);

const HIDDEN_STYLE =
  /display:\s*none|mso-hide:\s*all|max-height:\s*0(?:px)?\b/i;
const isHidden = (e: El) =>
  HIDDEN_STYLE.test(e.getAttribute("style") ?? "") ||
  ["SVG", "STYLE", "SCRIPT", "HEAD", "TITLE"].includes(e.tagName);

function parseHtml(html: string) {
  windowSingleton ??= new Window();
  return new windowSingleton.DOMParser().parseFromString(html, "text/html");
}

/** The element a channel's content sits in: the first of `roots` (selectors) the page has. */
function contentRoot(html: string, roots: readonly string[]): El {
  const doc = parseHtml(html);
  for (const selector of roots) {
    const found = doc.querySelector(selector) as unknown as El | null;
    if (found) return found;
  }
  throw new Error(`no ${roots.join(" or ")} in the HTML`);
}

/** A node's text, a <br> written as BREAK, hidden elements left out. */
const textOf = (n: Nd): string => {
  if (n.nodeType === 3) return n.textContent ?? "";
  if (n.nodeType !== 1) return "";
  const e = n as El;
  if (e.tagName === "BR") return BREAK;
  if (isHidden(e)) return "";
  return [...e.childNodes].map(textOf).join("");
};

/** The table an element sits in, if any. */
const closestTable = (e: El): El | null => {
  for (let a = e.parentElement; a; a = a.parentElement)
    if (a.tagName === "TABLE") return a;
  return null;
};

export function contentFromHtml(
  html: string,
  roots: readonly string[],
): Content {
  const top = contentRoot(html, roots);

  const isBlock = (n: Nd) =>
    n.nodeType === 1 && BLOCK_TAGS.has((n as El).tagName);
  const isPresentationTable = (e: El) =>
    e.tagName === "TABLE" && e.getAttribute("role") === "presentation";

  /** Content of a container (document, item, cell, callout, wrapper): inline runs become a line, blocks recurse. */
  const flow = (container: El): L[] => {
    const out: L[] = [];
    let inline = "";
    let sawBlock = false;
    const flush = () => {
      const segs = segments(inline);
      // A container whose only content is a no-break space or a break is a blank paragraph written
      // without a <p> (plain whitespace between tags is just markup).
      if (
        segs.length === 0 &&
        !sawBlock &&
        out.length === 0 &&
        (inline.includes(NBSP) || inline.includes(BREAK))
      )
        out.push({ t: "∅", k: "blank" });
      segs.forEach((t, k) =>
        out.push({
          t,
          k: "text",
          lead: !sawBlock && k === 0 ? true : undefined,
        }),
      );
      inline = "";
    };
    for (const n of container.childNodes) {
      if (n.nodeType === 1 && isHidden(n as El)) continue;
      if (!isBlock(n)) {
        inline += textOf(n);
        continue;
      }
      flush();
      sawBlock = true;
      const e = n as El;
      switch (e.tagName) {
        case "P": {
          const segs = segments(textOf(e));
          if (segs.length === 0) out.push({ t: "∅", k: "blank" });
          else segs.forEach((t) => out.push({ t, k: "text" }));
          break;
        }
        case "H1":
        case "H2":
        case "H3": {
          const segs = segments(textOf(e));
          if (segs.length === 0) out.push({ t: "∅", k: "blank" });
          else
            out.push({
              t: `${"#".repeat(Number(e.tagName[1]))} ${segs.join(" ")}`,
              k: "head",
            });
          break;
        }
        case "UL":
        case "OL":
          for (const li of e.children)
            if (li.tagName === "LI") out.push(...item(flow(li)));
          break;
        case "TABLE":
          if (isPresentationTable(e)) out.push(...layoutTable(e));
          else
            for (const tr of rowsOf(e))
              for (const cell of cellsOf(tr)) out.push(...flow(cell));
          break;
        case "TR":
        case "THEAD":
        case "TBODY":
        case "TD":
        case "TH":
        case "DIV":
        case "SECTION":
        case "ARTICLE":
        case "MAIN":
          out.push(...flow(e));
          break;
        default: // HR, LI outside a list
          break;
      }
    }
    flush();
    return out;
  };

  /** An item's lines: the leading inline text is the marker; it joins the first line that follows. */
  const item = (lines: L[]): L[] => {
    const first = lines[0];
    if (first?.lead && MARKER_ONLY.test(first.t)) {
      const next = lines[1];
      if (next && (next.k === "text" || next.k === "head"))
        return [{ t: `${first.t} ${next.t}`, k: "item" }, ...lines.slice(2)];
      if (next?.k === "blank")
        return [{ t: first.t, k: "item" }, ...lines.slice(2)];
      return [{ t: first.t, k: "item" }, ...lines.slice(1)];
    }
    if (first?.lead && ITEM_LINE.test(first.t))
      return [{ ...first, k: "item" }, ...lines.slice(1)];
    return lines;
  };

  /** A table used for layout (email callouts, markers beside text): a row's cells sit side by side. */
  const layoutTable = (table: El): L[] => {
    const out: L[] = [];
    for (const tr of rowsOf(table)) {
      const cells = cellsOf(tr).map((c) => flow(c));
      const [first, second] = cells;
      if (
        cells.length >= 2 &&
        first!.length === 1 &&
        MARKER_ONLY.test(first![0]!.t) &&
        second!.length > 0
      ) {
        out.push(...item([{ ...first![0]!, lead: true }, ...second!]));
        for (const rest of cells.slice(2)) out.push(...rest);
      } else for (const c of cells) out.push(...c);
    }
    return out;
  };
  /** The rows of this table only (not the rows of a table nested in one of its cells). */
  const rowsOf = (table: El): El[] =>
    [...table.querySelectorAll("tr")].filter(
      (tr) => closestTable(tr) === table,
    );
  const cellsOf = (tr: El): El[] =>
    [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");

  const out: Content = { lines: flow(top).map((l) => l.t), links: [] };
  // Consecutive anchors with the same href are one link (the adapters group by href; so does the editor).
  for (const a of top.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (href)
      out.links.push({
        text: norm(textOf(a).split(BREAK).join(" ")),
        url: href,
      });
  }
  return out;
}

/** A browser makes no line of a block's final <br>: the web fills the empty line after a final break with it. */
const collapseFinalBreak = (raw: string) =>
  raw.endsWith(BREAK) ? raw.slice(0, -BREAK.length) : raw;

/**
 * The same view read from the web page or the email HTML: every p, h1–h3, and every table cell that
 * holds inline content itself (the email writes an item's or a cell's only paragraph straight into
 * its <td>), in document order. A list row's marker cell (the first of two cells in an email layout
 * table) is not content.
 */
export function verbatimFromHtml(
  html: string,
  roots: readonly string[],
): string[][] {
  const top = contentRoot(html, roots);
  const isMarkerCell = (td: El) => {
    const cells = [...(td.parentElement?.children ?? [])].filter(
      (c) => c.tagName === "TD" || c.tagName === "TH",
    );
    return (
      closestTable(td)?.getAttribute("role") === "presentation" &&
      cells.length === 2 &&
      cells[0] === td
    );
  };
  const out: string[][] = [];
  const take = (e: El) => {
    const raw = collapseFinalBreak(textOf(e));
    if (segments(raw).length > 0) out.push(verbatimLines(raw));
  };
  const visit = (e: El) => {
    if (isHidden(e)) return;
    if (["P", "H1", "H2", "H3"].includes(e.tagName)) return take(e);
    if (
      (e.tagName === "TD" || e.tagName === "TH") &&
      ![...e.children].some((c) => BLOCK_TAGS.has(c.tagName))
    ) {
      if (!isMarkerCell(e)) take(e);
      return;
    }
    for (const child of e.children) visit(child);
  };
  visit(top);
  return out;
}

const show = (lines: readonly string[]) =>
  lines.map((l) => JSON.stringify(l)).join(" / ");

/** Problems with typed spaces and breaks: [] when both HTML channels keep every line as typed. */
export function verbatimProblems(
  ref: readonly string[][],
  web: readonly string[][],
  email: readonly string[][],
): string[] {
  const problems: string[] = [];
  for (const [channel, got] of [
    ["web", web],
    ["email.html", email],
  ] as const) {
    const d = diffLines(ref.map(show), got.map(show));
    if (!d.ok)
      problems.push(
        `${channel}: typed spaces or hard breaks differ from the RenderDoc\n${d.lines.map((l) => "    " + l).join("\n")}`,
      );
  }
  return problems;
}

// ── Markup that would let a browser or mail client number a list itself ──────

/**
 * Web and email HTML print every marker as text (docs/render-spec.md section 7). A page that also
 * set `start`, `type` or `value` on a list, or a `list-style` other than none, would show a second
 * marker or a different one in some client; a marker hidden from assistive technology would not be
 * read at all. [] when the markup keeps clear of both.
 */
export function listMarkupProblems(channel: string, html: string): string[] {
  const doc = parseHtml(html);
  const problems: string[] = [];
  for (const list of doc.querySelectorAll(
    "ol, ul",
  ) as unknown as Iterable<El>) {
    for (const attr of ["start", "type", "reversed"]) {
      if (list.getAttribute(attr) !== null)
        problems.push(
          `${channel}: <${list.tagName.toLowerCase()}> has a ${attr} attribute, so a client may number the list itself`,
        );
    }
  }
  for (const li of doc.querySelectorAll("li") as unknown as Iterable<El>) {
    if (li.getAttribute("value") !== null)
      problems.push(
        `${channel}: <li> has a value attribute, so a client may number the item itself`,
      );
  }
  for (const m of html.matchAll(/list-style(?:-type)?\s*:\s*([^;"'}]+)/gi)) {
    if (m[1]!.trim().toLowerCase() !== "none")
      problems.push(
        `${channel}: list-style: ${m[1]!.trim()} lets a client number a list itself`,
      );
  }
  for (const hidden of doc.querySelectorAll(
    "[aria-hidden]",
  ) as unknown as Iterable<El>) {
    if (
      hidden.getAttribute("aria-hidden") === "true" &&
      new RegExp(`^${MARKER}$`).test(norm(hidden.textContent ?? ""))
    ) {
      problems.push(
        `${channel}: the marker ${JSON.stringify(norm(hidden.textContent ?? ""))} is hidden from assistive technology`,
      );
    }
  }
  return problems;
}
