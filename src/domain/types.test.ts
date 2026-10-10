import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  DOCUMENT_CHANNELS,
  MESSAGE_CHANNELS,
  channelFamily,
  familyChannels,
  familyOf,
  isDocumentChannel,
  isMessageChannel,
} from "./types";

// The channel families (decision 0033): documents render the body, messages their own fields, and a
// content type or version is one family, never both.
describe("channel families", () => {
  it("splits every channel into documents and messages, in CHANNELS order", () => {
    expect(CHANNELS).toEqual(["pdf", "web", "email", "push", "sms"]);
    expect([...DOCUMENT_CHANNELS, ...MESSAGE_CHANNELS]).toEqual([...CHANNELS]);
    expect(CHANNELS.map(channelFamily)).toEqual(["document", "document", "document", "message", "message"]);
    expect(familyChannels("document")).toEqual(["pdf", "web", "email"]);
    expect(familyChannels("message")).toEqual(["push", "sms"]);
  });

  it("names a set of channels' family, or none for no channels", () => {
    expect(familyOf(["email"])).toBe("document");
    expect(familyOf(["sms", "push"])).toBe("message");
    expect(familyOf([])).toBeNull();
  });

  it("tells a document channel from a message channel", () => {
    expect(isDocumentChannel("web")).toBe(true);
    expect(isDocumentChannel("push")).toBe(false);
    expect(isMessageChannel("sms")).toBe(true);
    expect(isMessageChannel("pdf")).toBe(false);
  });
});
