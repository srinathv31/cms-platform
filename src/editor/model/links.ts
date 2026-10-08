// Links: the one check every link passes, in the editor's link field, paste and import, save
// normalization, the resolver and every channel adapter (and the Java engine). Pure TypeScript.
// docs/render-spec.md ("Links") is the specification; links.test.ts pins it.
//
// Allowed: https://, http://, mailto: and tel: links, with no whitespace and no control or invisible
// characters inside. A link that passes is a link in every channel; a link that doesn't is never a
// link anywhere (the editor's field refuses it with the reason; paste, import and save drop the
// link and keep its text; the resolver and the adapters do the same if one ever reaches them).
//
// What normalization changes (and nothing else):
//   - whitespace and zero-width characters at either end are trimmed (a pasted " https://x.com ");
//   - the text is NFC-normalized;
//   - the scheme is lowercased ("HTTPS://" → "https://");
//   - characters outside ASCII after the host (path, query, fragment) and in mailto: links are
//     percent-encoded as UTF-8 with uppercase hex ("/café" → "/caf%C3%A9"), so the href is the
//     same ASCII string in HTML, in plain text and in a PDF link annotation (PDF URIs are ASCII).
// Normalizing twice gives the same result. The host's case, existing %XX escapes and every other
// ASCII character are kept exactly as written.

export const LINK_SCHEMES = ["https", "http", "mailto", "tel"] as const;
export type LinkScheme = (typeof LINK_SCHEMES)[number];

/** Why a link was refused. Each has a sentence in LINK_MESSAGES for the editor's link field. */
export type LinkRefusal =
  | "empty"
  | "scheme"
  | "space"
  | "invisible"
  | "backslash"
  | "web-address"
  | "web-host"
  | "web-userinfo"
  | "email"
  | "phone";

export const LINK_MESSAGES: Readonly<Record<LinkRefusal, string>> = {
  empty: "Enter a link.",
  scheme: "Links must start with https://, http://, mailto: or tel:.",
  space: "Links can't contain spaces or line breaks.",
  invisible: "Links can't contain invisible or control characters.",
  backslash: "Links can't contain a backslash.",
  "web-address": "Enter a full web address, like https://www.example.com.",
  "web-host": "Write an international site name in its xn-- form.",
  "web-userinfo": "Web links can't have a name or password before the site's address.",
  email: "Enter an email address after mailto:, like mailto:help@example.com.",
  phone: "Enter a phone number after tel:, like tel:+18005550100.",
};

export type LinkCheck =
  | { ok: true; href: string; scheme: LinkScheme }
  | { ok: false; reason: LinkRefusal; message: string };

// ── Character sets (explicit, so the Java port matches code point for code point) ─────────────

/** Whitespace: refused inside a link, trimmed at its ends. */
const WHITESPACE = "\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
/** Zero-width characters the editor shows as nothing: also trimmed at the ends. */
const ZERO_WIDTH = "\\u200B-\\u200D\\u2060\\uFEFF";
/** C0 and C1 control characters. */
const CONTROLS = "\\u0000-\\u001F\\u007F-\\u009F";
/**
 * The invisible characters (docs/render-spec.md section 4): format and default-ignorable characters
 * the editor shows as nothing. Soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul
 * fillers, Khmer inherent vowels, Mongolian variation selectors and vowel separator, zero-width
 * and bidirectional marks, embeddings and overrides, word joiner, invisible operators and
 * isolates, variation selectors, BOM, interlinear annotation and specials, shorthand format
 * controls, musical format controls, tags and variation selectors supplement. The one set: refused
 * inside a link here, removed from text at save (normalize.ts) and again by the resolver, so the
 * editor, the stored document and every channel agree (a PDF font can't draw most of them).
 * A regular-expression character class body, for the `u` flag.
 */
export const INVISIBLE_CHARACTERS =
  "\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180F" +
  "\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFFB" +
  "\\u{1BCA0}-\\u{1BCA3}\\u{1D173}-\\u{1D17A}\\u{E0000}-\\u{E0FFF}";
/** Control and invisible characters: refused inside a link. Lone surrogates are refused too. */
const INVISIBLE = CONTROLS + INVISIBLE_CHARACTERS;

const TRIM_ENDS = new RegExp(`^[${WHITESPACE}${ZERO_WIDTH}]+|[${WHITESPACE}${ZERO_WIDTH}]+$`, "gu");
const HAS_WHITESPACE = new RegExp(`[${WHITESPACE}]`, "u");
const HAS_INVISIBLE = new RegExp(`[${INVISIBLE}]`, "u");
const INVISIBLE_IN_TEXT = new RegExp(`[${INVISIBLE_CHARACTERS}]`, "gu");

/** `text` with every invisible character (INVISIBLE_CHARACTERS) removed. */
export function withoutInvisible(text: string): string {
  return text.replace(INVISIBLE_IN_TEXT, "");
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const LABEL = "[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?";
const REG_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*\\.?$`);
const IPV6 = /^\[[0-9A-Fa-f:.]+\]$/;
const PORT = /^[0-9]{1,5}$/;
const EMAIL = /^[^@,?]+@[^@,?]+$/;
const PHONE = /^\+?[0-9().-]*[0-9][0-9().-]*(?:;ext=[0-9]+)?$/;

// ── Public ───────────────────────────────────────────────────────────────────

/**
 * Checks a link target and returns its normalized href, or why it's refused.
 *
 *   checkLink(" https://coral.example/café ") → { ok: true, href: "https://coral.example/caf%C3%A9" }
 *   checkLink("javascript:alert(1)")          → { ok: false, reason: "scheme", message: "Links must start…" }
 */
export function checkLink(input: string): LinkCheck {
  const trimmed = input.replace(TRIM_ENDS, "");
  if (trimmed === "") return refuse("empty");
  if (hasLoneSurrogate(trimmed)) return refuse("invisible");
  if (HAS_WHITESPACE.test(trimmed)) return refuse("space");
  if (HAS_INVISIBLE.test(trimmed)) return refuse("invisible");

  const text = trimmed.normalize("NFC");
  const match = SCHEME.exec(text);
  const scheme = match ? match[1]!.toLowerCase() : "";
  if (!match || !isScheme(scheme)) return refuse("scheme");
  if (text.includes("\\")) return refuse("backslash");
  const rest = text.slice(match[0].length);

  switch (scheme) {
    case "https":
    case "http":
      return web(scheme, rest);
    case "mailto":
      return mailto(rest);
    case "tel":
      return PHONE.test(rest) ? accept("tel", rest) : refuse("phone");
  }
}

/** The normalized href, or null when the value isn't a link every channel can carry. */
export function normalizeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const checked = checkLink(value);
  return checked.ok ? checked.href : null;
}

// ── Schemes ──────────────────────────────────────────────────────────────────

function web(scheme: "https" | "http", rest: string): LinkCheck {
  if (!rest.startsWith("//")) return refuse("web-address");
  const afterSlashes = rest.slice(2);
  const end = firstIndexOf(afterSlashes, "/?#");
  const authority = afterSlashes.slice(0, end);
  const tail = afterSlashes.slice(end);
  if (authority.includes("@")) return refuse("web-userinfo");

  let host = authority;
  let port: string | null = null;
  const colon = authority.lastIndexOf(":");
  if (colon >= 0 && !authority.endsWith("]")) {
    host = authority.slice(0, colon);
    port = authority.slice(colon + 1);
  }
  if (host === "") return refuse("web-address");
  if (!isAscii(host)) return refuse("web-host");
  if (!REG_NAME.test(host) && !IPV6.test(host)) return refuse("web-address");
  if (port !== null && (!PORT.test(port) || Number(port) > 65535)) return refuse("web-address");

  return accept(scheme, `//${authority}${percentEncode(tail)}`);
}

function mailto(rest: string): LinkCheck {
  const query = rest.indexOf("?");
  const to = query < 0 ? rest : rest.slice(0, query);
  if (to === "" || !to.split(",").every((address) => EMAIL.test(address))) return refuse("email");
  return accept("mailto", percentEncode(rest));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function accept(scheme: LinkScheme, rest: string): LinkCheck {
  return { ok: true, href: `${scheme}:${rest}`, scheme };
}

function refuse(reason: LinkRefusal): LinkCheck {
  return { ok: false, reason, message: LINK_MESSAGES[reason] };
}

function isScheme(value: string): value is LinkScheme {
  return (LINK_SCHEMES as readonly string[]).includes(value);
}

function firstIndexOf(text: string, chars: string): number {
  for (let i = 0; i < text.length; i += 1) {
    if (chars.includes(text[i]!)) return i;
  }
  return text.length;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const UTF8 = new TextEncoder();

/** Every code point above U+007F becomes its UTF-8 bytes as %XX (uppercase hex); ASCII stays. */
function percentEncode(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch.codePointAt(0)! <= 0x7f) {
      out += ch;
      continue;
    }
    for (const byte of UTF8.encode(ch)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}
