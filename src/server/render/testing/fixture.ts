// A render fixture: everything the engine reads (engine.ts `EngineInput`) plus the render time,
// frozen as JSON, and how it is read and written. Tests build them in code; a script can read and
// write them as files. Light on purpose (no adapters), so loading one never loads the PDF engine.

import type { JSONContent } from "@tiptap/core";
import { parseJsonWithNumberText } from "@/domain/render/json-number-text";
import type { Variable } from "@/editor/model/types";

/** Everything the engine needs to render one document, frozen. */
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
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
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
  return {
    templateId: raw.templateId!,
    templateName: raw.templateName!,
    versionNumber: raw.versionNumber ?? null,
    at: raw.at!,
    variables: raw.variables,
    values: parsed.numbersAsText(raw.values),
    body: raw.body,
    emailSubject: raw.emailSubject ?? null,
    emailPreheader: raw.emailPreheader ?? null,
  };
}
