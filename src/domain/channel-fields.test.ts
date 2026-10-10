import { describe, expect, it } from "vitest";
import {
  ALL_CHANNEL_FIELDS,
  CHANNEL_FIELD_IDS,
  channelFieldValue,
  channelFieldValues,
  channelFieldsFrom,
  channelFieldsOf,
  fieldName,
  fieldNoun,
  fieldsOfChannels,
  normalizeAndCheckChannelField,
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

  it("lists every field once, by a unique id", () => {
    expect(CHANNEL_FIELD_IDS).toEqual(["email.subject", "email.preheader"]);
    expect(new Set(CHANNEL_FIELD_IDS).size).toBe(ALL_CHANNEL_FIELDS.length);
  });

  it("lists the fields of the channels that are on, in channel order", () => {
    expect(fieldsOfChannels(["pdf", "web"])).toEqual([]);
    expect(fieldsOfChannels(["email", "pdf"]).map((f) => f.id)).toEqual(["email.subject", "email.preheader"]);
  });

  it("names a field for assistive tech and for a sentence", () => {
    const [subject] = channelFieldsOf("email");
    expect(fieldName(subject!)).toBe("Email subject");
    expect(fieldNoun(subject!)).toBe("an email subject");
  });
});

describe("normalizeAndCheckChannelField", () => {
  it("takes a one-line field to one line, and refuses what can't be one", () => {
    const broken: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] }] };
    expect(normalizeAndCheckChannelField("line", broken)).toEqual({ doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: " " }, { type: "text", text: "b" }] }] }, problem: null });
    const heading: JSONContent = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "b" }] }] };
    expect(normalizeAndCheckChannelField("line", heading).problem).toBe("field");
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
    expect(channelFieldValues(stored)).toEqual({ "email.subject": line("Hi"), "email.preheader": null });
    expect(channelFieldValues({})).toEqual({ "email.subject": null, "email.preheader": null });
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
