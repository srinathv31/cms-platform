// Public link shorteners in a text message. Pure TypeScript, for the composer to mark each one as the author types
// and for Submit to refuse an SMS that has one.
//
// Why: CTIA's Messaging Principles and Best Practices (May 2023), §5.3.2 Embedded Website Links: "Where a web
// address (i.e., Uniform Resource Locator (URL)) shortener is used, Message Senders should use a shortener with a
// web address and IP address(es) dedicated to the exclusive use of the Message Sender." A public shortener's domain
// is shared by every sender, spammers included, so it hides who the link belongs to and carries their reputation.
// US carriers filter messages that contain one, and 10DLC campaign vetting treats them as a red flag, so an alert
// with one may never arrive. A sender's own branded short domain (go.coral.example) is fine.

/**
 * Domains where anyone can make a short link to any address, or that wrap every link their users post. Curated, not
 * exhaustive: the best-known general-purpose services. A subdomain counts as its domain (www.bit.ly is bit.ly).
 */
export const PUBLIC_SHORTENER_DOMAINS: readonly string[] = [
  "bit.do", // Bit.do
  "bit.ly", // Bitly
  "buff.ly", // Buffer, for its users' posts
  "clck.ru", // Yandex
  "cutt.ly", // Cuttly
  "dlvr.it", // dlvr.it, for its users' posts
  "goo.gl", // Google's retired shortener; existing links still resolve
  "ift.tt", // IFTTT
  "is.gd", // is.gd
  "j.mp", // Bitly's second domain
  "lnkd.in", // LinkedIn, wraps every link posted there
  "ow.ly", // Hootsuite, for its users' posts
  "rb.gy", // RB.GY
  "rebrand.ly", // Rebrandly's shared domain
  "s.id", // s.id
  "shorturl.at", // ShortURL
  "t.co", // X (Twitter), wraps every link posted there
  "t.ly", // T.LY
  "tiny.cc", // tiny.cc
  "tinyurl.com", // TinyURL
  "v.gd", // is.gd's second domain
];

export interface ShortenerMatch {
  /** Where the link starts in the text, as a UTF-16 offset: its scheme when it has one, otherwise its host. */
  index: number;
  /** The link's length in UTF-16 code units, through its path, query and fragment; trailing punctuation excluded. */
  length: number;
  /** The listed domain it is on, lower case: "bit.ly" for HTTPS://WWW.BIT.LY/x. */
  domain: string;
  /** The link as written. */
  text: string;
}

/**
 * Each link on a public shortener's domain in `text`, in order. A host matches when it is a listed domain or a
 * subdomain of one, with or without a scheme and path, anywhere in the text, including inside another link's
 * query (`coral.example/go?to=bit.ly/x`). A host that only starts like one doesn't match: bit.lyrics.com,
 * notbit.ly, goo.gle.
 */
export function findPublicShorteners(text: string): ShortenerMatch[] {
  const matches: ShortenerMatch[] = [];
  // Scanning resumes just past a host that isn't listed, so a link inside its path or query is still found.
  const hosts = new RegExp(HOST, "gu");
  for (let found = hosts.exec(text); found; found = hosts.exec(text)) {
    const host = found[0];
    const domain = listedDomain(host.toLowerCase());
    if (!domain) continue;
    const hostStart = found.index;
    const hostEnd = hostStart + host.length;
    const scheme = SCHEME_BEFORE.exec(text.slice(Math.max(0, hostStart - 8), hostStart));
    const start = hostStart - (scheme ? scheme[0].length : 0);
    const end = hostEnd + pathLength(text, hostEnd);
    matches.push({ index: start, length: end - start, domain, text: text.slice(start, end) });
    hosts.lastIndex = end;
  }
  return matches;
}

/**
 * A host: two or more dot-separated labels. Labels take letters, combining marks, digits, hyphens and underscores,
 * so the match never starts or ends inside a longer word or host (the regex takes the longest run).
 */
const HOST = /[\p{L}\p{M}\p{N}_-]+(?:\.[\p{L}\p{M}\p{N}_-]+)+/u;

const SCHEME_BEFORE = /https?:\/\/$/i;

/** Characters that end a link when they are its last: sentence punctuation and closing brackets or quotes. */
const TRAILING = /[.,;:!?'"’”)\]}>]+$/u;

/** How far a link's port, path, query or fragment runs after its host: to the next space, less trailing punctuation. */
function pathLength(text: string, hostEnd: number): number {
  const next = text[hostEnd];
  if (next !== "/" && next !== "?" && next !== "#" && !(next === ":" && /\d/.test(text[hostEnd + 1] ?? ""))) return 0;
  const rest = /^\S*/u.exec(text.slice(hostEnd))?.[0] ?? "";
  return rest.replace(TRAILING, "").length;
}

function listedDomain(host: string): string | undefined {
  return PUBLIC_SHORTENER_DOMAINS.find((domain) => host === domain || host.endsWith(`.${domain}`));
}
