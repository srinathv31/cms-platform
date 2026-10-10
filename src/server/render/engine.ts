import "server-only";
import { assertNever } from "@/domain/assert-never";
import {
  renderFailed,
  renderFailedDocument,
  renderFailedGlyphs,
  resolveChannelField,
  ResolveError,
  resolveDocument,
  validateValues,
  type MessageInput,
  type MessageResult,
} from "@/domain/render";
import { channelFieldValue, channelFieldsOf, type ChannelFields } from "@/domain/channel-fields";
import type {
  CanonicalValues,
  EmailFields,
  EmailRender,
  PushRender,
  RenderDoc,
  RenderError,
  RenderTarget,
  ResolveContext,
  SmsRender,
} from "@/domain/render/types";
import { isDocumentChannel, type Channel, type DocumentChannel, type JSONContent, type Variable } from "@/domain/types";
import { renderEmail } from "./channels/email";
import { renderPdf, UnrenderableCharactersError } from "./channels/pdf";
import { renderPush } from "./channels/push";
import { renderSms } from "./channels/sms";
import { renderWeb } from "./channels/web";
import { checkDocument, checkField, RenderDocumentError } from "./schema-check";

// The render engine: stages 6 to 9 of the pipeline (docs/render-spec.md §1), and nothing that needs
// the database, the clock or the request. The render route (render-template.ts) runs it once it has
// found the template and version and checked who is asking; the golden files (golden/pipeline.ts)
// run it on frozen inputs. One implementation, so a golden file is what the API returns.
//
//   6 values                                                    → 422 missing_variables / invalid_values
//   7 the document check: the body (documents only), and the channel's own fields → 500 render_failed
//   8 resolve                                                   → 500 render_failed
//   9 the channel adapter                                       → 500 render_failed
//     for a message, its limits (renderMessage)                 → 422 push_payload_too_large / sms_too_long
//
// A document channel (PDF, web, email) renders the body, resolved to a RenderDoc. A message channel
// (push, SMS) renders only its own fields, through the domain's `renderMessage`: the body is never
// read, checked or resolved.
//
// A failure in 7–9 says why when the caller can act on it (`renderFailure`). What was thrown is kept
// as `cause` for the server log, which must never print its message (it could quote a value).

/** Everything the engine reads (spec §1), besides the target and the render time. */
export interface EngineInput {
  templateId: string;
  templateName: string;
  /** null for the open draft. */
  versionNumber: number | null;
  variables: readonly Variable[];
  values: Readonly<Record<string, unknown>>;
  body: JSONContent;
  /** Each channel's own fields (src/domain/channel-fields.ts). Only the rendered channel's are read. */
  channelFields: ChannelFields;
  /** The content type's SMS footer, printed after an SMS on its own line. Null: none. */
  smsFooter: string | null;
}

/** pdf: bytes; web: the HTML document; email: subject, preheader, html and text; push and sms: their JSON. */
export type RenderBody = Uint8Array | string | EmailRender | PushRender | SmsRender;

export type EngineResult =
  | {
      ok: true;
      /** The resolved document; null for a message channel, which renders no document. */
      doc: RenderDoc | null;
      body: RenderBody;
    }
  | {
      ok: false;
      /** The pipeline stage that failed (spec §1). */
      stage: 6 | 7 | 8 | 9;
      error: RenderError;
      /** What was thrown (stages 7–9). A message's limit is a refusal, not a throw: no cause. */
      cause?: unknown;
    };

/**
 * Renders one target: a channel, and for a push its platform. `at` is the render time, used only as the
 * PDF's creation and modification date, so the same input at the same time gives the same bytes.
 */
export async function runEngine(input: EngineInput, target: RenderTarget, at: Date): Promise<EngineResult> {
  const { channel } = target;
  const thrown = (stage: 7 | 8 | 9, cause: unknown): EngineResult => ({ ok: false, stage, error: renderFailure(channel, cause), cause });

  // 6. Values, canonicalized.
  const validated = validateValues(input.variables, input.values);
  if (!validated.ok) return { ok: false, stage: 6, error: validated.error };

  // 7. The document check: the body (a document channel's), then the channel's own fields in the
  // registry's order. Only a channel's own output prints its fields (email's subject and preheader, a
  // push's title and body), so only it checks them.
  const own = channelFieldsOf(channel);
  try {
    if (isDocumentChannel(channel)) checkDocument(input.body);
    for (const field of own) {
      const value = channelFieldValue(input.channelFields, field);
      if (value) checkField(value, field);
    }
  } catch (error) {
    return thrown(7, error);
  }

  switch (target.channel) {
    case "pdf":
    case "web":
    case "email":
      return renderDocument(input, target.channel, validated.values, at, thrown);
    case "push":
    case "sms": {
      // 8 and 9: resolve and measure, in the domain (the browser preview runs the same function).
      const message: MessageInput = {
        fields: input.channelFields,
        variables: input.variables,
        values: validated.values,
        rules: { smsFooter: input.smsFooter },
      };
      let result: MessageResult<PushRender | SmsRender>;
      try {
        result = target.channel === "push" ? renderPush(target.platform, message) : renderSms(message);
      } catch (error) {
        return thrown(8, error);
      }
      return result.ok ? { ok: true, doc: null, body: result.output } : { ok: false, stage: 9, error: result.error };
    }
    default:
      return assertNever(target, "render target");
  }
}

/** Stages 8 and 9 of a document channel: the body to a RenderDoc, the channel's fields to text, the adapter. */
async function renderDocument(
  input: EngineInput,
  channel: DocumentChannel,
  values: CanonicalValues,
  at: Date,
  thrown: (stage: 7 | 8 | 9, cause: unknown) => EngineResult,
): Promise<EngineResult> {
  // 8. Resolve.
  const ctx: ResolveContext = { variables: input.variables, values };
  let doc: RenderDoc;
  let fields: ResolvedFields;
  try {
    doc = {
      templateId: input.templateId,
      templateName: input.templateName,
      versionNumber: input.versionNumber,
      blocks: resolveDocument(input.body, ctx),
    };
    fields = Object.fromEntries(
      channelFieldsOf(channel).map((field) => [
        field.key,
        resolveChannelField(channelFieldValue(input.channelFields, field), field.shape, ctx),
      ]),
    );
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

/** The rendered channel's own fields as text, by key: a field with no value is "". */
type ResolvedFields = Readonly<Record<string, string>>;

async function adapt(channel: DocumentChannel, doc: RenderDoc, fields: ResolvedFields, at: Date): Promise<RenderBody> {
  switch (channel) {
    case "pdf":
      return renderPdf(doc, { createdAt: at });
    case "web":
      return renderWeb(doc);
    case "email":
      // `fields` has a string for each of Email's fields (stage 8 resolves every one, "" for none).
      return renderEmail(doc, fields as EmailFields);
    default:
      return assertNever(channel, "channel");
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
