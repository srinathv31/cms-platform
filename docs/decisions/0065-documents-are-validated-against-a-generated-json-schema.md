# 0065. Documents are validated against a JSON Schema generated from the editor's schema

Status: Accepted
Amended 2026-10-12: built (wave 2.1). `src/server/render/document-json-schema.ts` writes
[docs/reference/document.schema.json](../reference/document.schema.json) (`npm run document-schema:update`), and
`document-json-schema.test.ts` fails when the file is stale or when the schema and the document check disagree on a
golden case, a starter, a seeded body or a mutation of one. The schema also holds the channel field shapes
(`#/$defs/field-line`, `#/$defs/field-lines`). It is looser than the check in three rules the Java side keeps in code, the
table grid, the 12-column limit and list depth, listed in [render spec](../render-spec.md) §2 with the block id sentence
this record asks for.
Date: 2026-10-12

## Context

Every stored document goes through `prepareBody` (`src/server/documents/prepare.ts`): normalize (tabs, invisible
characters, heading levels, cells, links), check the limits (`src/editor/model/document-check.ts`), parse against the
editor's ProseMirror schema (`parseWithSchema` in `src/server/render/schema-check.ts`), then add an id to every block
that lacks one. Normalizing and adding ids change the document. The render pipeline's stage 7 runs the limits and the
schema parse again (`checkDocument`, called from `src/server/render/engine.ts`). Where each node may go exists only as
ProseMirror content expressions in the editor's extensions; [render spec](../render-spec.md) §2 summarizes them in a
table, and the spec doesn't say block ids are UUID v4 (M-15 of the
[October 12 review](../quality-review-2026-10-12.md)).

Java renders every channel ([0067](0067-java-renders-every-channel.md)), so it needs these rules at render time
whatever happens at save. A hand port of the content expressions would drift from the editor.

## Decision

- **A JSON Schema is generated from `editorSchema()` at build time**, and a test checks that it agrees with
  `parseWithSchema` on every golden document: what one accepts, the other accepts.
- **Java validates every document against it, on write and at render**, and ports the limits in
  `document-check.ts` line by line.
- **The BFF still normalizes and adds block ids before it sends a document**: Java validates; it doesn't normalize.
- **Render spec §2 states that block ids are UUID v4.**

## Alternatives considered

- **The BFF validates and Java trusts it**, storing opaque JSON. Enough only if Java never had to understand a
  document; it renders them, so it would need the rules anyway.
- **Java hand-ports the content expressions from spec §2.** A second statement of the rules that drifts from the
  editor with every extension change.

## Consequences

- **Node now (a small wave 2 item, not yet given a lane):** the generator, the agreement test, and the spec's block id
  sentence. The schema ships with the golden files as part of the Java port's acceptance test.
- **Java side:** a JSON Schema validator on the save path and in render stage 7, plus the limits.
- An editor change that adds a node or moves where one may go changes the generated schema, so the Java side takes a
  new schema with it, as it takes new golden files after a render change.
