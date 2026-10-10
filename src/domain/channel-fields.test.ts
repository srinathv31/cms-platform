import { describe, expect, it } from "vitest";
import {
  ALL_CHANNEL_FIELDS,
  CHANNEL_FIELD_IDS,
  channelFieldValue,
  channelFieldValues,
  channelFieldsFrom,
  channelFieldsHeading,
  channelFieldsOf,
  fieldLines,
  fieldName,
  fieldNoun,
  fieldOnPlatform,
  fieldPlatformTag,
  fieldsOfChannels,
  normalizeAndCheckChannelField,
  typedText,
  withChannelFieldValues,
  type ChannelFields,
} from "./channel-fields";
import type { JSONContent } from "./types";

const line = (text: string): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("the registry", () => {
  it("gives Email a required subject and an optional preheader, both one line, and PDF and Web nothing", () => {
    expect(channelFieldsOf("email")).toEqual([
      { id: "email.subject", channel: "email", key: "subject", label: "Subject", name: "email subject", shape: "line", required: true },
      { id: "email.preheader", channel: "email", key: "preheader", label: "Preheader", name: "email preheader", shape: "line", required: false },
    ]);
    expect(channelFieldsOf("pdf")).toEqual([]);
    expect(channelFieldsOf("web")).toEqual([]);
  });

  it("gives Push a required title, an iPhone-only subtitle and a required body, and SMS a required message", () => {
    expect(channelFieldsOf("push")).toEqual([
      { id: "push.title", channel: "push", key: "title", label: "Title", name: "push title", shape: "line", required: true },
      {
        id: "push.subtitle",
        channel: "push",
        key: "subtitle",
        label: "Subtitle",
        name: "push subtitle",
        shape: "line",
        required: false,
        platforms: ["ios"],
      },
      {
        id: "push.body",
        channel: "push",
        key: "body",
        label: "Body",
        name: "push body",
        shape: "paragraph",
        required: true,
        refusesShorteners: true,
      },
    ]);
    expect(channelFieldsOf("sms")).toEqual([
      { id: "sms.text", channel: "sms", key: "text", label: "Message", name: "SMS message", shape: "lines", required: true, refusesShorteners: true },
    ]);
  });

  it("lists every field once, by a unique id", () => {
    expect(CHANNEL_FIELD_IDS).toEqual(["email.subject", "email.preheader", "push.title", "push.subtitle", "push.body", "sms.text"]);
    expect(new Set(CHANNEL_FIELD_IDS).size).toBe(ALL_CHANNEL_FIELDS.length);
  });

  it("lists the fields of the channels that are on, in channel order", () => {
    expect(fieldsOfChannels(["pdf", "web"])).toEqual([]);
    expect(fieldsOfChannels(["email", "pdf"]).map((f) => f.id)).toEqual(["email.subject", "email.preheader"]);
    expect(fieldsOfChannels(["sms", "push"]).map((f) => f.id)).toEqual(["push.title", "push.subtitle", "push.body", "sms.text"]);
  });

  it("names a field for assistive tech and for a sentence", () => {
    const [subject] = channelFieldsOf("email");
    expect(fieldName(subject!)).toBe("Email subject");
    expect(fieldNoun(subject!)).toBe("an email subject");
    const [sms] = channelFieldsOf("sms");
    expect(fieldName(sms!)).toBe("SMS message");
    expect(fieldNoun(sms!)).toBe("an SMS message");
  });

  it("shows the subtitle on iPhone only, and every other field on both platforms", () => {
    const [title, subtitle] = channelFieldsOf("push");
    expect(fieldOnPlatform(subtitle!, "ios")).toBe(true);
    expect(fieldOnPlatform(subtitle!, "android")).toBe(false);
    expect(fieldOnPlatform(title!, "android")).toBe(true);
  });

  it("keeps line breaks only in a `lines` field", () => {
    expect(fieldLines("line")).toBe("line");
    expect(fieldLines("paragraph")).toBe("line");
    expect(fieldLines("lines")).toBe("lines");
  });
});

describe("how the fields are shown together", () => {
  it("heads each channel's fields with what it sends, and has nothing to head for PDF or Web", () => {
    expect((["email", "push", "sms"] as const).map((c) => channelFieldsHeading(c))).toEqual(["Email", "Push notification", "Text message"]);
    expect(() => channelFieldsHeading("pdf")).toThrow();
  });

  it("tags a field only some push platforms show, and no other", () => {
    expect(ALL_CHANNEL_FIELDS.map((f) => [f.id, fieldPlatformTag(f)])).toEqual([
      ["email.subject", null],
      ["email.preheader", null],
      ["push.title", null],
      ["push.subtitle", "iPhone only"],
      ["push.body", null],
      ["sms.text", null],
    ]);
  });
});

describe("normalizeAndCheckChannelField", () => {
  const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
  const doc = (...blocks: JSONContent[]): JSONContent => ({ type: "doc", content: blocks });
  const broken = doc(p({ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }));
  const heading: JSONContent = doc({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "b" }] });
  const [subject] = channelFieldsOf("email");
  const [title, , body] = channelFieldsOf("push");
  const [sms] = channelFieldsOf("sms");

  it("takes a one-line field to one line, and refuses what can't be one", () => {
    expect(normalizeAndCheckChannelField(subject!, broken)).toEqual({
      doc: doc(p({ type: "text", text: "a" }, { type: "text", text: " " }, { type: "text", text: "b" })),
      problem: null,
    });
    expect(normalizeAndCheckChannelField(subject!, heading).problem).toBe("field");
  });

  it("keeps a push's and an SMS's invisible characters (emoji joiners), and removes the email's", () => {
    const family = doc(p({ type: "text", text: "👨\u200D👩\u200D👧 ❤\uFE0F" }));
    expect(normalizeAndCheckChannelField(title!, family).doc).toEqual(family);
    expect(normalizeAndCheckChannelField(sms!, family).doc).toEqual(family);
    expect(normalizeAndCheckChannelField(subject!, family).doc).toEqual(doc(p({ type: "text", text: "👨👩👧 ❤" })));
  });

  it("takes a push title and body to one line, refused in the push's words", () => {
    expect(normalizeAndCheckChannelField(body!, broken).doc).toEqual(
      doc(p({ type: "text", text: "a" }, { type: "text", text: " " }, { type: "text", text: "b" })),
    );
    expect(normalizeAndCheckChannelField(title!, heading).problem).toBe("pushField");
  });

  it("keeps an SMS's line breaks, joins its paragraphs with one (a blank line stays), and drops marks", () => {
    expect(normalizeAndCheckChannelField(sms!, broken)).toEqual({ doc: broken, problem: null });
    const paragraphs = doc(p({ type: "text", text: "a", marks: [{ type: "bold" }] }), { type: "paragraph" }, p({ type: "text", text: "b\nc" }));
    expect(normalizeAndCheckChannelField(sms!, paragraphs)).toEqual({
      doc: doc(
        p(
          { type: "text", text: "a" },
          { type: "hardBreak" },
          { type: "hardBreak" },
          { type: "text", text: "b" },
          { type: "hardBreak" },
          { type: "text", text: "c" },
        ),
      ),
      problem: null,
    });
    expect(normalizeAndCheckChannelField(sms!, heading).problem).toBe("smsField");
  });
});

describe("typedText", () => {
  it("is the author's text, a line break as \\n and a chip as a space", () => {
    const value: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hi " }, { type: "variable", attrs: { key: "first_name" } }, { type: "hardBreak" }, { type: "text", text: "bit.ly/x" }],
        },
      ],
    };
    expect(typedText(value)).toBe("Hi  \nbit.ly/x");
    expect(typedText(null)).toBe("");
  });
});

describe("stored and flat values", () => {
  const stored: ChannelFields = { email: { subject: line("Hi") } };

  it("reads a field, null when it has none", () => {
    const [subject, preheader] = channelFieldsOf("email");
    expect(channelFieldValue(stored, subject!)).toEqual(line("Hi"));
    expect(channelFieldValue(stored, preheader!)).toBeNull();
    expect(channelFieldValue({}, subject!)).toBeNull();
  });

  it("flattens every field by id", () => {
    const none = { "push.title": null, "push.subtitle": null, "push.body": null, "sms.text": null };
    expect(channelFieldValues(stored)).toEqual({ "email.subject": line("Hi"), "email.preheader": null, ...none });
    expect(channelFieldValues({})).toEqual({ "email.subject": null, "email.preheader": null, ...none });
  });

  it("lays a patch over the stored fields: a document sets, null clears, the rest is kept", () => {
    expect(withChannelFieldValues(stored, { "email.preheader": line("Pre") })).toEqual({ email: { subject: line("Hi"), preheader: line("Pre") } });
    expect(withChannelFieldValues(stored, { "email.subject": line("New") })).toEqual({ email: { subject: line("New") } });
    expect(withChannelFieldValues(stored, {})).toEqual(stored);
  });

  it("drops a channel left with no field, and never changes what it was given", () => {
    expect(withChannelFieldValues(stored, { "email.subject": null })).toEqual({});
    expect(withChannelFieldValues({}, { "email.preheader": null })).toEqual({});
    expect(stored).toEqual({ email: { subject: line("Hi") } });
  });

  it("builds stored fields from flat values, the ones that have a value", () => {
    expect(channelFieldsFrom({ "email.subject": null, "email.preheader": line("Pre") })).toEqual({ email: { preheader: line("Pre") } });
    expect(channelFieldsFrom(channelFieldValues(stored))).toEqual(stored);
  });
});
