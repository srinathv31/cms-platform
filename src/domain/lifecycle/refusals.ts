// The refusal table of the lifecycle transitions. They refuse with a code and a one-line reason
// (`{ ok: false, code, reason }`) rather than throwing: a second tab or a slower colleague gets there
// first, and the person reads why. The table is whole and in one place, with its codes and sentences, so
// `src/domain/refusals.test.ts` can check that no code is used twice.

import { fieldNoun, type ChannelFieldSpec } from "../channel-fields";
import { PUSH_MAX_BYTES, type PushPlatform } from "../messages/push";
import { formatCount } from "../numbers";
import { plural } from "../plural";
import { refusal } from "../refusals";
import { characterLabel, joinWithAnd, PLATFORM_LABELS } from "../render/errors";
import { TEMPLATE_KIND_LABELS, type ChannelFamily } from "../types";
import { unique } from "./helpers";

/** `{{a}}`, `{{a}} and {{b}}`, `{{a}}, {{b}} and {{c}}`. */
function listKeys(keys: readonly string[]): string {
  const named = keys.map((key) => `{{${key}}}`);
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * What a refused submit or review transition returns: a code to branch on and the sentence people read
 * (maker-checker refusals come from `REASONS`).
 */
export const REFUSALS = {
  /** New template (`newTemplateContentType`): "No content type makes alerts yet." */
  noContentType: refusal(
    "no_content_type",
    (family: ChannelFamily) => `No content type makes ${TEMPLATE_KIND_LABELS[family].toLowerCase()}s yet.`,
  ),
  /** Edit (`planDraftStart`): a newer version is in review, so a draft now would fork the template. */
  newerInReview: refusal("newer_in_review", "A newer version is in review."),
  notEditable: refusal("not_editable", "Only an Active or Revoked template can be edited."),
  alreadyInReview: refusal("already_in_review", "This version is already in review."),
  notDraft: refusal("not_draft", "Only a draft can be submitted."),
  /** `submit` and a draft save (`draftChannelsRefusal`): a version with no channel renders nothing and skips every channel's rules. */
  noChannels: refusal("no_channels", "Turn on at least one channel."),
  /** A draft save (`draftChannelsRefusal`): a channel its content type doesn't allow, which would mix families. */
  channelNotAllowed: refusal("channel_unavailable", "That channel isn't available for this content type."),
  /** `submit`, when the draft changed after the summary the submitter saw. The submit dialog offers to refresh it. */
  summaryStale: refusal("summary_stale", "This draft changed after this summary was made."),
  undefinedVariables: refusal(
    "undefined_variables",
    (keys: readonly string[]) => `Define or remove ${listKeys(keys)} before submitting.`,
  ),
  /** `submit`, when a required channel field (channel-fields.ts) is blank: "Add an email subject before submitting." */
  fieldMissing: refusal(
    "field_missing",
    (field: Pick<ChannelFieldSpec, "name">) => `Add ${fieldNoun(field)} before submitting.`,
  ),
  /**
   * `submit`: characters the author typed in an SMS that aren't in GSM-7, each once, in order:
   * "Replace ’ and – in the SMS message before submitting. They aren't in the SMS character set."
   */
  smsCharacters: refusal("sms_characters", (field: Pick<ChannelFieldSpec, "name">, chars: readonly string[]) => {
    const labels = unique(chars.map(characterLabel));
    const they = labels.length === 1 ? "It isn't" : "They aren't";
    return `Replace ${joinWithAnd(labels)} in the ${field.name} before submitting. ${they} in the SMS character set.`;
  }),
  /** `submit`: "With the long sample values, the SMS is 4 parts. Keep it to 3 parts or fewer." */
  smsParts: refusal(
    "sms_too_many_parts",
    (parts: number, max: number) =>
      `With the long sample values, the SMS is ${plural(parts, "part")}. Keep it to ${plural(max, "part")} or fewer.`,
  ),
  /** `submit`: "The SMS message links through bit.ly, a public link shortener carriers filter. Use a link on your own domain." */
  publicShortener: refusal(
    "public_shortener",
    (field: Pick<ChannelFieldSpec, "name">, domains: readonly string[]) => {
      const names = unique(domains);
      const what = names.length === 1 ? "a public link shortener" : "public link shorteners";
      return `The ${field.name} links through ${joinWithAnd(names)}, ${what} carriers filter. Use a link on your own domain.`;
    },
  ),
  /** `submit`: "With the long sample values, the push is 4,321 bytes on iPhone. It can be at most 4,096 bytes." */
  pushTooLarge: refusal(
    "push_too_large",
    (platform: PushPlatform, bytes: number) =>
      `With the long sample values, the push is ${formatCount(bytes)} bytes on ${PLATFORM_LABELS[platform]}. It can be at most ${formatCount(PUSH_MAX_BYTES)} bytes.`,
  ),
  notInReview: refusal("not_in_review", "This version isn't in review."),
  stageMissing: refusal("stage_missing", "This version's approval stage no longer exists."),
  giveReason: refusal("reason_missing", "Give a reason."),
  sunsetAfterToday: refusal("sunset_not_after_today", "Pick a date after today."),
  sunsetNotSuperseded: refusal("sunset_not_superseded", "Only a Superseded version can have a sunset date."),
  sunsetPassed: refusal("sunset_passed", "This version's sunset has passed. It can't render again."),
  notRevocable: refusal("not_revocable", "Only an Active or Superseded version can be revoked."),
  alreadyRevoked: refusal("already_revoked", "This version is already revoked."),
  revokePending: refusal("revoke_pending", "A revoke is already waiting for confirmation."),
  noRevokePending: refusal("no_revoke_pending", "There's no revoke waiting for confirmation."),
  approvedEarlierStage: refusal("approved_earlier_stage", "You approved an earlier stage."),
} as const;
