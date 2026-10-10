// The channel fields registry: the short fields a channel renders of its own, beside or instead of the
// body. Email prints its subject and preheader beside the document; Push and SMS print only their own
// fields (a push's title, subtitle and body; an SMS's message), never anything from a body. Everything
// that stores, saves, checks, submits or renders a channel field loops over this registry rather than
// naming fields, so a channel's fields are declared here and nowhere else.
//
// How a version stores them: one JSON column, `versions.channel_fields` (`ChannelFields`), keyed by
// channel and then by field key, each value the field's stored document (one paragraph of text and
// variable chips, as `prepareField` makes it):
//
//   { "email": { "subject": { "type": "doc", … }, "preheader": { "type": "doc", … } } }
//
// A field with no value is absent, and so is a channel with no field set: `{}` is a version without
// any. A field keeps its value while its channel is off (the workspace hides the field, it doesn't drop
// it), and only the channel's own render reads it.
//
// How the workspace and autosave hold them: flat, one entry per field id ("email.subject"), null when the
// field has no value (`ChannelFieldValues`). A draft patch carries the ids that changed
// (`ChannelFieldsPatch`), and the server lays them over the stored column (`withChannelFieldValues`).

import {
  fieldProblem,
  normalizeAndCheckField,
  type Checked,
  type FieldCheck,
  type FieldProblem,
} from "@/editor/model/document-check";
import type { CharacterRules } from "@/editor/model/characters";
import type { FieldLines } from "@/editor/model/normalize";
import { assertNever } from "./assert-never";
import type { PushPlatform } from "./messages/push";
import { withArticle } from "./plural";
import { PLATFORM_LABELS } from "./render/errors";
import { CHANNELS, channelFamily, type Channel, type JSONContent } from "./types";

// ── The registry ──────────────────────────────────────────────

/**
 * What a field holds. Every shape is plain text and variable chips in one paragraph: no marks, no links
 * (the editor's `InlineVariableField`; saved through `normalizeField` and checked by `fieldProblem`).
 *   - `line`: one line, no line breaks: a header or a title (the email subject, a push title).
 *   - `paragraph`: no line breaks either, but long enough to wrap where it is shown (a push body).
 *   - `lines`: line breaks allowed, each a hard break (an SMS message). Enter adds one.
 * A line break typed or pasted into a `line` or `paragraph` field is saved as a space.
 */
export const FIELD_SHAPES = ["line", "paragraph", "lines"] as const;
export type FieldShape = (typeof FIELD_SHAPES)[number];

/** One field of a channel, as the registry declares it. */
export interface ChannelFieldSpec {
  /** Its key under the channel in `channel_fields`, and the second half of its id: "subject". */
  readonly key: string;
  /** The label over the field: "Subject". */
  readonly label: string;
  /**
   * The field as a sentence names it, in lower case unless a word is an acronym: "email subject". Its
   * accessible name is this with a capital (`fieldName`), and a missing one reads "Add an email subject
   * before submitting."
   */
  readonly name: string;
  readonly shape: FieldShape;
  /** Submit refuses while the field is blank (no text and no chip) and its channel is on. */
  readonly required: boolean;
  /**
   * A push field shown on only some platforms: the subtitle is iPhone-only, so Android's output and
   * preview leave it out. Absent: every platform.
   */
  readonly platforms?: readonly PushPlatform[];
  /**
   * Submit refuses a link on a public URL shortener in the text the author typed (`findPublicShorteners`):
   * carriers filter them (CTIA). Set on the fields that carry a link to a customer: a push body, an SMS.
   */
  readonly refusesShorteners?: true;
}

/** Every channel's fields, in the order the workspace shows them and submit checks them. */
export const CHANNEL_FIELDS = {
  pdf: [],
  web: [],
  email: [
    { key: "subject", label: "Subject", name: "email subject", shape: "line", required: true },
    { key: "preheader", label: "Preheader", name: "email preheader", shape: "line", required: false },
  ],
  push: [
    { key: "title", label: "Title", name: "push title", shape: "line", required: true },
    { key: "subtitle", label: "Subtitle", name: "push subtitle", shape: "line", required: false, platforms: ["ios"] },
    { key: "body", label: "Body", name: "push body", shape: "paragraph", required: true, refusesShorteners: true },
  ],
  sms: [{ key: "text", label: "Message", name: "SMS message", shape: "lines", required: true, refusesShorteners: true }],
} as const satisfies { readonly [C in Channel]: readonly ChannelFieldSpec[] };

/** A channel's field keys: `ChannelFieldKey<"email">` is "subject" | "preheader". */
export type ChannelFieldKey<C extends Channel> = (typeof CHANNEL_FIELDS)[C][number]["key"];

/** A field's id, its channel and key: "email.subject". The workspace's and autosave's name for it. */
export type ChannelFieldId = { [C in Channel]: `${C}.${ChannelFieldKey<C>}` }[Channel];

/** A field with its channel and id: what the loops get. */
export interface ChannelField extends ChannelFieldSpec {
  readonly id: ChannelFieldId;
  readonly channel: Channel;
}

/** Every field of every channel, in `CHANNELS` order and then the registry's. */
export const ALL_CHANNEL_FIELDS: readonly ChannelField[] = CHANNELS.flatMap((channel) =>
  (CHANNEL_FIELDS[channel] as readonly ChannelFieldSpec[]).map((spec) => ({
    ...spec,
    channel,
    id: `${channel}.${spec.key}` as ChannelFieldId,
  })),
);

/** Every field id, in the same order. */
export const CHANNEL_FIELD_IDS: readonly ChannelFieldId[] = ALL_CHANNEL_FIELDS.map((field) => field.id);

/** One channel's fields, in the registry's order. */
export function channelFieldsOf(channel: Channel): readonly ChannelField[] {
  return ALL_CHANNEL_FIELDS.filter((field) => field.channel === channel);
}

/** The fields of the channels that are on, in `CHANNELS` order whatever the order of `channels`. */
export function fieldsOfChannels(channels: readonly Channel[]): readonly ChannelField[] {
  return ALL_CHANNEL_FIELDS.filter((field) => channels.includes(field.channel));
}

/** The field's accessible name, and how a heading or a label that stands alone names it: "Email subject". */
export function fieldName(field: Pick<ChannelFieldSpec, "name">): string {
  return field.name.charAt(0).toUpperCase() + field.name.slice(1);
}

/** The field with its article, for a sentence: "an email subject". */
export function fieldNoun(field: Pick<ChannelFieldSpec, "name">): string {
  return withArticle(field.name);
}

/**
 * The heading over a channel's fields where they show together, as a message's sections (the composer,
 * the review, Compare) or a document's email details: "Push notification", "Text message", "Email".
 */
export function channelFieldsHeading(channel: Channel): string {
  switch (channel) {
    case "email":
      return "Email";
    case "push":
      return "Push notification";
    case "sms":
      return "Text message";
    case "pdf":
    case "web":
      throw new Error(`The ${channel} channel has no fields`);
    default:
      return assertNever(channel, "channel");
  }
}

/** The quiet tag beside a field only some push platforms show: "iPhone only". Null when every platform shows it. */
export function fieldPlatformTag(field: Pick<ChannelFieldSpec, "platforms">): string | null {
  if (field.platforms === undefined) return null;
  return `${field.platforms.map((platform) => PLATFORM_LABELS[platform]).join(" and ")} only`;
}

// ── Shapes ────────────────────────────────────────────────────

/**
 * A field as every save takes it: normalized for its shape, then checked. The workspace runs it before
 * a save is sent and the server before one is stored (`prepareField`), so both refuse the same fields
 * with the same sentence.
 */
export function normalizeAndCheckChannelField(field: FieldOf, doc: JSONContent): Checked {
  return normalizeAndCheckField(doc, fieldCheck(field));
}

/** The field check alone, on a stored field: null when it passes, else the problem to refuse it with. */
export function channelFieldProblem(field: FieldOf, doc: JSONContent): FieldProblem | null {
  return fieldProblem(doc, fieldCheck(field));
}

/** What the checks need to know about a field: its channel (which sentence) and its shape (which lines). */
export type FieldOf = Pick<ChannelField, "channel" | "shape">;

function fieldCheck(field: FieldOf): FieldCheck {
  return { lines: fieldLines(field.shape), problem: fieldProblemFor(field.channel), characters: fieldCharacters(field) };
}

/**
 * Which characters a field's text keeps (src/editor/model/characters.ts): a message's fields (Push, SMS) keep
 * the invisible characters a phone draws with (the joiner in 👨‍👩‍👧, the non-joiner in a Persian name) and lose
 * only control characters; the email's fields lose both, as the document does.
 */
export function fieldCharacters(field: Pick<ChannelField, "channel">): CharacterRules {
  return channelFamily(field.channel) === "message" ? "message" : "document";
}

/** How a field of this shape holds its lines: only `lines` keeps line breaks. */
export function fieldLines(shape: FieldShape): FieldLines {
  switch (shape) {
    case "line":
    case "paragraph":
      return "line";
    case "lines":
      return "lines";
    default:
      return assertNever(shape, "field shape");
  }
}

/** The sentence a channel's field is refused with ("The SMS message can hold only text, line breaks and variables."). */
function fieldProblemFor(channel: Channel): FieldProblem {
  switch (channel) {
    case "email":
      return "field";
    case "push":
      return "pushField";
    case "sms":
      return "smsField";
    case "pdf":
    case "web":
      throw new Error(`The ${channel} channel has no fields`);
    default:
      return assertNever(channel, "channel");
  }
}

/**
 * The text the author typed into a field: its text, each hard break or paragraph break as "\n", and each
 * variable chip as `chip` (a value isn't the author's text). What submit's character and link checks
 * read. `null` gives "".
 */
export function typedText(doc: JSONContent | null, chip = " "): string {
  if (!doc) return "";
  switch (doc.type) {
    case "text":
      return typeof doc.text === "string" ? doc.text : "";
    case "hardBreak":
      return "\n";
    case "variable":
      return chip;
    case "doc":
      return (doc.content ?? []).map((block) => typedText(block, chip)).join("\n");
    default:
      return (doc.content ?? []).map((child) => typedText(child, chip)).join("");
  }
}

/** Whether a field shows on a push platform: the subtitle shows only on iPhone. */
export function fieldOnPlatform(field: Pick<ChannelFieldSpec, "platforms">, platform: PushPlatform): boolean {
  return field.platforms === undefined || field.platforms.includes(platform);
}

// ── Stored and flat values ────────────────────────────────────

/**
 * `versions.channel_fields`: by channel, then by field key, the field's stored document. A field with no
 * value is absent, and so is a channel with none.
 */
export type ChannelFields = { [C in Channel]?: { [K in ChannelFieldKey<C>]?: JSONContent } };

/** Every field by id, null when it has no value: how the workspace holds the fields. */
export type ChannelFieldValues = { [Id in ChannelFieldId]: JSONContent | null };

/** The fields a draft save changes, by id: a document sets one, null clears it. */
export type ChannelFieldsPatch = Partial<ChannelFieldValues>;

type Loose = Partial<Record<Channel, Record<string, JSONContent | undefined>>>;

/** The field's value, or null when it has none. */
export function channelFieldValue(fields: ChannelFields, field: Pick<ChannelField, "channel" | "key">): JSONContent | null {
  return (fields as Loose)[field.channel]?.[field.key] ?? null;
}

/** Every field's value by id (null for none): the flat form of what a version stores. */
export function channelFieldValues(fields: ChannelFields): ChannelFieldValues {
  return Object.fromEntries(ALL_CHANNEL_FIELDS.map((field) => [field.id, channelFieldValue(fields, field)])) as ChannelFieldValues;
}

/**
 * `fields` with the patch laid over it: a document sets that field and null clears it. Fields the patch
 * doesn't name are kept, and a channel left with no field goes. Returns a new object; `fields` is not
 * changed.
 */
export function withChannelFieldValues(fields: ChannelFields, patch: ChannelFieldsPatch): ChannelFields {
  const next: Loose = {};
  for (const [channel, values] of Object.entries(fields as Loose)) next[channel as Channel] = { ...values };
  for (const field of ALL_CHANNEL_FIELDS) {
    const value = patch[field.id];
    if (value === undefined) continue;
    const own = (next[field.channel] ??= {});
    if (value === null) delete own[field.key];
    else own[field.key] = value;
  }
  for (const channel of Object.keys(next) as Channel[]) {
    if (Object.keys(next[channel]!).length === 0) delete next[channel];
  }
  return next as ChannelFields;
}

/** Stored fields from flat values: the ones that have a value. */
export function channelFieldsFrom(values: ChannelFieldsPatch): ChannelFields {
  return withChannelFieldValues({}, values);
}
