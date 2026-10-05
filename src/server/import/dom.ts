import { Window } from "happy-dom";

// A DOM on the server for the .docx import: happy-dom parses mammoth's HTML so the editor's
// `normalizePastedHtml` can clean it, and so the Compare view gets an allowlisted copy. One Window
// per conversion, always closed afterwards. Scripts never run (happy-dom's default), and no file,
// image, stylesheet or page is ever loaded.

export type ParseHtml = (html: string) => Document;

/** Runs `fn` with a parser bound to a fresh Window, then closes the Window. */
export async function withDom<T>(fn: (parse: ParseHtml) => T | Promise<T>): Promise<T> {
  const window = new Window({
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
        disableFallbackToSetURL: true,
      },
    },
  });
  try {
    const parser = new window.DOMParser();
    // happy-dom's Document is shaped like lib.dom's; the editor's normalizer is written against lib.dom.
    return await fn((html) => parser.parseFromString(html, "text/html") as unknown as Document);
  } finally {
    await window.happyDOM.close();
  }
}

// ── What mammoth adds that the import leaves out ─────────────────────────────

const COMMENT_ID = /^comment-\d+$/;
const NOTE_ID = /^(?:footnote|endnote)-\d+$/;
const REF_HREF = /^#(?:comment|footnote|endnote)-\d+$/;

/**
 * Removes mammoth's comment and footnote/endnote lists and the reference marks pointing at them,
 * and says how many there were.
 */
export function stripNotes(root: Element): { comments: number; footnotes: number } {
  const comments = [...root.querySelectorAll("[id]")].filter((el) => COMMENT_ID.test(el.id) && el.tagName === "DT");
  const notes = [...root.querySelectorAll("li[id]")].filter((el) => NOTE_ID.test(el.id));

  for (const link of [...root.querySelectorAll("a[href]")]) {
    if (!REF_HREF.test(link.getAttribute("href") ?? "")) continue;
    const parent = link.parentElement;
    const holder = parent && parent.tagName === "SUP" && parent.textContent?.trim() === link.textContent?.trim() ? parent : link;
    holder.remove();
  }
  for (const dt of comments) dt.closest("dl")?.remove();
  for (const li of notes) li.closest("ol, ul")?.remove();
  return { comments: comments.length, footnotes: notes.length };
}

// ── The Compare view's allowlisted HTML ──────────────────────────────────────

const KEEP = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "u"]);
const RENAME: Record<string, string> = { h4: "h3", h5: "h3", h6: "h3", b: "strong", i: "em" };
const DROP = new Set([
  "head", "style", "script", "noscript", "template", "meta", "link", "title", "iframe", "object", "embed",
  "svg", "math", "video", "audio", "canvas", "form", "input", "button", "select", "textarea",
]);
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
const SAFE_HREF = /^(?:https?:|mailto:)/i;

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/**
 * The element's content as allowlisted HTML: p, h1–h3, ul/ol/li, table/thead/tbody/tr/th/td,
 * strong/em/u, a (http, https and mailto only), br, and img with a data: src while the image budget
 * lasts (decoded bytes). Everything else is unwrapped or dropped; no other attribute survives
 * (cells keep colspan and rowspan).
 */
export function allowlistHtml(root: Element, maxImageBytes: number): string {
  let budget = maxImageBytes;

  const walk = (node: Node): string => {
    if (node.nodeType === 3) return escapeText(node.textContent ?? "");
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const raw = el.tagName.toLowerCase();
    if (DROP.has(raw)) return "";
    const tag = RENAME[raw] ?? raw;
    if (tag === "br") return "<br>";
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      const bytes = Math.floor(((src.length - src.indexOf(",") - 1) * 3) / 4);
      if (!DATA_IMAGE.test(src) || bytes > budget) return "";
      budget -= bytes;
      return `<img src="${src}" alt="${escapeAttr(el.getAttribute("alt") ?? "")}">`;
    }
    const inner = [...el.childNodes].map(walk).join("");
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      return SAFE_HREF.test(href) ? `<a href="${escapeAttr(href)}" rel="noopener noreferrer">${inner}</a>` : inner;
    }
    if (!KEEP.has(tag)) return inner;
    let attrs = "";
    if (tag === "td" || tag === "th") {
      for (const name of ["colspan", "rowspan"]) {
        const value = el.getAttribute(name);
        if (value && /^\d{1,3}$/.test(value)) attrs += ` ${name}="${value}"`;
      }
    }
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };

  return [...root.childNodes].map(walk).join("");
}
