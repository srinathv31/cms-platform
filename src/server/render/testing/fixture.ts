// A render fixture: everything the engine reads (engine.ts `EngineInput`) plus the render time,
// frozen as JSON, and how it is read and written. Tests build them in code; a script can read and
// write them as files. Light on purpose (no adapters), so loading one never loads the PDF engine.

import type { JSONContent } from "@tiptap/core";
import type { ChannelFields } from "@/domain/channel-fields";
import { parseJsonWithNumberText } from "@/domain/render/json-number-text";
import { CHANNELS, type Channel } from "@/domain/types";
import type { Variable } from "@/editor/model/types";
import type { EngineInput } from "../engine";

/** Everything the engine needs to render one template, frozen, and the channels to render it in. */
export interface RenderFixture {
  templateId: string;
  templateName: string;
  /** null for a draft. */
  versionNumber: number | null;
  /** The render time (ISO): the PDF's creation and modification date. */
  at: string;
  variables: Variable[];
  /** As a request sends them: JSON numbers are read from their source text (21.90 stays "21.90"). */
  values: Record<string, unknown>;
  /** The document: what PDF, web and email render. A message case's is never read. */
  body: JSONContent;
  /** Each channel's own fields, as `versions.channel_fields` stores them (src/domain/channel-fields.ts). */
  channelFields: ChannelFields;
  /**
   * The channels the case renders, as a version's `channels` (one family: PDF, web, email; or push and
   * SMS). A push renders once per platform.
   */
  channels: Channel[];
  /** The content type's SMS footer. Absent: none. */
  smsFooter?: string;
}

/** What the engine reads from a fixture. */
export function engineInput(fixture: RenderFixture): EngineInput {
  return { ...fixture, smsFooter: fixture.smsFooter ?? null };
}

/** JSON the way the files are written: two spaces, a newline at the end. */
export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** Reads a fixture's JSON. JSON numbers in `values` keep their exact digits, as the render route reads them. */
export function parseRenderFixture(text: string): RenderFixture {
  const parsed = parseJsonWithNumberText(text);
  const raw = parsed.json as Partial<RenderFixture> | null;
  if (!raw || typeof raw !== "object") throw new Error("A render fixture must be a JSON object.");
  for (const key of ["templateId", "templateName", "at"] as const) {
    if (typeof raw[key] !== "string") throw new Error(`Render fixture: "${key}" must be a string.`);
  }
  if (Number.isNaN(Date.parse(raw.at!))) throw new Error('Render fixture: "at" must be an ISO date-time.');
  if (!Array.isArray(raw.variables)) throw new Error('Render fixture: "variables" must be an array.');
  if (!raw.values || typeof raw.values !== "object") throw new Error('Render fixture: "values" must be an object.');
  if (raw.body?.type !== "doc") throw new Error('Render fixture: "body" must be a doc.');
  if (!raw.channelFields || typeof raw.channelFields !== "object" || Array.isArray(raw.channelFields)) {
    throw new Error('Render fixture: "channelFields" must be an object.');
  }
  const channels = raw.channels;
  if (!Array.isArray(channels) || channels.length === 0 || !channels.every((c) => (CHANNELS as readonly unknown[]).includes(c))) {
    throw new Error(`Render fixture: "channels" must list some of ${CHANNELS.join(", ")}.`);
  }
  if (raw.smsFooter !== undefined && typeof raw.smsFooter !== "string") throw new Error('Render fixture: "smsFooter" must be a string.');
  return {
    templateId: raw.templateId!,
    templateName: raw.templateName!,
    versionNumber: raw.versionNumber ?? null,
    at: raw.at!,
    variables: raw.variables,
    values: parsed.numbersAsText(raw.values),
    body: raw.body,
    channelFields: raw.channelFields,
    channels: CHANNELS.filter((c) => channels.includes(c)),
    ...(raw.smsFooter === undefined ? {} : { smsFooter: raw.smsFooter }),
  };
}
