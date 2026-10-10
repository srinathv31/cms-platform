// The one renderer for the message channels, Push and SMS. Pure TypeScript, with no framework and no
// clock, so the same function runs in the browser (the composer's live preview, on every keystroke)
// and on the server (the render route's engine and the golden files). What an author sees in the
// preview is, byte for byte, what a consumer gets (docs/render-spec.md §10).
//
// A message renders its own fields (channel-fields.ts) and nothing from the version's body:
//   push  title, subtitle (iPhone only) and body, each one line of text and variables. Android's push
//         never carries the subtitle. Measured as the UTF-8 bytes of the platform's notification JSON.
//   sms   the message, its line breaks kept, then the content type's footer on its own line. Measured in
//         GSM-7 or UCS-2 parts.
//
// Nothing is ever truncated or transliterated: a value prints exactly as sent, even when it switches an
// SMS to UCS-2. What can't be delivered at all is refused: a push over PUSH_MAX_BYTES on its platform,
// an SMS over SMS_MAX_PARTS. The tighter checks (the content type's part budget, the SMS character set,
// public link shorteners) are submit's (lifecycle.ts), against the "long" sample set.
//
// Values come in canonical, as `validateValues` returns them: the engine validates first (stage 6), and
// a browser caller runs `validateValues(variables, sampleValues)` before calling this.

import { assertNever } from "../assert-never";
import {
  channelFieldValue,
  channelFieldsOf,
  fieldCharacters,
  fieldOnPlatform,
  type ChannelField,
  type ChannelFields,
  type FieldOf,
} from "../channel-fields";
import { defaultSampleSets, sampleSetValues } from "@/editor/model/sample-sets";
import { SMS_MAX_PARTS, smsLength } from "../messages/gsm7";
import { PUSH_MAX_BYTES, pushPayloadBytes, type PushPlatform } from "../messages/push";
import type { JSONContent, SampleSet, Variable } from "../types";
import { pushPayloadTooLarge, smsTooLong } from "./errors";
import { resolveInlineField, resolveLinesField } from "./resolve";
import type { CanonicalValues, MessageTarget, PushRender, RenderError, ResolveContext, SmsRender } from "./types";
import { validateValues } from "./validate";

/** The content type's rules a message renders with. */
export interface MessageRules {
  /**
   * The SMS footer (brand and opt-out, "Coral Offers: Reply STOP to opt out, HELP for help."), printed
   * after the message on its own line, exactly as written. Null or "": none.
   */
  smsFooter: string | null;
}

/** What a message renders from, besides its target. */
export interface MessageInput {
  /** The version's channel fields, as stored (`versions.channel_fields`) or as the composer holds them. */
  fields: ChannelFields;
  variables: readonly Variable[];
  /** Canonical values (`validateValues`). A variable with no value prints nothing. */
  values: CanonicalValues;
  rules: MessageRules;
}

/** A push's text for one platform, before it is measured. */
export type PushText = Omit<PushRender, "payloadBytes">;

/** Rendered, or refused with the error the API returns. */
export type MessageResult<T> = { ok: true; output: T } | { ok: false; error: RenderError };

/**
 * A channel field as the text its channel prints: one line (`line`, `paragraph`) or its lines kept
 * (`lines`). A message's field (a push's, an SMS's) loses only control characters: the invisible
 * characters a phone draws with (the joiner in an emoji sequence, a presentation selector, a flag's tags,
 * the non-joiner in a Persian name) stay, in the text and in values. The email's lose them too, as the
 * document does (`fieldCharacters`). `null` gives "". Throws a ResolveError for JSON the resolver can't place.
 */
export function resolveChannelField(value: JSONContent | null, field: FieldOf, ctx: ResolveContext): string {
  const characters = fieldCharacters(field);
  switch (field.shape) {
    case "line":
    case "paragraph":
      return resolveInlineField(value, ctx, characters);
    case "lines":
      return resolveLinesField(value, ctx, characters);
    default:
      return assertNever(field.shape, "field shape");
  }
}

/**
 * The message's text, variables resolved, before anything is measured or refused: the push for its
 * platform (no subtitle on Android, none on iPhone when it's empty), or the SMS with its footer. The
 * preview shows this even when `renderMessage` refuses it.
 */
export function resolveMessage(target: { channel: "push"; platform: PushPlatform }, input: MessageInput): PushText;
export function resolveMessage(target: { channel: "sms" }, input: MessageInput): string;
export function resolveMessage(target: MessageTarget, input: MessageInput): PushText | string;
export function resolveMessage(target: MessageTarget, input: MessageInput): PushText | string {
  switch (target.channel) {
    case "push": {
      // Only the fields the platform shows: Android has no subtitle (the registry's `platforms`).
      const text = textOf(
        channelFieldsOf("push").filter((field) => fieldOnPlatform(field, target.platform)),
        input,
      );
      return { title: text.title ?? "", ...(text.subtitle ? { subtitle: text.subtitle } : {}), body: text.body ?? "" };
    }
    case "sms":
      return withFooter(textOf(channelFieldsOf("sms"), input).text ?? "", input.rules.smsFooter);
    default:
      return assertNever(target, "message target");
  }
}

/**
 * Renders a message channel: Push for one platform, or SMS. The push is measured as its platform's
 * notification JSON and refused past PUSH_MAX_BYTES (push_payload_too_large); the SMS is measured in
 * parts and refused past SMS_MAX_PARTS (sms_too_long). Never truncates, never transliterates.
 */
export function renderMessage(target: { channel: "push"; platform: PushPlatform }, input: MessageInput): MessageResult<PushRender>;
export function renderMessage(target: { channel: "sms" }, input: MessageInput): MessageResult<SmsRender>;
export function renderMessage(target: MessageTarget, input: MessageInput): MessageResult<PushRender | SmsRender>;
export function renderMessage(target: MessageTarget, input: MessageInput): MessageResult<PushRender | SmsRender> {
  switch (target.channel) {
    case "push": {
      const push = resolveMessage(target, input);
      const payloadBytes = pushPayloadBytes(target.platform, push);
      if (payloadBytes > PUSH_MAX_BYTES) return { ok: false, error: pushPayloadTooLarge(target.platform, payloadBytes) };
      return { ok: true, output: { ...push, payloadBytes } };
    }
    case "sms": {
      const text = resolveMessage(target, input);
      const length = smsLength(text);
      if (length.parts > SMS_MAX_PARTS) return { ok: false, error: smsTooLong(length) };
      return { ok: true, output: { text, encoding: length.encoding, parts: length.parts, characters: length.characters } };
    }
    default:
      return assertNever(target, "message target");
  }
}

/** The SMS as sent: the message, then the footer on its own line. Either may be empty. */
export function withFooter(message: string, footer: string | null): string {
  if (!footer) return message;
  return message ? `${message}\n${footer}` : footer;
}

/**
 * The "long" sample values that submit measures a message with (`submit` in lifecycle.ts) and the
 * composer's "Long values" line shows: the version's "long" set, or the generated one when it has none,
 * its gaps filled from the defaults (`sampleSetValues`), canonical. Null when they don't validate: then
 * there is nothing to measure, and the preview says why. `today` is YYYY-MM-DD (the demo clock's day).
 */
export function longSampleValues(
  version: { variables: readonly Variable[]; sampleSets: readonly SampleSet[] },
  today: string,
): CanonicalValues | null {
  const set =
    version.sampleSets.find((s) => s.id === "long") ??
    defaultSampleSets(version.variables, today).find((s) => s.id === "long")!;
  const validated = validateValues(version.variables, sampleSetValues(set, version.variables, today));
  return validated.ok ? validated.values : null;
}

/** The fields, each resolved to its text, by key. */
function textOf(fields: readonly ChannelField[], input: MessageInput): Readonly<Record<string, string>> {
  const ctx: ResolveContext = { variables: input.variables, values: input.values };
  return Object.fromEntries(
    fields.map((field) => [field.key, resolveChannelField(channelFieldValue(input.fields, field), field, ctx)]),
  );
}
