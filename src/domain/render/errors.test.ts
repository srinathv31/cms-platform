import { describe, expect, it } from "vitest";
import {
  BAD_REQUEST_MESSAGES,
  badRequest,
  bodyTooLarge,
  channelNotAllowed,
  channelNotEnabled,
  consumerRequired,
  invalidValues,
  joinWithAnd,
  missingVariables,
  previewForbidden,
  codePointLabel,
  renderError,
  renderFailed,
  renderFailedDocument,
  renderFailedGlyphs,
  templateNotFound,
  unknownConsumer,
  valuesError,
  versionNotFound,
  versionNotReleased,
  versionRevoked,
  versionSunset,
} from "./errors";
import { RENDER_ERROR_STATUS } from "./types";

const MARCH_1 = new Date("2027-03-01T15:30:00.000Z");

describe("renderError", () => {
  it("leaves details out when there are none", () => {
    expect(renderError("bad_request", "Nope.")).toEqual({ code: "bad_request", message: "Nope." });
    expect("details" in renderError("bad_request", "Nope.")).toBe(false);
  });

  it("keeps details when given", () => {
    expect(renderError("render_failed", "x", { a: 1 })).toEqual({ code: "render_failed", message: "x", details: { a: 1 } });
  });
});

describe("joinWithAnd", () => {
  it.each([
    [[], ""],
    [["PDF"], "PDF"],
    [["PDF", "Web"], "PDF and Web"],
    [["PDF", "Web", "Email"], "PDF, Web and Email"],
  ])("%j → %s", (items, text) => {
    expect(joinWithAnd(items)).toBe(text);
  });
});

describe("fixed messages", () => {
  it.each([
    [badRequest(BAD_REQUEST_MESSAGES.body), "bad_request", "The body must be JSON with version, channel and values."],
    [badRequest(BAD_REQUEST_MESSAGES.channel), "bad_request", "channel must be one of pdf, web, email."],
    [badRequest(BAD_REQUEST_MESSAGES.version), "bad_request", "version must be a version number."],
    [consumerRequired(), "consumer_required", "X-Consumer-Id is required."],
    [bodyTooLarge(), "body_too_large", "The body must be at most 1,000,000 bytes."],
    [unknownConsumer("acme"), "unknown_consumer", 'Consumer "acme" isn\'t registered.'],
    [previewForbidden(), "preview_forbidden", "You can't preview this template."],
    [templateNotFound("UC-4F7K2Q"), "template_not_found", "Template UC-4F7K2Q doesn't exist."],
    [versionNotFound("UC-4F7K2Q", 7), "version_not_found", "Template UC-4F7K2Q has no version 7."],
    [versionNotFound("UC-4F7K2Q", "draft"), "version_not_found", "Template UC-4F7K2Q has no open draft."],
    [renderFailed("pdf"), "render_failed", "The PDF couldn't be rendered. Try again."],
    [renderFailed("web"), "render_failed", "The web page couldn't be rendered. Try again."],
    [renderFailed("email"), "render_failed", "The email couldn't be rendered. Try again."],
  ])("%j", (error, code, message) => {
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("every code has a status", () => {
    expect(RENDER_ERROR_STATUS[templateNotFound("UC-1").code]).toBe(404);
    expect(RENDER_ERROR_STATUS[renderFailed("pdf").code]).toBe(500);
    expect(RENDER_ERROR_STATUS[bodyTooLarge().code]).toBe(413);
  });
});

describe("render_failed with a reason the caller can act on", () => {
  it("a stored document the check refuses: the check's sentence, after the channel's subject", () => {
    expect(renderFailedDocument("pdf", "Tables can have at most 12 columns.")).toEqual({
      code: "render_failed",
      message: "The PDF couldn't be rendered. Tables can have at most 12 columns.",
      details: { reason: "document" },
    });
    expect(renderFailedDocument("email", "Headings can only be levels 1 to 3.").message).toBe(
      "The email couldn't be rendered. Headings can only be levels 1 to 3.",
    );
  });

  it("characters the PDF's fonts can't draw: each once, in order, as U+ code points", () => {
    expect(renderFailedGlyphs(["ạ", "₹"])).toEqual({
      code: "render_failed",
      message: "The PDF couldn't be rendered. Its font can't show these characters: U+1EA1 (ạ), U+20B9 (₹).",
      details: { reason: "glyphs", characters: ["U+1EA1", "U+20B9"] },
    });
    expect(renderFailedGlyphs(["😀", "é", "😀"]).message).toBe(
      "The PDF couldn't be rendered. Its font can't show these characters: U+1F600 (😀), U+00E9 (é).",
    );
    expect(codePointLabel("A")).toBe("U+0041");
  });

  it("names ten characters and counts the rest", () => {
    const characters = [..."ẠạẢảẤấẦầẨẩẪẫẬ"];
    const error = renderFailedGlyphs(characters);
    expect(error.message).toBe(
      "The PDF couldn't be rendered. Its font can't show these characters: " +
        "U+1EA0 (Ạ), U+1EA1 (ạ), U+1EA2 (Ả), U+1EA3 (ả), U+1EA4 (Ấ), U+1EA5 (ấ), U+1EA6 (Ầ), U+1EA7 (ầ), U+1EA8 (Ẩ), U+1EA9 (ẩ) and 3 more.",
    );
    expect(error.details).toEqual({ reason: "glyphs", characters: characters.map(codePointLabel) });
  });
});

describe("channel messages", () => {
  it("names the content type in the plural", () => {
    expect(channelNotAllowed("Disclosure", "sms")).toEqual({
      code: "channel_not_allowed",
      message: "Disclosures don't render to sms.",
      details: { channel: "sms" },
    });
    expect(channelNotAllowed("Disclosure", "email").message).toBe("Disclosures don't render to Email.");
    expect(channelNotAllowed("Policy", "pdf").message).toBe("Policies don't render to PDF.");
    expect(channelNotAllowed("Notices", "pdf").message).toBe("Notices don't render to PDF.");
  });

  it("names the version and its channels", () => {
    expect(channelNotEnabled(2, "email", ["pdf", "web"])).toEqual({
      code: "channel_not_enabled",
      message: "Version 2 doesn't render to Email. Its channels are PDF and Web.",
      details: { channel: "email", channels: ["pdf", "web"] },
    });
  });

  it("calls an unsubmitted draft 'This draft'", () => {
    expect(channelNotEnabled(null, "email", ["pdf", "web"]).message).toBe(
      "This draft doesn't render to Email. Its channels are PDF and Web.",
    );
  });

  it("lists channels in the standard order, whatever order they come in", () => {
    expect(channelNotEnabled(3, "pdf", ["email", "web"]).message).toBe(
      "Version 3 doesn't render to PDF. Its channels are Web and Email.",
    );
  });

  it("handles one channel and none", () => {
    expect(channelNotEnabled(1, "email", ["pdf"]).message).toBe("Version 1 doesn't render to Email. Its only channel is PDF.");
    expect(channelNotEnabled(1, "email", []).message).toBe("Version 1 doesn't render to Email. It has no channels.");
  });
});

describe("version messages", () => {
  it("not released", () => {
    expect(versionNotReleased(3, "in_review", 2)).toEqual({
      code: "version_not_released",
      message: "Version 3 is in review. Version 2 is active.",
      details: { version: 3, activeVersion: 2 },
    });
    expect(versionNotReleased(3, "changes_requested", 2).message).toBe(
      "Version 3 was sent back for changes. Version 2 is active.",
    );
    expect(versionNotReleased(3, "draft", 2).message).toBe("Version 3 is a draft. Version 2 is active.");
    expect(versionNotReleased(1, "in_review", null).message).toBe("Version 1 is in review. No version is active yet.");
  });

  it("sunset: the day in the business time zone, the instant in details", () => {
    // 00:00 Eastern on March 1 is 05:00 UTC.
    const sunsetAt = new Date("2027-03-01T05:00:00.000Z");
    expect(versionSunset(1, sunsetAt, 2, "America/New_York")).toEqual({
      code: "version_sunset",
      message: "Version 1 was sunset on March 1, 2027. Version 2 is active.",
      details: { version: 1, activeVersion: 2, at: "2027-03-01T05:00:00.000Z" },
    });
    expect(versionSunset(1, sunsetAt, null, "America/New_York").message).toBe(
      "Version 1 was sunset on March 1, 2027. No version is active.",
    );
    // A zone ahead of UTC: 00:00 on March 1 in Kolkata is still February 28 in UTC.
    expect(versionSunset(1, new Date("2027-02-28T18:30:00.000Z"), 2, "Asia/Kolkata").message).toBe(
      "Version 1 was sunset on March 1, 2027. Version 2 is active.",
    );
  });

  it("revoked, with and without a date", () => {
    expect(versionRevoked(1, MARCH_1, 2)).toEqual({
      code: "version_revoked",
      message: "Version 1 was revoked on March 1, 2027. Version 2 is active.",
      details: { version: 1, activeVersion: 2, at: "2027-03-01T15:30:00.000Z" },
    });
    expect(versionRevoked(1, null, 2)).toEqual({
      code: "version_revoked",
      message: "Version 1 was revoked. Version 2 is active.",
      details: { version: 1, activeVersion: 2 },
    });
    expect(versionRevoked(2, null, null).message).toBe("Version 2 was revoked. No version is active.");
  });
});

describe("value messages", () => {
  const details = {
    missing: ["first_name", "purchase_apr"],
    invalid: [{ key: "home_state", expected: "us_state" as const }],
  };

  it("missing, then invalid, under missing_variables", () => {
    expect(missingVariables(details)).toEqual({
      code: "missing_variables",
      message: "Missing required variables: first_name, purchase_apr. home_state must be a US state, like NJ.",
      details,
    });
  });

  it("invalid only", () => {
    const only = { missing: [], invalid: details.invalid };
    expect(invalidValues(only)).toEqual({
      code: "invalid_values",
      message: "home_state must be a US state, like NJ.",
      details: only,
    });
  });

  it("a value over the length limit names the limit instead of the type", () => {
    const tooLong = { missing: [], invalid: [{ key: "first_name", expected: "text" as const, maxLength: 1000 }, ...details.invalid] };
    expect(invalidValues(tooLong)).toEqual({
      code: "invalid_values",
      message: "first_name must be at most 1,000 characters. home_state must be a US state, like NJ.",
      details: tooLong,
    });
  });

  it("valuesError picks the code", () => {
    expect(valuesError(details).code).toBe("missing_variables");
    expect(valuesError({ missing: [], invalid: details.invalid }).code).toBe("invalid_values");
  });
});
