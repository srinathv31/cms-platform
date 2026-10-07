import "server-only";
import { getSchema, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { baseExtensions } from "@/editor/schema";

// The guard between stored documents and the renderer: before a body (or an email field) is
// resolved, it must parse against the editor's own schema. The resolver (src/domain/render/
// resolve.ts) handles exactly that schema's nodes and marks; schema-check.test.ts fails the moment
// the two drift apart.

/** A document that doesn't fit the editor schema (unknown node or mark, wrong nesting). */
export class RenderDocumentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RenderDocumentError";
  }
}

let schema: Schema | null = null;

/** The editor's schema, built once from `baseExtensions()`. */
export function editorSchema(): Schema {
  return (schema ??= getSchema(baseExtensions()));
}

/** Throws a RenderDocumentError when `body` isn't a valid editor document. */
export function checkDocument(body: JSONContent): void {
  try {
    const node = editorSchema().nodeFromJSON(body);
    if (node.type !== editorSchema().topNodeType) {
      throw new Error(`Expected a "${editorSchema().topNodeType.name}" node, got "${node.type.name}".`);
    }
    node.check();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RenderDocumentError(`The document doesn't fit the editor schema: ${reason}`, { cause: error });
  }
}
