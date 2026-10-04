// Clipboard HTML (Word for Windows and Mac, Google Docs, web pages) → the small HTML the editor's
// schema understands: p, h1–h3, ul/ol/li, table/tr/th/td, strong/em/u, a[href], br, hr, plus our
// own chips (span[data-variable]) and callouts (div[data-callout]).
//
// Pure DOM: runs in the browser and, given a DOMParser (happy-dom), on the server, so the .docx
// import can reuse it.
//
// Word: drops <o:p>, mso-* styles, classes, spans, fonts, conditional comments and the
// StartFragment markers; turns its fake lists (MsoListParagraph* + `mso-list:lN levelM lfoK`, with
// the bullet or number in a supportLists span) into real nested ul/ol; keeps Heading 1–3 (h4–h6
// become h3), tables (header rows when marked: thead, th or Word's repeated heading rows) and
// bold/italic/underline whether they're tags or inline styles. Google Docs: unwraps its
// `<b id="docs-internal-guid-…" style="font-weight:normal">` wrapper.
// Everything else (colors, fonts, sizes, line heights, images, empty `&nbsp;` paragraphs) goes.
// HTML copied from a ProseMirror editor (data-pm-slice) is passed through untouched.

export interface NormalizeHtmlOptions {
  /** Parses an HTML string into a Document. Default: the global DOMParser (browser, happy-dom). */
  parse?: (html: string) => Document;
}

const PM_SLICE = /data-pm-slice/;
const WORD = /urn:schemas-microsoft-com:office|class="?Mso|mso-[a-z-]+:/i;

/** Elements whose content is never wanted. */
const DROP = new Set([
  "head", "style", "script", "noscript", "template", "meta", "link", "title", "xml",
  "img", "picture", "svg", "video", "audio", "iframe", "object", "embed", "canvas",
  "input", "button", "select", "textarea", "form", "map", "area",
]);

/** Inline wrappers whose children are kept (marks come from their style). */
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "tr", "td", "th", "div", "section", "article", "main", "header", "footer", "aside", "blockquote", "center", "figure", "dl", "dt", "dd", "pre", "address", "hr", "body"]);

const HEADING_CLASS: Record<string, string> = { msotitle: "h1", msoheading1: "h1", msoheading2: "h2", msoheading3: "h3" };

export function normalizePastedHtml(html: string, options: NormalizeHtmlOptions = {}): string {
  if (!html || PM_SLICE.test(html)) return html;
  const doc = (options.parse ?? parseWithDomParser)(html);
  const body = doc.body;
  if (!body) return html;

  if (WORD.test(html)) convertWordLists(body);
  stripListMarkers(body); // numbered headings and any marker left outside a list

  const out = doc.createElement("div");
  cleanChildren(body, out, doc);
  unwrapLinkUnderlines(out);
  pruneEmpty(out);
  return out.innerHTML;
}

function parseWithDomParser(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

// ── Styles ───────────────────────────────────────────────────────

function styleOf(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (el.getAttribute("style") ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim().toLowerCase());
  }
  return map;
}

function isBoldWeight(value: string | undefined): boolean | null {
  if (!value) return null;
  if (value === "bold" || value === "bolder") return true;
  if (value === "normal" || value === "lighter") return false;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n >= 600 : null;
}

interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function marksFromStyle(el: Element): Marks {
  const style = styleOf(el);
  return {
    bold: isBoldWeight(style.get("font-weight")) === true,
    italic: style.get("font-style") === "italic",
    underline: /underline/.test(style.get("text-decoration") ?? style.get("text-decoration-line") ?? ""),
  };
}

// ── Building the clean tree ──────────────────────────────────────

function cleanChildren(src: Node, dest: Element, doc: Document) {
  let skippingMarker = false;
  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === 8) {
      const data = (child as Comment).data.trim();
      if (data === "[if !supportLists]") skippingMarker = true;
      else if (data === "[endif]") skippingMarker = false;
      continue;
    }
    if (skippingMarker) continue;
    cleanInto(child, dest, doc);
  }
}

function cleanInto(node: Node, dest: Element, doc: Document) {
  if (node.nodeType === 3) {
    dest.appendChild(doc.createTextNode((node as Text).data));
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.localName.toLowerCase();

  if (DROP.has(tag)) return;
  if (tag.includes(":")) {
    // Office namespaces: <o:p> holds text (or a lone &nbsp;); <v:shape>, <w:…>, <m:…> don't.
    if (tag === "o:p" && hasText(el)) cleanChildren(el, dest, doc);
    return;
  }
  if (tag === "br") {
    if (!el.classList.contains("Apple-interchange-newline")) dest.appendChild(doc.createElement("br"));
    return;
  }
  if (tag === "hr") {
    dest.appendChild(doc.createElement("hr"));
    return;
  }

  // Our own markup (copied out of a static render): keep it as is.
  if (tag === "span" && el.hasAttribute("data-variable")) {
    const chip = doc.createElement("span");
    chip.setAttribute("data-variable", el.getAttribute("data-variable") ?? "");
    chip.textContent = el.textContent;
    dest.appendChild(chip);
    return;
  }
  if (tag === "div" && el.hasAttribute("data-callout")) {
    const callout = doc.createElement("div");
    callout.setAttribute("data-callout", "");
    cleanChildren(el, callout, doc);
    dest.appendChild(callout);
    return;
  }

  switch (tag) {
    case "p": {
      const cls = (el.getAttribute("class") ?? "").toLowerCase();
      appendBlock(el, dest, doc, HEADING_CLASS[cls] ?? "p");
      return;
    }
    case "h1":
    case "h2":
    case "h3":
      appendBlock(el, dest, doc, tag);
      return;
    case "h4":
    case "h5":
    case "h6":
      appendBlock(el, dest, doc, "h3");
      return;
    case "ul":
    case "ol":
    case "li":
      appendBlock(el, dest, doc, tag);
      return;
    case "table":
      appendTable(el, dest, doc);
      return;
    case "a": {
      const href = el.getAttribute("href")?.trim() ?? "";
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        const a = doc.createElement("a");
        a.setAttribute("href", href);
        appendInline(el, a, dest, doc);
      } else {
        appendInline(el, null, dest, doc);
      }
      return;
    }
    case "b":
    case "strong": {
      // Google Docs wraps the whole clipboard in <b style="font-weight:normal">.
      const weight = isBoldWeight(styleOf(el).get("font-weight"));
      appendInline(el, weight === false ? null : doc.createElement("strong"), dest, doc);
      return;
    }
    case "i":
    case "em":
      appendInline(el, styleOf(el).get("font-style") === "normal" ? null : doc.createElement("em"), dest, doc);
      return;
    case "u":
    case "ins":
      appendInline(el, doc.createElement("u"), dest, doc);
      return;
  }

  if (BLOCKS.has(tag)) {
    // A container: unwrap it, or make it a paragraph when it only holds inline content.
    if (hasBlockChild(el)) cleanChildren(el, dest, doc);
    else appendBlock(el, dest, doc, "p");
    return;
  }

  // Any other inline element (span, font, sub, sup, small, code…): its children, with its marks.
  appendInline(el, null, dest, doc);
}

function appendBlock(el: Element, dest: Element, doc: Document, tag: string) {
  const block = doc.createElement(tag);
  const marks = tag === "p" || tag === "li" ? marksFromStyle(el) : { bold: false, italic: false, underline: false };
  cleanChildren(el, wrapMarks(block, marks, doc), doc);
  dest.appendChild(block);
}

/** `wrapper` (or nothing) plus any marks from the element's style, around its cleaned children. */
function appendInline(el: Element, wrapper: Element | null, dest: Element, doc: Document) {
  const marks = marksFromStyle(el);
  if (wrapper?.localName === "strong") marks.bold = false;
  if (wrapper?.localName === "em") marks.italic = false;
  if (wrapper?.localName === "u") marks.underline = false;
  let target = dest;
  if (wrapper) {
    dest.appendChild(wrapper);
    target = wrapper;
  }
  cleanChildren(el, wrapMarks(target, marks, doc), doc);
}

/** Nests strong > em > u inside `target` for the marks set, returning the innermost element. */
function wrapMarks(target: Element, marks: Marks, doc: Document): Element {
  let inner = target;
  for (const [on, tag] of [
    [marks.bold, "strong"],
    [marks.italic, "em"],
    [marks.underline, "u"],
  ] as const) {
    if (!on) continue;
    const wrap = doc.createElement(tag);
    inner.appendChild(wrap);
    inner = wrap;
  }
  return inner;
}

function hasBlockChild(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.localName.toLowerCase();
    if (BLOCKS.has(tag) || tag === "table") return true;
  }
  return false;
}

function hasText(el: Element): boolean {
  return (el.textContent ?? "").replace(/[\s ]+/g, "") !== "";
}

// ── Tables ───────────────────────────────────────────────────────

function appendTable(el: Element, dest: Element, doc: Document) {
  const table = doc.createElement("table");
  const rows = Array.from(el.querySelectorAll("tr")).filter((tr) => tr.closest("table") === el);
  // Word marks repeated heading rows; the last of them carries mso-yfti-lastfirstrow.
  const lastHeaderRow = rows.findIndex((tr) => styleOf(tr).get("mso-yfti-lastfirstrow") === "yes");
  rows.forEach((tr, index) => {
    const header = tr.parentElement?.localName.toLowerCase() === "thead" || index <= lastHeaderRow;
    const row = doc.createElement("tr");
    for (const cell of Array.from(tr.children)) {
      const cellTag = cell.localName.toLowerCase();
      if (cellTag !== "td" && cellTag !== "th") continue;
      const out = doc.createElement(header || cellTag === "th" ? "th" : "td");
      for (const attr of ["colspan", "rowspan"]) {
        const value = cell.getAttribute(attr);
        if (value && value !== "1") out.setAttribute(attr, value);
      }
      cleanChildren(cell, out, doc);
      row.appendChild(out);
    }
    if (row.childNodes.length) table.appendChild(row);
  });
  if (table.childNodes.length) dest.appendChild(table);
}

// ── Pruning ──────────────────────────────────────────────────────

/** Links come underlined by their source's styling (Google Docs, web pages); the editor styles links itself. */
function unwrapLinkUnderlines(root: Element) {
  for (const u of Array.from(root.querySelectorAll("a u, u:has(> a)"))) {
    const onlyLink = u.localName === "u" && !u.closest("a") && (u.textContent ?? "") === (u.querySelector("a")?.textContent ?? "");
    if (u.closest("a") || onlyLink) u.replaceWith(...Array.from(u.childNodes));
  }
}

/** Removes paragraphs and headings with nothing in them (Word's `<o:p>&nbsp;</o:p>` lines). */
function pruneEmpty(root: Element) {
  for (const block of Array.from(root.querySelectorAll("p, h1, h2, h3"))) {
    if (hasText(block) || block.querySelector("br, span[data-variable]")) continue;
    block.remove();
  }
  // A cell or list item left with only whitespace stays (the schema fills it with a line).
}

// ── Word's lists ─────────────────────────────────────────────────

const LIST_STYLE = /mso-list:\s*l(\d+)\s+level(\d+)/i;
const ORDERED_MARKER = /^\(?(\d+|[a-z]{1,5})[.)]$/i;

interface ListLine {
  el: Element;
  id: string;
  level: number;
}

function listLine(el: Element): ListLine | null {
  if (el.localName.toLowerCase() !== "p") return null;
  const match = LIST_STYLE.exec(el.getAttribute("style") ?? "");
  return match ? { el, id: match[1], level: Number(match[2]) } : null;
}

function convertWordLists(root: Element) {
  const parents = new Set<Element>();
  for (const p of Array.from(root.querySelectorAll("p"))) {
    if (listLine(p) && p.parentElement) parents.add(p.parentElement);
  }
  for (const parent of parents) groupLists(parent);
}

/** Replaces each run of consecutive list paragraphs (same list id) with a nested ul/ol. */
function groupLists(parent: Element) {
  let run: ListLine[] = [];
  const flush = () => {
    if (!run.length) return;
    parent.insertBefore(buildList(run, parent.ownerDocument), run[0].el);
    for (const line of run) line.el.remove();
    run = [];
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 8 || (child.nodeType === 3 && !(child as Text).data.trim())) continue;
    const line = child.nodeType === 1 ? listLine(child as Element) : null;
    if (line && run.length && run[0].id !== line.id) flush();
    if (line) run.push(line);
    else flush();
  }
  flush();
}

function buildList(run: ListLine[], doc: Document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const stack: Element[] = [];
  for (const line of run) {
    const marker = takeMarker(line.el);
    const tag = ORDERED_MARKER.test(marker) ? "ol" : "ul";
    const level = Math.min(Math.max(line.level, 1), stack.length + 1);
    while (stack.length > level) stack.pop();

    if (stack.length === level && stack[level - 1].localName !== tag) {
      // Same depth, other kind: a sibling list of the right kind.
      const sibling = doc.createElement(tag);
      stack[level - 1].after(sibling);
      stack[level - 1] = sibling;
    } else if (stack.length < level) {
      const list = doc.createElement(tag);
      if (level === 1) {
        fragment.appendChild(list);
      } else {
        const parentList = stack[level - 2];
        let item = parentList.lastElementChild;
        if (!item) {
          item = doc.createElement("li");
          parentList.appendChild(item);
        }
        item.appendChild(list);
      }
      stack.push(list);
    }

    const item = doc.createElement("li");
    const paragraph = doc.createElement("p");
    // Keep the line's own style for its inline marks (a bold list line).
    const style = line.el.getAttribute("style");
    if (style) paragraph.setAttribute("style", style.replace(LIST_STYLE, ""));
    while (line.el.firstChild) paragraph.appendChild(line.el.firstChild);
    item.appendChild(paragraph);
    stack[level - 1].appendChild(item);
  }
  return fragment;
}

/** Removes the bullet or number Word renders before a list line, and returns its text. */
function takeMarker(el: Element): string {
  let marker = "";
  // <![if !supportLists]> … <![endif]> (Windows; parsed as comments) or <!--[if …]--> (Mac).
  const start = findComment(el, "[if !supportLists]");
  if (start) {
    let node = start.nextSibling;
    while (node && !(node.nodeType === 8 && (node as Comment).data.trim() === "[endif]")) {
      const next = node.nextSibling;
      marker += node.textContent ?? "";
      node.parentNode?.removeChild(node);
      node = next;
    }
    node?.parentNode?.removeChild(node);
    start.parentNode?.removeChild(start);
  } else {
    const ignore = Array.from(el.querySelectorAll("span")).find((span) => styleOf(span).get("mso-list") === "ignore");
    if (ignore) {
      marker = ignore.textContent ?? "";
      ignore.remove();
    }
  }
  return marker.replace(/[\s ]+/g, "");
}

function findComment(root: Node, data: string): Comment | null {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 8 && (child as Comment).data.trim() === data) return child as Comment;
    if (child.nodeType === 1) {
      const found = findComment(child, data);
      if (found) return found;
    }
  }
  return null;
}

/** Word list markers outside a converted list (a numbered heading): just drop them. */
function stripListMarkers(root: Element) {
  for (const span of Array.from(root.querySelectorAll("span"))) {
    if (styleOf(span).get("mso-list") === "ignore") span.remove();
  }
}
