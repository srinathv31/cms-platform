// The integration panel's copy: a sample render request per channel (curl and fetch), the response
// formats, and the errors a consumer should handle. Pure TypeScript; the UI only lays these out.

import { API_ERROR_STATUS } from "../golive-types";
import type { ApiErrorCode, ApiRenderRequest, Channel, ResponseFormat, Variable } from "../golive-types";
import { CHANNELS } from "../types";
import { exampleOf } from "./json-schema";

/** "/api/v1/templates/UC-4F7K2Q/render". */
export function renderPathOf(templateId: string): string {
  return `/api/v1/templates/${templateId}/render`;
}

/** "UC-4F7K2Q-v2.pdf": the name the render route gives the file. */
const pdfFilename = (templateId: string, versionNumber: number) => `${templateId}-v${versionNumber}.pdf`;

/** A single-quoted shell word: `it's` → `'it'\''s'`. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The request body, values = each variable's sample (canonical strings). */
export function sampleBody(versionNumber: number, channel: Channel, variables: readonly Variable[]): ApiRenderRequest {
  return { version: versionNumber, channel, values: Object.fromEntries(variables.map((v) => [v.key, exampleOf(v)])) };
}

const indent = (text: string, by: string) => text.replace(/\n/g, `\n${by}`);

const FETCH_RESULT: Readonly<Record<Channel, string>> = {
  pdf: "const pdf = new Uint8Array(await res.arrayBuffer());",
  web: "const html = await res.text();",
  email: "const { subject, preheader, html, text } = await res.json();",
};

/** curl writes the answer to a file (`--output`) only for a binary file: the PDF. */
const TO_FILE: Readonly<Record<Channel, boolean>> = { pdf: true, web: false, email: false };

/**
 * curl and fetch for one channel, ready to paste. curl sends the body pretty-printed with
 * `--data-raw` and writes a PDF to a file with `--output`; fetch reads the body by channel and
 * throws the API's own message on an error.
 */
export function integrationSamples(input: {
  origin: string;
  templateId: string;
  versionNumber: number;
  channel: Channel;
  variables: readonly Variable[];
  consumerId: string;
}): { curl: string; fetch: string } {
  const url = `${input.origin.replace(/\/+$/, "")}${renderPathOf(input.templateId)}`;
  const json = JSON.stringify(sampleBody(input.versionNumber, input.channel, input.variables), null, 2);

  const curl = [
    `curl -X POST ${shellQuote(url)}`,
    `  -H 'Content-Type: application/json'`,
    `  -H ${shellQuote(`X-Consumer-Id: ${input.consumerId}`)}`,
    `  --data-raw ${shellQuote(json)}`,
    ...(TO_FILE[input.channel] ? [`  --output ${shellQuote(pdfFilename(input.templateId, input.versionNumber))}`] : []),
  ].join(" \\\n");

  const fetch = [
    `const res = await fetch(${JSON.stringify(url)}, {`,
    `  method: "POST",`,
    `  headers: {`,
    `    "Content-Type": "application/json",`,
    `    "X-Consumer-Id": ${JSON.stringify(input.consumerId)},`,
    `  },`,
    `  body: JSON.stringify(${indent(json, "  ")}),`,
    `});`,
    `if (!res.ok) throw new Error((await res.json()).error.message);`,
    FETCH_RESULT[input.channel],
  ].join("\n");

  return { curl, fetch };
}

/** What comes back on a 200, per channel and for the base64 opt-in. */
const FORMATS: Readonly<Record<ResponseFormat["channel"], Omit<ResponseFormat, "channel">>> = {
  pdf: { contentType: "application/pdf", body: "The PDF file itself.", example: null },
  web: { contentType: "text/html; charset=utf-8", body: "A complete HTML page.", example: null },
  email: {
    contentType: "application/json",
    body: "JSON with subject, preheader, html and text.",
    example: JSON.stringify(
      {
        subject: "Your purchase APR is changing on March 4, 2027",
        preheader: "",
        html: "<!doctype html>…",
        text: "Hi Maya, …",
        newerVersion: null,
      },
      null,
      2,
    ),
  },
  base64: {
    contentType: "application/json",
    body: 'Send "encoding": "base64" to get JSON instead: the PDF or page as base64 in data, or the email\'s html and text as base64.',
    example: JSON.stringify(
      { channel: "pdf", contentType: "application/pdf", encoding: "base64", data: "JVBERi0xLjcK…", newerVersion: null },
      null,
      2,
    ),
  },
};

/** Every channel's format in `CHANNELS` order, then the base64 opt-in. */
export const RESPONSE_FORMATS: readonly ResponseFormat[] = [...CHANNELS, "base64" as const].map((channel) => ({
  channel,
  ...FORMATS[channel],
}));

const handle = (code: ApiErrorCode, when: string) => ({ status: API_ERROR_STATUS[code], code, when });

/** The errors worth handling, for the panel's short table. */
export const CONSUMER_ERRORS: readonly { status: number; code: ApiErrorCode; when: string }[] = [
  handle("version_sunset", "The version's sunset date has passed. Move to the Active version, or wait for a new one if none is Active."),
  handle("version_revoked", "The version was revoked. Move to the Active version, or wait for a new one if none is Active."),
  handle("missing_variables", "A required variable has no value."),
  handle("invalid_values", "A value doesn't fit its variable's type."),
  handle("channel_not_enabled", "The version doesn't render to that channel."),
  handle("template_not_found", "The template ID is wrong."),
  handle("version_not_found", "The template has no version with that number."),
];
