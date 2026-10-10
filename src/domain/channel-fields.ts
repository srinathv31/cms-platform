// The channel fields registry: the short fields a channel renders of its own, beside or instead of the
// body. Today only Email has any (its subject and preheader). Everything that stores, saves, checks,
// submits or renders a channel field loops over this registry rather than naming fields, so a channel's
// fields are declared here and nowhere else.
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

import { normalizeAndCheckField, type Checked } from "@/editor/model/document-check";
import { assertNever } from "./assert-never";
import { withArticle } from "./plural";
import { CHANNELS, type Channel, type JSONContent } from "./types";

// ── The registry ──────────────────────────────────────────────

/**
 * What a field holds. `line`: one line of text and variable chips, with no marks and no line breaks
 * (the editor's `InlineVariableField`; saved through `normalizeField` and checked by `fieldProblem`).
 */
export const FIELD_SHAPES = ["line"] as const;
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
}

/** Every channel's fields, in the order the workspace shows them and submit checks them. */
export const CHANNEL_FIELDS = {
  pdf: [],
  web: [],
  email: [
    { key: "subject", label: "Subject", name: "email subject", shape: "line", required: true },
    { key: "preheader", label: "Preheader", name: "email preheader", shape: "line", required: false },
  ],
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

// ── Shapes ────────────────────────────────────────────────────

/**
 * A field as every save takes it: normalized for its shape, then checked. The workspace runs it before
 * a save is sent and the server before one is stored (`prepareField`), so both refuse the same fields
 * with the same sentence.
 */
export function normalizeAndCheckChannelField(shape: FieldShape, doc: JSONContent): Checked {
  switch (shape) {
    case "line":
      return normalizeAndCheckField(doc);
    default:
      return assertNever(shape, "field shape");
  }
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
