import { describe, expect, it } from "vitest";
import { channelNotAllowed, renderFailed, renderFailedDocument, renderFailedGlyphs } from "./render/errors";
import type { RenderError } from "./render/types";
import {
  OUTPUT_KEYS,
  OUTPUT_REFUSALS,
  channelOutputs,
  isOutputKey,
  missingOutputs,
  outputKey,
  outputCannotBeShown,
  outputLabel,
  outputsLabels,
  outputsRefusal,
  requiredOutputs,
  viewedOutputs,
} from "./review-outputs";

describe("the outputs an approver views", () => {
  it("a document template: one output per enabled channel, in the order outputs are named", () => {
    expect(requiredOutputs(["email", "pdf", "web"])).toEqual(["pdf", "web", "email"]);
  });

  it("an alert: Push counts twice, once on each phone the Preview draws it on", () => {
    expect(requiredOutputs(["sms", "push"])).toEqual(["push.ios", "push.android", "sms"]);
    expect(channelOutputs("push")).toEqual(["push.ios", "push.android"]);
  });

  it("a single channel", () => {
    expect(requiredOutputs(["pdf"])).toEqual(["pdf"]);
    expect(requiredOutputs(["push"])).toEqual(["push.ios", "push.android"]);
    expect(requiredOutputs([])).toEqual([]);
  });

  it("names the output on screen by its channel, and a push by the phone too", () => {
    expect(outputKey("web", "android")).toBe("web");
    expect(outputKey("sms", "ios")).toBe("sms");
    expect(outputKey("push", "ios")).toBe("push.ios");
    expect(outputKey("push", "android")).toBe("push.android");
    expect(OUTPUT_KEYS.every(isOutputKey)).toBe(true);
    expect(isOutputKey("push")).toBe(false);
  });

  it("what's missing is what's required and not viewed; keys that aren't required are ignored", () => {
    expect(missingOutputs(["pdf", "web", "email"], [])).toEqual(["pdf", "web", "email"]);
    expect(missingOutputs(["pdf", "web", "email"], ["web", "sms", "nonsense"])).toEqual(["pdf", "email"]);
    expect(missingOutputs(["push", "sms"], ["push.ios", "sms"])).toEqual(["push.android"]);
    expect(missingOutputs(["push", "sms"], ["push.android", "sms", "push.ios"])).toEqual([]);
  });

  it("records the required outputs viewed, in order, each once", () => {
    expect(viewedOutputs(["push", "sms"], ["sms", "push.android", "sms", "pdf", "push.ios"])).toEqual(["push.ios", "push.android", "sms"]);
  });
});

describe("the refusal", () => {
  it("names what's left in the Preview's words, with a stable code", () => {
    expect(outputsRefusal(["pdf", "web", "email"], ["pdf"])).toEqual({
      code: "output_not_viewed",
      reason: "Preview Web and Email first.",
    });
    expect(outputsRefusal(["push", "sms"], [])).toEqual({
      code: "output_not_viewed",
      reason: "Preview Push (iPhone, Android) and SMS first.",
    });
    expect(outputsRefusal(["push"], ["push.ios"])?.reason).toBe("Preview Push (Android) first.");
    expect(OUTPUT_REFUSALS.notViewed.code).toBe("output_not_viewed");
  });

  it("is null once every output has been viewed", () => {
    expect(outputsRefusal(["pdf"], ["pdf"])).toBeNull();
    expect(outputsRefusal(["push", "sms"], ["push.ios", "push.android", "sms"])).toBeNull();
  });

  it("says an output the render refused can't be shown and the version needs changes, with a code of its own", () => {
    expect(outputsRefusal(["pdf", "web"], [], ["pdf"])).toEqual({
      code: "output_cannot_show",
      reason: "The PDF can't be shown. Request changes.",
    });
    expect(OUTPUT_REFUSALS.cannotShow.code).toBe("output_cannot_show");
    expect(OUTPUT_REFUSALS.cannotShow.code).not.toBe(OUTPUT_REFUSALS.notViewed.code);
    // Several, named the way the other sentence names them; a push by its phones.
    expect(outputsRefusal(["pdf", "web", "email"], [], ["email", "pdf"])?.reason).toBe("The PDF and Email can't be shown. Request changes.");
    expect(outputsRefusal(["push", "sms"], [], ["push.android", "push.ios"])?.reason).toBe(
      "The Push (iPhone, Android) can't be shown. Request changes.",
    );
  });

  it("puts the output that can't be shown ahead of the ones still to preview", () => {
    expect(outputsRefusal(["pdf", "web", "email"], ["web"], ["pdf"])?.code).toBe("output_cannot_show");
    // Only the refused one is named: the other is still to preview.
    expect(outputsRefusal(["pdf", "web", "email"], ["web"], ["pdf"])?.reason).toBe("The PDF can't be shown. Request changes.");
  });

  it("ignores a refusal for an output already viewed, or one the version doesn't have", () => {
    // Viewed on one sample set, refused on another: it was seen.
    expect(outputsRefusal(["pdf"], ["pdf"], ["pdf"])).toBeNull();
    expect(outputsRefusal(["pdf"], [], ["sms", "nonsense"])).toEqual({ code: "output_not_viewed", reason: "Preview PDF first." });
    // The approve transition passes none refused.
    expect(outputsRefusal(["pdf"], [])?.code).toBe("output_not_viewed");
  });

  it("labels each output, and names a push with the phones left", () => {
    expect(outputsLabels(["sms", "push.android", "pdf"])).toEqual(["PDF", "Push (Android)", "SMS"]);
    expect(outputsLabels(["push.android", "push.ios"])).toEqual(["Push (iPhone, Android)"]);
    expect(OUTPUT_KEYS.map(outputLabel)).toEqual(["PDF", "Web", "Email", "Push (iPhone)", "Push (Android)", "SMS"]);
  });
});

describe("which refused renders mean an output can't be shown", () => {
  const error = (code: RenderError["code"], details?: RenderError["details"]): RenderError =>
    details === undefined ? { code, message: "x" } : { code, message: "x", details };

  it("the version's own reasons do: a character the PDF font can't draw, a document that fails its check, a channel it can't render to", () => {
    expect(outputCannotBeShown(renderFailedGlyphs(["\u{1F600}"]))).toBe(true);
    expect(outputCannotBeShown(renderFailedDocument("pdf", "Tables can have at most 12 columns."))).toBe(true);
    expect(outputCannotBeShown(channelNotAllowed("Disclosure", "email"))).toBe(true);
    expect(outputCannotBeShown(error("channel_not_enabled"))).toBe(true);
    expect(outputCannotBeShown(error("sms_too_long"))).toBe(true);
    expect(outputCannotBeShown(error("push_payload_too_large"))).toBe(true);
    expect(outputCannotBeShown(error("version_not_found"))).toBe(true);
  });

  it("the sample set's values don't: another set may render, and the Preview offers Edit values", () => {
    expect(outputCannotBeShown(error("missing_variables", { missing: ["first_name"], invalid: [] }))).toBe(false);
    expect(outputCannotBeShown(error("invalid_values"))).toBe(false);
  });

  it("an unexplained failure doesn't: the server threw or couldn't be reached, and trying again may work", () => {
    expect(outputCannotBeShown(renderFailed("pdf"))).toBe(false);
    expect(outputCannotBeShown({ code: "render_failed", message: "The preview couldn't be loaded. Check your connection and try again." })).toBe(false);
  });
});
