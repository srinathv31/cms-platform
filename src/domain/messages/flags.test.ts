import { describe, expect, it } from "vitest";
import { channelFieldsOf } from "../channel-fields";
import { messageFieldFlags } from "./flags";

const [title, , body] = channelFieldsOf("push");
const [sms] = channelFieldsOf("sms");
const [subject] = channelFieldsOf("email");

describe("messageFieldFlags", () => {
  it("flags each character outside GSM-7 in an SMS, with its fix when there is an obvious one", () => {
    const text = "Don’t miss it – pay now";
    expect(messageFieldFlags(sms!, text)).toEqual([
      { index: 3, length: 1, kind: "character", message: "’ isn't in the SMS character set.", replacement: "'" },
      { index: 14, length: 1, kind: "character", message: "– isn't in the SMS character set.", replacement: "-" },
    ]);
  });

  it("offers to remove an invisible character, and names a space by its code point", () => {
    expect(messageFieldFlags(sms!, "pay\u200Bnow")).toEqual([
      { index: 3, length: 1, kind: "character", message: "U+200B isn't in the SMS character set.", replacement: "" },
    ]);
    expect(messageFieldFlags(sms!, "pay\u00A0now")[0]).toMatchObject({ message: "U+00A0 isn't in the SMS character set.", replacement: " " });
  });

  it("only flags a letter or an emoji: changing it would change the author's words", () => {
    const flags = messageFieldFlags(sms!, "Olá 👋");
    expect(flags.map((f) => [f.index, f.length, f.replacement])).toEqual([
      [2, 1, undefined],
      [4, 2, undefined],
    ]);
  });

  it("flags a public shortener in an SMS or a push body, with no fix", () => {
    expect(messageFieldFlags(body!, "Pay at bit.ly/pay")).toEqual([
      {
        index: 7,
        length: 10,
        kind: "shortener",
        message: "bit.ly is a public link shortener carriers filter. Use a link on your own domain.",
      },
    ]);
    expect(messageFieldFlags(sms!, "Pay at https://bit.ly/pay’").map((f) => f.kind)).toEqual(["shortener", "character"]);
  });

  it("flags nothing a field's rules don't cover: a push title can hold ’, and an email subject a shortener", () => {
    expect(messageFieldFlags(title!, "Don’t miss bit.ly/x")).toEqual([]);
    expect(messageFieldFlags(body!, "Don’t miss it")).toEqual([]);
    expect(messageFieldFlags(subject!, "Don’t miss bit.ly/x")).toEqual([]);
  });

  it("reads offsets in the typed text, where a chip is a space", () => {
    // "Hi {{first_name}}, it’s due": typedText puts one space for the chip.
    expect(messageFieldFlags(sms!, "Hi  , it’s due")[0]?.index).toBe(8);
  });
});
