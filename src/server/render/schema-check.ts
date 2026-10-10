import "server-only";
import { getSchema, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { assertNever } from "@/domain/assert-never";
import type { FieldShape } from "@/domain/channel-fields";
import { DOCUMENT_MESSAGES, documentProblem, fieldProblem, type DocumentProblem } from "@/editor/model/document-check";
import { baseExtensions } from "@/editor/schema";

// The document check (docs/render-spec.md §3): the guard between a document and storage (autosave)
// and between a stored document and the renderer (pipeline stage 7). A document must parse against
// the editor's own schema, and keep the limits the schema can't express (src/editor/model/
// document-check.ts: heading levels, list start and numbering style, list depth, cell content, table
// shape and width). The resolver (src/domain/render/resolve.ts) handles exactly that schema's nodes
// and marks; schema-check.test.ts fails the moment the two drift apart.

export { DOCUMENT_MESSAGES, type DocumentProblem };

/**
 * A document the check refuses. `message` is the author-facing sentence (DOCUMENT_MESSAGES): it
 * never quotes the document. A schema parse failure keeps ProseMirror's reason as the `cause`.
 */
export class RenderDocumentError extends Error {
  readonly problem: DocumentProblem;

  constructor(problem: DocumentProblem, options?: { cause?: unknown }) {
    super(DOCUMENT_MESSAGES[problem], options);
    this.name = "RenderDocumentError";
    this.problem = problem;
  }
}

let schema: Schema | null = null;

/** The editor's schema, built once from `baseExtensions()`. */
export function editorSchema(): Schema {
  return (schema ??= getSchema(baseExtensions()));
}

/**
 * Parses `body` against the editor's schema (node and mark names, where each node may go, an empty
 * text node, duplicate marks). Throws a RenderDocumentError ("unsupported") when it doesn't parse.
 */
export function parseWithSchema(body: JSONContent): void {
  try {
    const node = editorSchema().nodeFromJSON(body);
    if (node.type !== editorSchema().topNodeType) {
      throw new Error(`Expected a "${editorSchema().topNodeType.name}" node, got "${node.type.name}".`);
    }
    node.check();
  } catch (error) {
    throw new RenderDocumentError("unsupported", { cause: error });
  }
}

/** Throws a RenderDocumentError when `body` isn't a valid body document. */
export function checkDocument(body: JSONContent): void {
  // The limits first: a document can fail the parse for one of them (a heading in a cell), and the
  // limit's sentence says what to change.
  const problem = documentProblem(body);
  if (problem) throw new RenderDocumentError(problem);
  parseWithSchema(body);
}

/**
 * Throws a RenderDocumentError when `field` isn't a valid channel field of its shape
 * (src/domain/channel-fields.ts): for `line`, one line of text and variables (the email subject and
 * preheader).
 */
export function checkField(field: JSONContent, shape: FieldShape): void {
  const problem = fieldProblemOf(field, shape);
  if (problem) throw new RenderDocumentError(problem);
  parseWithSchema(field);
}

function fieldProblemOf(field: JSONContent, shape: FieldShape): DocumentProblem | null {
  switch (shape) {
    case "line":
      return fieldProblem(field);
    default:
      return assertNever(shape, "field shape");
  }
}
