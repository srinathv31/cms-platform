import "server-only";
import type { JSONContent } from "@/domain/types";
import { normalizeAndCheckBody, normalizeAndCheckField, type Checked } from "@/editor/model/document-check";
import { normalizeDocument } from "@/editor/model/normalize";
import { ensureBlockIds } from "@/editor/schema";
import { DOCUMENT_MESSAGES, RenderDocumentError, parseWithSchema } from "@/server/render/schema-check";

// The one way a document is made ready for storage (docs/render-spec.md §3), whoever wrote it: the
// autosave (src/server/drafts/apply-patch.ts) and the import (src/server/import/create.ts). Stored
// bodies must always render the way the editor showed them, so a document the check refuses (an
// unknown node type, a list start of 20000, lists ten deep, a table whose cells don't line up) is
// refused here with the check's sentence, rather than failing the render pipeline weeks later.

export type Prepared = { ok: true; doc: JSONContent } | { ok: false; message: string };

/**
 * A body as it is stored: normalized (tabs, control and invisible characters, heading levels, cell
 * attributes, links, content in cells, ragged and wide tables), checked (the limits, then the schema
 * parse), and with an `attrs.id` on every block that lacks one (comment anchors, redline, margin
 * threads).
 *
 * The editor already emits ids on every block and keeps its documents inside the limits, so for its
 * documents this changes little (an invisible character goes). It costs about a millisecond for a
 * short document and about 10 ms for 400 paragraphs.
 */
export function prepareBody(doc: JSONContent): Prepared {
  return prepare(doc, normalizeAndCheckBody, (normalized) =>
    // Giving ids round-trips through the schema, which writes every attribute's default back
    // (`align: null`, TipTap's list `type: null`): normalizing again takes those keys out.
    normalizeDocument(ensureBlockIds(normalized)),
  );
}

/** An email subject or preheader as it is stored: normalized to one line, and checked. */
export function prepareField(doc: JSONContent): Prepared {
  return prepare(doc, normalizeAndCheckField, (normalized) => normalized);
}

function prepare(doc: JSONContent, check: (doc: JSONContent) => Checked, finish: (doc: JSONContent) => JSONContent): Prepared {
  try {
    const checked = check(doc);
    if (checked.problem) return { ok: false, message: DOCUMENT_MESSAGES[checked.problem] };
    parseWithSchema(checked.doc);
    return { ok: true, doc: finish(checked.doc) };
  } catch (error) {
    return { ok: false, message: error instanceof RenderDocumentError ? error.message : DOCUMENT_MESSAGES.unsupported };
  }
}
