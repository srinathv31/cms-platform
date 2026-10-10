// The message channels' preview, rendered in the browser (decision 0036). A push or an SMS is plain
// text, so the preview doesn't ask the render route for it: it runs the route's own pure function,
// `renderMessage` (src/domain/render/message.ts), on the fields as they are now (the composer's,
// unsaved keystrokes included, or a version's stored ones on the review screen) and the selected
// sample set, on every change. What the phone shows is, byte for byte, what a consumer gets.
//
// Three outcomes, each shown its own way:
//   - rendered: the phone, with the text;
//   - refused (an SMS over 10 parts, a push over 4,096 bytes): the phone still shows the text
//     (`resolveMessage`, the same text without the limits), with the route's sentence above it;
//   - values that don't render (a required value missing, a date that isn't one): the error state, in
//     the route's words, as for any channel (`OutputError`). Nothing is drawn.

import type { ChannelFields } from "@/domain/channel-fields";
import { assertNever } from "@/domain/assert-never";
import { SMS_MAX_PARTS } from "@/domain/messages/gsm7";
import { PUSH_MAX_BYTES, type PushPlatform } from "@/domain/messages/push";
import { formatCount } from "@/domain/numbers";
import { renderFailedDocument } from "@/domain/render/errors";
import { renderMessage, resolveMessage, type MessageRules, type PushText } from "@/domain/render/message";
import { ResolveError } from "@/domain/render/resolve";
import type { RenderError } from "@/domain/render/types";
import { validateValues } from "@/domain/render/validate";
import type { Variable, VariableValues } from "@/domain/types";

/** Which message to render: a push for one platform, or the SMS. */
export type MessagePreviewTarget = { channel: "push"; platform: PushPlatform } | { channel: "sms" };

export interface MessagePreviewInput {
  /** The fields as they are now: the composer's live values, or a version's stored ones. */
  fields: ChannelFields;
  /** The variables as the editor has them now (the review screen: the version's). */
  variables: readonly Variable[];
  /** The selected sample set's values, as the switcher resolves them (not yet validated). */
  values: VariableValues;
  rules: MessageRules;
}

/** What the phone shows. `refusal` is the route's sentence when it would refuse this message. */
export type MessageOutput =
  | { kind: "push"; platform: PushPlatform; push: PushText; refusal: RenderError | null }
  | { kind: "sms"; text: string; refusal: RenderError | null };

/** The phone's content, or why there is none: the values don't render. */
export type MessagePreview = { ok: true; output: MessageOutput } | { ok: false; error: RenderError };

/** Renders a message channel as the route would, on the values given. Pure; never throws. */
export function renderMessagePreview(target: MessagePreviewTarget, input: MessagePreviewInput): MessagePreview {
  const checked = validateValues(input.variables, input.values);
  if (!checked.ok) return { ok: false, error: checked.error };
  const message = { fields: input.fields, variables: input.variables, values: checked.values, rules: input.rules };
  try {
    switch (target.channel) {
      case "push": {
        const result = renderMessage(target, message);
        const push: PushText = result.ok ? textOf(result.output) : resolveMessage(target, message);
        return { ok: true, output: { kind: "push", platform: target.platform, push, refusal: result.ok ? null : result.error } };
      }
      case "sms": {
        const result = renderMessage(target, message);
        const text = result.ok ? result.output.text : resolveMessage(target, message);
        return { ok: true, output: { kind: "sms", text, refusal: result.ok ? null : result.error } };
      }
      default:
        return assertNever(target, "message target");
    }
  } catch (error) {
    // Only a field the resolver can't place, which the editor never makes: say so as the route would.
    if (error instanceof ResolveError) return { ok: false, error: renderFailedDocument(target.channel, error.message) };
    throw error;
  }
}

/**
 * What a screen reader hears when a message turns refused: the limit it went over, in words that don't
 * change as the author types on ("The SMS is over 10 parts."). The route's own sentence carries the live
 * size, so it is shown but not announced.
 */
export function refusalNotice(refusal: RenderError): string {
  switch (refusal.code) {
    case "sms_too_long":
      return `The SMS is over ${formatCount(SMS_MAX_PARTS)} parts.`;
    case "push_payload_too_large":
      return `The push is over ${formatCount(PUSH_MAX_BYTES)} bytes.`;
    default:
      return "This message can't be sent as it is.";
  }
}

/** The push's text, without its measurement. */
function textOf({ title, subtitle, body }: PushText & { payloadBytes?: number }): PushText {
  return subtitle === undefined ? { title, body } : { title, subtitle, body };
}
