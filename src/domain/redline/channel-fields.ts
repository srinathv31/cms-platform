// A version's channel fields (an email's subject, a push's title, an SMS's message) are redlined with the
// same engine as the body (`diffDocuments`), one field at a time (`diffChannelFields`): for an alert they
// are the whole content.

import { channelFieldValue, fieldsOfChannels, type ChannelField, type ChannelFields } from "../channel-fields";
import type { FieldRedline, FooterRedline, RedlineDoc } from "../review-types";
import { CHANNELS, type Channel, type JSONContent } from "../types";
import { diffDocuments } from "./document";
import { isNode } from "./nodes";

/**
 * A version's channel fields as the redline reads them: the channels that are on, what they store, and the
 * SMS footer it prints (`smsFooterOf`: frozen at submit, a draft's the content type's; absent: none).
 */
export interface FieldsSide {
  channels: readonly Channel[];
  channelFields: ChannelFields;
  smsFooter?: string | null;
}

/**
 * Every field's redline, in registry order, how many fields were added, removed or changed (a changed footer
 * among them), and the SMS's footer: null while SMS is off on both sides.
 */
export interface FieldsRedline {
  fields: FieldRedline[];
  counts: RedlineDoc["counts"];
  footer: FooterRedline | null;
}

/**
 * The redline of each channel field (the email's subject and preheader, a push's title, subtitle and
 * body, an SMS's message) from `base` to `next`, over the registry, so a new field or channel needs
 * nothing here. A field's text is diffed with `diffDocuments`, its paragraph given the same id on both
 * sides so the two always pair and the change is a word diff, however much was rewritten.
 *
 * A field counts only while its channel is on: it keeps its value while its channel is off, but nothing
 * renders it. So the fields shown are those of every channel on in either version, and turning a channel
 * on adds its fields, off removes them. A field with no text on either side is "unchanged" (an optional
 * subtitle left empty). No base (a first version): `next`'s fields, all "unchanged", counts zero, as
 * `diffDocuments` does.
 *
 * The SMS's footer isn't a field (the author doesn't write it), but it is part of what each version sends:
 * its `footer` says what it was and is. A footer that changed while SMS stayed on counts as one change, so
 * a version whose only difference is its footer never reads "No changes".
 */
export function diffChannelFields(base: FieldsSide | null, next: FieldsSide): FieldsRedline {
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  const channels = base ? CHANNELS.filter((c) => base.channels.includes(c) || next.channels.includes(c)) : next.channels;
  const fields = fieldsOfChannels(channels).map((field): FieldRedline => {
    const after = fieldDoc(next, field);
    if (!base) return { field, status: "unchanged", doc: diffDocuments(null, after) };
    const doc = diffDocuments(fieldDoc(base, field), after);
    const status = fieldStatus(doc);
    if (status !== "unchanged") counts[status]++;
    return { field, status, doc };
  });
  const footer = channels.includes("sms") ? footerRedline(base, next) : null;
  if (footer && footer.status !== "unchanged" && base?.channels.includes("sms") && next.channels.includes("sms")) counts[footer.status]++;
  return { fields, counts, footer };
}

/** The SMS footer each side prints while its SMS is on, and how it changed. */
function footerRedline(base: FieldsSide | null, next: FieldsSide): FooterRedline {
  const footerOf = (side: FieldsSide) => (side.channels.includes("sms") ? side.smsFooter || null : null);
  const to = footerOf(next);
  if (!base) return { from: null, to, status: "unchanged" };
  const from = footerOf(base);
  const status = from === to ? "unchanged" : from === null ? "added" : to === null ? "removed" : "changed";
  return { from, to, status };
}

/** The two counts together: the body's and the fields', for one "N changes" and its summary. */
export function addCounts(a: RedlineDoc["counts"], b: RedlineDoc["counts"]): RedlineDoc["counts"] {
  return { added: a.added + b.added, removed: a.removed + b.removed, changed: a.changed + b.changed, moved: a.moved + b.moved };
}

/** The field as a document to diff: empty while its channel is off, each block keyed by the field (they pair across versions). */
function fieldDoc(side: FieldsSide, field: ChannelField): JSONContent {
  const value = side.channels.includes(field.channel) ? channelFieldValue(side.channelFields, field) : null;
  const blocks = (value?.content ?? []).filter(isNode);
  return { type: "doc", content: blocks.map((block, i) => ({ ...block, attrs: { ...block.attrs, id: `${field.id}:${i}` } })) };
}

/** The field's status from its blocks': all added is added, all removed removed, none changed unchanged. */
function fieldStatus(doc: RedlineDoc): FieldRedline["status"] {
  const { blocks } = doc;
  if (blocks.every((b) => b.status === "unchanged")) return "unchanged";
  if (blocks.every((b) => b.status === "added")) return "added";
  if (blocks.every((b) => b.status === "removed")) return "removed";
  return "changed";
}
