import { describe, expect, it } from "vitest";
import { PUBLIC_SHORTENER_DOMAINS, findPublicShorteners } from "./links";

describe("PUBLIC_SHORTENER_DOMAINS", () => {
  it("lists the common public shorteners, lower case, once each", () => {
    for (const domain of [
      "bit.ly",
      "tinyurl.com",
      "t.co",
      "goo.gl",
      "ow.ly",
      "is.gd",
      "buff.ly",
      "rebrand.ly",
      "cutt.ly",
      "shorturl.at",
      "tiny.cc",
      "t.ly",
      "rb.gy",
    ]) {
      expect(PUBLIC_SHORTENER_DOMAINS).toContain(domain);
    }
    expect(new Set(PUBLIC_SHORTENER_DOMAINS).size).toBe(PUBLIC_SHORTENER_DOMAINS.length);
    for (const domain of PUBLIC_SHORTENER_DOMAINS) expect(domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  });

  it("finds every listed domain, bare and as a link", () => {
    for (const domain of PUBLIC_SHORTENER_DOMAINS) {
      expect(findPublicShorteners(`Go to ${domain}/x9Z now`), domain).toEqual([
        { index: 6, length: domain.length + 4, domain, text: `${domain}/x9Z` },
      ]);
      expect(findPublicShorteners(`https://${domain}`), domain).toEqual([
        { index: 0, length: domain.length + 8, domain, text: `https://${domain}` },
      ]);
    }
  });
});

describe("findPublicShorteners", () => {
  it("returns the whole link with its UTF-16 offset", () => {
    expect(findPublicShorteners("Pay at https://bit.ly/3xYz now.")).toEqual([
      { index: 7, length: 19, domain: "bit.ly", text: "https://bit.ly/3xYz" },
    ]);
    // "Gómez " is 6 units and 😀 is 2.
    expect(findPublicShorteners("Gómez 😀 bit.ly/x")).toEqual([{ index: 9, length: 8, domain: "bit.ly", text: "bit.ly/x" }]);
  });

  it("matches any case, a subdomain, a scheme, a port, a query and a fragment", () => {
    expect(findPublicShorteners("HTTPS://WWW.BIT.LY/AbC")).toEqual([
      { index: 0, length: 22, domain: "bit.ly", text: "HTTPS://WWW.BIT.LY/AbC" },
    ]);
    expect(findPublicShorteners("http://tinyurl.com:443/a?b=c#d").map((m) => m.text)).toEqual([
      "http://tinyurl.com:443/a?b=c#d",
    ]);
  });

  it("leaves trailing punctuation and brackets out of the link", () => {
    expect(findPublicShorteners("Visit t.co.").map((m) => m.text)).toEqual(["t.co"]);
    expect(findPublicShorteners("(see bit.ly/abc).").map((m) => m.text)).toEqual(["bit.ly/abc"]);
    expect(findPublicShorteners("Go: “https://ow.ly/x”!").map((m) => m.text)).toEqual(["https://ow.ly/x"]);
    expect(findPublicShorteners("is.gd/a, then").map((m) => m.text)).toEqual(["is.gd/a"]);
  });

  it("finds several, in order", () => {
    expect(findPublicShorteners("bit.ly/a or tinyurl.com/b\nor t.co/c")).toEqual([
      { index: 0, length: 8, domain: "bit.ly", text: "bit.ly/a" },
      { index: 12, length: 13, domain: "tinyurl.com", text: "tinyurl.com/b" },
      { index: 29, length: 6, domain: "t.co", text: "t.co/c" },
    ]);
  });

  it("finds a shortener inside another link's query", () => {
    expect(findPublicShorteners("https://coral.example/go?to=https://bit.ly/x")).toEqual([
      { index: 28, length: 16, domain: "bit.ly", text: "https://bit.ly/x" },
    ]);
    expect(findPublicShorteners("coral.example/r?u=goo.gl/abc&src=sms").map((m) => m.text)).toEqual([
      "goo.gl/abc&src=sms",
    ]);
  });

  it("doesn't match a host that only starts or ends like a listed domain", () => {
    for (const text of [
      "bit.lyrics.com",
      "https://bit.lyrics.com/song",
      "notbit.ly/x",
      "bit.ly.example.com/x",
      "goo.gle/abc",
      "how.ly",
      "at.co",
      "t.com",
      "t.co_x.example",
      "my-t.co",
      "coral.example/pay",
      "bit ly",
      "bitly",
      "Reply STOP to opt out.",
      "",
    ]) {
      expect(findPublicShorteners(text), text).toEqual([]);
    }
  });

  it("doesn't match a listed domain inside a word with accents", () => {
    expect(findPublicShorteners("éb́it.ly")).toEqual([]);
    expect(findPublicShorteners("ábit.ly")).toEqual([]);
  });
});
