import "server-only";
import {
  renderFailed,
  renderFailedDocument,
  renderFailedGlyphs,
  ResolveError,
  resolveDocument,
  resolveInlineField,
  validateValues,
} from "@/domain/render";
import type { EmailRender, RenderDoc, RenderError, ResolveContext } from "@/domain/render/types";
import type { Channel, JSONContent, Variable } from "@/domain/types";
import { renderEmail } from "./channels/email";
import { renderPdf, UnrenderableCharactersError } from "./channels/pdf";
import { renderWeb } from "./channels/web";
import { checkDocument, checkField, RenderDocumentError } from "./schema-check";

// The render engine: stages 6 to 9 of the pipeline (docs/render-spec.md §1), and nothing that needs
// the database, the clock or the request. The render route (render-template.ts) runs it once it has
// found the template and version and checked who is asking; the golden files (golden/pipeline.ts)
// run it on frozen inputs. One implementation, so a golden file is what the API returns.
//
//   6 values                                                    → 422 missing_variables / invalid_values
//   7 the document check: the body; for email, subject and preheader too → 500 render_failed
//   8 resolve                                                   → 500 render_failed
//   9 the channel adapter                                       → 500 render_failed
//
// A failure in 7–9 says why when the caller can act on it (`renderFailure`). What was thrown is kept
// as `cause` for the server log, which must never print its message (it could quote a value).

/** Everything the engine reads (spec §1), besides the channel and the render time. */
export interface EngineInput {
  templateId: string;
  templateName: string;
  /** null for the open draft. */
  versionNumber: number | null;
  variables: readonly Variable[];
  values: Readonly<Record<string, unknown>>;
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
}

/** pdf: bytes; web: the HTML document; email: subject, preheader, html and text. */
export type RenderBody = Uint8Array | string | EmailRender;

export type EngineResult =
  | { ok: true; doc: RenderDoc; body: RenderBody }
  | {
      ok: false;
      /** The pipeline stage that failed (spec §1). */
      stage: 6 | 7 | 8 | 9;
      error: RenderError;
      /** What was thrown (stages 7–9). */
      cause?: unknown;
    };

/**
 * Renders one channel. `at` is the render time, used only as the PDF's creation and modification
 * date, so the same input at the same time gives the same bytes.
 */
export async function runEngine(input: EngineInput, channel: Channel, at: Date): Promise<EngineResult> {
  const thrown = (stage: 7 | 8 | 9, cause: unknown): EngineResult => ({ ok: false, stage, error: renderFailure(channel, cause), cause });

  // 6. Values, canonicalized.
  const validated = validateValues(input.variables, input.values);
  if (!validated.ok) return { ok: false, stage: 6, error: validated.error };

  // 7. The document check. Only email prints the subject and preheader, so only email checks them.
  try {
    checkDocument(input.body);
    if (channel === "email") {
      if (input.emailSubject) checkField(input.emailSubject);
      if (input.emailPreheader) checkField(input.emailPreheader);
    }
  } catch (error) {
    return thrown(7, error);
  }

  // 8. Resolve.
  const ctx: ResolveContext = { variables: input.variables, values: validated.values };
  let doc: RenderDoc;
  let fields = { subject: "", preheader: "" };
  try {
    doc = {
      templateId: input.templateId,
      templateName: input.templateName,
      versionNumber: input.versionNumber,
      blocks: resolveDocument(input.body, ctx),
    };
    if (channel === "email") {
      fields = { subject: resolveInlineField(input.emailSubject, ctx), preheader: resolveInlineField(input.emailPreheader, ctx) };
    }
  } catch (error) {
    return thrown(8, error);
  }

  // 9. The channel adapter.
  try {
    return { ok: true, doc, body: await adapt(channel, doc, fields, at) };
  } catch (error) {
    return thrown(9, error);
  }
}

async function adapt(channel: Channel, doc: RenderDoc, fields: { subject: string; preheader: string }, at: Date): Promise<RenderBody> {
  switch (channel) {
    case "pdf":
      return renderPdf(doc, { createdAt: at });
    case "web":
      return renderWeb(doc);
    case "email":
      return renderEmail(doc, fields);
  }
}

/**
 * The render_failed for something thrown in stages 7–9 (docs/render-spec.md §11). A stored
 * document the check or the resolver refuses gives the refusal's sentence; characters the PDF's
 * fonts can't draw are named; anything else is "Try again.". None of these quotes the document or
 * a value (the glyphs message shows single characters only).
 */
export function renderFailure(channel: Channel, error: unknown): RenderError {
  if (error instanceof RenderDocumentError || error instanceof ResolveError) return renderFailedDocument(channel, error.message);
  if (error instanceof UnrenderableCharactersError) return renderFailedGlyphs(error.characters);
  return renderFailed(channel);
}
