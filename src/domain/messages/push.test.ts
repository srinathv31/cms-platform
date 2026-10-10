import { describe, expect, it } from "vitest";
import { PUSH_MAX_BYTES, PUSH_PLATFORMS, pushPayload, pushPayloadBytes, utf8ByteLength } from "./push";

const UTF8 = new TextEncoder();

describe("pushPayload", () => {
  it("builds the APNs alert for iOS, with the subtitle", () => {
    expect(pushPayload("ios", { title: "Payment due", subtitle: "Coral Card", body: "Pay $25 by Oct 12." })).toEqual({
      aps: { alert: { title: "Payment due", subtitle: "Coral Card", body: "Pay $25 by Oct 12." } },
    });
    expect(JSON.stringify(pushPayload("ios", { title: "T", subtitle: "S", body: "B" }))).toBe(
      '{"aps":{"alert":{"title":"T","subtitle":"S","body":"B"}}}',
    );
  });

  it("leaves an absent or empty subtitle out of the APNs alert", () => {
    expect(JSON.stringify(pushPayload("ios", { title: "T", body: "B" }))).toBe('{"aps":{"alert":{"title":"T","body":"B"}}}');
    expect(JSON.stringify(pushPayload("ios", { title: "T", subtitle: "", body: "B" }))).toBe(
      '{"aps":{"alert":{"title":"T","body":"B"}}}',
    );
  });

  it("builds the FCM v1 notification for Android, which never carries a subtitle", () => {
    expect(JSON.stringify(pushPayload("android", { title: "T", subtitle: "S", body: "B" }))).toBe(
      '{"message":{"notification":{"title":"T","body":"B"}}}',
    );
    expect(JSON.stringify(pushPayload("android", { title: "T", body: "B" }))).toBe(
      '{"message":{"notification":{"title":"T","body":"B"}}}',
    );
  });

  it("keeps the text exactly as given", () => {
    const content = { title: " Hi  ", subtitle: "\n", body: "Line one\nLine two " };
    expect(pushPayload("ios", content).aps.alert).toEqual(content);
    expect(pushPayload("android", content).message.notification).toEqual({ title: " Hi  ", body: "Line one\nLine two " });
  });
});

describe("pushPayloadBytes", () => {
  it("is the UTF-8 length of the compact JSON", () => {
    expect(pushPayloadBytes("ios", { title: "Hi", body: "Yo" })).toBe(44);
    expect(pushPayloadBytes("ios", { title: "Hi", subtitle: "Sub", body: "Yo" })).toBe(61);
    expect(pushPayloadBytes("android", { title: "Hi", subtitle: "Sub", body: "Yo" })).toBe(55);
    // The fixed overhead: what the keys and punctuation cost with empty text.
    expect(pushPayloadBytes("ios", { title: "", body: "" })).toBe(40);
    expect(pushPayloadBytes("android", { title: "", body: "" })).toBe(51);
  });

  it("counts JSON escapes: 2 bytes for \\\" \\\\ \\n \\t, 6 for other control characters", () => {
    const base = pushPayloadBytes("ios", { title: "", body: "" });
    expect(pushPayloadBytes("ios", { title: "", body: '"' })).toBe(base + 2);
    expect(pushPayloadBytes("ios", { title: "", body: "\\" })).toBe(base + 2);
    expect(pushPayloadBytes("ios", { title: "", body: "\n" })).toBe(base + 2);
    expect(pushPayloadBytes("ios", { title: "", body: "\t" })).toBe(base + 2);
    expect(pushPayloadBytes("ios", { title: "", body: "\u0001" })).toBe(base + 6);
    expect(pushPayloadBytes("ios", { title: "", body: "/" })).toBe(base + 1); // JSON.stringify doesn't escape /
    expect(pushPayloadBytes("ios", { title: "", body: " " })).toBe(base + 3); // nor U+2028
  });

  it("counts é as 2 bytes, ’ and € as 3, and an emoji as 4", () => {
    const base = pushPayloadBytes("android", { title: "", body: "" });
    expect(pushPayloadBytes("android", { title: "é", body: "" })).toBe(base + 2);
    expect(pushPayloadBytes("android", { title: "’", body: "" })).toBe(base + 3);
    expect(pushPayloadBytes("android", { title: "€", body: "" })).toBe(base + 3);
    expect(pushPayloadBytes("android", { title: "😀", body: "" })).toBe(base + 4);
    expect(pushPayloadBytes("android", { title: "👩‍👩‍👧‍👦", body: "" })).toBe(base + 4 * 4 + 3 * 3);
  });

  it("matches the bytes a UTF-8 encoder writes", () => {
    const content = { title: 'Card used in "Zürich" 💳', subtitle: "Coral\\Card", body: "Café… ’ \n 中文 🇨🇭 \u0007 ok" };
    for (const platform of PUSH_PLATFORMS) {
      expect(pushPayloadBytes(platform, content)).toBe(UTF8.encode(JSON.stringify(pushPayload(platform, content))).length);
    }
  });

  it("puts a payload of exactly 4,096 bytes at the limit, and one more byte over it", () => {
    for (const platform of PUSH_PLATFORMS) {
      const overhead = pushPayloadBytes(platform, { title: "Payment due", body: "" });
      const atLimit = { title: "Payment due", body: "a".repeat(PUSH_MAX_BYTES - overhead) };
      expect(pushPayloadBytes(platform, atLimit)).toBe(PUSH_MAX_BYTES);
      expect(pushPayloadBytes(platform, { ...atLimit, body: atLimit.body + "a" })).toBe(PUSH_MAX_BYTES + 1);
    }
  });

  it("can put a body under 4,096 characters over the limit with emoji", () => {
    const body = "😀".repeat(1100); // 2,200 UTF-16 units, 4,400 bytes
    expect(body.length).toBeLessThan(PUSH_MAX_BYTES);
    expect(pushPayloadBytes("ios", { title: "Hi", body })).toBe(42 + 4400);
  });
});

describe("utf8ByteLength", () => {
  it("counts 1, 2, 3 and 4 bytes per character", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("߿")).toBe(2);
    expect(utf8ByteLength("ࠀ")).toBe(3);
    expect(utf8ByteLength("’")).toBe(3);
    expect(utf8ByteLength("￿")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("\u{10ffff}")).toBe(4);
  });

  it("counts a lone surrogate as the 3-byte U+FFFD an encoder writes", () => {
    expect(utf8ByteLength("\ud800")).toBe(UTF8.encode("\ud800").length);
    expect(utf8ByteLength("a\udc00b")).toBe(UTF8.encode("a\udc00b").length);
    expect(utf8ByteLength("\ud83d😀")).toBe(UTF8.encode("\ud83d😀").length);
  });

  it("matches TextEncoder on mixed text", () => {
    const text = "Gómez ’ … — € 中 😀 🇺🇸 👩‍👩‍👧‍👦 é \r\n end";
    expect(utf8ByteLength(text)).toBe(UTF8.encode(text).length);
  });
});
