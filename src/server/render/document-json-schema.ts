// The JSON Schema (draft 2020-12) for a stored document, generated from the editor's ProseMirror schema.
// The committed result is docs/reference/document.schema.json; `npm run document-schema:update` rewrites
// it, and document-json-schema.test.ts fails when it is stale. Decision 0065 and docs/render-spec.md §2.
//
// Why: Java renders every channel, so it has to refuse the documents Stencil's own check refuses, and
// where each node may go exists nowhere but in the extensions' content expressions. Generating the schema
// from `editorSchema()` keeps the Java side from drifting when the editor changes. The BFF still
// normalizes and adds block ids before it sends a document; the schema only checks.
//
// What it states, from the editor's schema: the node and mark names, where each node may go and how many
// children it takes (the content expressions, read by content-expression.ts), which marks a node's
// children may carry, that a mark type appears once, that a text node is not empty, and the attributes.
// From the document check (src/editor/model/document-check.ts), what JSON Schema can say: heading level
// 1 to 3, list start 0 to 9999, the numbering styles, spans of at least 1, and the table cell rule (a
// cell, and every list item inside one, holds only paragraphs and lists). A cell's rule is the one place
// a node's schema depends on where it sits: a list inside a cell is `bulletList-in-cell`, not
// `bulletList`. The channel field shapes (`field-line`, `field-lines`) are here too, for the email
// subject and preheader, a push's fields and an SMS's text.
//
// Looser than the check (SCHEMA_GAPS; an implementation validates these in code, line by line from
// document-check.ts and table-grid.ts):
//   - a table's cells line up into rows and columns (spans, rowspans from above, every row full);
//   - a table is at most 12 columns wide (a width the spans and rowspans add up to);
//   - lists nest at most 9 levels deep, counted through anything, table cells included.
// Attribute values that nothing checks stay open, as the check leaves them: a block's `id` (a UUID v4
// as written, but any value is accepted), `requiredKey`, a variable's `key`, a link's `href`.
//
// Stricter than ProseMirror's parse, in shape only (the editor never writes them): `attrs` must be an
// object, `content` and `marks` arrays, where ProseMirror also reads null or a string as "none".
//
// It throws rather than guess when the editor's schema grows past what it can state: a content
// expression with no JSON Schema form, an attribute it has no rule for, a mark that excludes others, or
// two parents that allow different marks on the same inline node. Extend this file, and the gap list
// above and in the spec, when that happens.

import type { MarkType, NodeType, Schema } from "@tiptap/pm/model";
import {
  LIST_START_MAX,
  LIST_START_MIN,
  MARKER_DELIMITERS,
  MARKER_FORMATS,
  MAX_LIST_DEPTH,
} from "@/editor/model/list-markers";
import { CELL_BLOCKS, HEADING_LEVELS } from "@/editor/model/normalize";
import { MAX_TABLE_COLUMNS } from "@/editor/model/table-grid";
import { contentPieces, type Piece } from "./content-expression";
import { editorSchema } from "./schema-check";

export type JsonSchema = { [keyword: string]: unknown };

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** What the schema leaves to code (the header says why), worded for the schema's own description. */
export const SCHEMA_GAPS = [
  "A table's cells line up into rows and columns: each cell takes the next column a rowspan from above does not hold, no slot is taken twice, nothing runs past the last column or row, and every row is full. The schema only requires each span to be an integer of at least 1.",
  `A table is at most ${MAX_TABLE_COLUMNS} columns wide.`,
  `Lists nest at most ${MAX_LIST_DEPTH} levels deep, bullet and ordered together, counted through table cells too.`,
] as const;

/** The nodes the document check calls a table cell (src/editor/model/document-check.ts). */
const CELLS = ["tableCell", "tableHeader"];
/** The node that holds a cell's blocks once it is inside a cell. */
const LIST_ITEM = "listItem";

/** Where a node sits: inside a table cell, at any depth, or not. Only the cell rule cares. */
type Context = "body" | "cell";

/** The empty array: no marks. */
const NO_MARKS: JsonSchema = { type: "array", items: false };

const SPAN: JsonSchema = { type: ["integer", "null"], minimum: 1 };
const ignored = (why: string): JsonSchema => ({ description: why });

/**
 * The rule for each attribute of each node and mark, by "owner.attribute" (or the attribute alone when
 * every owner shares it). An attribute the editor's schema has and this table lacks stops the generator:
 * a new attribute is a decision about what a document may hold. (The test checks the other way too: no
 * rule for an attribute that is gone.)
 */
export const ATTRIBUTE_RULES: Record<string, JsonSchema> = {
  id: {
    description:
      "A block's stable id. The editor writes a UUID v4 (TipTap's UniqueID). Any non-empty string is read as the id, and any other value as no id (docs/render-spec.md §2).",
  },
  "heading.level": { enum: [...HEADING_LEVELS] },
  "heading.requiredKey": {
    description:
      "The key of the required section the heading stands for. Anything but a non-empty string is an ordinary heading.",
  },
  "orderedList.start": {
    type: ["integer", "null"],
    minimum: LIST_START_MIN,
    maximum: LIST_START_MAX,
  },
  "orderedList.markerFormat": { enum: [...MARKER_FORMATS, null] },
  "orderedList.markerDelimiter": { enum: [...MARKER_DELIMITERS, null] },
  "orderedList.type": ignored(
    "TipTap's own attribute: ignored, removed at save.",
  ),
  "tableCell.colspan": SPAN,
  "tableCell.rowspan": SPAN,
  "tableCell.colwidth": ignored("Ignored, removed at save."),
  "tableCell.align": ignored("Ignored, removed at save."),
  "tableHeader.colspan": SPAN,
  "tableHeader.rowspan": SPAN,
  "tableHeader.colwidth": ignored("Ignored, removed at save."),
  "tableHeader.align": ignored("Ignored, removed at save."),
  "variable.key": ignored(
    "A variable key. Not checked: a key that is not in the version's variable list renders nothing (docs/render-spec.md §8).",
  ),
  "link.href": ignored(
    "Not checked here: a link that fails the link check loses its mark at save, and the resolver drops it (docs/render-spec.md §6).",
  ),
  "link.target": ignored("Ignored by the engine."),
  "link.rel": ignored("Ignored by the engine."),
  "link.class": ignored("Ignored by the engine."),
  "link.title": ignored("Ignored by the engine."),
};

/**
 * The JSON Schema of a stored body document, with the channel field shapes in `$defs`. The root is a
 * body (`doc`); validate a channel field against `#/$defs/field-line` or `#/$defs/field-lines`.
 */
export function documentJsonSchema(
  schema: Schema = editorSchema(),
): JsonSchema {
  return new SchemaBuilder(schema).build();
}

class SchemaBuilder {
  private readonly defs: Record<string, JsonSchema> = {};

  constructor(private readonly schema: Schema) {
    for (const mark of Object.values(schema.marks)) {
      if (mark.spec.excludes !== undefined)
        throw new Error(
          `The mark "${mark.name}" sets \`excludes\`, which the generator doesn't state in JSON Schema.`,
        );
    }
  }

  build(): JsonSchema {
    const top = this.schema.topNodeType;
    const root = this.node(top, "body");
    this.defs["field-line"] = this.field(false);
    this.defs["field-lines"] = this.field(true);

    return {
      $schema: DIALECT,
      $comment:
        "Generated from the editor's schema by src/server/render/document-json-schema.ts. Do not edit: run `npm run document-schema:update`.",
      title: "Stencil document",
      description:
        "A template's stored body (docs/render-spec.md §2). Validate a channel field against #/$defs/field-line (the line and paragraph shapes) or #/$defs/field-lines. Looser than Stencil's own document check, so an implementation must still enforce, in code:\n- " +
        SCHEMA_GAPS.join("\n- "),
      ...root,
      $defs: Object.fromEntries(
        Object.entries(this.defs).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    };
  }

  // ── Nodes ──────────────────────────────────────────────────────────────────

  /** A `$ref` to the node's definition, made on first use. */
  private ref(typeName: string, context: Context): JsonSchema {
    const inCell = context === "cell" && this.reachesListItem(typeName);
    const key = inCell ? `${typeName}-in-cell` : typeName;
    if (!(key in this.defs)) {
      this.defs[key] = {}; // holds the place while the node's children (and so itself) are made
      const type = this.nodeType(typeName);
      this.defs[key] = {
        ...this.node(type, inCell ? "cell" : "body"),
        ...(inCell
          ? {
              description:
                "Inside a table cell, which holds only paragraphs and lists, at every depth (docs/render-spec.md §3).",
            }
          : {}),
      };
    }
    return { $ref: `#/$defs/${key}` };
  }

  private node(
    type: NodeType,
    context: Context,
    override: { marks?: JsonSchema } = {},
  ): JsonSchema {
    const properties: Record<string, JsonSchema> = {
      type: { const: type.name },
    };
    const required = ["type"];

    if (type.isText) {
      properties.text = { type: "string", minLength: 1 };
      required.push("text");
    } else {
      const content = this.content(type, context);
      properties.content = content.schema;
      if (content.required) required.push("content");
    }

    const attributes = this.attributes(type.name, type.spec.attrs);
    if (attributes) properties.attrs = attributes;

    if (type.isInline) {
      properties.marks = override.marks ?? this.marks(type);
    } else if (type !== this.schema.topNodeType) {
      properties.marks = NO_MARKS;
    }

    return { type: "object", required, properties };
  }

  /**
   * The `content` array: the content expression's pieces as a fixed prefix (`prefixItems`), then at most
   * one repeated piece (`items`). `required` when the node needs at least one child.
   */
  private content(
    type: NodeType,
    context: Context,
  ): { schema: JsonSchema; required: boolean } {
    const pieces = contentPieces(type.spec.content ?? "");
    const childContext: Context =
      context === "cell" || CELLS.includes(type.name) ? "cell" : "body";
    const onlyCellBlocks =
      CELLS.includes(type.name) ||
      (context === "cell" && type.name === LIST_ITEM);

    const itemsOf = (piece: Piece): JsonSchema => {
      const names = this.typeNames(piece.names).filter(
        (name) => !onlyCellBlocks || CELL_BLOCKS.includes(name),
      );
      const refs = names.map((name) => this.ref(name, childContext));
      if (refs.length === 0)
        throw new Error(
          `${type.name} has no child type left to allow ("${piece.names.join(" | ")}").`,
        );
      return refs.length === 1 ? refs[0]! : { oneOf: refs };
    };

    const fixed = pieces.findIndex((p) => p.min !== 1 || p.max !== 1);
    const prefix = fixed === -1 ? pieces : pieces.slice(0, fixed);
    const rest = fixed === -1 ? [] : pieces.slice(fixed);
    if (rest.length > 1)
      throw new Error(
        `The content expression "${type.spec.content}" of ${type.name} has more than one repeated part, which the generator doesn't state in JSON Schema.`,
      );
    const repeated = rest[0];

    // `items: false` closes the array after the prefix: a leaf takes no children at all.
    const min = prefix.length + (repeated?.min ?? 0);
    const schema: JsonSchema = { type: "array" };
    if (min > 0) schema.minItems = min;
    if (repeated && repeated.max !== Infinity)
      schema.maxItems = prefix.length + repeated.max;
    if (prefix.length > 0) schema.prefixItems = prefix.map(itemsOf);
    schema.items = repeated ? itemsOf(repeated) : false;
    return { schema, required: min > 0 };
  }

  /**
   * Node type names a piece's names stand for: a name is a node type or a group of them. Sorted, so
   * the order the editor's extensions load in doesn't move the generated file.
   */
  private typeNames(names: readonly string[]): string[] {
    const found = new Set<string>();
    for (const name of names) {
      const members = Object.values(this.schema.nodes)
        .filter(
          (type) =>
            type.name === name ||
            (type.spec.group ?? "").split(" ").includes(name),
        )
        .map((type) => type.name);
      if (members.length === 0)
        throw new Error(
          `The content expression names "${name}", which is no node or group.`,
        );
      members.forEach((member) => found.add(member));
    }
    return [...found].sort();
  }

  private nodeType(name: string): NodeType {
    const type = this.schema.nodes[name];
    if (!type) throw new Error(`The editor's schema has no node "${name}".`);
    return type;
  }

  /**
   * Whether the node's schema depends on sitting inside a cell: it is a list item, or it can hold one,
   * through any depth of children. Paragraphs and the rest hold the same wherever they are.
   */
  private reachesListItem(start: string): boolean {
    const seen = new Set<string>();
    const queue = [start];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      if (name === LIST_ITEM) return true;
      if (seen.has(name)) continue;
      seen.add(name);
      queue.push(...this.childNames(this.nodeType(name)));
    }
    return false;
  }

  /** The node types a node's content expression allows as children. */
  private childNames(type: NodeType): string[] {
    return this.typeNames(
      contentPieces(type.spec.content ?? "").flatMap((piece) => piece.names),
    );
  }

  // ── Attributes ─────────────────────────────────────────────────────────────

  private attributes(
    owner: string,
    attrs: { [name: string]: { default?: unknown } } | undefined,
  ): JsonSchema | null {
    if (!attrs || Object.keys(attrs).length === 0) return null;
    const properties: Record<string, JsonSchema> = {};
    for (const [name, spec] of Object.entries(attrs)) {
      const rule = ([`${owner}.${name}`, name] as const).find(
        (key) => key in ATTRIBUTE_RULES,
      );
      if (!rule)
        throw new Error(
          `No JSON Schema rule for the attribute ${owner}.${name}: add it to ATTRIBUTE_RULES in document-json-schema.ts.`,
        );
      const fallback = spec.default;
      properties[name] = {
        ...ATTRIBUTE_RULES[rule],
        ...(fallback !== undefined && fallback !== null
          ? { default: fallback }
          : {}),
      };
    }
    return { type: "object", properties };
  }

  // ── Marks ──────────────────────────────────────────────────────────────────

  /**
   * The `marks` of an inline node: the marks its parents allow on their children, each type at most once
   * (ProseMirror refuses a collection with two of a type, whatever their attributes).
   */
  private marks(type: NodeType): JsonSchema {
    const allowed = this.allowedMarks(type);
    if (allowed.length === 0) return NO_MARKS;
    const refs = allowed.map((mark) => this.markRef(mark));
    return {
      type: "array",
      items: refs.length === 1 ? refs[0] : { oneOf: refs },
      allOf: allowed.map((mark) => ({
        type: "array",
        contains: {
          type: "object",
          required: ["type"],
          properties: { type: { const: mark.name } },
        },
        minContains: 0,
        maxContains: 1,
      })),
    };
  }

  /** The marks every parent of the inline node allows, which must be the same set. Sorted by name. */
  private allowedMarks(type: NodeType): MarkType[] {
    const all = Object.values(this.schema.marks).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    const sets = Object.values(this.schema.nodes)
      .filter((parent) => this.childNames(parent).includes(type.name))
      .map((parent) => (parent.markSet ?? all).map((mark) => mark.name).sort());
    const first = sets[0];
    if (!first) return all;
    if (sets.some((set) => set.join() !== first.join()))
      throw new Error(
        `The parents of ${type.name} allow different marks on it, which the generator doesn't state in JSON Schema.`,
      );
    return all.filter((mark) => first.includes(mark.name));
  }

  private markRef(mark: MarkType): JsonSchema {
    if (!(mark.name in this.defs)) {
      const attributes = this.attributes(mark.name, mark.spec.attrs);
      this.defs[mark.name] = {
        type: "object",
        required: ["type"],
        properties: {
          type: { const: mark.name },
          ...(attributes ? { attrs: attributes } : {}),
        },
      };
    }
    return { $ref: `#/$defs/${mark.name}` };
  }

  // ── Channel fields ─────────────────────────────────────────────────────────

  /**
   * A channel field (docs/render-spec.md §2, "Field shapes"): a `doc` of one paragraph of text and
   * variables, none of them marked, and hard breaks too when the field keeps its line breaks (`lines`).
   */
  private field(lines: boolean): JsonSchema {
    const inline = ["text", "variable", ...(lines ? ["hardBreak"] : [])];
    const refs = inline.map((name) => {
      const key = `field-${name}`;
      this.defs[key] ??= this.node(this.nodeType(name), "body", {
        marks: NO_MARKS,
      });
      return { $ref: `#/$defs/${key}` };
    });
    const paragraph = this.nodeType("paragraph");
    const attributes = this.attributes("paragraph", paragraph.spec.attrs);
    const paragraphKey = lines
      ? "field-lines-paragraph"
      : "field-line-paragraph";
    this.defs[paragraphKey] = {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "paragraph" },
        ...(attributes ? { attrs: attributes } : {}),
        marks: NO_MARKS,
        content: { type: "array", items: { oneOf: refs } },
      },
    };
    return {
      type: "object",
      required: ["type", "content"],
      description: lines
        ? "A field that keeps its line breaks (the lines shape: an SMS message): one paragraph of text, variables and hard breaks, none of them marked."
        : "A one-line field (the line and paragraph shapes: an email subject or preheader, a push title, subtitle or body): one paragraph of text and variables, none of them marked, with no line breaks.",
      properties: {
        type: { const: "doc" },
        content: {
          type: "array",
          minItems: 1,
          prefixItems: [{ $ref: `#/$defs/${paragraphKey}` }],
          items: false,
        },
      },
    };
  }
}
