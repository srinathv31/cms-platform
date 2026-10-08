// These tables are the spec examples for links (docs/render-spec.md, "Links"). The Java engine runs
// the same rows.

import { describe, expect, it } from "vitest";
import { LINK_MESSAGES, checkLink, normalizeLink, type LinkRefusal } from "./links";

describe("checkLink: accepted, with the normalized href", () => {
  it.each([
    // Kept exactly as written.
    ["https://coral.example", "https://coral.example"],
    ["https://coral.example/", "https://coral.example/"],
    ["http://coral.example/terms", "http://coral.example/terms"],
    ["https://Coral.Example/Terms?Q=1#Top", "https://Coral.Example/Terms?Q=1#Top"],
    ["https://coral.example/a?q=1&r=two#top", "https://coral.example/a?q=1&r=two#top"],
    ["https://coral.example?q=1", "https://coral.example?q=1"],
    ["https://coral.example#fees", "https://coral.example#fees"],
    ["https://coral.example:8443/x", "https://coral.example:8443/x"],
    ["https://coral.example./x", "https://coral.example./x"],
    ["https://localhost/x", "https://localhost/x"],
    ["https://192.168.0.1/x", "https://192.168.0.1/x"],
    ["https://[2001:db8::1]:8080/x", "https://[2001:db8::1]:8080/x"],
    ["https://xn--caf-dma.example/", "https://xn--caf-dma.example/"],
    ["https://my_host.example/", "https://my_host.example/"],
    ["https://coral.example/card%20terms", "https://coral.example/card%20terms"],
    ["https://coral.example/50%off", "https://coral.example/50%off"],
    ["https://coral.example/a|b{c}^", "https://coral.example/a|b{c}^"],
    ["https://coral.example/\"quoted\"<tag>", "https://coral.example/\"quoted\"<tag>"],
    ["mailto:help@coral.example", "mailto:help@coral.example"],
    ["mailto:help@coral.example?subject=Card%20terms", "mailto:help@coral.example?subject=Card%20terms"],
    ["mailto:a@coral.example,b@coral.example", "mailto:a@coral.example,b@coral.example"],
    ["tel:+18005550100", "tel:+18005550100"],
    ["tel:1-800-555-0100", "tel:1-800-555-0100"],
    ["tel:(800)555.0100", "tel:(800)555.0100"],
    ["tel:+18005550100;ext=42", "tel:+18005550100;ext=42"],
    // Ends trimmed: whitespace, NBSP, zero-width characters, BOM.
    ["  https://coral.example  ", "https://coral.example"],
    [" https://coral.example\n", "https://coral.example"],
    ["​https://coral.example﻿", "https://coral.example"],
    // Scheme lowercased.
    ["HTTPS://coral.example", "https://coral.example"],
    ["MailTo:help@coral.example", "mailto:help@coral.example"],
    ["TEL:+18005550100", "tel:+18005550100"],
    // Non-ASCII after the host, and in mailto:, percent-encoded as UTF-8 (after NFC).
    ["https://coral.example/café", "https://coral.example/caf%C3%A9"],
    ["https://coral.example/café", "https://coral.example/caf%C3%A9"],
    ["https://coral.example/a?q=é#ü", "https://coral.example/a?q=%C3%A9#%C3%BC"],
    ["https://coral.example/€", "https://coral.example/%E2%82%AC"],
    ["https://coral.example/😀", "https://coral.example/%F0%9F%98%80"],
    ["mailto:josé@coral.example", "mailto:jos%C3%A9@coral.example"],
  ])("%j → %j", (input, href) => {
    expect(checkLink(input)).toMatchObject({ ok: true, href });
    expect(normalizeLink(input)).toBe(href);
  });
});

describe("checkLink: refused, with the reason", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["​", "empty"],
    // Not one of the four schemes.
    ["javascript:alert(1)", "scheme"],
    ["JaVaScRiPt:alert(1)", "scheme"],
    ["data:text/html,hi", "scheme"],
    ["ftp://coral.example", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["sms:+18005550100", "scheme"],
    ["coral.example", "scheme"],
    ["www.coral.example/terms", "scheme"],
    ["/terms", "scheme"],
    ["#fees", "scheme"],
    ["help@coral.example", "scheme"],
    ["//coral.example", "scheme"],
    // Whitespace inside.
    ["https://coral.example/card terms", "space"],
    ["https://coral.example/a\tb", "space"],
    ["https://coral.example/a\nb", "space"],
    ["https://coral.example/a b", "space"],
    ["https://coral.example/a　b", "space"],
    ["tel:+1 800 555 0100", "space"],
    // Control and invisible characters inside.
    ["https://coral.example/a\u0000b", "invisible"],
    ["https://coral.example/a\u007Fb", "invisible"],
    ["https://coral.example/a\u0085b", "space"],
    ["https://coral.example/a​b", "invisible"],
    ["https://coral.example/a‎b", "invisible"],
    ["https://coral.example/a‮b", "invisible"],
    ["https://coral.example/a⁦b", "invisible"],
    ["https://coral.example/a­b", "invisible"],
    ["https://coral.example/a️b", "invisible"],
    ["https://coral.example/a\u{E0041}b", "invisible"],
    ["https://coral.example/a\uD800b", "invisible"],
    ["https://coral.example/a\uDC00b", "invisible"],
    // Backslash anywhere.
    ["https://coral.example\\@evil.example", "backslash"],
    ["https://coral.example/a\\b", "backslash"],
    // Web addresses.
    ["https:", "web-address"],
    ["https:coral.example", "web-address"],
    ["https:/coral.example", "web-address"],
    ["https://", "web-address"],
    ["https:///terms", "web-address"],
    ["https://:443/", "web-address"],
    ["https://coral.example:/x", "web-address"],
    ["https://coral.example:99999/x", "web-address"],
    ["https://coral.example:8a/x", "web-address"],
    ["https://-coral.example/", "web-address"],
    ["https://coral..example/", "web-address"],
    ["https://coral.example%2F/", "web-address"],
    ["https://café.example/", "web-host"],
    ["https://bank.example@evil.example/", "web-userinfo"],
    ["https://user:pass@coral.example/", "web-userinfo"],
    // mailto: and tel:.
    ["mailto:", "email"],
    ["mailto:help", "email"],
    ["mailto:@coral.example", "email"],
    ["mailto:help@", "email"],
    ["mailto:a@b@coral.example", "email"],
    ["mailto:?subject=hi", "email"],
    ["mailto:a@coral.example,", "email"],
    ["tel:", "phone"],
    ["tel:+", "phone"],
    ["tel:1-800-FLOWERS", "phone"],
    ["tel:++18005550100", "phone"],
    ["tel:+18005550100;ext=", "phone"],
  ] as [string, LinkRefusal][])("%j → %s", (input, reason) => {
    expect(checkLink(input)).toEqual({ ok: false, reason, message: LINK_MESSAGES[reason] });
    expect(normalizeLink(input)).toBeNull();
  });
});

describe("normalizeLink", () => {
  it("is null for anything but a string", () => {
    for (const value of [null, undefined, 42, {}, ["https://coral.example"]]) expect(normalizeLink(value)).toBeNull();
  });

  it("is idempotent", () => {
    for (const input of [
      " HTTPS://coral.example/café?q=ü#é ",
      "mailto:josé@coral.example?subject=Café",
      "tel:+18005550100",
      "https://coral.example/caf%C3%A9",
    ]) {
      const once = normalizeLink(input);
      expect(once).not.toBeNull();
      expect(normalizeLink(once)).toBe(once);
    }
  });

  it("gives an ASCII href for every accepted link", () => {
    const href = normalizeLink("https://coral.example/naïve/€/😀?q=ß#ŝ");
    expect(href).toMatch(/^[\x21-\x7e]+$/);
  });
});
