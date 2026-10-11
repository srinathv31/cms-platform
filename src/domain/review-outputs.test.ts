import { describe, expect, it } from "vitest";
import {
  OUTPUT_KEYS,
  OUTPUT_REFUSALS,
  channelOutputs,
  isOutputKey,
  missingOutputs,
  outputKey,
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

  it("labels each output, and names a push with the phones left", () => {
    expect(outputsLabels(["sms", "push.android", "pdf"])).toEqual(["PDF", "Push (Android)", "SMS"]);
    expect(outputsLabels(["push.android", "push.ios"])).toEqual(["Push (iPhone, Android)"]);
    expect(OUTPUT_KEYS.map(outputLabel)).toEqual(["PDF", "Web", "Email", "Push (iPhone)", "Push (Android)", "SMS"]);
  });
});
