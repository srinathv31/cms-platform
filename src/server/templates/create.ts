import "server-only";
import {
  ALL_CHANNEL_FIELDS,
  channelFieldValues,
  channelFieldsFrom,
  type ChannelFieldsPatch,
} from "@/domain/channel-fields";
import {
  BLANK_STARTER_KEY,
  DEFAULT_CHANNELS,
  initialTemplateName,
  newTemplateChannels,
} from "@/domain/lifecycle/drafts";
import type { DraftContent, StarterContent } from "@/domain/lifecycle/types";
import { conformToSections } from "@/domain/platform-config/sections";
import type { Channel, RequiredSection } from "@/domain/types";
import { prepareBody, prepareField } from "@/server/documents/prepare";
import { newId } from "@/server/ids";

// The BFF's half of "a new template and its first draft", shared by New template (a starter,
// src/server/actions/create-template.ts) and Import a file (src/server/import/create.ts). The BFF builds the
// draft and makes its documents ready for storage (decision 0065); the backend stores it
// (`TemplateService.create`, `createImported`). Nothing here reads a database or a clock.

/**
 * A first draft shaped to the content type as it is now (Platform settings), for every way a template
 * is born. Its channels: the ones the starter wants that the type allows, else the defaults of the
 * type's family (documents PDF and Web, messages Push and SMS) that it allows, else the first it allows
 * (`newTemplateChannels`). Its required sections: removed ones become ordinary headings, renamed ones
 * take the new title, new ones are appended. An import has already fitted them (`finishImport`), so it
 * passes `sectionsFitted` and its body is left alone. Existing templates are never reshaped.
 */
export function conformToContentType(
  starter: StarterContent,
  type: { requiredSections: RequiredSection[]; allowedChannels: Channel[] },
  options: { sectionsFitted?: boolean } = {},
): StarterContent {
  return {
    ...starter,
    body: options.sectionsFitted
      ? starter.body
      : conformToSections(starter.body, type.requiredSections, () =>
          newId("b"),
        ),
    channels: newTemplateChannels(starter.channels, type.allowedChannels),
  };
}

/**
 * The draft a template starts with, from a starter already fitted to its content type: Blank is untitled and
 * keeps no starter key, an example keeps its own name and key. An import has no starter key either.
 */
export function draftContentOf(
  starter: StarterContent,
  options: { imported?: boolean } = {},
): DraftContent {
  return {
    name: initialTemplateName(starter),
    body: starter.body,
    channelFields: starter.channelFields ?? {},
    channels: [...(starter.channels ?? DEFAULT_CHANNELS.document)],
    variables: [...starter.variables],
    sampleSets: [...starter.sampleSets],
    starterKey:
      options.imported || starter.key === BLANK_STARTER_KEY
        ? null
        : starter.key,
  };
}

export type PreparedDraft =
  { ok: true; draft: DraftContent } | { ok: false; message: string };

/**
 * The draft with its documents ready for storage, as an autosave of them would store them
 * (`prepareBody`, and `prepareField` for each channel field that has a value): normalized, checked, with block
 * ids. A document the check refuses is `{ ok: false, message }` with the check's sentence, and nothing is stored.
 */
export function prepareDraftContent(draft: DraftContent): PreparedDraft {
  const body = prepareBody(draft.body);
  if (!body.ok) return body;
  const fields: ChannelFieldsPatch = {};
  const values = channelFieldValues(draft.channelFields);
  for (const field of ALL_CHANNEL_FIELDS) {
    const value = values[field.id];
    if (value === null) continue;
    const prepared = prepareField(value, field);
    if (!prepared.ok) return prepared;
    fields[field.id] = prepared.doc;
  }
  return {
    ok: true,
    draft: {
      ...draft,
      body: body.doc,
      channelFields: channelFieldsFrom(fields),
    },
  };
}
