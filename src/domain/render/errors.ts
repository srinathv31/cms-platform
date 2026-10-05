// The render route's errors: one constructor and the exact message builders. Pure TypeScript.
//
// Messages are plain sentences for the people integrating; the simulator shows them as is. They
// name keys, types, versions, channels and ids, and NEVER echo a submitted variable value.

import { CHANNELS, type Channel, type VariableType, type VersionState } from "../types";
import type {
  InvalidValue,
  RenderError,
  RenderErrorCode,
  ValueErrorDetails,
  VersionErrorDetails,
} from "./types";

/** An error body's payload. `details` is left out when there are none. */
export function renderError(code: RenderErrorCode, message: string, details?: RenderError["details"]): RenderError {
  return details === undefined ? { code, message } : { code, message, details };
}

// ── Formatting ───────────────────────────────────────────────────────────────

const longDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "March 1, 2027": the same style as `formatValue`'s dates (en-US, UTC). */
export function formatLongDate(date: Date): string {
  return longDate.format(date);
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortDateYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "Mar 1", or "Mar 1, 2027" when `now` is given and the date isn't in its year. UTC, like
 * `formatLongDate`: a sunset is a calendar day stored as that day's midnight UTC, so it reads as
 * the same day in every time zone.
 */
export function formatShortDate(date: Date, now?: Date): string {
  return (!now || date.getUTCFullYear() === now.getUTCFullYear() ? shortDate : shortDateYear).format(date);
}

/** How a channel is named in messages. */
export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = { pdf: "PDF", web: "Web", email: "Email" };

/** "PDF", "PDF and Web", "PDF, Web and Email". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function channelLabel(channel: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}

/** "Disclosure" → "Disclosures", "Policy" → "Policies", "Notices" stays. */
function plural(name: string): string {
  if (/s$/i.test(name)) return name;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

// ── 400 / 403 ────────────────────────────────────────────────────────────────

/** The fixed bad_request sentences. */
export const BAD_REQUEST_MESSAGES = {
  body: "The body must be JSON with version, channel and values.",
  channel: `channel must be one of ${CHANNELS.join(", ")}.`,
  version: "version must be a version number.",
} as const;

export function badRequest(message: string): RenderError {
  return renderError("bad_request", message);
}

export function consumerRequired(): RenderError {
  return renderError("consumer_required", "X-Consumer-Id is required.");
}

/** `Consumer "acme" isn't registered.` */
export function unknownConsumer(consumerId: string): RenderError {
  return renderError("unknown_consumer", `Consumer "${consumerId}" isn't registered.`);
}

export function previewForbidden(): RenderError {
  return renderError("preview_forbidden", "You can't preview this template.");
}

// ── 404 ──────────────────────────────────────────────────────────────────────

/** "Template UC-4F7K2Q doesn't exist." */
export function templateNotFound(templateId: string): RenderError {
  return renderError("template_not_found", `Template ${templateId} doesn't exist.`);
}

/** "Template UC-4F7K2Q has no version 7." / "Template UC-4F7K2Q has no open draft." */
export function versionNotFound(templateId: string, version: number | "draft"): RenderError {
  const what = version === "draft" ? "open draft" : `version ${version}`;
  return renderError("version_not_found", `Template ${templateId} has no ${what}.`);
}

// ── 409 / 410: version rules ─────────────────────────────────────────────────

function versionDetails(version: number, activeVersion: number | null, at: Date | null): VersionErrorDetails {
  return at ? { version, activeVersion, at: at.toISOString() } : { version, activeVersion };
}

/** "Version 2 is active." or, with none, the given fallback. */
function activeSentence(activeVersion: number | null, none: string): string {
  return activeVersion === null ? none : `Version ${activeVersion} is active.`;
}

/**
 * "Version 3 is in review. Version 2 is active." / "Version 3 was sent back for changes. …" /
 * "Version 3 is a draft. …"; with no active version, "… No version is active yet."
 */
export function versionNotReleased(
  version: number,
  state: Extract<VersionState, "draft" | "in_review" | "changes_requested">,
  activeVersion: number | null,
): RenderError {
  const what =
    state === "in_review" ? "is in review" : state === "changes_requested" ? "was sent back for changes" : "is a draft";
  return renderError(
    "version_not_released",
    `Version ${version} ${what}. ${activeSentence(activeVersion, "No version is active yet.")}`,
    versionDetails(version, activeVersion, null),
  );
}

/** "Version 1 was sunset on March 1, 2027. Version 2 is active." / "… No version is active." */
export function versionSunset(version: number, sunsetAt: Date, activeVersion: number | null): RenderError {
  return renderError(
    "version_sunset",
    `Version ${version} was sunset on ${formatLongDate(sunsetAt)}. ${activeSentence(activeVersion, "No version is active.")}`,
    versionDetails(version, activeVersion, sunsetAt),
  );
}

/** "Version 1 was revoked on March 1, 2027. Version 2 is active."; without a date, "Version 1 was revoked. …" */
export function versionRevoked(version: number, revokedAt: Date | null, activeVersion: number | null): RenderError {
  const when = revokedAt ? ` on ${formatLongDate(revokedAt)}` : "";
  return renderError(
    "version_revoked",
    `Version ${version} was revoked${when}. ${activeSentence(activeVersion, "No version is active.")}`,
    versionDetails(version, activeVersion, revokedAt),
  );
}

// ── 422: channels ────────────────────────────────────────────────────────────

/** The content type doesn't allow the channel: "Disclosures don't render to sms." */
export function channelNotAllowed(contentTypeName: string, channel: string): RenderError {
  return renderError("channel_not_allowed", `${plural(contentTypeName)} don't render to ${channelLabel(channel)}.`, {
    channel,
  });
}

/**
 * The version doesn't have the channel turned on:
 * "Version 2 doesn't render to Email. Its channels are PDF and Web."
 * "This draft doesn't render to Email. Its channels are PDF and Web."
 */
export function channelNotEnabled(versionNumber: number | null, channel: Channel, enabled: readonly Channel[]): RenderError {
  const subject = versionNumber === null ? "This draft" : `Version ${versionNumber}`;
  const labels = CHANNELS.filter((c) => enabled.includes(c)).map((c) => CHANNEL_LABELS[c]);
  const its =
    labels.length === 0
      ? "It has no channels."
      : labels.length === 1
        ? `Its only channel is ${labels[0]}.`
        : `Its channels are ${joinWithAnd(labels)}.`;
  return renderError("channel_not_enabled", `${subject} doesn't render to ${channelLabel(channel)}. ${its}`, {
    channel,
    channels: CHANNELS.filter((c) => enabled.includes(c)),
  });
}

// ── 422: values ──────────────────────────────────────────────────────────────

/** What a value of each type must be: "{key} must be {noun}." */
export const VALUE_NOUNS: Readonly<Record<VariableType, string>> = {
  text: "text",
  currency: "an amount, like 1000.00",
  percent: "a percentage, like 21.99",
  date: "a date, like 2027-03-04",
  number: "a number, like 20000",
  us_state: "a US state, like NJ",
};

function missingSentence(missing: readonly string[]): string {
  return `Missing required variables: ${missing.join(", ")}.`;
}

function invalidSentences(invalid: readonly InvalidValue[]): string[] {
  return invalid.map(({ key, expected }) => `${key} must be ${VALUE_NOUNS[expected]}.`);
}

/**
 * "Missing required variables: first_name, purchase_apr." followed by any invalid-value
 * sentences. Use when at least one required variable is missing.
 */
export function missingVariables(details: ValueErrorDetails): RenderError {
  const message = [missingSentence(details.missing), ...invalidSentences(details.invalid)].join(" ");
  return renderError("missing_variables", message, details);
}

/** "purchase_apr must be a percentage, like 21.99." One sentence per key. */
export function invalidValues(details: ValueErrorDetails): RenderError {
  return renderError("invalid_values", invalidSentences(details.invalid).join(" "), details);
}

/** missing_variables when anything is missing, otherwise invalid_values. */
export function valuesError(details: ValueErrorDetails): RenderError {
  return details.missing.length > 0 ? missingVariables(details) : invalidValues(details);
}

// ── 500 ──────────────────────────────────────────────────────────────────────

const RENDER_FAILED_SUBJECT: Readonly<Record<Channel, string>> = {
  pdf: "The PDF",
  web: "The web page",
  email: "The email",
};

/** "The PDF couldn't be rendered. Try again." */
export function renderFailed(channel: Channel): RenderError {
  return renderError("render_failed", `${RENDER_FAILED_SUBJECT[channel]} couldn't be rendered. Try again.`);
}
