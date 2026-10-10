import { describe, expect, it } from "vitest";
import type { ChannelFields } from "../channel-fields";
import { smsLength } from "../messages/gsm7";
import { pushPayloadBytes } from "../messages/push";
import type { JSONContent, Variable } from "../types";
import { renderMessage, resolveChannelField, resolveMessage, withFooter, type MessageInput } from "./message";
import { validateValues } from "./validate";

const t = (text: string): JSONContent => ({ type: "text", text });
const br: JSONContent = { type: "hardBreak" };
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const field = (...inline: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "amount_due", label: "Amount due", type: "currency", required: true, sample: "35" },
  { key: "due_date", label: "Due date", type: "date", required: true, sample: "2027-03-04" },
  { key: "card_last4", label: "Card ending", type: "text", required: false, sample: "4417" },
];

const FOOTER = "Coral Offers: Reply STOP to opt out, HELP for help.";

const FIELDS: ChannelFields = {
  push: {
    title: field(t("Payment due "), chip("due_date")),
    subtitle: field(t("Card ending "), chip("card_last4")),
    body: field(t("Hi "), chip("first_name"), t(", your minimum payment of "), chip("amount_due"), t(" is due "), chip("due_date"), t(".")),
  },
  sms: { text: field(t("Coral Offers: your payment of "), chip("amount_due"), t(" is due "), chip("due_date"), t("."), br, t("Pay at coral.example/pay")) },
};

/** The input as a caller builds it: values validated first, as the engine (stage 6) and the preview do. */
function input(values: Record<string, string>, over: Partial<MessageInput> = {}): MessageInput {
  const validated = validateValues(VARIABLES, values);
  if (!validated.ok) throw new Error(validated.error.message);
  return { fields: FIELDS, variables: VARIABLES, values: validated.values, rules: { smsFooter: FOOTER }, ...over };
}

const MAYA = { first_name: "Maya", amount_due: "35.00", due_date: "2027-03-04", card_last4: "4417" };

describe("renderMessage: push", () => {
  it("renders iPhone's push with its subtitle, every field in full, and measures its APNs JSON", () => {
    const result = renderMessage({ channel: "push", platform: "ios" }, input(MAYA));
    expect(result).toEqual({
      ok: true,
      output: {
        title: "Payment due March 4, 2027",
        subtitle: "Card ending 4417",
        body: "Hi Maya, your minimum payment of $35.00 is due March 4, 2027.",
        payloadBytes: pushPayloadBytes("ios", {
          title: "Payment due March 4, 2027",
          subtitle: "Card ending 4417",
          body: "Hi Maya, your minimum payment of $35.00 is due March 4, 2027.",
        }),
      },
    });
  });

  it("never gives Android a subtitle, and the title and body are iPhone's word for word", () => {
    const ios = renderMessage({ channel: "push", platform: "ios" }, input(MAYA));
    const android = renderMessage({ channel: "push", platform: "android" }, input(MAYA));
    if (!ios.ok || !android.ok) throw new Error("refused");
    expect(android.output).not.toHaveProperty("subtitle");
    expect(android.output.title).toBe(ios.output.title);
    expect(android.output.body).toBe(ios.output.body);
    expect(android.output.payloadBytes).toBe(pushPayloadBytes("android", android.output));
  });

  it("leaves out an iPhone subtitle that resolves to nothing", () => {
    const noCard = { first_name: MAYA.first_name, amount_due: MAYA.amount_due, due_date: MAYA.due_date };
    const fields: ChannelFields = { push: { ...FIELDS.push, subtitle: field(chip("card_last4")) } };
    const result = renderMessage({ channel: "push", platform: "ios" }, input(noCard, { fields }));
    expect(result.ok && result.output).not.toHaveProperty("subtitle");
  });

  it("refuses a push over 4,096 bytes on its platform rather than cut it, and names no value", () => {
    const long = "x".repeat(1000);
    const fields: ChannelFields = {
      push: { title: field(chip("first_name")), body: field(chip("first_name"), chip("first_name"), chip("first_name"), chip("first_name")) },
    };
    const result = renderMessage({ channel: "push", platform: "android" }, input({ ...MAYA, first_name: long }, { fields }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("push_payload_too_large");
    expect(result.error.message).toBe("The push is 5,051 bytes on Android. It can be at most 4,096 bytes.");
    expect(result.error.details).toEqual({ platform: "android", payloadBytes: 5051, maxBytes: 4096 });
    expect(result.error.message).not.toContain("xxx");
  });

  it("prints a value exactly as sent, whatever it costs: no transliteration", () => {
    const result = renderMessage({ channel: "push", platform: "ios" }, input({ ...MAYA, first_name: "Zoë 😀" }));
    expect(result.ok && result.output.body).toBe("Hi Zoë 😀, your minimum payment of $35.00 is due March 4, 2027.");
  });
});

describe("renderMessage: SMS", () => {
  it("sends the message with its line breaks, then the footer on its own line, and measures it", () => {
    const result = renderMessage({ channel: "sms" }, input(MAYA));
    const text = `Coral Offers: your payment of $35.00 is due March 4, 2027.\nPay at coral.example/pay\n${FOOTER}`;
    const { encoding, parts, characters } = smsLength(text);
    expect(result).toEqual({ ok: true, output: { text, encoding, parts, characters } });
    expect(encoding).toBe("GSM-7");
    expect(parts).toBe(1);
  });

  it("switches to UCS-2 when a value has a character outside GSM-7, and never transliterates it", () => {
    const fields: ChannelFields = { sms: { text: field(t("Hi "), chip("first_name"), t(".")) } };
    const result = renderMessage({ channel: "sms" }, input({ ...MAYA, first_name: "Gómez" }, { fields, rules: { smsFooter: null } }));
    expect(result).toEqual({ ok: true, output: { text: "Hi Gómez.", encoding: "UCS-2", parts: 1, characters: 9 } });
  });

  it("refuses an SMS over 10 parts rather than cut it, and names no value", () => {
    const fields: ChannelFields = { sms: { text: field(chip("first_name"), chip("first_name")) } };
    const result = renderMessage({ channel: "sms" }, input({ ...MAYA, first_name: "é".repeat(1000) }, { fields }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "sms_too_long",
      message: "The SMS is 14 parts in GSM-7. It can be at most 10 parts.",
      details: { parts: 14, maxParts: 10, encoding: "GSM-7", characters: 2052 },
    });
  });

  it("with no footer, is the message alone; with no message, the footer alone", () => {
    expect(withFooter("Hi", null)).toBe("Hi");
    expect(withFooter("Hi", "")).toBe("Hi");
    expect(withFooter("", FOOTER)).toBe(FOOTER);
    expect(resolveMessage({ channel: "sms" }, input(MAYA, { fields: {} }))).toBe(FOOTER);
  });
});

describe("resolveChannelField", () => {
  const ctx = { variables: VARIABLES, values: { first_name: "Maya" } };
  const typed = field(t("  Hi "), chip("first_name"), br, br, t("Line\tthree  "));

  it("puts a one-line or paragraph field on one line, trimmed at the ends", () => {
    expect(resolveChannelField(typed, "line", ctx)).toBe("Hi Maya  Line three");
    expect(resolveChannelField(typed, "paragraph", ctx)).toBe("Hi Maya  Line three");
  });

  it("keeps a `lines` field's line breaks as \\n, blank lines included", () => {
    expect(resolveChannelField(typed, "lines", ctx)).toBe("Hi Maya\n\nLine three");
    expect(resolveChannelField(field(t("a\r\nb")), "lines", ctx)).toBe("a\nb");
  });

  it("gives nothing for a field with no value", () => {
    expect(resolveChannelField(null, "lines", ctx)).toBe("");
  });
});
